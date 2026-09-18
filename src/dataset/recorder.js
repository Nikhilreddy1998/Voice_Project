import { eventBus } from '../events/event-bus.js';
import { EVENTS, DATASET_CONFIG } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { microphoneManager } from '../audio/microphone.js';
import { encodeWav, verifyWavHeader } from './wav-encoder.js';
import { validateAudio } from './dataset-validator.js';
import { resampleAudio } from '../utils/audio-resampler.js';

export const RECORDER_STATES = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  RECORDING: 'recording',
  READY: 'ready',
  ERROR: 'error'
};

/**
 * Dataset Recorder
 * ----------------
 * Orchestrates microphone capture, audio buffering, live VU-meter calculation,
 * 16-bit PCM WAV encoding, and quality validation for dataset audio samples.
 */
export class DatasetAudioRecorder {
  constructor() {
    this.state = RECORDER_STATES.IDLE;
    this.chunks = [];
    this.startTime = 0;
    this.timerInterval = null;
    this.micUnsubscribe = null;
    
    this.lastRecording = null;
    this.onProgressCallback = null;
  }

  /**
   * Set callback for live recording telemetry (elapsed time, VU level).
   * @param {Function} callback 
   */
  setOnProgress(callback) {
    this.onProgressCallback = callback;
  }

  /**
   * Start a new recording take.
   */
  async startRecording() {
    if (this.state === RECORDER_STATES.RECORDING) return;

    try {
      this.state = RECORDER_STATES.INITIALIZING;

      // Ensure microphone is initialized via shared MicrophoneManager
      if (!microphoneManager.isInitialized) {
        logger.info('Dataset', 'Initializing microphone capture for dataset recorder...');
        const ok = await microphoneManager.initialize();
        if (!ok) {
          throw new Error('Could not access microphone. Please grant microphone permissions.');
        }
      }

      // Clear previous recording buffer
      this._cleanupLastRecording();
      this.chunks = [];
      this.startTime = performance.now();
      this.state = RECORDER_STATES.RECORDING;

      // Start microphone streaming
      microphoneManager.start();

      // Emit recording started event (main.js bypasses live inference pipeline)
      eventBus.emit(EVENTS.DATASET_RECORDING_STARTED);
      logger.info('Dataset', 'Dataset recording started.');

      // Subscribe to raw 512-sample Float32 microphone stream frames
      this.micUnsubscribe = eventBus.on(EVENTS.MIC_STREAM_DATA, (frame) => {
        this._handleAudioFrame(frame);
      });

      // Start elapsed timer loop
      this._startTimer();

    } catch (err) {
      this.state = RECORDER_STATES.ERROR;
      logger.error('Dataset', `Failed to start recording: ${err.message}`);
      eventBus.emit(EVENTS.DATASET_RECORDING_ERROR, err);
      throw err;
    }
  }

  /**
   * Process incoming raw 512-sample Float32 frame.
   * @private
   */
  _handleAudioFrame(frame) {
    if (this.state !== RECORDER_STATES.RECORDING) return;

    // Store sample frame copy
    this.chunks.push(new Float32Array(frame));

    // Calculate real-time RMS for VU level meter
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sum / frame.length);
    // Normalized 0 to 1 with gentle compression for UI meter responsiveness
    const vuLevel = Math.min(1, Math.max(0, Math.sqrt(rms) * 1.6));

    const elapsedSec = (performance.now() - this.startTime) / 1000;

    if (this.onProgressCallback) {
      this.onProgressCallback({
        elapsedSec,
        vuLevel,
        rms
      });
    }

    // Auto-stop at 4.0 seconds max limit to prevent runaway takes
    if (elapsedSec >= DATASET_CONFIG.MAX_DURATION_SEC) {
      this.stopRecording(true);
    }
  }

  /**
   * Start local timer for high-frequency UI updates.
   * @private
   */
  _startTimer() {
    this._stopTimer();
    this.timerInterval = setInterval(() => {
      if (this.state !== RECORDER_STATES.RECORDING) {
        this._stopTimer();
        return;
      }
      const elapsedSec = (performance.now() - this.startTime) / 1000;
      if (this.onProgressCallback) {
        this.onProgressCallback({
          elapsedSec,
          vuLevel: 0,
          rms: 0
        });
      }
    }, 50);
  }

  /**
   * Stop timer.
   * @private
   */
  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Stop recording take and process WAV audio.
   * @param {boolean} [autoStopped=false] 
   * @returns {Promise<Object|null>}
   */
  async stopRecording(autoStopped = false) {
    if (this.state !== RECORDER_STATES.RECORDING) return null;

    this.state = RECORDER_STATES.IDLE;
    this._stopTimer();

    // Unsubscribe from mic frame stream
    if (this.micUnsubscribe) {
      this.micUnsubscribe();
      this.micUnsubscribe = null;
    }

    // Stop microphone streaming if not needed elsewhere
    microphoneManager.stop();

    // Notify event bus that dataset recording finished
    eventBus.emit(EVENTS.DATASET_RECORDING_STOPPED, { autoStopped });
    logger.info('Dataset', `Recording stopped (${autoStopped ? 'auto-stopped at 4.0s' : 'manual stop'}).`);

    // Concatenate all recorded Float32 frames
    const totalSamples = this.chunks.reduce((acc, c) => acc + c.length, 0);
    const rawSamples = new Float32Array(totalSamples);
    let offset = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      rawSamples.set(this.chunks[i], offset);
      offset += this.chunks[i].length;
    }

    // Determine actual source sample rate from MicrophoneManager
    const actualSampleRate = microphoneManager.sampleRate || DATASET_CONFIG.SAMPLE_RATE;
    const targetSampleRate = DATASET_CONFIG.SAMPLE_RATE;

    logger.info(
      'Dataset',
      `Captured ${rawSamples.length} raw samples. AudioContext rate: ${actualSampleRate} Hz, target rate: ${targetSampleRate} Hz.`
    );

    let processedSamples = rawSamples;
    let wasResampled = false;

    // Resample if AudioContext is not running at exact 16000 Hz
    if (actualSampleRate !== targetSampleRate) {
      logger.info(
        'Dataset',
        `AudioContext sample rate (${actualSampleRate} Hz) differs from required ${targetSampleRate} Hz. Resampling audio...`
      );
      try {
        processedSamples = await resampleAudio(rawSamples, actualSampleRate, targetSampleRate);
        wasResampled = true;
        logger.info(
          'Dataset',
          `Resampling completed: ${rawSamples.length} samples (${actualSampleRate} Hz) -> ${processedSamples.length} samples (${targetSampleRate} Hz).`
        );
      } catch (resampleErr) {
        logger.error('Dataset', `Failed to resample audio: ${resampleErr.message}`);
        this.state = RECORDER_STATES.ERROR;
        eventBus.emit(EVENTS.DATASET_RECORDING_ERROR, new Error(`Audio resampling failed: ${resampleErr.message}`));
        return null;
      }
    }

    // 1. Encode into standard 16-bit linear PCM mono WAV at verified 16 kHz
    const wavResult = encodeWav(processedSamples, targetSampleRate);

    // 2. Independently verify the generated WAV header
    const wavVerification = verifyWavHeader(wavResult.buffer, targetSampleRate);
    if (!wavVerification.valid) {
      logger.error('Dataset', `WAV header verification failed: ${wavVerification.errors.join(', ')}`);
    } else {
      logger.info(
        'Dataset',
        `WAV header independently verified: ${wavVerification.sampleRate} Hz, ${wavVerification.bitsPerSample}-bit, ${wavVerification.numChannels} channel(s), duration: ${wavVerification.durationSec.toFixed(2)}s.`
      );
    }

    // 3. Validate against audio specifications
    const validation = validateAudio(processedSamples, {
      sampleRate: targetSampleRate,
      actualSampleRate,
      wasResampled,
      channels: DATASET_CONFIG.CHANNELS,
      bitDepth: DATASET_CONFIG.BIT_DEPTH
    });

    if (!wavVerification.valid) {
      validation.isValid = false;
      validation.errors.push(...wavVerification.errors);
    }

    const objectUrl = URL.createObjectURL(wavResult.blob);

    this.lastRecording = {
      wavResult,
      validation,
      wavVerification,
      samples: processedSamples,
      rawSamples,
      actualSampleRate,
      finalSampleRate: targetSampleRate,
      wasResampled,
      objectUrl,
      autoStopped
    };

    this.state = RECORDER_STATES.READY;

    // Dispatch ready event with payload
    eventBus.emit(EVENTS.DATASET_RECORDING_READY, this.lastRecording);
    return this.lastRecording;
  }

  /**
   * Discard current recording take and free resources.
   */
  discardRecording() {
    this._cleanupLastRecording();
    this.state = RECORDER_STATES.IDLE;
    eventBus.emit(EVENTS.DATASET_RECORDING_DISCARDED);
    logger.info('Dataset', 'Current take discarded.');
  }

  /**
   * Mark recording take as saved.
   */
  markSaved() {
    eventBus.emit(EVENTS.DATASET_RECORDING_SAVED, this.lastRecording);
    logger.info('Dataset', 'Current take marked saved.');
  }

  /**
   * Cleanup blob URLs and temporary buffers.
   * @private
   */
  _cleanupLastRecording() {
    if (this.lastRecording && this.lastRecording.objectUrl) {
      URL.revokeObjectURL(this.lastRecording.objectUrl);
    }
    this.lastRecording = null;
    this.chunks = [];
  }

  /**
   * Dispose recorder completely.
   */
  dispose() {
    this._stopTimer();
    if (this.micUnsubscribe) {
      this.micUnsubscribe();
      this.micUnsubscribe = null;
    }
    this._cleanupLastRecording();
  }
}
