import * as ort from 'onnxruntime-web';
import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { ModelLoader } from './model-loader.js';

// Configure ONNX WebAssembly paths to resolve dependencies locally (same-origin)
ort.env.wasm.wasmPaths = '/';
ort.env.wasm.numThreads = 1;

/**
 * SpeechEmbedding runs Google's Speech Embedding backbone model
 * on top of accumulated Mel Spectrogram frames.
 */
export class SpeechEmbedding {
  constructor() {
    this.session = null;
    this.isInitialized = false;
    this.loader = new ModelLoader();

    // Rolling Feature Buffer
    this.frameBuffer = [];
    this.requiredFrames = 76; // Default fallback, will be overwritten by metadata
    this.numChannels = 32;    // Default fallback, will be overwritten by metadata

    // Model Metadata
    this.inputName = '';
    this.outputName = '';
    this.inputShape = [];
    this.outputShape = [];
    this.inputType = '';
    this.outputType = '';

    // Metrics Tracking
    this.metrics = {
      framesProcessed: 0,
      inferenceCount: 0,
      droppedFrames: 0,
      avgLatencyMs: 0.0,
      maxLatencyMs: 0.0,
      lastLatencyMs: 0.0,
      totalLatencyMs: 0.0,
      lastEmbeddingTime: null,
      status: 'Uninitialized'
    };

    this._handleMelFeatures = this._handleMelFeatures.bind(this);
  }

  /**
   * Load the ONNX model and initialize InferenceSession.
   * Performs validation of inputs/outputs.
   * 
   * @returns {Promise<boolean>}
   */
  async initialize() {
    logger.info('SpeechEmbedding', 'Initializing Speech Embedding module...');
    this._updateStatus('Loading');
    eventBus.emit(EVENTS.EMBEDDING_PROGRESS, 0);

    const localUrl = '/models/embedding_model.onnx';
    const fallbackUrl = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx';

    try {
      // 1. Download and load the model buffer
      let modelBuffer;
      try {
        modelBuffer = await this.loader.loadModel('embedding_model', localUrl, EVENTS.EMBEDDING_PROGRESS);
      } catch {
        logger.warn('SpeechEmbedding', `Local model file not found or failed to load. Falling back to remote: ${fallbackUrl}`);
        modelBuffer = await this.loader.loadModel('embedding_model', fallbackUrl, EVENTS.EMBEDDING_PROGRESS);
      }

      // 2. Create Inference Session
      this.session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ['wasm']
      });

      // 3. Inspect and validate model metadata
      const inputNames = this.session.inputNames;
      const outputNames = this.session.outputNames;

      if (inputNames.length !== 1 || outputNames.length !== 1) {
        throw new Error(`Validation Error: Expected exactly 1 input and 1 output. Found ${inputNames.length} inputs, ${outputNames.length} outputs.`);
      }

      this.inputName = inputNames[0];
      this.outputName = outputNames[0];

      // Try checking session.inputMetadata / outputMetadata first, then session.inputs / outputs
      const inputMetadata = (this.session.inputMetadata && this.session.inputMetadata[this.inputName]) ||
                            (this.session.inputs && (Array.isArray(this.session.inputs) ? this.session.inputs[0] : this.session.inputs[this.inputName])) ||
                            null;
      const outputMetadata = (this.session.outputMetadata && this.session.outputMetadata[this.outputName]) ||
                             (this.session.outputs && (Array.isArray(this.session.outputs) ? this.session.outputs[0] : this.session.outputs[this.outputName])) ||
                             null;

      this.inputShape = inputMetadata ? (inputMetadata.dims || []) : [];
      this.inputType = inputMetadata ? (inputMetadata.type || 'float32') : 'float32';
      this.outputShape = outputMetadata ? (outputMetadata.dims || []) : [];
      this.outputType = outputMetadata ? (outputMetadata.type || 'float32') : 'float32';

      // Log the metadata
      logger.info('SpeechEmbedding', `
Speech Embedding Model Metadata
---------------------------------------
Input Node     : ${this.inputName}
Input Shape    : [${this.inputShape.join(', ')}]
Input Type     : ${this.inputType}
Output Node    : ${this.outputName}
Output Shape   : [${this.outputShape.join(', ')}]
Output Type    : ${this.outputType}
`);

      // Type validation with warning fallback
      if (this.inputType && this.inputType !== 'float32' && this.inputType !== 'float') {
        logger.warn('SpeechEmbedding', `Unexpected input datatype: "${this.inputType}". Proceeding with float32.`);
      }

      // Deriving dimensions from metadata: Input shape is [batch, frames, channels, height/channelWidth]
      // Expected typical shape: ['unk__314', 76, 32, 1]
      if (this.inputShape && this.inputShape.length >= 3) {
        const framesDim = this.inputShape[1];
        const channelsDim = this.inputShape[2];
        this.requiredFrames = typeof framesDim === 'number' && framesDim > 0 ? framesDim : 76;
        this.numChannels = typeof channelsDim === 'number' && channelsDim > 0 ? channelsDim : 32;
      } else {
        logger.warn('SpeechEmbedding', 'Input shape is dynamic or empty. Using default requiredFrames=76, numChannels=32.');
        this.requiredFrames = 76;
        this.numChannels = 32;
      }

      this.isInitialized = true;
      eventBus.on(EVENTS.MELSPEC_FEATURES, this._handleMelFeatures);
      
      this._updateStatus('Ready');
      eventBus.emit(EVENTS.EMBEDDING_READY);
      return true;
    } catch (error) {
      logger.error('SpeechEmbedding', `Initialization failed: ${error.message}`);
      
      // Log detailed validation block on mismatch/failure
      logger.error('SpeechEmbedding', `
Speech Embedding Model Validation Error
---------------------------------------
Expected/Input:
Name: input_1
Shape: [1, 76, 32, 1]
Type: float32

Actual:
Name: ${this.inputName || 'Unknown'}
Shape: [${this.inputShape ? this.inputShape.join(', ') : 'Unknown'}]
Type: ${this.inputType || 'Unknown'}
`);

      this._updateStatus('Error');
      eventBus.emit(EVENTS.EMBEDDING_ERROR, error);
      return false;
    }
  }

  /**
   * Process a chunk of Mel Spectrogram features and manage the rolling buffer context.
   * 
   * @param {Object} payload 
   * @param {Float32Array} payload.features
   * @param {Array<number>} payload.shape
   */
  async _handleMelFeatures({ features }) {
    if (!this.isInitialized || !this.session) return;

    try {
      const numChannels = this.numChannels; // strictly 32
      const numNewFrames = Math.floor(features.length / numChannels);

      // 1. Accumulate new frames into the rolling buffer
      for (let i = 0; i < numNewFrames; i++) {
        const frame = features.subarray(i * numChannels, (i + 1) * numChannels);
        this.frameBuffer.push(new Float32Array(frame));
        this.metrics.framesProcessed++;
      }

      // 2. Shift buffer to keep only the required sliding window size
      if (this.frameBuffer.length > this.requiredFrames) {
        const overflow = this.frameBuffer.length - this.requiredFrames;
        this.frameBuffer.splice(0, overflow);
      }

      // Update current status
      this._updateStatus('Processing');

      // 3. Run inference only when we have filled the buffer
      if (this.frameBuffer.length === this.requiredFrames) {
        // Prepare the flat float array
        const flatFeatures = new Float32Array(this.requiredFrames * this.numChannels);
        for (let i = 0; i < this.requiredFrames; i++) {
          flatFeatures.set(this.frameBuffer[i], i * this.numChannels);
        }

        // Construct input tensor shape dynamically based on model metadata
        let tensorShape;
        if (this.inputShape && this.inputShape.length >= 3) {
          tensorShape = this.inputShape.map(dim => {
            if (typeof dim === 'string' || dim <= 0) return 1;
            return dim;
          });
        } else {
          tensorShape = [1, 76, 32, 1];
        }

        // Run inference
        const inputTensor = new ort.Tensor('float32', flatFeatures, tensorShape);
        const feeds = {};
        feeds[this.inputName] = inputTensor;

        const runT0 = performance.now();
        const outputMap = await this.session.run(feeds);
        const runT1 = performance.now();
        const durationMs = runT1 - runT0;

        const outputTensor = outputMap[this.outputName];

        if (!outputTensor) {
          throw new Error(`Inference returned empty results for output node: ${this.outputName}`);
        }

        // 4. Update Metrics
        this.metrics.inferenceCount++;
        this.metrics.lastLatencyMs = durationMs;
        this.metrics.totalLatencyMs += durationMs;
        this.metrics.maxLatencyMs = Math.max(this.metrics.maxLatencyMs, durationMs);
        this.metrics.avgLatencyMs = this.metrics.totalLatencyMs / this.metrics.inferenceCount;
        this.metrics.lastEmbeddingTime = new Date().toLocaleTimeString();

        // 5. Emit embedding output event
        eventBus.emit(EVENTS.EMBEDDING_FEATURES, {
          embedding: outputTensor.data, // Float32Array of size 96
          shape: outputTensor.dims      // [1, 1, 1, 96]
        });

        this._emitMetrics();
      } else {
        // Not enough frames yet, just report buffer progress
        this._emitMetrics();
      }
    } catch (error) {
      logger.error('SpeechEmbedding', `Inference runtime failure: ${error.message}`);
      this._updateStatus('Error');
      eventBus.emit(EVENTS.EMBEDDING_ERROR, error);
    }
  }

  /**
   * Helper to set metrics status state and notify listeners.
   * 
   * @private
   * @param {string} newStatus 
   */
  _updateStatus(newStatus) {
    this.metrics.status = newStatus;
    this._emitMetrics();
  }

  /**
   * Helper to broadcast metrics.
   * 
   * @private
   */
  _emitMetrics() {
    eventBus.emit(EVENTS.EMBEDDING_METRICS, {
      status: this.metrics.status,
      model: 'embedding_model.onnx',
      input: 'Mel Spectrogram',
      output: 'Speech Embedding',
      bufferSize: this.frameBuffer.length,
      requiredFrames: this.requiredFrames,
      inferenceCount: this.metrics.inferenceCount,
      droppedFrames: this.metrics.droppedFrames,
      avgLatency: this.metrics.avgLatencyMs,
      maxLatency: this.metrics.maxLatencyMs,
      lastLatency: this.metrics.lastLatencyMs,
      lastEmbeddingTime: this.metrics.lastEmbeddingTime || '--'
    });
  }

  /**
   * Release resources, unsubscribe listeners, and clear internal buffers.
   */
  dispose() {
    eventBus.off(EVENTS.MELSPEC_FEATURES, this._handleMelFeatures);

    if (this.session) {
      this.session = null;
    }

    this.isInitialized = false;
    this.frameBuffer = [];
    
    this.metrics = {
      framesProcessed: 0,
      inferenceCount: 0,
      droppedFrames: 0,
      avgLatencyMs: 0.0,
      maxLatencyMs: 0.0,
      lastLatencyMs: 0.0,
      totalLatencyMs: 0.0,
      lastEmbeddingTime: null,
      status: 'Uninitialized'
    };

    logger.info('SpeechEmbedding', 'Speech Embedding resources disposed.');
    this._emitMetrics();
  }
}
