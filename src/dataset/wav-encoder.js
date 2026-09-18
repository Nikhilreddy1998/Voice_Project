/**
 * WAV Encoder
 * -----------
 * Encodes linear mono Float32 audio samples into standard uncompressed
 * 16-bit PCM WAV (RIFF/WAVE) format at 16 kHz.
 * 
 * Preserves original acoustic characteristics (gain, volume, distance)
 * without destructive normalization to retain natural dataset diversity.
 */

/**
 * Write ASCII string into DataView at given byte offset.
 * @param {DataView} view 
 * @param {number} offset 
 * @param {string} str 
 */
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Encodes Float32 mono audio samples into a 16-bit PCM WAV Blob.
 * 
 * @param {Float32Array} samples - Audio samples in range [-1.0, 1.0]
 * @param {number} [sampleRate=16000] - Sample rate in Hz (default 16000)
 * @returns {{ blob: Blob, buffer: ArrayBuffer, sizeBytes: number, duration: number, sampleRate: number, channels: number, bitDepth: number }}
 */
export function encodeWav(samples, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // 1. RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // ChunkSize: 36 + SubChunk2Size
  writeString(view, 8, 'WAVE');

  // 2. "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);              // AudioFormat (1 = Linear PCM)
  view.setUint16(22, numChannels, true);    // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);     // SampleRate (16000)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true);              // BlockAlign
  view.setUint16(34, bitsPerSample, true);  // BitsPerSample (16)

  // 3. "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);     // Subchunk2Size

  // 4. Write audio data samples as signed 16-bit integers
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp sample between -1.0 and 1.0
    const s = Math.max(-1, Math.min(1, samples[i]));
    // Convert float to signed 16-bit int (little-endian)
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  const duration = samples.length / sampleRate;
  const blob = new Blob([buffer], { type: 'audio/wav' });

  return {
    blob,
    buffer,
    sizeBytes: buffer.byteLength,
    duration,
    sampleRate,
    channels: numChannels,
    bitDepth: bitsPerSample
  };
}

/**
 * Read ASCII string from DataView at given byte offset and length.
 * @param {DataView} view 
 * @param {number} offset 
 * @param {number} length 
 * @returns {string}
 */
function readString(view, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str;
}

/**
 * Independently parse and verify that an ArrayBuffer contains a valid
 * 16-bit linear PCM mono WAV file with the expected sample rate.
 * 
 * @param {ArrayBuffer} buffer - Raw WAV byte buffer
 * @param {number} [expectedSampleRate=16000] - Expected sample rate in Hz
 * @returns {{
 *   valid: boolean,
 *   riffTag: string,
 *   waveTag: string,
 *   audioFormat: number,
 *   numChannels: number,
 *   sampleRate: number,
 *   byteRate: number,
 *   blockAlign: number,
 *   bitsPerSample: number,
 *   dataLength: number,
 *   sampleCount: number,
 *   durationSec: number,
 *   errors: string[]
 * }}
 */
export function verifyWavHeader(buffer, expectedSampleRate = 16000) {
  const errors = [];
  if (!buffer || buffer.byteLength < 44) {
    return {
      valid: false,
      errors: ['Buffer is too small to contain a valid 44-byte WAV header.']
    };
  }

  const view = new DataView(buffer);
  const riffTag = readString(view, 0, 4);
  const waveTag = readString(view, 8, 4);
  const fmtTag = readString(view, 12, 4);
  const subchunk1Size = view.getUint32(16, true);
  const audioFormat = view.getUint16(20, true);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const blockAlign = view.getUint16(32, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataTag = readString(view, 36, 4);
  const dataLength = view.getUint32(40, true);

  if (riffTag !== 'RIFF') errors.push(`Invalid RIFF tag: "${riffTag}"`);
  if (waveTag !== 'WAVE') errors.push(`Invalid WAVE format tag: "${waveTag}"`);
  if (fmtTag !== 'fmt ') errors.push(`Invalid fmt subchunk tag: "${fmtTag}"`);
  if (subchunk1Size !== 16) errors.push(`Unexpected fmt size: ${subchunk1Size} (expected 16 for PCM)`);
  if (audioFormat !== 1) errors.push(`Non-PCM audio format: ${audioFormat} (expected 1 for linear PCM)`);
  if (numChannels !== 1) errors.push(`Invalid channel count: ${numChannels} (expected 1 for mono)`);
  if (sampleRate !== expectedSampleRate) {
    errors.push(`Sample rate mismatch: header has ${sampleRate} Hz, expected ${expectedSampleRate} Hz`);
  }
  if (bitsPerSample !== 16) errors.push(`Bits per sample mismatch: ${bitsPerSample} (expected 16)`);
  if (blockAlign !== 2) errors.push(`Block align mismatch: ${blockAlign} (expected 2 for 16-bit mono)`);
  if (byteRate !== sampleRate * 2) {
    errors.push(`Byte rate mismatch: ${byteRate} (expected ${sampleRate * 2})`);
  }
  if (dataTag !== 'data') errors.push(`Invalid data tag: "${dataTag}"`);
  if (buffer.byteLength !== 44 + dataLength) {
    errors.push(`File length mismatch: byteLength=${buffer.byteLength}, expected ${44 + dataLength}`);
  }

  const sampleCount = dataLength / 2;
  const durationSec = sampleCount / sampleRate;

  return {
    valid: errors.length === 0,
    riffTag,
    waveTag,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataLength,
    sampleCount,
    durationSec,
    errors
  };
}
