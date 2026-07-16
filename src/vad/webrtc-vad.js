// Pre-declare WebRtcVadWasm global property to avoid strict-mode ReferenceError in imported library
globalThis.WebRtcVadWasm = undefined;

import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * WebRtcVadWrapper wraps WebRTC VAD (Voice Activity Detection)
 * to distinguish speech from background silence or steady noise.
 */
export class WebRtcVadWrapper {
  constructor() {
    this.wasmModule = null;
    this.vadHandle = null;
    this.isInitialized = false;
    this.isSpeechActive = false;
    this.speechDebounceTimeout = null;
    this.speechThresholdMs = 200; // Debounce speech changes
    this.pcmBufferPointer = null;
    this.inputAccumulator = [];
    this.frameCount = 0; // Tracks number of 10ms audio blocks processed
    this.speechSegmentStartTime = 0;

    this.metrics = {
      engineStatus: 'Loading...',
      state: 'IDLE',
      framesProcessed: 0,
      speechFrames: 0,
      silenceFrames: 0,
      speechDuration: 0.0,
      speechPercentage: 0.0,
      falseTriggers: 0
    };

    // Bind window start/stop listeners to handle state transition
    this._handlePipelineStart = this._handlePipelineStart.bind(this);
    this._handlePipelineStop = this._handlePipelineStop.bind(this);
    
    window.addEventListener('pipeline:start', this._handlePipelineStart);
    window.addEventListener('pipeline:stop', this._handlePipelineStop);
  }

  /**
   * Transition metrics state when pipeline starts.
   */
  _handlePipelineStart() {
    if (this.isInitialized) {
      this.metrics.state = 'LISTENING';
      this._emitMetrics();
    }
  }

  /**
   * Transition metrics state when pipeline stops.
   */
  _handlePipelineStop() {
    if (this.isInitialized) {
      this.metrics.state = 'IDLE';
      this._emitMetrics();
    }
  }

  /**
   * Initialize WebRTC VAD library.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    logger.info('VAD', 'Loading WebRTC VAD module...');
    this._updateEngineStatus('Loading...');
    try {
      // 1. Dynamically load WebRTC VAD module from yahweasel's WASM library
      const WebRtcVad = (await import('@ennuicastr/webrtcvad.js')).default;
      this.wasmModule = await WebRtcVad();

      // 2. Instantiate WebRTC VAD handle
      this.vadHandle = this.wasmModule.Create();
      const initResult = this.wasmModule.Init(this.vadHandle);
      if (initResult < 0) {
        throw new Error(`Failed to initialize WebRTC VAD handle (code: ${initResult})`);
      }

      // 3. Set Aggressiveness Mode: 3 (highest noise suppression filtering)
      this.wasmModule.set_mode(this.vadHandle, 3);

      // 4. Allocate WASM heap space for 10ms frame at 16kHz
      // 10ms of 16kHz audio = 160 samples. 160 samples * 2 bytes = 320 bytes buffer.
      this.pcmBufferPointer = this.wasmModule.malloc(160 * 2);

      this.isInitialized = true;
      this._updateEngineStatus('Ready');
      eventBus.emit(EVENTS.VAD_INITIALIZED);
      eventBus.emit(EVENTS.VAD_READY);
      logger.info('VAD', 'WebRTC VAD initialized successfully.');
      return true;
    } catch (error) {
      this._updateEngineStatus('Error');
      eventBus.emit(EVENTS.VAD_ERROR);
      logger.error('VAD', `Failed to initialize WebRTC VAD: ${error.message}`);
      return false;
    }
  }

  /**
   * Update internal engine status and emit metrics.
   * @param {string} status 
   * @private
   */
  _updateEngineStatus(status) {
    this.metrics.engineStatus = status;
    this._emitMetrics();
  }

  /**
   * Emit current metrics payload down the event bus.
   * @private
   */
  _emitMetrics() {
    eventBus.emit(EVENTS.VAD_METRICS, { ...this.metrics });
  }

  /**
   * Process a single denoised audio frame for Voice Activity Detection.
   * 
   * @param {Float32Array} frame - Denoised PCM Float32 audio frame (512 samples at 16kHz).
   */
  process(frame) {
    if (!this.isInitialized) return;

    // 1. Accumulate Float32 samples from incoming frame
    for (let i = 0; i < frame.length; i++) {
      this.inputAccumulator.push(frame[i]);
    }

    let speechDetectedInFrame = false;

    // 2. Process all accumulated 10ms (160 samples) chunks
    const tempBuffer = new Int16Array(160);
    const heap = this.wasmModule.HEAPU8 || this.wasmModule.heap;
    const heapView = new Int16Array(heap.buffer, this.pcmBufferPointer, 160);

    while (this.inputAccumulator.length >= 160) {
      // Extract 160 Float32 samples and scale to 16-bit signed PCM
      for (let i = 0; i < 160; i++) {
        const floatSample = this.inputAccumulator.shift();
        const scaled = floatSample * 32768.0;
        tempBuffer[i] = Math.min(32767, Math.max(-32768, scaled));
      }

      // Copy PCM buffer data to the WASM heap
      heapView.set(tempBuffer);

      // Invoke WebRTC VAD Process: returns 1 for speech, 0 for silence
      const isSpeechChunk = this.wasmModule.Process(this.vadHandle, 16000, this.pcmBufferPointer, 160);

      this.frameCount++;
      this.metrics.framesProcessed++;

      if (isSpeechChunk === 1) {
        speechDetectedInFrame = true;
        this.metrics.speechFrames++;
      } else {
        this.metrics.silenceFrames++;
      }
    }

    // Recalculate speech duration and speech ratio percentage
    this.metrics.speechDuration = this.metrics.speechFrames * 0.01; // each chunk is 10ms (0.01s)
    if (this.metrics.framesProcessed > 0) {
      this.metrics.speechPercentage = (this.metrics.speechFrames / this.metrics.framesProcessed) * 100;
    }

    // 3. Process immediate speech presence and apply state machine logic
    this._handleSpeechDecision(speechDetectedInFrame);
  }

  /**
   * Transition state and trigger events when speech starts/ends with debouncing.
   * @param {boolean} isSpeechFrame - Immediate VAD classifier decision.
   * @private
   */
  _handleSpeechDecision(isSpeechFrame) {
    const timestamp = (this.frameCount * 0.01).toFixed(2);

    if (isSpeechFrame) {
      if (this.speechDebounceTimeout) {
        clearTimeout(this.speechDebounceTimeout);
        this.speechDebounceTimeout = null;
      }

      if (!this.isSpeechActive) {
        this.isSpeechActive = true;
        this.metrics.state = 'SPEECH';
        this.speechSegmentStartTime = performance.now();

        // Print initial SPEECH state block log in console
        logger.info('VAD', `Frame       : ${this.frameCount}\nTimestamp   : ${timestamp}s\nState       : SPEECH\nDuration    : 0.00s`);

        eventBus.emit(EVENTS.SPEECH_START);
        eventBus.emit(EVENTS.VAD_STATE_CHANGE, { active: true });
        this._emitMetrics();
      }
    } else {
      // If we think speech is active but frame is silence, wait to emit speechEnd
      if (this.isSpeechActive && !this.speechDebounceTimeout) {
        this.speechDebounceTimeout = setTimeout(() => {
          this.isSpeechActive = false;
          this.metrics.state = 'LISTENING';

          const segmentDurationMs = performance.now() - this.speechSegmentStartTime;
          const segmentDurationSec = segmentDurationMs / 1000;

          // Increment false triggers metric if the speech duration is < 100ms
          if (segmentDurationMs < 100) {
            this.metrics.falseTriggers++;
            logger.warn('VAD', `False trigger detected.\nFrame       : ${this.frameCount}\nTimestamp   : ${timestamp}s\nDuration    : ${segmentDurationSec.toFixed(2)}s`);
          } else {
            logger.info('VAD', `Frame       : ${this.frameCount}\nTimestamp   : ${timestamp}s\nState       : LISTENING\nDuration    : ${segmentDurationSec.toFixed(2)}s`);
          }

          eventBus.emit(EVENTS.SPEECH_END);
          eventBus.emit(EVENTS.VAD_STATE_CHANGE, { active: false });
          this._emitMetrics();
          this.speechDebounceTimeout = null;
        }, this.speechThresholdMs);
      }
    }

    // Periodic telemetry debug logging every 100 VAD frames (approx. 1 second)
    if (this.frameCount > 0 && this.frameCount % 100 === 0) {
      const currentDuration = this.isSpeechActive ? 
        ((performance.now() - this.speechSegmentStartTime) / 1000) : 0.00;

      logger.info('VAD', `Frame       : ${this.frameCount}\nTimestamp   : ${timestamp}s\nState       : ${this.metrics.state}\nDuration    : ${currentDuration.toFixed(2)}s`);
    }

    // Send metrics down to update UI sub-component
    this._emitMetrics();
  }

  /**
   * Release VAD library resources.
   */
  dispose() {
    // Remove listeners
    window.removeEventListener('pipeline:start', this._handlePipelineStart);
    window.removeEventListener('pipeline:stop', this._handlePipelineStop);

    if (this.speechDebounceTimeout) {
      clearTimeout(this.speechDebounceTimeout);
      this.speechDebounceTimeout = null;
    }

    logger.info('VAD', 'Disposing WebRTC VAD resources.');

    // Free allocated heap buffer
    if (this.pcmBufferPointer && this.wasmModule) {
      try {
        this.wasmModule.free(this.pcmBufferPointer);
      } catch (e) {
        logger.error('VAD', `Error freeing WASM pointer: ${e.message}`);
      }
    }

    // Free native instance
    if (this.vadHandle && this.wasmModule) {
      try {
        this.wasmModule.Free(this.vadHandle);
      } catch (e) {
        logger.error('VAD', `Error freeing WebRTC VAD handle: ${e.message}`);
      }
    }

    this.wasmModule = null;
    this.vadHandle = null;
    this.pcmBufferPointer = null;
    this.isInitialized = false;
    this.isSpeechActive = false;
    this.inputAccumulator = [];

    // Reset status to default uninitialized values
    this.metrics.engineStatus = 'Loading...';
    this.metrics.state = 'IDLE';
    this._emitMetrics();
  }
}
