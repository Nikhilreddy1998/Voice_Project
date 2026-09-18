import { eventBus } from '../events/event-bus.js';
import { EVENTS, AUDIO_CONFIG } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * MicrophoneManager handles obtaining microphone permission, setting up
 * the Web Audio context, loading/attaching the AudioWorkletProcessor,
 * and dispatching captured audio frames to the event bus.
 */
export class MicrophoneManager {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.isRecording = false;
    this.actualSampleRate = null;
  }

  /**
   * Check whether microphone audio pipeline is initialized.
   */
  get isInitialized() {
    return Boolean(this.audioContext && this.workletNode);
  }

  /**
   * Check whether microphone is actively streaming.
   */
  get isActive() {
    return this.isRecording;
  }

  /**
   * Get the actual active AudioContext sample rate in Hz.
   * Returns null if uninitialized, or the real hardware/driver sampleRate.
   */
  get sampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : this.actualSampleRate;
  }

  /**
   * Check whether the AudioContext is running at exactly 16000 Hz.
   */
  get isStandardSampleRate() {
    return Boolean(this.audioContext && this.audioContext.sampleRate === AUDIO_CONFIG.SAMPLE_RATE);
  }

  /**
   * Initialize microphone permission and setup the Audio Context pipeline.
   * @returns {Promise<boolean>} Resolves to true if initialization succeeded.
   */
  async initialize() {
    if (this.isInitialized) {
      return true;
    }
    logger.info('Microphone', 'Initializing microphone capture...');
    try {
      // 1. Request microphone access permission from the browser
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false
        }
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      eventBus.emit(EVENTS.MIC_PERMISSION_GRANTED);
      logger.info('Microphone', 'Permission granted successfully.');

      // 2. Initialize AudioContext at standard 16kHz
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass({
        sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
        latencyHint: 'interactive'
      });

      // Explicitly inspect and verify the actual AudioContext sample rate
      this.actualSampleRate = this.audioContext.sampleRate;
      if (this.actualSampleRate === AUDIO_CONFIG.SAMPLE_RATE) {
        logger.info(
          'Microphone',
          `AudioContext sample rate verified: ${this.actualSampleRate} Hz (matches standard 16 kHz).`
        );
      } else {
        logger.warn(
          'Microphone',
          `AudioContext sample rate mismatch: requested ${AUDIO_CONFIG.SAMPLE_RATE} Hz, but running at ${this.actualSampleRate} Hz. Downstream dataset recording will resample to 16 kHz.`
        );
      }

      // 3. Load and register the custom AudioWorkletProcessor
      await this.audioContext.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url).href);
      
      // 4. Create source node from MediaStream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 5. Connect source node to AudioWorkletNode
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      this.workletNode.port.onmessage = (event) => this.handleAudioFrame(event.data);
      this.sourceNode.connect(this.workletNode);

      eventBus.emit(EVENTS.MIC_INITIALIZED, { sampleRate: this.actualSampleRate });
      logger.info('Microphone', `Audio pipeline initialized at ${this.actualSampleRate} Hz, ready to start.`);
      return true;
    } catch (error) {
      logger.error('Microphone', `Failed to initialize microphone: ${error.message}`);
      eventBus.emit(EVENTS.MIC_ERROR, error);
      return false;
    }
  }

  /**
   * Start streaming audio data.
   */
  start() {
    if (this.isRecording) return;
    logger.info('Microphone', 'Starting audio stream capture.');
    
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    this.isRecording = true;
  }

  /**
   * Stop streaming audio data.
   */
  stop() {
    if (!this.isRecording) return;
    logger.info('Microphone', 'Stopping audio stream capture.');
    
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }
    this.isRecording = false;
  }

  /**
   * Callback fired by the Audio Worklet on the audio thread.
   * @param {Object} data - Message data from the worklet containing audioFrame and metadata.
   * @param {Float32Array} data.audioFrame - Raw audio buffer (512 samples at 16kHz)
   * @param {number} data.frameCount - Total count of processed frames
   * @param {number} data.timestamp - Timestamp from the audio thread
   * @param {number} data.bufferSize - Buffer size (512)
   */
  handleAudioFrame(data) {
    if (!this.isRecording) return;

    const { audioFrame, frameCount, timestamp, bufferSize } = data;

    // Periodically update the dashboard console log every 30 frames (~approx once per second)
    // to verify that frames are actively being received and processed, without flooding the DOM.
    if (frameCount % 30 === 0) {
      logger.info(
        'Microphone',
        `Frame received: count=${frameCount}, timestamp=${timestamp.toFixed(2)}s, size=${bufferSize}`
      );
    }

    // Emit raw audio data down the pipeline
    eventBus.emit(EVENTS.MIC_STREAM_DATA, audioFrame);
  }

  /**
   * Clean up and release system microphone resources.
   */
  async dispose() {
    this.stop();
    logger.info('Microphone', 'Disposing microphone manager resources.');

    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      await this.audioContext.close();
    }
    
    this.sourceNode = null;
    this.workletNode = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.actualSampleRate = null;
  }
}

// Shared singleton instance for unified microphone access across modules
export const microphoneManager = new MicrophoneManager();
