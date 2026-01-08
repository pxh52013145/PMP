use once_cell::sync::OnceCell;

const HTAPS: usize = 48;
const FIFOSIZE: usize = 16;
const FIFOMASK: usize = FIFOSIZE - 1;
const CTABLES: usize = (HTAPS + 7) / 8;

#[derive(Clone, Copy)]
struct Ctables {
    msbf: [[f64; 256]; CTABLES],
    lsbf: [[f64; 256]; CTABLES],
}

static CTABLES_DATA: OnceCell<Ctables> = OnceCell::new();

fn ctables() -> &'static Ctables {
    CTABLES_DATA.get_or_init(|| {
        // 48 coefficients = the second half of a 96-tap symmetric lowpass filter (Sebastian
        // Gesemann's dsd2pcm approach; also used by FFmpeg's dsd decoder).
        const HTAPS_COEFFS: [f64; HTAPS] = [
            0.09950731974056658,
            0.09562845727714668,
            0.08819647126516944,
            0.07782552527068175,
            0.06534876523171299,
            0.05172629311427257,
            0.0379429484910187,
            0.02490921351762261,
            0.0133774746265897,
            0.003883043418804416,
            -0.003284703416210726,
            -0.008080250212687497,
            -0.01067241812471033,
            -0.01139427235000863,
            -0.0106813877974587,
            -0.009007905078766049,
            -0.006828859761015335,
            -0.004535184322001496,
            -0.002425035959059578,
            -0.0006922187080790708,
            0.0005700762133516592,
            0.001353838005269448,
            0.001713709169690937,
            0.001742046839472948,
            0.001545601648013235,
            0.001226696225277855,
            0.0008704322683580222,
            0.0005381636200535649,
            0.000266446345425276,
            7.002968738383528e-05,
            -5.279407053811266e-05,
            -0.0001140625650874684,
            -0.0001304796361231895,
            -0.0001189970287491285,
            -9.396247155265073e-05,
            -6.577634378272832e-05,
            -4.07492895872535e-05,
            -2.17407957554587e-05,
            -9.163058931391722e-06,
            -2.017460145032201e-06,
            1.249721855219005e-06,
            2.166655190537392e-06,
            1.930520892991082e-06,
            1.319400334374195e-06,
            7.410039764949091e-07,
            3.423230509967409e-07,
            1.244182214744588e-07,
            3.130441005359396e-08,
        ];

        let mut msbf = [[0.0f64; 256]; CTABLES];
        let mut lsbf = [[0.0f64; 256]; CTABLES];

        for e in 0u16..=255 {
            let mut acc = [0.0f64; CTABLES];
            for m in 0..8usize {
                let bit = ((e >> (7 - m)) & 1) as i32;
                let sign = (bit * 2 - 1) as f64;
                for t in 0..CTABLES {
                    acc[t] += sign * HTAPS_COEFFS[t * 8 + m];
                }
            }

            for t in 0..CTABLES {
                let dst_t = CTABLES - 1 - t;
                msbf[dst_t][e as usize] = acc[t];
                let reversed = (e as u8).reverse_bits() as usize;
                lsbf[dst_t][reversed] = acc[t];
            }
        }

        Ctables { msbf, lsbf }
    })
}

/// Per-channel DSD->PCM state.
///
/// This translates a DSD bitstream into PCM at `dsd_sample_rate / 8` by consuming one byte
/// (8 one-bit samples) at a time and producing one float sample per input byte.
#[derive(Clone, Debug)]
pub(crate) struct Dsd2PcmContext {
    buf: [u8; FIFOSIZE],
    pos: usize,
}

impl Default for Dsd2PcmContext {
    fn default() -> Self {
        Self {
            buf: [0u8; FIFOSIZE],
            pos: 0,
        }
    }
}

impl Dsd2PcmContext {
    pub fn reset(&mut self) {
        self.buf = [0u8; FIFOSIZE];
        self.pos = 0;
    }

    pub fn translate_byte_msbf(&mut self, byte: u8) -> f32 {
        self.translate_byte(byte, false)
    }

    fn translate_byte(&mut self, byte: u8, lsbf: bool) -> f32 {
        let ctables = if lsbf {
            &ctables().lsbf
        } else {
            &ctables().msbf
        };

        self.buf[self.pos] = byte;

        // Pre-flip bits of the byte that is about to enter the mirrored part of the symmetric
        // FIR window.
        let p = (self.pos.wrapping_sub(CTABLES)) & FIFOMASK;
        self.buf[p] = self.buf[p].reverse_bits();

        let mut sum = 0.0f64;
        for i in 0..CTABLES {
            let a = self.buf[(self.pos.wrapping_sub(i)) & FIFOMASK] as usize;
            let b = self.buf[(self.pos.wrapping_sub(CTABLES * 2 - 1).wrapping_add(i)) & FIFOMASK]
                as usize;
            sum += ctables[i][a] + ctables[i][b];
        }

        self.pos = (self.pos + 1) & FIFOMASK;
        sum as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn warmup(ctx: &mut Dsd2PcmContext) {
        for _ in 0..128 {
            let _ = ctx.translate_byte_msbf(0xAA);
        }
    }

    #[test]
    fn dsd2pcm_silence_pattern_is_near_zero() {
        let mut ctx = Dsd2PcmContext::default();
        warmup(&mut ctx);

        let mut sum = 0.0f64;
        let mut sum_sq = 0.0f64;
        let n = 2048usize;
        for _ in 0..n {
            let v = ctx.translate_byte_msbf(0xAA) as f64;
            sum += v;
            sum_sq += v * v;
        }
        let mean = sum / n as f64;
        let rms = (sum_sq / n as f64).sqrt();

        assert!(mean.abs() < 0.02, "mean={mean}");
        assert!(rms < 0.05, "rms={rms}");
    }

    #[test]
    fn dsd2pcm_all_ones_is_positive_after_warmup() {
        let mut ctx = Dsd2PcmContext::default();
        warmup(&mut ctx);

        let mut max = -1.0f32;
        for _ in 0..512 {
            max = max.max(ctx.translate_byte_msbf(0xFF));
        }
        assert!(max > 0.2, "max={max}");
    }

    #[test]
    fn dsd2pcm_all_zeros_is_negative_after_warmup() {
        let mut ctx = Dsd2PcmContext::default();
        warmup(&mut ctx);

        let mut min = 1.0f32;
        for _ in 0..512 {
            min = min.min(ctx.translate_byte_msbf(0x00));
        }
        assert!(min < -0.2, "min={min}");
    }
}
