use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use once_cell::sync::OnceCell;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::Duration,
};

use crate::audio::{engine::SpectrumTapKind, events::NativeAudioSpectrumFramePayload};

const BINARY_FRAME_MAGIC: [u8; 4] = *b"PMS1";
const BINARY_FRAME_VERSION: u8 = 1;
const BINARY_FRAME_HEADER_BYTES: usize = 32;
const FLAG_HAS_TIME_DOMAIN: u8 = 0b0000_0001;
const MAX_CLIENTS: usize = 8;
const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

static SERVER: OnceCell<Arc<SpectrumBinaryStreamServer>> = OnceCell::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumStreamEndpoint {
    pub url: String,
    pub protocol_version: u8,
}

struct ClientMailbox {
    frame: Mutex<Option<Arc<[u8]>>>,
    wake: Condvar,
    closed: AtomicBool,
}

impl ClientMailbox {
    fn new() -> Self {
        Self {
            frame: Mutex::new(None),
            wake: Condvar::new(),
            closed: AtomicBool::new(false),
        }
    }

    fn replace_latest(&self, frame: Arc<[u8]>) {
        if let Ok(mut slot) = self.frame.lock() {
            *slot = Some(frame);
            self.wake.notify_one();
        }
    }

    fn take_next(&self, shutting_down: &AtomicBool) -> Option<Arc<[u8]>> {
        let mut slot = self.frame.lock().ok()?;
        while slot.is_none()
            && !shutting_down.load(Ordering::Acquire)
            && !self.closed.load(Ordering::Acquire)
        {
            let (next_slot, _) = self
                .wake
                .wait_timeout(slot, Duration::from_millis(250))
                .ok()?;
            slot = next_slot;
        }
        slot.take()
    }

    fn wake_shutdown(&self) {
        self.wake.notify_all();
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.wake.notify_all();
    }
}

struct SpectrumBinaryStreamInner {
    token: String,
    clients: Mutex<HashMap<u64, Arc<ClientMailbox>>>,
    next_client_id: AtomicU64,
    shutdown: AtomicBool,
}

impl SpectrumBinaryStreamInner {
    fn register_client(&self) -> Option<(u64, Arc<ClientMailbox>)> {
        let mut clients = self.clients.lock().ok()?;
        if clients.len() >= MAX_CLIENTS {
            return None;
        }
        let client_id = self.next_client_id.fetch_add(1, Ordering::Relaxed);
        let mailbox = Arc::new(ClientMailbox::new());
        clients.insert(client_id, mailbox.clone());
        Some((client_id, mailbox))
    }

    fn unregister_client(&self, client_id: u64) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.remove(&client_id);
        }
    }

    fn publish(&self, frame: Arc<[u8]>) -> bool {
        let mailboxes = match self.clients.lock() {
            Ok(clients) => clients.values().cloned().collect::<Vec<_>>(),
            Err(_) => return false,
        };
        if mailboxes.is_empty() {
            return false;
        }
        for mailbox in mailboxes {
            mailbox.replace_latest(frame.clone());
        }
        true
    }

    fn has_clients(&self) -> bool {
        self.clients
            .lock()
            .map(|clients| !clients.is_empty())
            .unwrap_or(false)
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        if let Ok(clients) = self.clients.lock() {
            for mailbox in clients.values() {
                mailbox.wake_shutdown();
            }
        }
    }
}

struct SpectrumBinaryStreamServer {
    inner: Arc<SpectrumBinaryStreamInner>,
    url: String,
}

impl SpectrumBinaryStreamServer {
    fn start() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("Failed to bind spectrum stream: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Failed to configure spectrum stream: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Failed to read spectrum stream address: {error}"))?
            .port();
        let token = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(48)
            .map(char::from)
            .collect::<String>();
        let inner = Arc::new(SpectrumBinaryStreamInner {
            token: token.clone(),
            clients: Mutex::new(HashMap::new()),
            next_client_id: AtomicU64::new(1),
            shutdown: AtomicBool::new(false),
        });
        let accept_inner = inner.clone();
        thread::Builder::new()
            .name("pmp-spectrum-stream".into())
            .spawn(move || accept_loop(listener, accept_inner))
            .map_err(|error| format!("Failed to start spectrum stream: {error}"))?;

        Ok(Self {
            inner,
            url: format!("ws://127.0.0.1:{port}/audio-spectrum?token={token}"),
        })
    }

    fn endpoint(&self) -> SpectrumStreamEndpoint {
        SpectrumStreamEndpoint {
            url: self.url.clone(),
            protocol_version: BINARY_FRAME_VERSION,
        }
    }
}

pub(crate) fn open() -> Result<SpectrumStreamEndpoint, String> {
    let server = SERVER.get_or_try_init(|| SpectrumBinaryStreamServer::start().map(Arc::new))?;
    Ok(server.endpoint())
}

pub(crate) fn publish_frame(payload: &NativeAudioSpectrumFramePayload<'_>) -> bool {
    let Some(server) = SERVER.get() else {
        return false;
    };
    if server.inner.shutdown.load(Ordering::Acquire) {
        return false;
    }
    server.inner.publish(encode_frame(payload))
}

pub(crate) fn has_subscribers() -> bool {
    SERVER
        .get()
        .map(|server| !server.inner.shutdown.load(Ordering::Acquire) && server.inner.has_clients())
        .unwrap_or(false)
}

pub(crate) fn shutdown() {
    if let Some(server) = SERVER.get() {
        server.inner.shutdown();
    }
}

fn encode_frame(payload: &NativeAudioSpectrumFramePayload<'_>) -> Arc<[u8]> {
    let bins = payload.bins;
    let time_domain = payload.time_domain.unwrap_or_default();
    let bins_len = bins.len().min(u16::MAX as usize);
    let time_len = time_domain.len().min(u16::MAX as usize);
    let mut bytes = Vec::with_capacity(BINARY_FRAME_HEADER_BYTES + bins_len + time_len);
    bytes.extend_from_slice(&BINARY_FRAME_MAGIC);
    bytes.push(BINARY_FRAME_VERSION);
    bytes.push(match payload.tap {
        SpectrumTapKind::PreDsp => 0,
        SpectrumTapKind::PostDsp => 1,
    });
    bytes.push(if time_len > 0 {
        FLAG_HAS_TIME_DOMAIN
    } else {
        0
    });
    bytes.push(0);
    bytes.extend_from_slice(&payload.frame_id.to_le_bytes());
    bytes.extend_from_slice(&payload.timestamp_ms.to_le_bytes());
    bytes.extend_from_slice(&payload.sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(bins_len as u16).to_le_bytes());
    bytes.extend_from_slice(&(time_len as u16).to_le_bytes());
    bytes.extend_from_slice(&bins[..bins_len]);
    bytes.extend_from_slice(&time_domain[..time_len]);
    Arc::from(bytes.into_boxed_slice())
}

fn accept_loop(listener: TcpListener, inner: Arc<SpectrumBinaryStreamInner>) {
    while !inner.shutdown.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                let client_inner = inner.clone();
                let _ = thread::Builder::new()
                    .name("pmp-spectrum-client".into())
                    .spawn(move || handle_client(stream, client_inner));
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn handle_client(mut stream: TcpStream, inner: Arc<SpectrumBinaryStreamInner>) {
    if complete_handshake(&mut stream, &inner.token).is_err() {
        return;
    }
    let _ = stream.set_write_timeout(Some(Duration::from_millis(50)));
    let Some((client_id, mailbox)) = inner.register_client() else {
        return;
    };
    let reader_mailbox = mailbox.clone();
    let mut reader_stream = match stream.try_clone() {
        Ok(reader) => reader,
        Err(_) => {
            inner.unregister_client(client_id);
            return;
        }
    };
    let _ = reader_stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = thread::Builder::new()
        .name("pmp-spectrum-client-read".into())
        .spawn(move || watch_client_close(&mut reader_stream, reader_mailbox));

    loop {
        if inner.shutdown.load(Ordering::Acquire) || mailbox.closed.load(Ordering::Acquire) {
            break;
        }
        let Some(frame) = mailbox.take_next(&inner.shutdown) else {
            continue;
        };
        if write_binary_websocket_frame(&mut stream, &frame).is_err() {
            break;
        }
    }
    mailbox.close();
    let _ = stream.shutdown(Shutdown::Both);
    inner.unregister_client(client_id);
}

fn watch_client_close(stream: &mut TcpStream, mailbox: Arc<ClientMailbox>) {
    let mut buffer = [0u8; 128];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => break,
            Err(error)
                if error.kind() == ErrorKind::WouldBlock || error.kind() == ErrorKind::TimedOut =>
            {
                if mailbox.closed.load(Ordering::Acquire) {
                    return;
                }
            }
            Err(_) => break,
        }
    }
    mailbox.close();
}

fn complete_handshake(stream: &mut TcpStream, token: &str) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = read_http_request(stream)?;
    let key = request_header(&request, "sec-websocket-key")
        .ok_or_else(|| "Missing WebSocket key".to_string())?;
    if !is_authorized_request(&request, token) {
        let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return Err("Unauthorized spectrum stream client".into());
    }
    let mut digest = Sha1::new();
    digest.update(key.as_bytes());
    digest.update(WEBSOCKET_GUID.as_bytes());
    let accept = BASE64_STANDARD.encode(digest.finalize());
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("Failed to complete spectrum stream handshake: {error}"))?;
    Ok(())
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, String> {
    const MAX_REQUEST_BYTES: usize = 8 * 1024;
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    while request.len() < MAX_REQUEST_BYTES {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read spectrum stream handshake: {error}"))?;
        if count == 0 {
            return Err("Spectrum stream client disconnected during handshake".into());
        }
        request.extend_from_slice(&buffer[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return String::from_utf8(request)
                .map_err(|error| format!("Invalid spectrum stream handshake: {error}"));
        }
    }
    Err("Spectrum stream handshake exceeds size limit".into())
}

fn request_header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    request.lines().skip(1).find_map(|line| {
        let (candidate, value) = line.split_once(':')?;
        candidate
            .trim()
            .eq_ignore_ascii_case(name)
            .then_some(value.trim())
    })
}

fn is_authorized_request(request: &str, token: &str) -> bool {
    let Some(request_line) = request.lines().next() else {
        return false;
    };
    let mut parts = request_line.split_ascii_whitespace();
    if parts.next() != Some("GET") {
        return false;
    }
    let Some(target) = parts.next() else {
        return false;
    };
    let Some((path, query)) = target.split_once('?') else {
        return false;
    };
    path == "/audio-spectrum"
        && query
            .split('&')
            .any(|entry| entry.strip_prefix("token=") == Some(token))
}

fn write_binary_websocket_frame(stream: &mut TcpStream, payload: &[u8]) -> Result<(), String> {
    stream
        .write_all(&[0x82])
        .map_err(|error| format!("Failed to write spectrum frame opcode: {error}"))?;
    match payload.len() {
        length @ 0..=125 => stream
            .write_all(&[length as u8])
            .map_err(|error| format!("Failed to write spectrum frame length: {error}"))?,
        length @ 126..=65_535 => {
            stream
                .write_all(&[126])
                .and_then(|_| stream.write_all(&(length as u16).to_be_bytes()))
                .map_err(|error| format!("Failed to write spectrum frame length: {error}"))?;
        }
        length => {
            stream
                .write_all(&[127])
                .and_then(|_| stream.write_all(&(length as u64).to_be_bytes()))
                .map_err(|error| format!("Failed to write spectrum frame length: {error}"))?;
        }
    }
    stream
        .write_all(payload)
        .map_err(|error| format!("Failed to write spectrum frame payload: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_frame_layout_preserves_metadata_and_bytes() {
        let bins = [7u8, 8, 9];
        let time_domain = [10u8, 11];
        let payload = NativeAudioSpectrumFramePayload {
            frame_id: 42,
            timestamp_ms: 99,
            tap: SpectrumTapKind::PostDsp,
            tap_id: Some("post-dsp"),
            sample_rate: 48_000,
            bins: &bins,
            time_domain: Some(&time_domain),
        };

        let encoded = encode_frame(&payload);
        assert_eq!(&encoded[..4], BINARY_FRAME_MAGIC);
        assert_eq!(encoded[4], BINARY_FRAME_VERSION);
        assert_eq!(encoded[5], 1);
        assert_eq!(encoded[6], FLAG_HAS_TIME_DOMAIN);
        assert_eq!(u64::from_le_bytes(encoded[8..16].try_into().unwrap()), 42);
        assert_eq!(u64::from_le_bytes(encoded[16..24].try_into().unwrap()), 99);
        assert_eq!(
            u32::from_le_bytes(encoded[24..28].try_into().unwrap()),
            48_000
        );
        assert_eq!(u16::from_le_bytes(encoded[28..30].try_into().unwrap()), 3);
        assert_eq!(u16::from_le_bytes(encoded[30..32].try_into().unwrap()), 2);
        assert_eq!(&encoded[32..], [7, 8, 9, 10, 11]);
    }

    #[test]
    fn authorization_requires_the_exact_capability_token() {
        assert!(is_authorized_request(
            "GET /audio-spectrum?token=expected HTTP/1.1\r\nHost: localhost\r\n",
            "expected"
        ));
        assert!(!is_authorized_request(
            "GET /audio-spectrum?token=unexpected HTTP/1.1\r\nHost: localhost\r\n",
            "expected"
        ));
    }
}
