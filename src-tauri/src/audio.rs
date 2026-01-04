use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use hound::{WavSpec, WavWriter};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::Arc;
use std::thread;

use crate::commands::transcribe_audio_bytes;

// ============================================================================
// State Types
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordingState {
    Idle,
    Recording,
    Stopping,
}

/// Shared data between the recording thread and the Tauri commands
pub struct SharedRecordingData {
    pub state: RecordingState,
    pub samples: Vec<i16>,
    pub sample_rate: u32,
    pub channels: u16,
    pub should_stop: bool,
    pub error: Option<String>,
}

impl Default for SharedRecordingData {
    fn default() -> Self {
        Self {
            state: RecordingState::Idle,
            samples: Vec::new(),
            sample_rate: 16000,
            channels: 1,
            should_stop: false,
            error: None,
        }
    }
}

/// Tauri-managed audio state - only contains Send+Sync data
pub struct AudioState {
    pub data: Arc<Mutex<SharedRecordingData>>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            data: Arc::new(Mutex::new(SharedRecordingData::default())),
        }
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

// ============================================================================
// Audio Device Enumeration
// ============================================================================

pub fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let default_name = default_device.as_ref().and_then(|d| d.name().ok());

    let devices: Vec<AudioDeviceInfo> = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?
        .filter_map(|device| {
            device.name().ok().map(|name| AudioDeviceInfo {
                is_default: Some(&name) == default_name.as_ref(),
                name,
            })
        })
        .collect();

    Ok(devices)
}

// ============================================================================
// WAV Encoding
// ============================================================================

fn encode_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            WavWriter::new(&mut cursor, spec).map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        for &sample in samples {
            writer
                .write_sample(sample)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    }

    Ok(cursor.into_inner())
}

// ============================================================================
// Recording Thread Function
// ============================================================================

fn run_recording_thread(data: Arc<Mutex<SharedRecordingData>>) {
    // Get default input device
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            let mut guard = data.lock();
            guard.error = Some("No input device available".to_string());
            guard.state = RecordingState::Idle;
            return;
        }
    };

    // Get supported config
    let supported_config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            let mut guard = data.lock();
            guard.error = Some(format!("Failed to get input config: {}", e));
            guard.state = RecordingState::Idle;
            return;
        }
    };

    let config: StreamConfig = supported_config.config();

    // Update config info
    {
        let mut guard = data.lock();
        guard.sample_rate = config.sample_rate.0;
        guard.channels = config.channels;
    }

    // Clone data for the audio callback
    let data_clone = data.clone();

    // Build input stream based on sample format
    let stream = match supported_config.sample_format() {
        SampleFormat::I16 => build_input_stream_i16(&device, &config, data_clone),
        SampleFormat::U16 => build_input_stream_u16(&device, &config, data_clone),
        SampleFormat::F32 => build_input_stream_f32(&device, &config, data_clone),
        format => Err(format!("Unsupported sample format: {:?}", format)),
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let mut guard = data.lock();
            guard.error = Some(e);
            guard.state = RecordingState::Idle;
            return;
        }
    };

    if let Err(e) = stream.play() {
        let mut guard = data.lock();
        guard.error = Some(format!("Failed to start stream: {}", e));
        guard.state = RecordingState::Idle;
        return;
    }

    // Poll for stop signal
    loop {
        thread::sleep(std::time::Duration::from_millis(50));
        let should_stop = {
            let guard = data.lock();
            guard.should_stop
        };
        if should_stop {
            break;
        }
    }

    // Stop the stream by dropping it
    drop(stream);

    // Update state
    {
        let mut guard = data.lock();
        guard.state = RecordingState::Idle;
        guard.should_stop = false;
    }
}

// ============================================================================
// Stream Builders
// ============================================================================

fn build_input_stream_i16(
    device: &Device,
    config: &StreamConfig,
    data: Arc<Mutex<SharedRecordingData>>,
) -> Result<Stream, String> {
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    device
        .build_input_stream(
            config,
            move |samples: &[i16], _: &cpal::InputCallbackInfo| {
                let mut guard = data.lock();
                guard.samples.extend_from_slice(samples);
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))
}

fn build_input_stream_u16(
    device: &Device,
    config: &StreamConfig,
    data: Arc<Mutex<SharedRecordingData>>,
) -> Result<Stream, String> {
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    device
        .build_input_stream(
            config,
            move |samples: &[u16], _: &cpal::InputCallbackInfo| {
                let mut guard = data.lock();
                for &sample in samples {
                    guard.samples.push((sample as i32 - 32768) as i16);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))
}

fn build_input_stream_f32(
    device: &Device,
    config: &StreamConfig,
    data: Arc<Mutex<SharedRecordingData>>,
) -> Result<Stream, String> {
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    device
        .build_input_stream(
            config,
            move |samples: &[f32], _: &cpal::InputCallbackInfo| {
                let mut guard = data.lock();
                for &sample in samples {
                    let clamped = sample.clamp(-1.0, 1.0);
                    guard.samples.push((clamped * 32767.0) as i16);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub async fn start_audio_recording(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let data = state.data.clone();

    // Check if already recording
    {
        let guard = data.lock();
        if guard.state == RecordingState::Recording {
            return Err("Already recording".to_string());
        }
    }

    // Reset state and start recording
    {
        let mut guard = data.lock();
        guard.samples.clear();
        guard.error = None;
        guard.should_stop = false;
        guard.state = RecordingState::Recording;
    }

    // Spawn recording thread
    let data_clone = data.clone();
    thread::spawn(move || {
        run_recording_thread(data_clone);
    });

    // Wait a bit and check for immediate errors
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let guard = data.lock();
    if let Some(ref err) = guard.error {
        return Err(err.clone());
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_audio_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
) -> Result<String, String> {
    let data = state.data.clone();

    // Check if recording
    {
        let guard = data.lock();
        if guard.state != RecordingState::Recording {
            return Err("Not currently recording".to_string());
        }
    }

    // Signal stop
    {
        let mut guard = data.lock();
        guard.should_stop = true;
        guard.state = RecordingState::Stopping;
    }

    // Wait for recording thread to finish
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let state = {
            let guard = data.lock();
            guard.state.clone()
        };
        if state == RecordingState::Idle {
            break;
        }
    }

    // Get the recorded audio
    let (samples, sample_rate, channels, error) = {
        let mut guard = data.lock();
        let samples = std::mem::take(&mut guard.samples);
        (samples, guard.sample_rate, guard.channels, guard.error.take())
    };

    if let Some(err) = error {
        return Err(err);
    }

    if samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    // Encode to WAV
    let wav_bytes = encode_wav(&samples, sample_rate, channels)?;

    // Transcribe the audio
    transcribe_audio_bytes(&app, wav_bytes, "audio.wav", "audio/wav").await
}

#[tauri::command]
pub async fn cancel_audio_recording(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let data = state.data.clone();

    // Signal stop
    {
        let mut guard = data.lock();
        guard.should_stop = true;
    }

    // Wait a bit for cleanup
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Clear samples
    {
        let mut guard = data.lock();
        guard.samples.clear();
        guard.error = None;
        guard.state = RecordingState::Idle;
    }

    Ok(())
}

#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    list_audio_devices()
}

#[tauri::command]
pub fn get_recording_state(state: tauri::State<'_, AudioState>) -> Result<String, String> {
    let guard = state.data.lock();
    Ok(match &guard.state {
        RecordingState::Idle => "idle".to_string(),
        RecordingState::Recording => "recording".to_string(),
        RecordingState::Stopping => "stopping".to_string(),
    })
}

/// Stop recording and return raw base64-encoded WAV audio (for Gemini native multimodal)
#[tauri::command]
pub async fn stop_audio_recording_raw(
    state: tauri::State<'_, AudioState>,
) -> Result<String, String> {
    let data = state.data.clone();

    // Check if recording
    {
        let guard = data.lock();
        if guard.state != RecordingState::Recording {
            return Err("Not currently recording".to_string());
        }
    }

    // Signal stop
    {
        let mut guard = data.lock();
        guard.should_stop = true;
        guard.state = RecordingState::Stopping;
    }

    // Wait for recording thread to finish
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let state = {
            let guard = data.lock();
            guard.state.clone()
        };
        if state == RecordingState::Idle {
            break;
        }
    }

    // Get the recorded audio
    let (samples, sample_rate, channels, error) = {
        let mut guard = data.lock();
        let samples = std::mem::take(&mut guard.samples);
        (samples, guard.sample_rate, guard.channels, guard.error.take())
    };

    if let Some(err) = error {
        return Err(err);
    }

    if samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    // Encode to WAV
    let wav_bytes = encode_wav(&samples, sample_rate, channels)?;

    // Return as base64
    Ok(BASE64.encode(&wav_bytes))
}
