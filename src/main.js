import './style.css';
import { eventBus } from './events/event-bus.js';
import { EVENTS } from './utils/constants.js';
import { logger } from './utils/logger.js';
import { MicrophoneManager } from './audio/microphone.js';
import { RNNoiseWrapper } from './dsp/rnnoise.js';
import { WebRtcVadWrapper } from './vad/webrtc-vad.js';
import { OpenWakeWordWrapper } from './wakeword/openwakeword.js';
import { Dashboard } from './ui/dashboard.js';

// Instantiate module references
let micManager = null;
let rnnoise = null;
let vad = null;
let wakeword = null;

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
  
  // Initialize OpenWakeWord module
  wakeword = new OpenWakeWordWrapper();

  // Load and initialize all libraries in parallel
  const [micOk, dspOk, vadOk, wwOk] = await Promise.all([
    micManager.initialize(),
    rnnoise.initialize(),
    vad.initialize(),
    wakeword.initialize()
  ]);

  if (micOk && dspOk && vadOk && wwOk) {
    logger.info('System', 'Pipeline modules initialized successfully. You can now start listening.');
    
    // Bind the real-time processing stream pipeline
    // This hooks: Mic raw frame -> RNNoise Denoising -> WebRTC VAD -> OpenWakeWord inference
    eventBus.on(EVENTS.MIC_STREAM_DATA, (rawFrame) => {
      // 1. DSP (Denoise)
      const cleanFrame = rnnoise.process(rawFrame);
      
      // 2. Voice Activity Detection
      vad.process(cleanFrame);
      
      // 3. Wake Word Classifier Inference
      wakeword.process(cleanFrame);
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
  if (wakeword) await wakeword.dispose();
});
