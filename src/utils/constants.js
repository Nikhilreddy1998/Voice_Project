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

  // Performance/Telemetry Events
  METRICS_UPDATE: 'metrics:update', // Emits { latencyMs: number, fps: number, cpuEstimation: number }
  LOG: 'log', // Emits { timestamp: string, level: string, message: string }
};

export const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};
