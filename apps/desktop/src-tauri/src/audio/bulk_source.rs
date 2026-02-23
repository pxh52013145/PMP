use rodio::Source;

pub(crate) trait BulkSource: Source<Item = f32> {
    fn fill_buffer(&mut self, buf: &mut [f32]) -> usize {
        let mut written = 0usize;
        for slot in buf.iter_mut() {
            let Some(sample) = self.next() else {
                break;
            };
            *slot = sample;
            written += 1;
        }
        written
    }
}
