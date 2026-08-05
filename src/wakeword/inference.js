import * as ort from 'onnxruntime-web';
import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

// Configure ONNX WebAssembly paths to resolve dependencies via dynamic CDN
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

/**
 * WakeWordInference wraps the ONNX Runtime Web session,
 * verifies model tensor names, shapes, and types,
 * and maintains telemetry status tracking.
 */
export class WakeWordInference {
  constructor() {
    this.session = null;
    this.isInitialized = false;
    this.modelName = '';
    
    // Config properties
    this.threshold = 0.50;
    this.cooldownDuration = 2000;

    // Rolling temporal embedding buffer
    this.embeddingWindow = [];
    this.lastInferenceTime = null;

    this.metrics = {
      inferenceCount: 0,
      detectionCount: 0,
      droppedFrames: 0,
      lastConfidence: 0.0,
      averageConfidence: 0.0,
      inferenceRateFps: 0.0,
      lastDetectionTime: null,
      cooldownActive: false,
      totalLatencyMs: 0.0,
      avgLatencyMs: 0.0,
      maxLatencyMs: 0.0,
      lastLatencyMs: 0.0
    };
  }

  /**
   * Initialize ONNX Runtime Session using the loaded model buffer.
   * Performs deep verification checks on input/output tensors.
   * 
   * @param {ArrayBuffer} modelBuffer 
   * @param {string} modelName 
   * @returns {Promise<boolean>}
   */
  async initialize(modelBuffer, modelName) {
    this.modelName = modelName;
    logger.info('WakeWord', 'Initializing ONNX Runtime Web InferenceSession...');
    this.embeddingWindow = [];
    this.lastInferenceTime = null;

    try {
      // 1. Create ONNX Inference Session
      this.session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ['wasm']
      });

      // 2. Perform deep metadata verification checks
      const inputNames = this.session.inputNames;
      const outputNames = this.session.outputNames;

      if (inputNames.length !== 1) {
        throw new Error(`Invalid model structure: Expected exactly 1 input, found ${inputNames.length}`);
      }
      if (outputNames.length !== 1) {
        throw new Error(`Invalid model structure: Expected exactly 1 output, found ${outputNames.length}`);
      }

      const inputName = inputNames[0];
      const outputName = outputNames[0];

      const inputMetadata = this.session.inputs
        ? (Array.isArray(this.session.inputs) ? this.session.inputs[0] : this.session.inputs[inputName])
        : null;
      const outputMetadata = this.session.outputs
        ? (Array.isArray(this.session.outputs) ? this.session.outputs[0] : this.session.outputs[outputName])
        : null;

      const inputShape = inputMetadata ? inputMetadata.dims : [1, 16, 96];
      const inputType = inputMetadata ? inputMetadata.type : 'float32';
      const outputShape = outputMetadata ? outputMetadata.dims : [1];

      // Verify data types and shapes
      if (inputType !== 'float32') {
        throw new Error(`Invalid model datatype: Expected "float32", found "${inputType}"`);
      }

      // Check input dimensions
      const isValidShape = inputShape &&
        inputShape.length === 3 &&
        (inputShape[0] === 1 || inputShape[0] === -1) &&
        inputShape[1] === 16 &&
        inputShape[2] === 96;

      if (!isValidShape) {
        logger.warn('WakeWord', `Input shape [${inputShape ? inputShape.join(', ') : '?'}] differs from expected [1, 16, 96]. The session may still work.`);
      }

      const outputShapeStr = outputShape ? `[${outputShape.join(', ')}]` : '[?]';

      logger.info('WakeWord', `
Wake Word Engine Initialized
----------------------------
Model          : ${modelName}.onnx
Input Tensor   : ${inputName}
Input Shape    : [${inputShape ? inputShape.join(', ') : '?'}]
Input Type     : ${inputType}
Output Tensor  : ${outputName}
Output Shape   : ${outputShapeStr}
Execution      : WASM
Status         : Ready (inference active)`);

      this.isInitialized = true;
      this._emitMetrics();
      return true;
    } catch (error) {
      logger.error('WakeWord', `Model validation failed: ${error.message}`);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Process a single 96-D speech embedding frame.
   * Maintains a rolling window buffer of size 16 and runs the classifier.
   * 
   * @param {Float32Array} embedding 
   */
  async process(embedding) {
    if (!this.isInitialized || !this.session) return;

    // 1. Accumulate into the rolling buffer
    this.embeddingWindow.push(embedding);

    // 2. Keep only the last 16 frames
    if (this.embeddingWindow.length > 16) {
      this.embeddingWindow.shift();
    }

    // 3. If we don't have a full window yet, report status and wait
    if (this.embeddingWindow.length < 16) {
      eventBus.emit(EVENTS.WAKEWORD_METRICS, {
        status: 'Ready',
        inferenceStatus: 'Buffering',
        reason: `Accumulating embedding window (${this.embeddingWindow.length}/16)`,
        ...this.metrics
      });
      return;
    }

    try {
      const t0 = performance.now();

      // 4. Flatten the rolling window of size 16 * 96
      const flatWindow = new Float32Array(16 * 96);
      for (let i = 0; i < 16; i++) {
        flatWindow.set(this.embeddingWindow[i], i * 96);
      }

      // 5. Run inference with ONNX model
      const inputTensor = new ort.Tensor('float32', flatWindow, [1, 16, 96]);
      const feeds = {};
      feeds[this.session.inputNames[0]] = inputTensor;

      const outputMap = await this.session.run(feeds);
      const outputTensor = outputMap[this.session.outputNames[0]];

      if (!outputTensor) {
        throw new Error('Classifier model returned empty output.');
      }

      const probability = outputTensor.data[0];
      const t1 = performance.now();
      const latencyMs = t1 - t0;

      // 6. Update Performance & Telemetry metrics
      this.metrics.inferenceCount++;
      this.metrics.lastConfidence = probability;
      
      // Compute running average confidence
      this.metrics.averageConfidence = 
        (this.metrics.averageConfidence * (this.metrics.inferenceCount - 1) + probability) / this.metrics.inferenceCount;

      // Track latencies
      this.metrics.lastLatencyMs = latencyMs;
      this.metrics.totalLatencyMs += latencyMs;
      this.metrics.maxLatencyMs = Math.max(this.metrics.maxLatencyMs, latencyMs);
      this.metrics.avgLatencyMs = this.metrics.totalLatencyMs / this.metrics.inferenceCount;

      // Estimate FPS based on time delta between inferences
      const now = performance.now();
      if (this.lastInferenceTime) {
        const deltaSec = (now - this.lastInferenceTime) / 1000;
        if (deltaSec > 0) {
          const instantFps = 1 / deltaSec;
          this.metrics.inferenceRateFps = this.metrics.inferenceRateFps * 0.95 + instantFps * 0.05;
        }
      } else {
        this.metrics.inferenceRateFps = 12.5; // ~12.5 inferences/sec at 80ms step
      }
      this.lastInferenceTime = now;

      // 7. Detection Logic with threshold and cooldown gating
      if (probability >= this.threshold && !this.metrics.cooldownActive) {
        logger.info('WakeWord', `🌟 Custom Classifier Triggered: confidence=${probability.toFixed(4)}`);
        
        this.metrics.detectionCount++;
        this.metrics.lastDetectionTime = new Date().toLocaleTimeString();
        this.metrics.cooldownActive = true;

        // Emit detection event immediately
        eventBus.emit(EVENTS.WAKEWORD_DETECTED, {
          word: 'Hey Louie',
          probability: probability
        });

        // Set 2-second cooldown lock
        setTimeout(() => {
          this.metrics.cooldownActive = false;
          logger.info('WakeWord', 'Cooldown period inactive. Ready to detect.');
          this._emitMetrics();
        }, this.cooldownDuration);
      }

      // 8. Emit overall metrics updates
      this._emitMetrics();

    } catch (error) {
      logger.error('WakeWord', `Inference run failed: ${error.message}`);
      eventBus.emit(EVENTS.WAKEWORD_METRICS, {
        status: 'Error',
        inferenceStatus: 'Failed',
        reason: error.message,
        ...this.metrics
      });
    }
  }

  /**
   * Helper to dispatch metrics updates down the event bus.
   * @private
   */
  _emitMetrics() {
    eventBus.emit(EVENTS.WAKEWORD_METRICS, {
      status: 'Ready',
      inferenceStatus: this.metrics.cooldownActive ? 'Cooldown' : 'Active',
      reason: this.metrics.cooldownActive ? 'Cooldown Active (2s)' : 'Listening for "Hey Louie"',
      ...this.metrics
    });
  }

  /**
   * Reset the engine state.
   */
  dispose() {
    this.session = null;
    this.isInitialized = false;
    this.embeddingWindow = [];
    this.lastInferenceTime = null;
    this.metrics = {
      inferenceCount: 0,
      detectionCount: 0,
      droppedFrames: 0,
      lastConfidence: 0.0,
      averageConfidence: 0.0,
      inferenceRateFps: 0.0,
      lastDetectionTime: null,
      cooldownActive: false,
      totalLatencyMs: 0.0,
      avgLatencyMs: 0.0,
      maxLatencyMs: 0.0,
      lastLatencyMs: 0.0
    };
    eventBus.emit(EVENTS.WAKEWORD_METRICS, {
      status: 'Uninitialized',
      inferenceStatus: 'Disabled',
      reason: 'OpenWakeWordwrapper Disposed',
      ...this.metrics
    });
  }
}
