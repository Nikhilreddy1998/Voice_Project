/**
 * AudioProcessor runs on the audio rendering thread.
 * It is responsible for accumulating mono channel audio samples and pushing
 * standard size chunks (e.g., 512 samples) to the main thread.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // TODO: Initialize internal buffer or ring buffer to accumulate samples
    this.bufferSize = 512;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
  }

  /**
   * Main audio processing loop callback.
   * @param {Array<Array<Float32Array>>} inputs - Array of inputs, each input is an array of channels, each channel is a Float32Array of 128 samples.
   * @param {Array<Array<Float32Array>>} outputs - Output channels (if forwarding is needed).
   * @param {Object} parameters - Dynamic parameters.
   * @returns {boolean} Keep worklet alive.
   */
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Get the first channel (mono)
    const channelData = input[0];
    const length = channelData.length; // Typically 128 samples

    // TODO: Write incoming samples to the circular accumulator buffer
    // For now, this is a simplified simulation of block bundling:
    for (let i = 0; i < length; i++) {
      this.buffer[this.writeIndex++] = channelData[i];

      // If buffer is full, post it to the main thread and reset
      if (this.writeIndex >= this.bufferSize) {
        // Post a copy of the accumulated buffer
        this.port.postMessage(this.buffer.slice());
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
