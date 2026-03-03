pub trait Modulator: Send + Sync {
    fn process(&mut self, sample_rate: f32) -> f32;
}

pub struct Lfo {
    pub phase: f32,
    pub freq: f32,
}

impl Modulator for Lfo {
    fn process(&mut self, sample_rate: f32) -> f32 {
        self.phase = (self.phase + self.freq / sample_rate) % 1.0;
        (self.phase * 2.0 * std::f32::consts::PI).sin()
    }
}