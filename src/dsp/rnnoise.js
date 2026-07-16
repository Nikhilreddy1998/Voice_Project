import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { Rnnoise } from '@shiguredo/rnnoise-wasm';

/**
 * RNNoiseWrapper interfaces with the RNNoise WebAssembly module
 * to suppress background noise in incoming audio frames.
 */
export class RNNoiseWrapper {
  constructor() {
    this.rnnoise = null;
    this.denoiseState = null;
    this.isInitialized = false;
    this.frameCount = 0;

    // Accumulation buffers for 48kHz audio processing
    this.inputAccumulator = [];
    this.outputAccumulator = [];
  }

  /**
   * Initialize and load RNNoise WASM binary.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    logger.info('RNNoise', 'Loading RNNoise WebAssembly library...');
    try {
      // 1. Load the RNNoise WASM module
      this.rnnoise = await Rnnoise.load();

      // 2. Create the noise suppression state instance
      this.denoiseState = this.rnnoise.createDenoiseState();

      this.isInitialized = true;
      eventBus.emit(EVENTS.DSP_INITIALIZED);
      logger.info('RNNoise', 'RNNoise WASM loaded and initialized successfully.');
      return true;
    } catch (error) {
      logger.error('RNNoise', `Failed to initialize RNNoise WASM: ${error.message}`);
      return false;
    }
  }

  /**
   * Process a single audio frame to suppress noise.
   * Handles 16kHz to 48kHz upsampling, 480-sample frame processing via RNNoise,
   * and 48kHz to 16kHz downsampling.
   * 
   * @param {Float32Array} inputFrame - Raw input frame from MicrophoneManager.
   * @returns {Float32Array} Denoised audio frame of the same size.
   */
  process(inputFrame) {
    if (!this.isInitialized) {
      return inputFrame; // Pass-through if not initialized
    }

    const startTime = performance.now();

    // 1. Upsample 16kHz input frame (512 samples) to 48kHz (1536 samples)
    const upsampled = this._upsample16to48(inputFrame);

    // 2. Add upsampled samples to input accumulator
    for (let i = 0; i < upsampled.length; i++) {
      this.inputAccumulator.push(upsampled[i]);
    }

    // 3. Process as many 480-sample frames as possible
    const tempFrame = new Float32Array(480);
    while (this.inputAccumulator.length >= 480) {
      // Extract 480 samples
      for (let i = 0; i < 480; i++) {
        tempFrame[i] = this.inputAccumulator.shift();
      }

      // Convert from normalized float range [-1.0, 1.0] to 16-bit PCM float range [-32768.0, 32767.0]
      for (let i = 0; i < 480; i++) {
        tempFrame[i] = tempFrame[i] * 32768;
      }

      // Process the frame (modifies tempFrame in-place)
      this.denoiseState.processFrame(tempFrame);

      // Convert back to normalized float range [-1.0, 1.0]
      for (let i = 0; i < 480; i++) {
        tempFrame[i] = tempFrame[i] / 32768;
      }

      // Push processed samples to output accumulator
      for (let i = 0; i < 480; i++) {
        this.outputAccumulator.push(tempFrame[i]);
      }
    }

    // 4. Extract 512 samples at 16kHz (requires 1536 samples at 48kHz)
    const denoisedFrame = new Float32Array(inputFrame.length);
    if (this.outputAccumulator.length >= 1536) {
      // Retrieve 1536 samples at 48kHz
      const segment48 = new Float32Array(1536);
      for (let i = 0; i < 1536; i++) {
        segment48[i] = this.outputAccumulator.shift();
      }

      // Downsample 48kHz segment (1536 samples) back to 16kHz (512 samples)
      const downsampled = this._downsample48to16(segment48);
      for (let i = 0; i < denoisedFrame.length; i++) {
        denoisedFrame[i] = downsampled[i];
      }
    } else {
      // In the first frame, we don't have enough samples yet due to latency.
      // We pass through the raw input frame.
      for (let i = 0; i < denoisedFrame.length; i++) {
        denoisedFrame[i] = inputFrame[i];
      }
    }

    const duration = performance.now() - startTime;
    this.frameCount++;

    // Periodically update the dashboard console log every 30 frames (~approx once per second)
    if (this.frameCount % 30 === 0) {
      logger.info(
        'RNNoise',
        `Denoising frames: count=${this.frameCount}, latency=${duration.toFixed(2)}ms`
      );
    }

    // Emit processed audio event
    eventBus.emit(EVENTS.DSP_PROCESSED, {
      raw: inputFrame,
      denoised: denoisedFrame,
      latencyMs: duration
    });

    return denoisedFrame;
  }

  /**
   * Free RNNoise WebAssembly memory heap and clean up states.
   */
  dispose() {
    if (!this.isInitialized) return;
    logger.info('RNNoise', 'Disposing RNNoise WebAssembly resources.');

    if (this.denoiseState) {
      this.denoiseState.destroy();
      this.denoiseState = null;
    }

    this.rnnoise = null;
    this.isInitialized = false;
    this.inputAccumulator = [];
    this.outputAccumulator = [];
  }

  /**
   * Upsample 16kHz audio array to 48kHz by performing linear interpolation (ratio 3:1).
   * @private
   */
  _upsample16to48(input) {
    const output = new Float32Array(input.length * 3);
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const next = (i + 1 < input.length) ? input[i + 1] : current;
      output[i * 3] = current;
      output[i * 3 + 1] = current + (next - current) * (1 / 3);
      output[i * 3 + 2] = current + (next - current) * (2 / 3);
    }
    return output;
  }

  /**
   * Downsample 48kHz audio array to 16kHz by taking the average of every 3 samples (ratio 3:1).
   * @private
   */
  _downsample48to16(input) {
    const output = new Float32Array(input.length / 3);
    for (let i = 0; i < output.length; i++) {
      output[i] = (input[i * 3] + input[i * 3 + 1] + input[i * 3 + 2]) / 3;
    }
    return output;
  }
}
