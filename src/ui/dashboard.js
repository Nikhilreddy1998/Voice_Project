import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { VadMetricsComponent } from './vad-metrics.js';

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
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">VAD (Voice Activity)</span>
                  <div class="status-indicator-wrapper">
                    <span id="status-vad-badge" class="badge inactive">Idle</span>
                  </div>
                </div>
                <div id="vad-metrics-container"></div>
              </div>
              <div class="status-item">
                <span class="status-label">Wake Word Engine</span>
                <div class="status-indicator-wrapper">
                  <span id="status-ww-badge" class="badge inactive">Waiting...</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Wake Word Engine Card -->
          <section class="card wakeword-card">
            <h2>Wake Word Engine</h2>
            <div class="status-grid">
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Engine Status</span>
                  <div class="status-indicator-wrapper">
                    <span id="ww-status-badge" class="badge inactive">Uninitialized</span>
                  </div>
                </div>
                
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Configured Phrase</span>
                  <span class="text-mono text-sm" id="ww-cfg-phrase" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">Hey Louie</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Loaded Model</span>
                  <span class="text-mono text-sm" id="ww-loaded-model" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Mode</span>
                  <span class="badge text-xs" id="ww-mode-badge" style="font-size: 0.75rem; background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3);">Development</span>
                </div>
                
                <div id="ww-progress-bar-container" style="display: none; width: 100%; margin-top: 8px;">
                  <div class="progress-bar-lbl" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 4px;">
                    <span>Downloading Model...</span>
                    <span id="ww-progress-pct">0%</span>
                  </div>
                  <div class="progress-bar-bg" style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div id="ww-progress-fill" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div>
                  </div>
                </div>
              </div>
              
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Inference Status</span>
                  <span class="badge warning" id="ww-inference-status">Disabled</span>
                </div>
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Reason</span>
                  <span class="text-mono text-sm" id="ww-inference-reason" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--warning);">Feature Extractor Pending</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Last Detection</span>
                  <span class="text-mono text-sm" id="ww-metric-last-detect" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Detections</span>
                  <span class="text-mono text-sm" id="ww-metric-detections" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Cooldown</span>
                  <span class="badge inactive" id="ww-cooldown-badge">Inactive</span>
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
            <!-- Pipeline Timing Panel -->
            <div class="pipeline-timing-panel">
              <div class="timing-title">Pipeline Stage Latency</div>
              <div class="timing-grid">
                <div class="timing-item">
                  <span class="timing-lbl">Microphone</span>
                  <span class="timing-val" id="timing-mic">-- ms</span>
                </div>
                <div class="timing-item">
                  <span class="timing-lbl">RNNoise (DSP)</span>
                  <span class="timing-val" id="timing-dsp">-- ms</span>
                </div>
                <div class="timing-item">
                  <span class="timing-lbl">VAD</span>
                  <span class="timing-val" id="timing-vad">-- ms</span>
                </div>
                <div class="timing-item">
                  <span class="timing-lbl">Wake Word</span>
                  <span class="timing-val" id="timing-ww">-- ms</span>
                </div>
                <div class="timing-item total">
                  <span class="timing-lbl">Total Latency</span>
                  <span class="timing-val" id="timing-total">-- ms</span>
                </div>
              </div>
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
      canvas: document.getElementById('audio-visualizer'),
      timingMic: document.getElementById('timing-mic'),
      timingDsp: document.getElementById('timing-dsp'),
      timingVad: document.getElementById('timing-vad'),
      timingWw: document.getElementById('timing-ww'),
      timingTotal: document.getElementById('timing-total'),
      wwStatusBadge: document.getElementById('ww-status-badge'),
      wwCfgPhrase: document.getElementById('ww-cfg-phrase'),
      wwLoadedModel: document.getElementById('ww-loaded-model'),
      wwModeBadge: document.getElementById('ww-mode-badge'),
      wwProgressBarContainer: document.getElementById('ww-progress-bar-container'),
      wwProgressPct: document.getElementById('ww-progress-pct'),
      wwProgressFill: document.getElementById('ww-progress-fill'),
      wwInferenceStatus: document.getElementById('ww-inference-status'),
      wwInferenceReason: document.getElementById('ww-inference-reason'),
      wwMetricLastDetect: document.getElementById('ww-metric-last-detect'),
      wwMetricDetections: document.getElementById('ww-metric-detections'),
      wwCooldownBadge: document.getElementById('ww-cooldown-badge')
    };

    // Instantiate and render VAD metrics sub-component
    const vadMetricsContainer = document.getElementById('vad-metrics-container');
    if (vadMetricsContainer) {
      this.vadMetrics = new VadMetricsComponent(vadMetricsContainer);
      this.vadMetrics.render();
    }

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
    eventBus.on(EVENTS.VAD_READY, () => this._handleVadStatus('Ready'));
    eventBus.on(EVENTS.VAD_ERROR, () => this._handleVadStatus('Error'));
    eventBus.on(EVENTS.SPEECH_START, () => this._handleVadStatus('Speech Detected'));
    eventBus.on(EVENTS.SPEECH_END, () => this._handleVadStatus('Listening'));
    
    // Window listeners for pipeline active/inactive transitions
    window.addEventListener('pipeline:start', () => {
      // Transition from Ready to Listening when mic starts streaming
      const currentText = this.elements.vadBadge.textContent;
      if (currentText !== 'Error') {
        this._handleVadStatus('Listening');
      }
    });
    window.addEventListener('pipeline:stop', () => {
      const currentText = this.elements.vadBadge.textContent;
      if (currentText !== 'Error') {
        this._handleVadStatus('Idle');
      }
    });
    
    eventBus.on(EVENTS.WAKEWORD_INITIALIZED, () => this._handleWakewordStatus('Active'));
    eventBus.on(EVENTS.WAKEWORD_DETECTED, this._handleWakewordDetected);
    
    // Metrics subscription
    eventBus.on(EVENTS.METRICS_UPDATE, this._handleMetrics);
    
    eventBus.on('pipeline:timing', (timings) => {
      if (this.elements.timingMic) {
        this.elements.timingMic.textContent = `${timings.mic.toFixed(2)} ms`;
        this.elements.timingDsp.textContent = `${timings.dsp.toFixed(2)} ms`;
        this.elements.timingVad.textContent = `${timings.vad.toFixed(2)} ms`;
        this.elements.timingWw.textContent = `${timings.ww.toFixed(2)} ms`;
        this.elements.timingTotal.textContent = `${timings.total.toFixed(2)} ms`;
      }
    });

    eventBus.on(EVENTS.WAKEWORD_PROGRESS, (progress) => {
      if (this.elements.wwProgressBarContainer) {
        this.elements.wwProgressBarContainer.style.display = 'block';
        this.elements.wwProgressPct.textContent = `${progress}%`;
        this.elements.wwProgressFill.style.width = `${progress}%`;
        this.elements.wwStatusBadge.textContent = `Downloading (${progress}%)`;
        this.elements.wwStatusBadge.className = 'badge warning';
        
        if (progress >= 100) {
          setTimeout(() => {
            if (this.elements.wwProgressBarContainer) {
              this.elements.wwProgressBarContainer.style.display = 'none';
            }
          }, 1000);
        }
      }
    });

    eventBus.on(EVENTS.WAKEWORD_READY, () => {
      this._handleWakewordStatus('Ready');
      if (this.elements.wwStatusBadge) {
        this.elements.wwStatusBadge.textContent = 'Ready (model loaded)';
        this.elements.wwStatusBadge.className = 'badge success';
      }
      if (this.elements.wwLoadedModel) {
        this.elements.wwLoadedModel.textContent = 'Hey Mycroft';
      }
    });

    eventBus.on(EVENTS.WAKEWORD_ERROR, () => {
      this._handleWakewordStatus('Error');
      if (this.elements.wwStatusBadge) {
        this.elements.wwStatusBadge.textContent = 'Error';
        this.elements.wwStatusBadge.className = 'badge danger';
      }
      if (this.elements.wwProgressBarContainer) {
        this.elements.wwProgressBarContainer.style.display = 'none';
      }
    });
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
    } else if (state === 'Speech Detected') {
      badge.classList.add('alert-glow');
    } else if (state === 'Active' || state === 'Ready') {
      badge.classList.add('success');
    } else if (state === 'Error') {
      badge.classList.add('danger');
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
    if (state === 'Ready' || state === 'Active') {
      badge.className = 'badge success';
    } else if (state === 'Error') {
      badge.className = 'badge danger';
    } else {
      badge.className = 'badge inactive';
    }
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
