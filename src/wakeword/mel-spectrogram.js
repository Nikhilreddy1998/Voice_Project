import * as ort from 'onnxruntime-web';
import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { ModelLoader } from './model-loader.js';

// Configure ONNX WebAssembly paths to resolve dependencies locally (same-origin)
ort.env.wasm.wasmPaths = '/';

/**
 * MelSpectrogram class manages raw audio accumulation,
 * runs the melspectrogram.onnx model via ONNX Runtime Web,
 * and emits the generated features and extraction metrics.
 */
export class MelSpectrogram {
  constructor() {
    this.session = null;
    this.isInitialized = false;
    this.loader = new ModelLoader();

    // Streaming Audio Buffer config (16kHz, mono, 16-bit PCM float32)
    this.bufferCapacity = 16000 * 2; // 2 seconds capacity
    this.audioBuffer = new Float32Array(this.bufferCapacity);
    this.bufferLength = 0;

    this.inputName = '';
    this.outputName = '';

    // Metrics tracking
    this.metrics = {
      framesProcessed: 0,
      framesProduced: 0,
      totalExtractionTimeMs: 0,
      maxExtractionTimeMs: 0,
      avgExtractionTimeMs: 0,
      droppedFrames: 0,
      lastFeatureTimestamp: null,
      lastLatencyMs: 0.0
    };
  }

  /**
   * Download the Mel Spectrogram ONNX model and initialize the ONNX Runtime session.
   * 
   * @returns {Promise<boolean>}
   */
  async initialize() {
    logger.info('MelSpectrogram', 'Initializing Mel Spectrogram feature extractor...');
    eventBus.emit(EVENTS.MELSPEC_METRICS, { status: 'Loading' });

    const localUrl = '/models/melspectrogram.onnx';
    const fallbackUrl = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx';

    try {
      // 1. Download and load the model buffer
      let modelBuffer;
      try {
        modelBuffer = await this.loader.loadModel('melspectrogram', localUrl, EVENTS.MELSPEC_PROGRESS);
      } catch {
        logger.warn('MelSpectrogram', `Local model file not found or failed to load. Falling back to remote LFS URL: ${fallbackUrl}`);
        modelBuffer = await this.loader.loadModel('melspectrogram', fallbackUrl, EVENTS.MELSPEC_PROGRESS);
      }

      // 2. Initialize ONNX inference session
      this.session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ['wasm']
      });

      // 3. Log model inputs/outputs structure
      const inputNames = this.session.inputNames;
      const outputNames = this.session.outputNames;
      
      this.inputName = inputNames[0];
      this.outputName = outputNames[0];

      logger.info('MelSpectrogram', `Model Loaded Successfully. Input nodes: ${inputNames.join(', ')}, Output nodes: ${outputNames.join(', ')}`);

      this.isInitialized = true;
      eventBus.emit(EVENTS.MELSPEC_READY);
      
      // Dispatch initial metrics
      this._emitMetrics('Ready');
      return true;
    } catch (error) {
      logger.error('MelSpectrogram', `Initialization failed: ${error.message}`);
      eventBus.emit(EVENTS.MELSPEC_ERROR, error);
      this._emitMetrics('Error');
      return false;
    }
  }

  /**
   * Process a single audio frame (512 samples) from the RNNoise/DSP pipeline.
   * 
   * @param {Float32Array} frame - Denoised float32 PCM frame.
   */
  process(frame) {
    if (!this.isInitialized) return;

    this.metrics.framesProcessed++;

    // 1. Accumulate audio samples into the pre-allocated Float32Array rolling buffer
    if (this.bufferLength + frame.length > this.bufferCapacity) {
      // Handle buffer overrun by dropping oldest samples
      const overflow = (this.bufferLength + frame.length) - this.bufferCapacity;
      this.audioBuffer.copyWithin(0, overflow, this.bufferLength);
      this.bufferLength -= overflow;
      this.metrics.droppedFrames++;
      logger.warn('MelSpectrogram', `Buffer overflow! Dropped ${overflow} samples.`);
    }

    this.audioBuffer.set(frame, this.bufferLength);
    this.bufferLength += frame.length;

    // 2. Feed 1280-sample non-overlapping chunks to the ONNX session
    const chunkLength = 1280;
    while (this.bufferLength >= chunkLength) {
      const chunk = this.audioBuffer.slice(0, chunkLength);
      
      // Run the ONNX model asynchronously
      this._runInference(chunk);

      // Shift the remaining samples to the beginning of the buffer
      this.audioBuffer.copyWithin(0, chunkLength, this.bufferLength);
      this.bufferLength -= chunkLength;
    }
  }

  /**
   * Run ONNX session on a 1280-sample chunk.
   * 
   * @private
   * @param {Float32Array} chunk 
   */
  async _runInference(chunk) {
    try {
      // 1. Create input tensor
      const inputTensor = new ort.Tensor('float32', chunk, [1, 1280]);

      // 2. Run inference
      const feeds = {};
      feeds[this.inputName] = inputTensor;

      const runT0 = performance.now();
      const outputMap = await this.session.run(feeds);
      const runT1 = performance.now();
      const runDurationMs = runT1 - runT0;

      const outputTensor = outputMap[this.outputName];

      if (!outputTensor) {
        throw new Error(`ONNX model returned empty outputs or output tensor is missing for node: ${this.outputName}`);
      }

      const rawData = outputTensor.data;

      // 3. Post-process: output = (value / 10.0) + 2.0
      const processedData = new Float32Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        processedData[i] = (rawData[i] / 10.0) + 2.0;
      }

      // 4. Update metrics
      this.metrics.framesProduced += 8; // Each inference yields 8 Mel spectrogram frames (80ms total)
      this.metrics.totalExtractionTimeMs += runDurationMs;
      this.metrics.maxExtractionTimeMs = Math.max(this.metrics.maxExtractionTimeMs, runDurationMs);
      this.metrics.avgExtractionTimeMs = this.metrics.totalExtractionTimeMs / (this.metrics.framesProduced / 8);
      this.metrics.lastFeatureTimestamp = new Date().toLocaleTimeString();
      this.metrics.lastLatencyMs = runDurationMs;

      // 5. Emit events
      eventBus.emit(EVENTS.MELSPEC_FEATURES, {
        features: processedData,
        shape: outputTensor.dims
      });

      this._emitMetrics('Processing');
    } catch (error) {
      logger.error('MelSpectrogram', `Inference runtime failure: ${error.message}`);
      eventBus.emit(EVENTS.MELSPEC_ERROR, error);
      this._emitMetrics('Error');
    }
  }

  /**
   * Helper to dispatch current extractor metrics via the event bus.
   * 
   * @private
   * @param {string} status 
   */
  _emitMetrics(status) {
    eventBus.emit(EVENTS.MELSPEC_METRICS, {
      status,
      model: 'melspectrogram.onnx',
      sampleRate: 16000,
      framesProduced: this.metrics.framesProduced,
      bufferSize: this.bufferLength,
      avgLatency: this.metrics.avgExtractionTimeMs,
      maxLatency: this.metrics.maxExtractionTimeMs,
      lastLatency: this.metrics.lastLatencyMs,
      lastFeatureTime: this.metrics.lastFeatureTimestamp || '--',
      droppedFrames: this.metrics.droppedFrames
    });
  }

  /**
   * Dispose resources and clear the buffers.
   */
  dispose() {
    this.session = null;
    this.isInitialized = false;
    this.bufferLength = 0;
    this.metrics = {
      framesProcessed: 0,
      framesProduced: 0,
      totalExtractionTimeMs: 0,
      maxExtractionTimeMs: 0,
      avgExtractionTimeMs: 0,
      droppedFrames: 0,
      lastFeatureTimestamp: null,
      lastLatencyMs: 0.0
    };
    logger.info('MelSpectrogram', 'Mel Spectrogram Extractor disposed.');
    this._emitMetrics('Uninitialized');
  }
}
