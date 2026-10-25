use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

pub const MAX_SECONDS: u64 = 300;
type Level = Arc<dyn Fn(f32) + Send + Sync>;

pub struct Recording {
    pub wav: Vec<u8>,
    pub duration_ms: u64,
    pub raw_peak: f32,
}

enum Command {
    Start(
        Option<String>,
        bool,
        Level,
        mpsc::Sender<Result<(), String>>,
    ),
    Stop(mpsc::Sender<Result<Recording, String>>),
    Chunk(mpsc::Sender<Result<Vec<u8>, String>>),
    Cancel,
}

#[derive(Clone)]
pub struct Recorder(mpsc::Sender<Command>);

impl Recorder {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut active = None;
            for command in receiver {
                match command {
                    Command::Start(device, capture_audio, level, reply) => {
                        let result = if active.is_some() {
                            Err("voice.error.busy".into())
                        } else {
                            open(device.as_deref(), capture_audio, level)
                                .map(|capture| active = Some(capture))
                        };
                        let _ = reply.send(result);
                    }
                    Command::Stop(reply) => {
                        let result = active
                            .take()
                            .ok_or_else(|| "voice.error.idle".to_string())
                            .and_then(Capture::finish);
                        let _ = reply.send(result);
                    }
                    Command::Chunk(reply) => {
                        let result = active
                            .as_mut()
                            .ok_or_else(|| "voice.error.idle".to_string())
                            .map(Capture::chunk);
                        let _ = reply.send(result);
                    }
                    Command::Cancel => active = None,
                }
            }
        });
        Self(sender)
    }

    pub fn start(
        &self,
        device: Option<String>,
        capture_audio: bool,
        level: Level,
    ) -> Result<(), String> {
        let (sender, receiver) = mpsc::channel();
        self.0
            .send(Command::Start(device, capture_audio, level, sender))
            .map_err(|_| "voice.error.microphone")?;
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "voice.error.microphone")?
    }

    pub fn stop(&self) -> Result<Recording, String> {
        let (sender, receiver) = mpsc::channel();
        self.0
            .send(Command::Stop(sender))
            .map_err(|_| "voice.error.microphone")?;
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "voice.error.microphone")?
    }

    pub fn cancel(&self) {
        let _ = self.0.send(Command::Cancel);
    }

    pub fn chunk(&self) -> Result<Vec<u8>, String> {
        let (sender, receiver) = mpsc::channel();
        self.0
            .send(Command::Chunk(sender))
            .map_err(|_| "voice.error.microphone")?;
        receiver
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "voice.error.microphone")?
    }
}

pub fn devices() -> Result<Vec<String>, String> {
    cpal::default_host()
        .input_devices()
        .map_err(|_| "voice.error.microphone".into())
        .map(|devices| devices.filter_map(|device| device.name().ok()).collect())
}

#[derive(Default)]
struct CapturedSamples {
    samples: Vec<f32>,
    raw_peak: f32,
}

struct Capture {
    stream: cpal::Stream,
    samples: Arc<Mutex<CapturedSamples>>,
    error: Arc<Mutex<Option<String>>>,
    rate: u32,
    streamed: usize,
}

impl Capture {
    fn chunk(&mut self) -> Vec<u8> {
        let captured = self.samples.lock().unwrap();
        let samples = &captured.samples;
        // Keep one input sample for interpolation across callback boundaries.
        let count = samples.len().saturating_sub(1) as u64 * 16000 / u64::from(self.rate);
        let chunk = pcm(samples, self.rate, self.streamed, count as usize);
        self.streamed = count as usize;
        chunk
    }

    fn finish(self) -> Result<Recording, String> {
        drop(self.stream);
        if self.error.lock().unwrap().is_some() {
            return Err("voice.error.microphone".into());
        }
        let captured = self.samples.lock().unwrap();
        let samples = &captured.samples;
        if samples.is_empty() {
            return Err("voice.error.noAudio".into());
        }
        Ok(Recording {
            duration_ms: samples.len() as u64 * 1000 / self.rate as u64,
            wav: wav(samples, self.rate),
            raw_peak: captured.raw_peak,
        })
    }
}

fn open(name: Option<&str>, capture_audio: bool, level: Level) -> Result<Capture, String> {
    let host = cpal::default_host();
    let device = if let Some(name) = name {
        host.input_devices()
            .map_err(|_| "voice.error.microphone")?
            .find(|device| device.name().is_ok_and(|current| current == name))
    } else {
        host.default_input_device()
    }
    .ok_or("voice.error.noMicrophone")?;
    let supported = device
        .default_input_config()
        .map_err(|_| "voice.error.microphone")?;
    let config: cpal::StreamConfig = supported.clone().into();
    let samples = Arc::new(Mutex::new(CapturedSamples::default()));
    let error = Arc::new(Mutex::new(None));
    macro_rules! build {
        ($sample:ty) => {
            input::<$sample>(
                &device,
                &config,
                samples.clone(),
                error.clone(),
                capture_audio,
                level,
            )
        };
    }
    let stream = match supported.sample_format() {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        _ => return Err("voice.error.microphone".into()),
    }
    .map_err(|_| "voice.error.microphone")?;
    stream.play().map_err(|_| "voice.error.microphone")?;
    Ok(Capture {
        stream,
        samples,
        error,
        rate: config.sample_rate.0,
        streamed: 0,
    })
}

pub(super) struct LevelMeter {
    peak: f32,
    emitted: Instant,
}

pub(super) struct InputGain {
    envelope: f32,
    gain: f32,
    decay: f32,
    rise: f32,
    fall: f32,
}

impl InputGain {
    pub(super) fn new(rate: u32) -> Self {
        let rate = rate as f32;
        Self {
            envelope: 0.0,
            gain: 1.0,
            decay: (-1.0 / (rate * 0.25)).exp(),
            rise: (-1.0 / (rate * 0.08)).exp(),
            fall: (-1.0 / (rate * 0.005)).exp(),
        }
    }

    pub(super) fn process(&mut self, sample: f32) -> f32 {
        let magnitude = sample.abs();
        self.envelope = magnitude.max(self.envelope * self.decay);
        let target = if self.envelope >= 0.001 {
            (0.35 / self.envelope).clamp(1.0, 64.0)
        } else {
            1.0
        };
        let smoothing = if target < self.gain {
            self.fall
        } else {
            self.rise
        };
        self.gain = target + (self.gain - target) * smoothing;
        // Lower gain immediately for transients instead of clipping the boosted sample.
        if magnitude > 0.0 {
            self.gain = self.gain.min((0.95 / magnitude).max(1.0));
        }
        sample * self.gain
    }
}

impl LevelMeter {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            peak: 0.0,
            emitted: now,
        }
    }

    pub(super) fn update(&mut self, peak: f32, now: Instant) -> Option<f32> {
        self.peak = self.peak.max(peak);
        if now.duration_since(self.emitted) < Duration::from_millis(80) {
            return None;
        }
        self.emitted = now;
        // A -72..0 dBFS meter makes quiet speech visible without changing the audio.
        let level = ((20.0 * self.peak.log10() + 72.0) / 72.0).clamp(0.0, 1.0);
        self.peak = 0.0;
        Some(level)
    }
}

fn input<T: SizedSample + Sample>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<CapturedSamples>>,
    error: Arc<Mutex<Option<String>>>,
    capture_audio: bool,
    level: Level,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let limit = config.sample_rate.0 as usize * MAX_SECONDS as usize;
    let mut meter = LevelMeter::new(Instant::now());
    let mut gain = InputGain::new(config.sample_rate.0);
    let error_level = level.clone();
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let mut captured = samples.lock().unwrap();
            let mut peak = 0.0_f32;
            for frame in data.chunks_exact(channels) {
                // Speech devices can expose an unused second channel. Match the
                // mono capture path instead of attenuating speech with silence.
                let value = frame[0].to_sample::<f32>();
                let value = if value.is_finite() {
                    value.clamp(-1.0, 1.0)
                } else {
                    0.0
                };
                let enhanced = gain.process(value);
                peak = peak.max(enhanced.abs());
                if capture_audio && captured.samples.len() < limit {
                    captured.raw_peak = captured.raw_peak.max(value.abs());
                    captured.samples.push(enhanced);
                }
            }
            drop(captured);
            if let Some(reading) = meter.update(peak, Instant::now()) {
                level(reading);
            }
        },
        move |_| {
            *error.lock().unwrap() = Some("voice.error.microphone".into());
            error_level(-1.0);
        },
        None,
    )
}

pub(super) fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let count = samples.len() as u64 * 16000 / rate as u64;
    let length = count as u32 * 2;
    let mut bytes = Vec::with_capacity(length as usize + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(length + 36).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
    bytes.extend_from_slice(&16000_u32.to_le_bytes());
    bytes.extend_from_slice(&32000_u32.to_le_bytes());
    bytes.extend_from_slice(b"\x02\0\x10\0data");
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(&pcm(samples, rate, 0, count as usize));
    bytes
}

pub(super) fn pcm(samples: &[f32], rate: u32, start: usize, end: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(end.saturating_sub(start) * 2);
    for index in start..end {
        let position = index as f64 * rate as f64 / 16000.0;
        let left = position as usize;
        let right = (left + 1).min(samples.len() - 1);
        let value = samples[left] + (samples[right] - samples[left]) * position.fract() as f32;
        bytes.extend_from_slice(&((value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
    }
    bytes
}
