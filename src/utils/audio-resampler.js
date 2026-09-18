/**
 * Audio Resampler
 * ---------------
 * Resamples Float32 audio buffers from an arbitrary source sample rate
 * (e.g. 44.1 kHz, 48 kHz) to standard 16.0 kHz for dataset collection.
 * 
 * Uses browser-native OfflineAudioContext for hardware-accelerated,
 * band-limited sinc interpolation with anti-aliasing filtering.
 * Falls back to pure-JS area-weighted decimation if OfflineAudioContext is unavailable.
 */

/**
 * Resample Float32 mono audio samples to a target sample rate.
 * 
 * @param {Float32Array} samples - Input audio samples
 * @param {number} sourceRate - Native AudioContext sample rate (e.g. 48000, 44100)
 * @param {number} [targetRate=16000] - Desired target sample rate (default 16000)
 * @returns {Promise<Float32Array>} Resampled Float32 audio samples
 */
export async function resampleAudio(samples, sourceRate, targetRate = 16000) {
  if (!samples || samples.length === 0) {
    return new Float32Array(0);
  }

  // Fast path: sample rates already match
  if (sourceRate === targetRate) {
    return samples;
  }

  if (!sourceRate || !targetRate || sourceRate <= 0 || targetRate <= 0) {
    throw new Error(`Invalid sample rates: sourceRate=${sourceRate}, targetRate=${targetRate}`);
  }

  // 1. Try browser OfflineAudioContext (highest quality band-limited sinc + anti-aliasing)
  const OfflineCtxClass =
    (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) ||
    (typeof globalThis !== 'undefined' && (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)) ||
    null;

  if (OfflineCtxClass) {
    try {
      const targetLength = Math.max(1, Math.round(samples.length * (targetRate / sourceRate)));
      const offlineCtx = new OfflineCtxClass(1, targetLength, targetRate);
      const audioBuffer = offlineCtx.createBuffer(1, samples.length, sourceRate);

      if (audioBuffer.copyToChannel) {
        audioBuffer.copyToChannel(samples, 0);
      } else {
        audioBuffer.getChannelData(0).set(samples);
      }

      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start(0);

      const rendered = await offlineCtx.startRendering();
      return rendered.getChannelData(0);
    } catch {
      // If Web Audio OfflineAudioContext fails or rejects rate, proceed to pure JS fallback
    }
  }

  // 2. Pure JavaScript anti-aliased decimation / interpolation fallback
  return resampleAudioPureJs(samples, sourceRate, targetRate);
}

/**
 * Pure JavaScript resampler with anti-aliasing area-weighted integration
 * for downsampling and linear interpolation for upsampling.
 * 
 * @param {Float32Array} samples 
 * @param {number} sourceRate 
 * @param {number} targetRate 
 * @returns {Float32Array}
 */
export function resampleAudioPureJs(samples, sourceRate, targetRate = 16000) {
  if (!samples || samples.length === 0) {
    return new Float32Array(0);
  }

  if (sourceRate === targetRate) {
    return samples;
  }

  const ratio = sourceRate / targetRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);

  if (ratio > 1) {
    // Decimation: anti-aliasing area-weighted averaging across source intervals
    for (let i = 0; i < targetLength; i++) {
      const start = i * ratio;
      const end = Math.min(samples.length, (i + 1) * ratio);
      let sum = 0;
      let totalWeight = 0;

      let curr = Math.floor(start);
      const last = Math.min(samples.length - 1, Math.floor(end));

      while (curr <= last) {
        const segStart = Math.max(start, curr);
        const segEnd = Math.min(end, curr + 1);
        const weight = Math.max(0, segEnd - segStart);
        sum += samples[curr] * weight;
        totalWeight += weight;
        curr++;
      }

      output[i] = totalWeight > 0 ? sum / totalWeight : 0;
    }
  } else {
    // Upsampling: linear interpolation between adjacent samples
    for (let i = 0; i < targetLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s1 = samples[idx] !== undefined ? samples[idx] : 0;
      const s2 = (idx + 1 < samples.length) ? samples[idx + 1] : s1;
      output[i] = s1 + frac * (s2 - s1);
    }
  }

  return output;
}
