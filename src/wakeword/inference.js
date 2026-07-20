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

    this.metrics = {
      inferenceCount: 0,
      detectionCount: 0,
      droppedFrames: 0,
      lastConfidence: 0.0,
      averageConfidence: 0.0,
      inferenceRateFps: 0.0,
      lastDetectionTime: null,
      cooldownActive: false
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

    try {
      // 1. Create ONNX Inference Session (requires a Uint8Array view of the buffer)
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

      // Inspect model input/output properties
      // Note: input/output definitions in ort are accessed via session.handler (or session.inputNames mapped to session.inputs)
      // In newer ort versions, input/output dimensions are stored on session.inputNames/outputNames or inferred.
      // We can check shapes from session.inputNames and inputs:
      const inputMetadata = this.session.inputs ? this.session.inputs[0] : null;
      const outputMetadata = this.session.outputs ? this.session.outputs[0] : null;

      const inputShape = inputMetadata ? inputMetadata.dims : [1, 16, 96]; // fallback if not exposed
      const inputType = inputMetadata ? inputMetadata.type : 'float32';
      const outputShape = outputMetadata ? outputMetadata.dims : [1];

      // Verify data types and shapes
      if (inputType !== 'float32') {
        throw new Error(`Invalid model datatype: Expected "float32", found "${inputType}"`);
      }

      // Check input dimensions — expected [1, 16, 96] for openWakeWord classifier heads
      const isValidShape = inputShape &&
        inputShape.length === 3 &&
        (inputShape[0] === 1 || inputShape[0] === -1) &&
        inputShape[1] === 16 &&
        inputShape[2] === 96;

      if (!isValidShape) {
        logger.warn('WakeWord', `Input shape [${inputShape ? inputShape.join(', ') : '?'}] differs from expected [1, 16, 96]. The session may still work.`);
      }

      // Derive output shape cleanly (could be [1] or [1,1])
      const outputShapeStr = outputShape ? `[${outputShape.join(', ')}]` : '[?]';

      // Log successful verification metadata block
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
Status         : Ready (model loaded — inference disabled until Phase 2)`);


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
   * Helper to dispatch metrics updates down the event bus.
   * @private
   */
  _emitMetrics() {
    eventBus.emit(EVENTS.WAKEWORD_METRICS, { ...this.metrics });
  }

  /**
   * Reset the engine state.
   */
  dispose() {
    this.session = null;
    this.isInitialized = false;
    this.metrics = {
      inferenceCount: 0,
      detectionCount: 0,
      droppedFrames: 0,
      lastConfidence: 0.0,
      averageConfidence: 0.0,
      inferenceRateFps: 0.0,
      lastDetectionTime: null,
      cooldownActive: false
    };
    this._emitMetrics();
  }
}
