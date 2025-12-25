use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub const SHM_RING_VERSION: u32 = 1;
pub const SHM_RING_MAGIC: [u8; 8] = *b"PMP_SHM1";

const FLAG_HOST_READY: u32 = 1 << 0;
const FLAG_PEER_READY: u32 = 1 << 1;

#[repr(C)]
pub struct ShmRingHeaderV1 {
    pub magic: [u8; 8],
    pub version: u32,
    pub channels: u32,
    pub sample_rate: u32,
    pub capacity_frames: u32,
    pub flags: AtomicU32,
    pub heartbeat: AtomicU32,
    pub reserved: [u32; 2],
    pub write_index: AtomicU64,
    pub read_index: AtomicU64,
    pub reserved_tail: u64,
}

impl ShmRingHeaderV1 {
    fn new(sample_rate: u32, channels: u32, capacity_frames: u32) -> Self {
        Self {
            magic: SHM_RING_MAGIC,
            version: SHM_RING_VERSION,
            channels,
            sample_rate,
            capacity_frames,
            flags: AtomicU32::new(FLAG_HOST_READY),
            heartbeat: AtomicU32::new(0),
            reserved: [0; 2],
            write_index: AtomicU64::new(0),
            read_index: AtomicU64::new(0),
            reserved_tail: 0,
        }
    }

    pub fn is_peer_ready(&self) -> bool {
        (self.flags.load(Ordering::Acquire) & FLAG_PEER_READY) != 0
    }

    pub fn mark_peer_ready(&self) {
        self.flags.fetch_or(FLAG_PEER_READY, Ordering::AcqRel);
    }
}

pub struct ShmRing {
    mapping: SharedMemoryMapping,
    header_ptr: *mut ShmRingHeaderV1,
    data_ptr: *mut f32,
    channels: usize,
    capacity_frames: usize,
}

// SAFETY: `ShmRing` owns a Windows file mapping view and raw pointers into it. The mapping is
// process-wide (not thread-affine), and dropping it from any thread is safe. `Send` is required to
// store sessions inside a global `Mutex`. Callers must uphold the SPSC contract when reading/writing.
unsafe impl Send for ShmRing {}

impl ShmRing {
    pub fn create(name: &str, sample_rate: u32, channels: u32, capacity_frames: u32) -> Result<Self, String> {
        if channels == 0 {
            return Err("channels must be > 0".to_string());
        }
        if capacity_frames == 0 {
            return Err("capacityFrames must be > 0".to_string());
        }

        let data_floats = capacity_frames as usize * channels as usize;
        let data_bytes = data_floats
            .checked_mul(std::mem::size_of::<f32>())
            .ok_or_else(|| "Shared memory size overflow".to_string())?;

        let total_bytes = std::mem::size_of::<ShmRingHeaderV1>()
            .checked_add(data_bytes)
            .ok_or_else(|| "Shared memory size overflow".to_string())?;

        let mapping = SharedMemoryMapping::create(name, total_bytes)?;
        let header_ptr = mapping.view_ptr as *mut ShmRingHeaderV1;
        unsafe {
            header_ptr.write(ShmRingHeaderV1::new(sample_rate, channels, capacity_frames));
        }

        let data_ptr =
            unsafe { (mapping.view_ptr as *mut u8).add(std::mem::size_of::<ShmRingHeaderV1>()) } as *mut f32;

        Ok(Self {
            mapping,
            header_ptr,
            data_ptr,
            channels: channels as usize,
            capacity_frames: capacity_frames as usize,
        })
    }

    pub fn open(name: &str) -> Result<Self, String> {
        let mapping = SharedMemoryMapping::open(name)?;
        let header_ptr = mapping.view_ptr as *mut ShmRingHeaderV1;
        let header = unsafe { &*header_ptr };

        if header.magic != SHM_RING_MAGIC {
            return Err(format!(
                "Shared memory magic mismatch (expected {:?}, got {:?})",
                SHM_RING_MAGIC, header.magic
            ));
        }
        if header.version != SHM_RING_VERSION {
            return Err(format!(
                "Shared memory version mismatch (expected {SHM_RING_VERSION}, got {})",
                header.version
            ));
        }
        if header.channels == 0 || header.capacity_frames == 0 {
            return Err("Shared memory header invalid (channels/capacityFrames)".to_string());
        }

        header.mark_peer_ready();

        let channels = header.channels as usize;
        let capacity_frames = header.capacity_frames as usize;
        let data_ptr =
            unsafe { (mapping.view_ptr as *mut u8).add(std::mem::size_of::<ShmRingHeaderV1>()) } as *mut f32;

        Ok(Self {
            mapping,
            header_ptr,
            data_ptr,
            channels,
            capacity_frames,
        })
    }

    pub fn header(&self) -> &ShmRingHeaderV1 {
        unsafe { &*self.header_ptr }
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn capacity_frames(&self) -> usize {
        self.capacity_frames
    }

    pub fn available_to_read_frames(&self) -> usize {
        let header = self.header();
        let write = header.write_index.load(Ordering::Acquire);
        let read = header.read_index.load(Ordering::Relaxed);
        (write.saturating_sub(read)) as usize
    }

    pub fn available_to_write_frames(&self) -> usize {
        let header = self.header();
        let write = header.write_index.load(Ordering::Relaxed);
        let read = header.read_index.load(Ordering::Acquire);
        let used = write.saturating_sub(read) as usize;
        self.capacity_frames.saturating_sub(used)
    }

    pub fn try_write_interleaved_all(&self, samples: &[f32]) -> bool {
        if self.channels == 0 {
            return false;
        }
        let frames = samples.len() / self.channels;
        if frames == 0 {
            return true;
        }

        let header = self.header();
        let write = header.write_index.load(Ordering::Relaxed);
        let read = header.read_index.load(Ordering::Acquire);
        let used = write.saturating_sub(read) as usize;
        let free_frames = self.capacity_frames.saturating_sub(used);
        if free_frames < frames {
            return false;
        }

        let start = (write % self.capacity_frames as u64) as usize;
        unsafe {
            self.write_frames_at(start, &samples[..frames * self.channels], frames);
        }

        header
            .write_index
            .store(write.saturating_add(frames as u64), Ordering::Release);
        true
    }

    pub fn try_write_interleaved(&self, samples: &[f32]) -> usize {
        if self.channels == 0 {
            return 0;
        }
        let frames = samples.len() / self.channels;
        if frames == 0 {
            return 0;
        }

        let header = self.header();
        let write = header.write_index.load(Ordering::Relaxed);
        let read = header.read_index.load(Ordering::Acquire);
        let used = write.saturating_sub(read) as usize;
        let free_frames = self.capacity_frames.saturating_sub(used);
        let frames_to_write = frames.min(free_frames);
        if frames_to_write == 0 {
            return 0;
        }

        let start = (write % self.capacity_frames as u64) as usize;
        unsafe {
            self.write_frames_at(start, &samples[..frames_to_write * self.channels], frames_to_write);
        }

        header
            .write_index
            .store(write.saturating_add(frames_to_write as u64), Ordering::Release);
        frames_to_write
    }

    pub fn try_read_interleaved_all(&self, out: &mut [f32]) -> bool {
        if self.channels == 0 {
            return false;
        }
        let frames = out.len() / self.channels;
        if frames == 0 {
            return true;
        }

        let header = self.header();
        let write = header.write_index.load(Ordering::Acquire);
        let read = header.read_index.load(Ordering::Relaxed);
        let available_frames = (write.saturating_sub(read)) as usize;
        if available_frames < frames {
            return false;
        }

        let start = (read % self.capacity_frames as u64) as usize;
        unsafe {
            self.read_frames_at(start, &mut out[..frames * self.channels], frames);
        }

        header
            .read_index
            .store(read.saturating_add(frames as u64), Ordering::Release);
        true
    }

    pub fn try_read_interleaved(&self, out: &mut [f32]) -> usize {
        if self.channels == 0 {
            return 0;
        }
        let max_frames = out.len() / self.channels;
        if max_frames == 0 {
            return 0;
        }

        let header = self.header();
        let write = header.write_index.load(Ordering::Acquire);
        let read = header.read_index.load(Ordering::Relaxed);
        let available_frames = (write.saturating_sub(read)) as usize;
        let frames_to_read = max_frames.min(available_frames);
        if frames_to_read == 0 {
            return 0;
        }

        let start = (read % self.capacity_frames as u64) as usize;
        unsafe {
            self.read_frames_at(start, &mut out[..frames_to_read * self.channels], frames_to_read);
        }

        header
            .read_index
            .store(read.saturating_add(frames_to_read as u64), Ordering::Release);
        frames_to_read
    }

    unsafe fn write_frames_at(&self, start_frame: usize, samples: &[f32], frames: usize) {
        let channels = self.channels;
        let capacity = self.capacity_frames;
        let first_frames = frames.min(capacity.saturating_sub(start_frame));

        if first_frames > 0 {
            let start_sample = start_frame * channels;
            let count_samples = first_frames * channels;
            let dst = std::slice::from_raw_parts_mut(self.data_ptr.add(start_sample), count_samples);
            dst.copy_from_slice(&samples[..count_samples]);
        }

        let remaining_frames = frames.saturating_sub(first_frames);
        if remaining_frames > 0 {
            let offset_samples = first_frames * channels;
            let count_samples = remaining_frames * channels;
            let dst = std::slice::from_raw_parts_mut(self.data_ptr, count_samples);
            dst.copy_from_slice(&samples[offset_samples..offset_samples + count_samples]);
        }
    }

    unsafe fn read_frames_at(&self, start_frame: usize, out: &mut [f32], frames: usize) {
        let channels = self.channels;
        let capacity = self.capacity_frames;
        let first_frames = frames.min(capacity.saturating_sub(start_frame));

        if first_frames > 0 {
            let start_sample = start_frame * channels;
            let count_samples = first_frames * channels;
            let src = std::slice::from_raw_parts(self.data_ptr.add(start_sample), count_samples);
            out[..count_samples].copy_from_slice(src);
        }

        let remaining_frames = frames.saturating_sub(first_frames);
        if remaining_frames > 0 {
            let offset_samples = first_frames * channels;
            let count_samples = remaining_frames * channels;
            let src = std::slice::from_raw_parts(self.data_ptr, count_samples);
            out[offset_samples..offset_samples + count_samples].copy_from_slice(src);
        }
    }
}

struct SharedMemoryMapping {
    #[allow(dead_code)]
    name: String,
    handle: *mut std::ffi::c_void,
    view_ptr: *mut std::ffi::c_void,
    #[allow(dead_code)]
    size_bytes: usize,
}

impl Drop for SharedMemoryMapping {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Memory::{UnmapViewOfFile, MEMORY_MAPPED_VIEW_ADDRESS};
            if !self.view_ptr.is_null() {
                let _ = UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view_ptr });
            }
            if !self.handle.is_null() {
                let _ = CloseHandle(self.handle);
            }
        }
    }
}

impl SharedMemoryMapping {
    #[cfg(target_os = "windows")]
    fn create(name: &str, size_bytes: usize) -> Result<Self, String> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Memory::{
            CreateFileMappingW, MapViewOfFile, FILE_MAP_ALL_ACCESS, PAGE_READWRITE,
        };

        let wide = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>();
        let size = size_bytes as u64;

        unsafe {
            let handle = CreateFileMappingW(
                INVALID_HANDLE_VALUE,
                std::ptr::null(),
                PAGE_READWRITE,
                (size >> 32) as u32,
                (size & 0xFFFF_FFFF) as u32,
                wide.as_ptr(),
            );
            if handle.is_null() {
                return Err(format!("CreateFileMappingW failed: {}", GetLastError()));
            }

            let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size_bytes);
            if view.Value.is_null() {
                let err = GetLastError();
                let _ = CloseHandle(handle);
                return Err(format!("MapViewOfFile failed: {err}"));
            }

            Ok(Self {
                name: name.to_string(),
                handle,
                view_ptr: view.Value,
                size_bytes,
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn create(_name: &str, _size_bytes: usize) -> Result<Self, String> {
        Err("Shared memory is only supported on Windows".to_string())
    }

    #[cfg(target_os = "windows")]
    fn open(name: &str) -> Result<Self, String> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
        use windows_sys::Win32::System::Memory::{MapViewOfFile, OpenFileMappingW, FILE_MAP_ALL_ACCESS};

        let wide = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>();

        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_ALL_ACCESS, 0, wide.as_ptr());
            if handle.is_null() {
                return Err(format!("OpenFileMappingW failed: {}", GetLastError()));
            }

            let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, 0);
            if view.Value.is_null() {
                let err = GetLastError();
                let _ = CloseHandle(handle);
                return Err(format!("MapViewOfFile failed: {err}"));
            }

            Ok(Self {
                name: name.to_string(),
                handle,
                view_ptr: view.Value,
                size_bytes: 0,
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn open(_name: &str) -> Result<Self, String> {
        Err("Shared memory is only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{ShmRing, ShmRingHeaderV1};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    static TEST_NONCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn shm_ring_header_size_is_stable() {
        assert_eq!(std::mem::size_of::<ShmRingHeaderV1>(), 64);
        assert_eq!(std::mem::align_of::<ShmRingHeaderV1>(), 8);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shm_ring_roundtrip_wraparound() {
        let pid = std::process::id();
        let nonce = TEST_NONCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("Local\\pmp-shm-test-{pid}-{nonce}");

        let ring_host = ShmRing::create(&name, 48_000, 2, 16).expect("create shm ring");
        assert!(!ring_host.header().is_peer_ready(), "peerReady should be false before open");

        let ring_peer = ShmRing::open(&name).expect("open shm ring");
        assert!(ring_host.header().is_peer_ready(), "peerReady should be true after open");

        let channels = ring_host.channels();
        assert_eq!(channels, 2);

        let block1 = make_frames(0, 12, channels);
        assert_eq!(ring_host.try_write_interleaved(&block1), 12);

        let mut first_read = vec![0.0f32; 8 * channels];
        assert_eq!(ring_peer.try_read_interleaved(&mut first_read), 8);
        assert_eq!(first_read, block1[..8 * channels]);

        let block2 = make_frames(12, 10, channels);
        assert_eq!(ring_host.try_write_interleaved(&block2), 10);

        let mut remaining = vec![0.0f32; 14 * channels];
        assert_eq!(ring_peer.try_read_interleaved(&mut remaining), 14);

        let mut expected = Vec::new();
        expected.extend_from_slice(&block1[8 * channels..]);
        expected.extend_from_slice(&block2);
        assert_eq!(remaining, expected);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shm_bypass_copy_loop_smoke() {
        let pid = std::process::id();
        let nonce = TEST_NONCE.fetch_add(1, Ordering::Relaxed);
        let shm_in_name = format!("Local\\pmp-shm-bypass-in-{pid}-{nonce}");
        let shm_out_name = format!("Local\\pmp-shm-bypass-out-{pid}-{nonce}");

        let shm_in = ShmRing::create(&shm_in_name, 48_000, 2, 128).expect("create shm-in ring");
        let shm_out = ShmRing::create(&shm_out_name, 48_000, 2, 128).expect("create shm-out ring");

        let stop = Arc::new(AtomicBool::new(false));
        let stop_worker = stop.clone();

        let worker = std::thread::spawn(move || {
            let in_peer = ShmRing::open(&shm_in_name).expect("open shm-in ring");
            let out_peer = ShmRing::open(&shm_out_name).expect("open shm-out ring");
            let channels = in_peer.channels();

            let mut buffer = vec![0.0f32; 64 * channels];
            while !stop_worker.load(Ordering::Acquire) {
                let frames = in_peer.try_read_interleaved(&mut buffer);
                if frames == 0 {
                    std::thread::sleep(Duration::from_millis(1));
                    continue;
                }
                let _ = out_peer.try_write_interleaved(&buffer[..frames * channels]);
            }
        });

        let ready_deadline = Instant::now() + Duration::from_millis(250);
        while Instant::now() < ready_deadline {
            if shm_in.header().is_peer_ready() && shm_out.header().is_peer_ready() {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(shm_in.header().is_peer_ready(), "shm-in peerReady not set");
        assert!(shm_out.header().is_peer_ready(), "shm-out peerReady not set");

        let channels = shm_in.channels();
        let frames = 32usize;
        let input = make_frames(0, frames, channels);
        assert_eq!(shm_in.try_write_interleaved(&input), frames);

        let mut output = vec![0.0f32; frames * channels];
        let mut read_total = 0usize;
        let io_deadline = Instant::now() + Duration::from_millis(250);
        while read_total < frames && Instant::now() < io_deadline {
            let got = shm_out.try_read_interleaved(&mut output[read_total * channels..]);
            if got == 0 {
                std::thread::sleep(Duration::from_millis(1));
                continue;
            }
            read_total += got;
        }

        stop.store(true, Ordering::Release);
        let _ = worker.join();

        assert_eq!(read_total, frames);
        assert_eq!(output, input);
    }

    fn make_frames(start_frame: u32, frames: usize, channels: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(frames * channels);
        for frame in 0..frames as u32 {
            let id = start_frame + frame;
            for ch in 0..channels as u32 {
                out.push(id as f32 + (ch as f32) * 0.25);
            }
        }
        out
    }
}
