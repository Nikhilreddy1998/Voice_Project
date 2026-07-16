import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';

/**
 * VadMetricsComponent manages the rendering and live updates
 * of performance metrics specific to the VAD pipeline module.
 */
export class VadMetricsComponent {
  /**
   * Create metrics component.
   * @param {HTMLElement} container 
   */
  constructor(container) {
    this.container = container;
    this.elements = {};
    this._handleMetrics = this._handleMetrics.bind(this);
  }

  /**
   * Render metrics markup and bind to Event Bus.
   */
  render() {
    this.container.innerHTML = `
      <div class="vad-metrics-panel">
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Engine</span>
          <span class="metric-mini-val" id="vad-engine-status">Loading...</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">State</span>
          <span class="metric-mini-val" id="vad-state">IDLE</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Frames</span>
          <span class="metric-mini-val" id="vad-frames">0</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Speech</span>
          <span class="metric-mini-val" id="vad-speech-frames">0</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Silence</span>
          <span class="metric-mini-val" id="vad-silence-frames">0</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Speech Time</span>
          <span class="metric-mini-val" id="vad-speech-time">0.00s</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">Speech %</span>
          <span class="metric-mini-val" id="vad-speech-percent">0.0%</span>
        </div>
        <div class="metric-mini-box">
          <span class="metric-mini-lbl">False Triggers</span>
          <span class="metric-mini-val" id="vad-false-triggers">0</span>
        </div>
      </div>
    `;

    this.elements = {
      engineStatus: document.getElementById('vad-engine-status'),
      state: document.getElementById('vad-state'),
      frames: document.getElementById('vad-frames'),
      speechFrames: document.getElementById('vad-speech-frames'),
      silenceFrames: document.getElementById('vad-silence-frames'),
      speechTime: document.getElementById('vad-speech-time'),
      speechPercent: document.getElementById('vad-speech-percent'),
      falseTriggers: document.getElementById('vad-false-triggers'),
    };

    // Listen to metrics updates from VAD wrapper
    eventBus.on(EVENTS.VAD_METRICS, this._handleMetrics);
  }

  /**
   * Handle real-time metrics update events.
   * @param {Object} metrics - VAD stats payload.
   * @private
   */
  _handleMetrics(metrics) {
    if (!this.elements.engineStatus) return;

    const {
      engineStatus,
      state,
      framesProcessed,
      speechFrames,
      silenceFrames,
      speechDuration,
      speechPercentage,
      falseTriggers,
    } = metrics;

    this.elements.engineStatus.textContent = engineStatus || 'Loading...';
    
    // Status text color styling
    if (engineStatus === 'Ready') {
      this.elements.engineStatus.style.color = 'var(--success)';
    } else if (engineStatus === 'Error') {
      this.elements.engineStatus.style.color = 'var(--danger)';
    } else {
      this.elements.engineStatus.style.color = 'var(--warning)';
    }

    this.elements.state.textContent = state || 'IDLE';
    if (state === 'SPEECH') {
      this.elements.state.style.color = 'var(--warning)';
    } else if (state === 'LISTENING') {
      this.elements.state.style.color = 'var(--info)';
    } else {
      this.elements.state.style.color = 'var(--color-text-muted)';
    }

    this.elements.frames.textContent = framesProcessed;
    this.elements.speechFrames.textContent = speechFrames;
    this.elements.silenceFrames.textContent = silenceFrames;
    this.elements.speechTime.textContent = `${speechDuration.toFixed(2)}s`;
    this.elements.speechPercent.textContent = `${speechPercentage.toFixed(1)}%`;
    this.elements.falseTriggers.textContent = falseTriggers;
  }

  /**
   * Clean up event listeners.
   */
  dispose() {
    eventBus.off(EVENTS.VAD_METRICS, this._handleMetrics);
  }
}
