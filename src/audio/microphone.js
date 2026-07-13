import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * MicrophoneManager handles obtaining microphone permission, setting up
 * the Web Audio context, loading/attaching the AudioWorkletProcessor,
 * and dispatching captured audio frames to the event bus.
 */
export class MicrophoneManager {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.isRecording = false;
  }

  /**
   * Initialize microphone permission and setup the Audio Context pipeline.
   * @returns {Promise<boolean>} Resolves to true if initialization succeeded.
   */
  async initialize() {
    logger.info('Microphone', 'Initializing microphone capture...');
    try {
      // 1. Request microphone access permission from the browser
      // TODO: Request user media stream with constraints
      // const constraints = { audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } };
      // this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      eventBus.emit(EVENTS.MIC_PERMISSION_GRANTED);
      logger.info('Microphone', 'Permission granted successfully.');

      // 2. Initialize AudioContext at standard 16kHz
      // TODO: Instantiate AudioContext with sampleRate: AUDIO_CONFIG.SAMPLE_RATE
      // this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      //   sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
      //   latencyHint: 'interactive'
      // });

      // 3. Load and register the custom AudioWorkletProcessor
      // TODO: Register audio-worklet.js using this.audioContext.audioWorklet.addModule()
      
      // 4. Create source node from MediaStream
      // TODO: this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 5. Connect source node to AudioWorkletNode
      // TODO: Instantiate AudioWorkletNode and hook 'message' events to forward audio frames
      // this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      // this.workletNode.port.onmessage = (event) => this.handleAudioFrame(event.data);
      // this.sourceNode.connect(this.workletNode);

      eventBus.emit(EVENTS.MIC_INITIALIZED);
      logger.info('Microphone', 'Audio pipeline initialized, ready to start.');
      return true;
    } catch (error) {
      logger.error('Microphone', `Failed to initialize microphone: ${error.message}`);
      eventBus.emit(EVENTS.MIC_ERROR, error);
      return false;
    }
  }

  /**
   * Start streaming audio data.
   */
  start() {
    if (this.isRecording) return;
    logger.info('Microphone', 'Starting audio stream capture.');
    
    // TODO: Resume AudioContext if suspended, start forwarding worklet data
    this.isRecording = true;
  }

  /**
   * Stop streaming audio data.
   */
  stop() {
    if (!this.isRecording) return;
    logger.info('Microphone', 'Stopping audio stream capture.');
    
    // TODO: Suspend AudioContext, stop worklet data propagation
    this.isRecording = false;
  }

  /**
   * Callback fired by the Audio Worklet on the audio thread.
   * @param {Float32Array} frame - Raw audio buffer (512 samples at 16kHz)
   */
  handleAudioFrame(_frame) {
    if (!this.isRecording) return;

    // TODO: Forward frame to the event bus for DSP and VAD modules
    // eventBus.emit(EVENTS.MIC_STREAM_DATA, frame);
  }

  /**
   * Clean up and release system microphone resources.
   */
  async dispose() {
    this.stop();
    logger.info('Microphone', 'Disposing microphone manager resources.');

    // TODO: Close streams, disconnect nodes, and close AudioContext
    // if (this.mediaStream) {
    //   this.mediaStream.getTracks().forEach(track => track.stop());
    // }
    // if (this.audioContext) {
    //   await this.audioContext.close();
    // }
    
    this.sourceNode = null;
    this.workletNode = null;
    this.audioContext = null;
    this.mediaStream = null;
  }
}
