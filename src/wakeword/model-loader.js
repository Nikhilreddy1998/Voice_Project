import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const CACHE_NAME = 'openwakeword-models';

/**
 * ModelLoader handles downloading ONNX model files asynchronously,
 * caching them via browser CacheStorage API for offline support,
 * and reporting real-time download progress (0-100%).
 */
export class ModelLoader {
  /**
   * Load the configured model. Attempts to load from CacheStorage first,
   * falling back to network fetch if not found.
   * 
   * @param {string} modelName - Configuration identifier (e.g. "hey_mycroft")
   * @param {string} modelUrl - Network URL or local path to download
   * @returns {Promise<ArrayBuffer>}
   */
  async loadModel(modelName, modelUrl) {
    logger.info('WakeWord', `Preparing to load model "${modelName}"...`);
    eventBus.emit(EVENTS.WAKEWORD_PROGRESS, 0);

    try {
      // 1. Open browser CacheStorage
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(modelUrl);

      if (cachedResponse) {
        const cachedContentType = cachedResponse.headers.get('content-type');
        const cachedLength = cachedResponse.headers.get('content-length');
        const cachedSize = cachedLength ? parseInt(cachedLength, 10) : 0;

        if ((cachedContentType && cachedContentType.includes('text/html')) || (cachedSize > 0 && cachedSize < 10240)) {
          logger.warn('WakeWord', 'Cached response is invalid HTML or too small. Deleting from CacheStorage...');
          await cache.delete(modelUrl);
        } else {
          // Read arrayBuffer and verify size as double insurance
          const buffer = await cachedResponse.arrayBuffer();
          if (buffer.byteLength < 10240) {
            logger.warn('WakeWord', 'Cached buffer size is too small. Deleting from CacheStorage...');
            await cache.delete(modelUrl);
          } else {
            logger.info('WakeWord', `Model "${modelName}" found in browser CacheStorage. Loading offline...`);
            eventBus.emit(EVENTS.WAKEWORD_PROGRESS, 100);
            return buffer;
          }
        }
      }

      logger.info('WakeWord', `Model "${modelName}" not found in cache. Downloading from: ${modelUrl}`);

      // 2. Fetch with progress tracking
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      // Safeguard: Check if response is an HTML page (indicates Vite SPA route fallback)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error('Received HTML response instead of binary model data (Vite routing redirect)');
      }

      const contentLength = response.headers.get('content-length');
      if (!contentLength) {
        logger.warn('WakeWord', 'Content-Length header missing. Progress indicators may be inaccurate.');
      }

      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
      let loadedBytes = 0;

      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loadedBytes += value.length;

        if (totalBytes > 0) {
          const progress = Math.round((loadedBytes / totalBytes) * 100);
          eventBus.emit(EVENTS.WAKEWORD_PROGRESS, progress);
        }
      }

      // Reassemble the downloaded chunks into a single Uint8Array
      const mergedBuffer = new Uint8Array(loadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        mergedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // Safeguard: Check minimum size (real ONNX binary is always > 10KB, LFS pointers and HTML pages are < 1KB)
      if (mergedBuffer.byteLength < 10240) {
        throw new Error(`Downloaded model buffer size is too small (${mergedBuffer.byteLength} bytes). Expected at least 10KB.`);
      }

      // 3. Cache the downloaded response for future offline loads
      // Note: response.clone() or creating a new Response object is required
      try {
        const cacheResponse = new Response(mergedBuffer, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': loadedBytes.toString()
          }
        });
        await cache.put(modelUrl, cacheResponse);
        logger.info('WakeWord', `Model "${modelName}" successfully cached in CacheStorage.`);
      } catch (cacheError) {
        logger.warn('WakeWord', `Failed to write model cache: ${cacheError.message}`);
      }

      eventBus.emit(EVENTS.WAKEWORD_PROGRESS, 100);
      return mergedBuffer.buffer;
    } catch (error) {
      logger.error('WakeWord', `Failed to load model file: ${error.message}`);
      throw error;
    }
  }
}
