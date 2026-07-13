import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * WebRtcVadWrapper wraps WebRTC VAD (Voice Activity Detection)
 * to distinguish speech from background silence or steady noise.
 */
export class WebRtcVadWrapper {
  constructor() {
    this.vadInstance = null;
    this.isInitialized = false;
    this.isSpeechActive = false;
    this.speechDebounceTimeout = null;
    this.speechThresholdMs = 200; // Debounce speech changes
  }

  /**
   * Initialize WebRTC VAD library.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    logger.info('VAD', 'Loading WebRTC VAD module...');
    try {
      // 1. Load WebRTC VAD module (e.g., standard WASM or JS library)
      // TODO: Instantiate WebRTC VAD library or WASM wrapper
      // this.vadInstance = await WebRtcVad.create();

      this.isInitialized = true;
      eventBus.emit(EVENTS.VAD_INITIALIZED);
      logger.info('VAD', 'WebRTC VAD initialized successfully.');
      return true;
    } catch (error) {
      logger.error('VAD', `Failed to initialize WebRTC VAD: ${error.message}`);
      return false;
    }
  }

  /**
   * Process a single denoised audio frame for Voice Activity Detection.
   * Note: WebRTC VAD operates on 10ms, 20ms, or 30ms frames (160, 320, 480 samples at 16kHz).
   * 
   * @param {Float32Array} frame - Denoised PCM Float32 audio frame.
   */
  process(_frame) {
    if (!this.isInitialized) return;

    // TODO: Convert float32 [-1.0, 1.0] samples to 16-bit signed PCM integers as required by WebRTC VAD
    // const pcmDataInt16 = new Int16Array(frame.length);
    // for (let i = 0; i < frame.length; i++) {
    //   pcmDataInt16[i] = Math.min(1, Math.max(-1, frame[i])) * 0x7FFF;
    // }

    // TODO: Invoke WebRTC VAD library processing
    // const isSpeechFrame = this.vadInstance.process(pcmDataInt16);
    const isSpeechFrame = false; // Placeholder simulation

    this._handleSpeechDecision(isSpeechFrame);
  }

  /**
   * Transition state and trigger events when speech starts/ends with debouncing.
   * @param {boolean} isSpeechFrame - Immediate VAD classifier decision.
   * @private
   */
  _handleSpeechDecision(isSpeechFrame) {
    if (isSpeechFrame) {
      if (this.speechDebounceTimeout) {
        clearTimeout(this.speechDebounceTimeout);
        this.speechDebounceTimeout = null;
      }

      if (!this.isSpeechActive) {
        this.isSpeechActive = true;
        logger.info('VAD', 'Speech detected (speechStart).');
        eventBus.emit(EVENTS.SPEECH_START);
        eventBus.emit(EVENTS.VAD_STATE_CHANGE, { active: true });
      }
    } else {
      // If we currently think speech is active but frame is silence, wait to emit speechEnd
      if (this.isSpeechActive && !this.speechDebounceTimeout) {
        this.speechDebounceTimeout = setTimeout(() => {
          this.isSpeechActive = false;
          logger.info('VAD', 'Silence detected (speechEnd).');
          eventBus.emit(EVENTS.SPEECH_END);
          eventBus.emit(EVENTS.VAD_STATE_CHANGE, { active: false });
          this.speechDebounceTimeout = null;
        }, this.speechThresholdMs);
      }
    }
  }

  /**
   * Release VAD library resources.
   */
  dispose() {
    if (!this.isInitialized) return;
    logger.info('VAD', 'Disposing WebRTC VAD resources.');

    if (this.speechDebounceTimeout) {
      clearTimeout(this.speechDebounceTimeout);
      this.speechDebounceTimeout = null;
    }

    // TODO: Free VAD instances and pointers
    this.vadInstance = null;
    this.isInitialized = false;
    this.isSpeechActive = false;
  }
}
