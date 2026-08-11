import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { ModelLoader } from './model-loader.js';
import { WakeWordInference } from './inference.js';

/**
 * OpenWakeWordWrapper coordinates model downloading, ONNX session initialization,
 * event hooks, and conditional execution gating.
 */
export class OpenWakeWordWrapper {
  constructor() {
    this.config = {
      wakeWord: 'Hey Louie',
      model: 'hey_louie',
      mode: 'Production',
      threshold: 0.50,
      cooldown: 2000,
      sampleRate: 16000
    };

    this.loader = new ModelLoader();
    this.inference = new WakeWordInference();
    
    this.isInitialized = false;
    this.isSpeechActive = false;
    this.hasNotifiedPending = false;

    // Bind listeners
    this._handleSpeechStart = this._handleSpeechStart.bind(this);
    this._handleSpeechEnd = this._handleSpeechEnd.bind(this);
    this._handleEmbeddingFeatures = this._handleEmbeddingFeatures.bind(this);
 
    eventBus.on(EVENTS.SPEECH_START, this._handleSpeechStart);
    eventBus.on(EVENTS.SPEECH_END, this._handleSpeechEnd);
    eventBus.on(EVENTS.EMBEDDING_FEATURES, this._handleEmbeddingFeatures);
  }
 
  _handleSpeechStart() {
    this.isSpeechActive = true;
    this.hasNotifiedPending = false;
  }
 
  _handleSpeechEnd() {
    this.isSpeechActive = false;
  }
 
  /**
   * Listen to the Speech Embedding feature tensors.
   * 
   * @param {Object} payload
   * @param {Float32Array} payload.embedding
   * @param {Array<number>} payload.shape
   */
  _handleEmbeddingFeatures({ embedding, shape }) {
    if (!this.isInitialized) return;
    
    if (this.config.mode === 'Development' && Math.random() < 0.05) {
      logger.info('WakeWord', `Ingested Speech Embedding frame: size=${embedding.length}, shape=[${shape.join(', ')}]`);
    }

    // Run inference using the new custom classifier
    this.inference.process(embedding);
  }
 
  /**
   * Download the ONNX model, boot the ONNX session, and check metadata properties.
   * 
   * @param {Object} options - Configuration overrides.
   * @returns {Promise<boolean>}
   */
  async initialize(options = {}) {
    this.config = { ...this.config, ...options };
    logger.info('WakeWord', `Initializing OpenWakeWord Engine for target wake word "${this.config.wakeWord}"...`);
 
    // Declare URLs outside try so catch block can evict them from cache
    const version = this.config.model === 'hey_louie' ? '?v=1.1' : '';
    const localUrl = `/models/${this.config.model}.onnx${version}`;
    const fallbackUrl = `https://raw.githubusercontent.com/CLFML/lowwi/main/models/example_wakewords/${this.config.model}.onnx${version}`;
 
    try {
      // 1. Download/Cache model file with automatic local-to-remote fallback
      let modelBuffer;
      try {
        modelBuffer = await this.loader.loadModel(this.config.model, localUrl);
      } catch (localError) {
        logger.warn('WakeWord', `Local model file not found or failed to load. Falling back to remote LFS URL: ${fallbackUrl}`);
        modelBuffer = await this.loader.loadModel(this.config.model, fallbackUrl);
      }
 
      // 2. Load and validate inside ONNX session
      await this.inference.initialize(modelBuffer, this.config.model);
 
      this.isInitialized = true;
      eventBus.emit(EVENTS.WAKEWORD_INITIALIZED);
      eventBus.emit(EVENTS.WAKEWORD_READY);
      return true;
    } catch (error) {
      logger.error('WakeWord', `Initialization failed: ${error.message}. Evicting cache to recover...`);
      
      // Self-healing cache eviction — clears corrupt entries so next attempt re-downloads
      try {
        const cache = await caches.open('openwakeword-models');
        await cache.delete(localUrl);
        await cache.delete(fallbackUrl);
        logger.info('WakeWord', 'Evicted corrupted model cache entries. Please retry initialization.');
      } catch (cacheError) {
        logger.warn('WakeWord', `Failed to evict cache: ${cacheError.message}`);
      }
 
      eventBus.emit(EVENTS.WAKEWORD_ERROR);
      return false;
    }
  }
 
  /**
   * Process a single audio frame. Gated by VAD speech classification.
   * 
   * @param {Float32Array} frame - Raw/denoised PCM float32 audio frame.
   */
  process(_frame) {
    if (!this.isInitialized) return;
 
    if (this.isSpeechActive) {
      if (!this.hasNotifiedPending) {
        // Output the honest, transparent status log in the console
        logger.info('WakeWord', 'VAD Speech active. Engine is ready and waiting for feature extraction backbone (Phase 2).');
        this.hasNotifiedPending = true;
      }
    }
  }
 
  /**
   * Unsubscribe from events and dispose ONNX sessions.
   */
  dispose() {
    eventBus.off(EVENTS.SPEECH_START, this._handleSpeechStart);
    eventBus.off(EVENTS.SPEECH_END, this._handleSpeechEnd);
    eventBus.off(EVENTS.EMBEDDING_FEATURES, this._handleEmbeddingFeatures);
 
    if (this.isInitialized) {
      this.inference.dispose();
    }
    
    this.isInitialized = false;
    this.isSpeechActive = false;
    this.hasNotifiedPending = false;
    logger.info('WakeWord', 'OpenWakeWord Engine resources disposed.');
  }
}
