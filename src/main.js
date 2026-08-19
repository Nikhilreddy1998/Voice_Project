import './style.css';
import { eventBus } from './events/event-bus.js';
import { EVENTS } from './utils/constants.js';
import { logger } from './utils/logger.js';
import { MicrophoneManager } from './audio/microphone.js';
import { RNNoiseWrapper } from './dsp/rnnoise.js';
import { WebRtcVadWrapper } from './vad/webrtc-vad.js';
import { OpenWakeWordWrapper } from './wakeword/openwakeword.js';
import { MelSpectrogram } from './wakeword/mel-spectrogram.js';
import { SpeechEmbedding } from './wakeword/speech-embedding.js';
import { Dashboard } from './ui/dashboard.js';

// Instantiate module references
let micManager = null;
let rnnoise = null;
let vad = null;
let wakeword = null;
let melspec = null;
let speechEmbedding = null;

// Initialize GUI Dashboard
const appContainer = document.getElementById('app');
const dashboard = new Dashboard(appContainer);
dashboard.render();

logger.info('System', 'Application booster completed. Ready to initialize audio pipeline.');

// Listen for pipeline initialization request from the UI
window.addEventListener('pipeline:init', async () => {
  logger.info('System', 'Starting pipeline initialization...');

  // Initialize Microphone Manager
  micManager = new MicrophoneManager();
  
  // Initialize DSP RNNoise module
  rnnoise = new RNNoiseWrapper();
  
  // Initialize WebRTC VAD module
  vad = new WebRtcVadWrapper();
  
  // Initialize Mel Spectrogram Extractor
  melspec = new MelSpectrogram();
  
  // Initialize Speech Embedding backbone
  speechEmbedding = new SpeechEmbedding();
  
  // Initialize OpenWakeWord module
  wakeword = new OpenWakeWordWrapper();

  // Load and initialize all libraries in parallel
  const [micOk, dspOk, vadOk, wwOk, melspecOk, embeddingOk] = await Promise.all([
    micManager.initialize(),
    rnnoise.initialize(),
    vad.initialize(),
    wakeword.initialize(),
    melspec.initialize(),
    speechEmbedding.initialize()
  ]);

  if (micOk && dspOk && vadOk && wwOk && melspecOk && embeddingOk) {
    logger.info('System', 'Pipeline modules initialized successfully. You can now start listening.');
    
    // Bind the real-time processing stream pipeline
    // This hooks: Mic raw frame -> RNNoise Denoising -> WebRTC VAD -> MelSpectrogram -> OpenWakeWord inference
    eventBus.on(EVENTS.MIC_STREAM_DATA, (rawFrame) => {
      const t0 = performance.now();
      
      // 1. DSP (Denoise)
      const cleanFrame = rnnoise.process(rawFrame);
      const t1 = performance.now();
      
      // 2. Voice Activity Detection
      vad.process(cleanFrame);
      const t2 = performance.now();
      
      // 3. Mel Spectrogram Extraction (runs inference asynchronously when buffer is full)
      melspec.process(cleanFrame);

      const dspMs = t1 - t0;
      const vadMs = t2 - t1;
      const melspecMs = melspec ? melspec.metrics.lastLatencyMs : 0;
      const embeddingMs = speechEmbedding ? speechEmbedding.metrics.lastLatencyMs : 0;
      const wwMs = (wakeword && wakeword.inference && wakeword.inference.metrics) ? wakeword.inference.metrics.lastLatencyMs : 0;
      const totalMs = dspMs + vadMs + melspecMs + embeddingMs + wwMs;

      // Dispatch stage timings (estimated mic queue latency is 0.2ms)
      eventBus.emit('pipeline:timing', {
        mic: 0.2,
        dsp: dspMs,
        vad: vadMs,
        melspec: melspecMs,
        embedding: embeddingMs,
        ww: wwMs,
        total: 0.2 + totalMs
      });

      // Calculate estimated CPU usage ratio based on the 32ms audio chunk budget
      const cpuUsage = ((0.2 + totalMs) / 32) * 100;
      eventBus.emit(EVENTS.METRICS_UPDATE, {
        latencyMs: 0.2 + totalMs,
        fps: 31,
        cpuEstimation: Math.min(100, Math.max(0.1, cpuUsage))
      });
    });

  } else {
    logger.error('System', 'One or more pipeline modules failed to initialize. Check console for details.');
  }
});

// Listen for record start/stop events from the UI
window.addEventListener('pipeline:start', () => {
  if (micManager) {
    micManager.start();
    logger.info('System', 'Listening pipeline active.');
  }
});

window.addEventListener('pipeline:stop', () => {
  if (micManager) {
    micManager.stop();
    logger.info('System', 'Listening pipeline stopped.');
  }
});

// Handle window unload and cleanup resources
window.addEventListener('beforeunload', async () => {
  logger.info('System', 'Application tearing down...');
  if (micManager) await micManager.dispose();
  if (rnnoise) rnnoise.dispose();
  if (vad) vad.dispose();
  if (melspec) melspec.dispose();
  if (speechEmbedding) speechEmbedding.dispose();
  if (wakeword) await wakeword.dispose();
});
