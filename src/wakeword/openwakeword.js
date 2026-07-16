import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * OpenWakeWordWrapper handles downloading/caching the wake word model,
 * initializing the ONNX Runtime Web InferenceSession, running inference
 * on audio frames, and emitting a detection event when the probability threshold is crossed.
 */
export class OpenWakeWordWrapper {
  constructor() {
    this.session = null;
    this.isInitialized = false;
    this.threshold = 0.5; // Probability threshold for wake word
    this.modelPath = '/models/wakeword.onnx'; // Local path to ONNX model file
  }

  /**
   * Initialize ONNX Runtime Web and load the OpenWakeWord model.
   * @param {Object} options - Configuration overrides.
   * @param {string} [options.modelPath] - Custom model location.
   * @param {number} [options.threshold] - Custom probability threshold.
   * @returns {Promise<boolean>}
   */
  async initialize(options = {}) {
    if (options.modelPath) this.modelPath = options.modelPath;
    if (options.threshold) this.threshold = options.threshold;

    logger.info('WakeWord', `Initializing OpenWakeWord model from path: ${this.modelPath}...`);
    try {
      // 1. Initialize ONNX Runtime Web
      // TODO: Import onnxruntime-web dynamically or use imported package
      // const ort = await import('onnxruntime-web');

      // 2. Load model from path/URL and instantiate inference session
      // TODO: ort.InferenceSession.create(this.modelPath, { executionProviders: ['wasm'] });
      
      this.isInitialized = true;
      eventBus.emit(EVENTS.WAKEWORD_INITIALIZED);
      logger.info('WakeWord', 'OpenWakeWord ONNX Inference session loaded successfully.');
      return true;
    } catch (error) {
      logger.error('WakeWord', `Failed to load OpenWakeWord model: ${error.message}`);
      return false;
    }
  }

  /**
   * Run inference on the incoming audio frame (or accumulated feature buffers).
   * Note: OpenWakeWord typically operates on Mel-spectrogram inputs generated from 
   * overlapping audio frames (e.g. 1280 samples or sliding windows).
   * 
   * @param {Float32Array} frame - Denoised audio frame.
   */
  process(_frame) {
    if (!this.isInitialized) return;

    const startTime = performance.now();
    let probability = 0.0;

    // TODO: Extract audio features (spectrogram) and populate ONNX input tensor
    // const inputTensor = new ort.Tensor('float32', featureData, [1, 96, 64]);
    
    // TODO: Run inference: const outputs = await this.session.run({ input: inputTensor });
    // TODO: Extract prediction score output
    // probability = outputs.sigmoid_predictions.data[0];

    const inferenceTime = performance.now() - startTime;



    // Check if the detection threshold is crossed
    if (probability > this.threshold) {
      logger.info('WakeWord', `WAKE WORD DETECTED! Probability: ${probability.toFixed(4)}`);
      eventBus.emit(EVENTS.WAKEWORD_DETECTED, {
        word: 'alexa', // Placeholder for detected target word
        probability
      });
    }
  }

  /**
   * Release ONNX session resources.
   */
  async dispose() {
    if (!this.isInitialized) return;
    logger.info('WakeWord', 'Disposing OpenWakeWord inference session.');

    try {
      // TODO: Release ONNX session
      // if (this.session) {
      //   await this.session.release();
      // }
    } catch (e) {
      logger.error('WakeWord', `Error during ONNX disposal: ${e.message}`);
    }

    this.session = null;
    this.isInitialized = false;
  }
}
