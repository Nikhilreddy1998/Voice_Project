import { DATASET_CONFIG } from '../utils/constants.js';

/**
 * Dataset Validator
 * -----------------
 * Validates audio recordings for the Hey Louie dataset against the
 * official dataset criteria and acoustic quality specifications.
 * 
 * Rules:
 * - Format: 16 kHz, 1 channel (mono), 16-bit PCM WAV.
 * - Duration: 2.0s to 4.0s.
 * - Signal Energy: Rejects silence when RMS < MIN_RMS_THRESHOLD.
 * - DC Offset: Evaluated independently; warnings flagged if excessive,
 *   without rejecting natural non-zero acoustic means.
 * - No destructive normalization applied.
 */

/**
 * Validate audio samples and metadata.
 * 
 * @param {Float32Array} samples - Raw Float32 mono audio samples
 * @param {Object} [meta={}] - Optional metadata (sampleRate, channels, bitDepth)
 * @returns {{
 *   isValid: boolean,
 *   durationStatus: 'short' | 'good' | 'long',
 *   errors: string[],
 *   warnings: string[],
 *   metrics: {
 *     sampleCount: number,
 *     duration: number,
 *     rms: number,
 *     rmsDb: number,
 *     peak: number,
 *     peakDb: number,
 *     dcOffset: number,
 *     sampleRate: number,
 *     channels: number,
 *     bitDepth: number
 *   }
 * }}
 */
export function validateAudio(samples, meta = {}) {
  const sampleRate = meta.sampleRate || DATASET_CONFIG.SAMPLE_RATE;
  const actualSampleRate = meta.actualSampleRate !== undefined 
    ? meta.actualSampleRate 
    : (meta.inputSampleRate !== undefined ? meta.inputSampleRate : sampleRate);
  const wasResampled = Boolean(meta.wasResampled);
  const channels = meta.channels !== undefined ? meta.channels : DATASET_CONFIG.CHANNELS;
  const bitDepth = meta.bitDepth || DATASET_CONFIG.BIT_DEPTH;

  const errors = [];
  const warnings = [];

  // Check audio data presence
  if (!samples || samples.length === 0) {
    return {
      isValid: false,
      durationStatus: 'short',
      errors: ['No audio samples recorded (buffer is empty).'],
      warnings: [],
      metrics: {
        sampleCount: 0,
        duration: 0,
        rms: 0,
        rmsDb: -Infinity,
        peak: 0,
        peakDb: -Infinity,
        dcOffset: 0,
        sampleRate,
        actualSampleRate,
        wasResampled,
        channels,
        bitDepth
      }
    };
  }

  // Format checks
  if (sampleRate !== DATASET_CONFIG.SAMPLE_RATE) {
    errors.push(`Invalid final sample rate: ${sampleRate} Hz (must be ${DATASET_CONFIG.SAMPLE_RATE} Hz).`);
  }
  if (actualSampleRate !== DATASET_CONFIG.SAMPLE_RATE && !wasResampled) {
    errors.push(
      `AudioContext ran at ${actualSampleRate} Hz, but samples were not resampled to required ${DATASET_CONFIG.SAMPLE_RATE} Hz.`
    );
  }
  if (channels !== DATASET_CONFIG.CHANNELS) {
    errors.push(`Invalid channel count: ${channels} (must be mono / 1 channel).`);
  }
  if (bitDepth !== DATASET_CONFIG.BIT_DEPTH) {
    errors.push(`Invalid bit depth: ${bitDepth}-bit (must be ${DATASET_CONFIG.BIT_DEPTH}-bit PCM).`);
  }

  // Calculate duration
  const duration = samples.length / sampleRate;
  let durationStatus = 'good';

  if (duration < DATASET_CONFIG.MIN_DURATION_SEC) {
    durationStatus = 'short';
    errors.push(`Duration too short: ${duration.toFixed(2)}s (minimum required is ${DATASET_CONFIG.MIN_DURATION_SEC.toFixed(1)}s).`);
  } else if (duration > DATASET_CONFIG.MAX_DURATION_SEC + 0.5) {
    durationStatus = 'long';
    errors.push(`Duration too long: ${duration.toFixed(2)}s (maximum recommended is ${DATASET_CONFIG.MAX_DURATION_SEC.toFixed(1)}s).`);
  } else if (duration > DATASET_CONFIG.MAX_DURATION_SEC) {
    durationStatus = 'long';
    warnings.push(`Duration ${duration.toFixed(2)}s slightly exceeds target ${DATASET_CONFIG.MAX_DURATION_SEC.toFixed(1)}s limit.`);
  }

  // Calculate signal metrics: RMS, Peak Amplitude, DC Offset
  let sumSquares = 0;
  let sumSamples = 0;
  let peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const abs = Math.abs(s);
    if (abs > peak) {
      peak = abs;
    }
    sumSquares += s * s;
    sumSamples += s;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const dcOffset = Math.abs(sumSamples / samples.length);

  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;

  // Silence / energy rejection: reject if RMS < MIN_RMS_THRESHOLD
  if (rms < DATASET_CONFIG.MIN_RMS_THRESHOLD) {
    errors.push(
      `Audio signal is silent or near-empty (RMS: ${rms.toFixed(4)}, Peak: ${peak.toFixed(4)}). Speak clearly into the microphone.`
    );
  }

  // Check for clipping
  if (peak >= 0.999) {
    warnings.push('Audio clipped during recording (peak reached maximum 0 dBFS). Try moving further from the mic or lowering input gain.');
  }

  // Evaluate DC offset independently: only warn if excessively high
  if (dcOffset > DATASET_CONFIG.MAX_DC_OFFSET_WARN) {
    warnings.push(`Noticeable DC offset detected (${(dcOffset * 100).toFixed(1)}%). Check your microphone or sound card.`);
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    durationStatus,
    errors,
    warnings,
    metrics: {
      sampleCount: samples.length,
      duration,
      rms,
      rmsDb,
      peak,
      peakDb,
      dcOffset,
      sampleRate,
      actualSampleRate,
      wasResampled,
      channels,
      bitDepth
    }
  };
}
