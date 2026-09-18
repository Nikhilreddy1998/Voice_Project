/**
 * System-wide constants for the Wake Word Detection project.
 */
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000, // OpenWakeWord and WebRTC VAD expect 16kHz audio
  FRAME_SIZE: 512,    // Process audio in 512-sample frames (32ms at 16kHz)
  CHANNEL_COUNT: 1,   // Mono audio
};

export const EVENTS = {
  // Microphone Events
  MIC_INITIALIZED: 'mic:initialized',
  MIC_ERROR: 'mic:error',
  MIC_PERMISSION_GRANTED: 'mic:permission-granted',
  MIC_STREAM_DATA: 'mic:data',

  // DSP Events
  DSP_INITIALIZED: 'dsp:initialized',
  DSP_PROCESSED: 'dsp:processed',

  // VAD Events
  VAD_INITIALIZED: 'vad:initialized',
  SPEECH_START: 'speech:start',
  SPEECH_END: 'speech:end',
  VAD_STATE_CHANGE: 'vad:state-change', // Emits { active: boolean }
  VAD_READY: 'vad:ready',
  VAD_ERROR: 'vad:error',
  VAD_METRICS: 'vad:metrics',

  // Wake Word Events
  WAKEWORD_INITIALIZED: 'wakeword:initialized',
  WAKEWORD_DETECTED: 'wakeword:detected', // Emits { word: string, probability: number }
  WAKEWORD_READY: 'wakeword:ready',
  WAKEWORD_ERROR: 'wakeword:error',
  WAKEWORD_METRICS: 'wakeword:metrics',
  WAKEWORD_PROGRESS: 'wakeword:progress',

  // Mel Spectrogram Events
  MELSPEC_READY: 'melspec:ready',
  MELSPEC_ERROR: 'melspec:error',
  MELSPEC_FEATURES: 'melspec:features',
  MELSPEC_METRICS: 'melspec:metrics',
  MELSPEC_PROGRESS: 'melspec:progress',

  // Speech Embedding Events
  EMBEDDING_READY: 'embedding:ready',
  EMBEDDING_ERROR: 'embedding:error',
  EMBEDDING_FEATURES: 'embedding:features',
  EMBEDDING_METRICS: 'embedding:metrics',
  EMBEDDING_PROGRESS: 'embedding:progress',

  // Performance/Telemetry Events
  METRICS_UPDATE: 'metrics:update', // Emits { latencyMs: number, fps: number, cpuEstimation: number }
  LOG: 'log', // Emits { timestamp: string, level: string, message: string }

  // Dataset Recording Events
  DATASET_RECORDING_STARTED: 'dataset:recording-started',
  DATASET_RECORDING_STOPPED: 'dataset:recording-stopped',
  DATASET_RECORDING_READY: 'dataset:recording-ready',
  DATASET_RECORDING_SAVED: 'dataset:recording-saved',
  DATASET_RECORDING_DISCARDED: 'dataset:recording-discarded',
  DATASET_RECORDING_ERROR: 'dataset:recording-error',
};

export const DATASET_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
  MIN_DURATION_SEC: 2.0,
  MAX_DURATION_SEC: 4.0,
  MIN_RMS_THRESHOLD: 0.003,
  MAX_DC_OFFSET_WARN: 0.08,
};

export const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};
