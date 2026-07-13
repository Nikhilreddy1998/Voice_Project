import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';

export class Dashboard {
  /**
   * Create the dashboard, attaching it to a container element.
   * @param {HTMLElement} container 
   */
  constructor(container) {
    this.container = container;
    this.elements = {};
    this.logsLimit = 100;
    this.logsList = [];
    
    // Bind callback contexts
    this._handleLog = this._handleLog.bind(this);
    this._handleMicStatus = this._handleMicStatus.bind(this);
    this._handleDspStatus = this._handleDspStatus.bind(this);
    this._handleVadStatus = this._handleVadStatus.bind(this);
    this._handleWakewordStatus = this._handleWakewordStatus.bind(this);
    this._handleWakewordDetected = this._handleWakewordDetected.bind(this);
    this._handleMetrics = this._handleMetrics.bind(this);
  }

  /**
   * Render dashboard markup and mount.
   */
  render() {
    this.container.innerHTML = `
      <div class="dashboard-wrapper">
        <header class="dashboard-header">
          <div class="logo-area">
            <span class="icon">🎙️</span>
            <h1>Wake Word Detection Hub</h1>
          </div>
          <div class="actions">
            <button id="btn-init" class="btn primary">Initialize Pipeline</button>
            <button id="btn-toggle" class="btn success" disabled>Start Listening</button>
          </div>
        </header>

        <main class="dashboard-content">
          <!-- Status Grid -->
          <section class="card status-card">
            <h2>Pipeline Modules</h2>
            <div class="status-grid">
              <div class="status-item">
                <span class="status-label">Microphone</span>
                <div class="status-indicator-wrapper">
                  <span id="status-mic-badge" class="badge warning">Uninitialized</span>
                </div>
              </div>
              <div class="status-item">
                <span class="status-label">RNNoise (DSP)</span>
                <div class="status-indicator-wrapper">
                  <span id="status-dsp-badge" class="badge inactive">Inactive</span>
                </div>
              </div>
              <div class="status-item">
                <span class="status-label">VAD (Voice Activity)</span>
                <div class="status-indicator-wrapper">
                  <span id="status-vad-badge" class="badge inactive">Idle</span>
                </div>
              </div>
              <div class="status-item">
                <span class="status-label">Wake Word Engine</span>
                <div class="status-indicator-wrapper">
                  <span id="status-ww-badge" class="badge inactive">Waiting...</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Telemetry Grid -->
          <section class="card telemetry-card">
            <h2>Real-time Performance</h2>
            <div class="metrics-grid">
              <div class="metric-box">
                <span class="metric-val" id="metric-latency">--</span>
                <span class="metric-unit">ms</span>
                <span class="metric-lbl">Processing Latency</span>
              </div>
              <div class="metric-box">
                <span class="metric-val" id="metric-fps">--</span>
                <span class="metric-unit">fps</span>
                <span class="metric-lbl">Frames / Sec</span>
              </div>
              <div class="metric-box">
                <span class="metric-val" id="metric-cpu">--</span>
                <span class="metric-unit">%</span>
                <span class="metric-lbl">CPU Usage Est.</span>
              </div>
            </div>
            <!-- Audio Visualizer Canvas -->
            <div class="visualizer-container">
              <canvas id="audio-visualizer" height="60"></canvas>
            </div>
          </section>

          <!-- Console Event Log -->
          <section class="card console-card">
            <div class="console-header">
              <h2>System Event Console</h2>
              <button id="btn-clear-logs" class="btn-text">Clear Console</button>
            </div>
            <div class="console-log-wrapper" id="console-logs-list">
              <!-- Logs appended here -->
              <div class="log-row info">
                <span class="log-time">[00:00:00]</span>
                <span class="log-tag">[SYSTEM]</span>
                <span class="log-text">Dashboard rendered. Ready to initialize.</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    `;

    // Cache elements
    this.elements = {
      btnInit: document.getElementById('btn-init'),
      btnToggle: document.getElementById('btn-toggle'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      micBadge: document.getElementById('status-mic-badge'),
      dspBadge: document.getElementById('status-dsp-badge'),
      vadBadge: document.getElementById('status-vad-badge'),
      wwBadge: document.getElementById('status-ww-badge'),
      metricLatency: document.getElementById('metric-latency'),
      metricFps: document.getElementById('metric-fps'),
      metricCpu: document.getElementById('metric-cpu'),
      logsList: document.getElementById('console-logs-list'),
      canvas: document.getElementById('audio-visualizer')
    };

    this._bindButtonEvents();
    this._subscribeToEvents();
    this._initializeCanvas();
  }

  /**
   * Subscribe to event bus events.
   * @private
   */
  _subscribeToEvents() {
    eventBus.on(EVENTS.LOG, this._handleLog);
    
    // Status subscriptions
    eventBus.on(EVENTS.MIC_INITIALIZED, () => this._handleMicStatus('Ready'));
    eventBus.on(EVENTS.MIC_ERROR, () => this._handleMicStatus('Error'));
    eventBus.on(EVENTS.MIC_PERMISSION_GRANTED, () => this._handleMicStatus('Permitted'));
    
    eventBus.on(EVENTS.DSP_INITIALIZED, () => this._handleDspStatus('Active'));
    
    eventBus.on(EVENTS.VAD_INITIALIZED, () => this._handleVadStatus('Active'));
    eventBus.on(EVENTS.SPEECH_START, () => this._handleVadStatus('Listening'));
    eventBus.on(EVENTS.SPEECH_END, () => this._handleVadStatus('Idle'));
    
    eventBus.on(EVENTS.WAKEWORD_INITIALIZED, () => this._handleWakewordStatus('Active'));
    eventBus.on(EVENTS.WAKEWORD_DETECTED, this._handleWakewordDetected);
    
    // Metrics subscription
    eventBus.on(EVENTS.METRICS_UPDATE, this._handleMetrics);
  }

  /**
   * Wire buttons up to trigger pipeline setup logic (handled in main.js).
   * @private
   */
  _bindButtonEvents() {
    this.elements.btnInit.addEventListener('click', () => {
      this.elements.btnInit.disabled = true;
      this.elements.btnInit.textContent = 'Initializing...';
      
      // Dispatch initialization intent to main controller
      const customEvent = new CustomEvent('pipeline:init');
      window.dispatchEvent(customEvent);
    });

    this.elements.btnToggle.addEventListener('click', () => {
      const isListening = this.elements.btnToggle.textContent === 'Stop Listening';
      
      if (isListening) {
        this.elements.btnToggle.textContent = 'Start Listening';
        this.elements.btnToggle.classList.remove('danger');
        this.elements.btnToggle.classList.add('success');
        window.dispatchEvent(new CustomEvent('pipeline:stop'));
      } else {
        this.elements.btnToggle.textContent = 'Stop Listening';
        this.elements.btnToggle.classList.remove('success');
        this.elements.btnToggle.classList.add('danger');
        window.dispatchEvent(new CustomEvent('pipeline:start'));
      }
    });

    this.elements.btnClearLogs.addEventListener('click', () => {
      this.elements.logsList.innerHTML = '';
      this.logsList = [];
    });
  }

  _initializeCanvas() {
    const ctx = this.elements.canvas.getContext('2d');
    const width = this.elements.canvas.width;
    const height = this.elements.canvas.height;
    
    ctx.fillStyle = '#1e1e2f';
    ctx.fillRect(0, 0, width, height);
    
    // Draw initial empty wave line
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }

  /**
   * Update Microphone badge.
   * @param {'Ready'|'Error'|'Permitted'} state 
   */
  _handleMicStatus(state) {
    const badge = this.elements.micBadge;
    badge.className = 'badge'; // Reset classes
    
    if (state === 'Ready') {
      badge.textContent = 'Ready';
      badge.classList.add('success');
      this.elements.btnToggle.disabled = false; // Allow starting/stopping
      this.elements.btnInit.textContent = 'Initialized';
    } else if (state === 'Permitted') {
      badge.textContent = 'Access OK';
      badge.classList.add('info');
    } else {
      badge.textContent = 'Error';
      badge.classList.add('danger');
      this.elements.btnInit.disabled = false;
      this.elements.btnInit.textContent = 'Retry Init';
    }
  }

  /**
   * Update DSP badge.
   */
  _handleDspStatus(state) {
    const badge = this.elements.dspBadge;
    badge.textContent = state;
    badge.className = 'badge ' + (state === 'Active' ? 'success' : 'inactive');
  }

  /**
   * Update VAD badge.
   */
  _handleVadStatus(state) {
    const badge = this.elements.vadBadge;
    badge.textContent = state;
    badge.className = 'badge';
    
    if (state === 'Listening') {
      badge.classList.add('primary-glow');
    } else if (state === 'Active') {
      badge.classList.add('success');
    } else {
      badge.classList.add('inactive');
    }
  }

  /**
   * Update Wake Word badge.
   */
  _handleWakewordStatus(state) {
    const badge = this.elements.wwBadge;
    badge.textContent = state;
    badge.className = 'badge ' + (state === 'Active' ? 'success' : 'inactive');
  }

  /**
   * Wake word detection trigger.
   */
  _handleWakewordDetected({ word, probability }) {
    const badge = this.elements.wwBadge;
    const oldText = badge.textContent;
    const oldClass = badge.className;

    badge.textContent = `🌟 ${word.toUpperCase()} (${(probability * 100).toFixed(0)}%)`;
    badge.className = 'badge alert-glow';

    // Reset back to status after 2 seconds
    setTimeout(() => {
      badge.textContent = oldText;
      badge.className = oldClass;
    }, 2000);
  }

  /**
   * Handle telemetry update.
   */
  _handleMetrics({ latencyMs, fps, cpuEstimation }) {
    this.elements.metricLatency.textContent = latencyMs.toFixed(1);
    this.elements.metricFps.textContent = fps.toFixed(0);
    this.elements.metricCpu.textContent = cpuEstimation.toFixed(1);
    
    // Animate canvas wave (mock simulation for setup phase)
    this._drawMockWave(latencyMs);
  }

  _drawMockWave(latency) {
    const ctx = this.elements.canvas.getContext('2d');
    const w = this.elements.canvas.width;
    const h = this.elements.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#11111a';
    ctx.fillRect(0, 0, w, h);
    
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    for (let x = 0; x < w; x++) {
      const angle = (x / w) * Math.PI * 4 + (performance.now() / 150);
      const amp = (latency > 0) ? (5 + Math.sin(performance.now() / 300) * 10) : 2;
      const y = h / 2 + Math.sin(angle) * amp;
      
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /**
   * Appends log info to console list.
   */
  _handleLog({ timestamp, level, module, message }) {
    if (!this.elements.logsList) return;

    const row = document.createElement('div');
    row.className = `log-row ${level.toLowerCase()}`;
    
    row.innerHTML = `
      <span class="log-time">[${timestamp}]</span>
      <span class="log-tag">[${module.toUpperCase()}]</span>
      <span class="log-text">${message}</span>
    `;

    this.elements.logsList.appendChild(row);
    
    // Auto scroll to bottom
    this.elements.logsList.scrollTop = this.elements.logsList.scrollHeight;

    // Prune logs if list exceeds capacity
    while (this.elements.logsList.children.length > this.logsLimit) {
      this.elements.logsList.removeChild(this.elements.logsList.firstChild);
    }
  }
}
