use std::sync::atomic::{AtomicU32, Ordering};

pub(crate) fn store_atomic_f32(target: &AtomicU32, value: f32) {
    target.store(value.to_bits(), Ordering::Release);
}

pub(crate) fn load_atomic_f32(target: &AtomicU32) -> f32 {
    f32::from_bits(target.load(Ordering::Acquire))
}
