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
                <span class="status-label">Mel Spectrogram</span>
                <div class="status-indicator-wrapper">
                  <span id="status-melspec-badge" class="badge inactive">Inactive</span>
                </div>
              </div>
              <div class="status-item">
                <span class="status-label">Speech Embedding</span>
                <div class="status-indicator-wrapper">
                  <span id="status-embedding-badge" class="badge inactive">Inactive</span>
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
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Dropped Frames</span>
                  <span class="text-mono text-sm" id="ww-metric-dropped" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0</span>
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
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Confidence</span>
                  <span class="text-mono text-sm" id="ww-metric-confidence" style="font-size: 0.85rem; font-family: var(--font-mono); color: #818cf8; font-weight: bold;">0.0000</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Threshold</span>
                  <span class="text-mono text-sm" id="ww-metric-threshold" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0.50</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Inferences</span>
                  <span class="text-mono text-sm" id="ww-metric-inferences" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0</span>
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

          <!-- Mel Spectrogram Card -->
          <section class="card melspec-card">
            <h2>Mel Spectrogram</h2>
            <div class="status-grid">
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Status</span>
                  <div class="status-indicator-wrapper">
                    <span id="melspec-status-badge" class="badge inactive">Uninitialized</span>
                  </div>
                </div>
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Model</span>
                  <span class="text-mono text-sm" id="melspec-loaded-model" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Sample Rate</span>
                  <span class="text-mono text-sm" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">16000 Hz</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Buffer Size</span>
                  <span class="text-mono text-sm" id="melspec-buffer-size" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0 samples</span>
                </div>
                
                <div id="melspec-progress-bar-container" style="display: none; width: 100%; margin-top: 8px;">
                  <div class="progress-bar-lbl" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 4px;">
                    <span>Downloading Model...</span>
                    <span id="melspec-progress-pct">0%</span>
                  </div>
                  <div class="progress-bar-bg" style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div id="melspec-progress-fill" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div>
                  </div>
                </div>
              </div>
              
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Frames Generated</span>
                  <span class="text-mono" id="melspec-metric-frames" style="font-weight: 600; color: var(--primary);">0</span>
                </div>
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Average Latency</span>
                  <span class="text-mono text-sm" id="melspec-metric-avg-latency" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">-- ms</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Max Latency</span>
                  <span class="text-mono text-sm" id="melspec-metric-max-latency" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">-- ms</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Dropped Frames</span>
                  <span class="text-mono text-sm" id="melspec-metric-dropped" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Last Feature Time</span>
                  <span class="text-mono text-sm" id="melspec-metric-last-time" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Speech Embedding Card -->
          <section class="card embedding-card" style="border-color: rgba(99, 102, 241, 0.2) !important; box-shadow: 0 10px 30px -10px rgba(99, 102, 241, 0.1);">
            <h2 style="color: #a5b4fc;">Speech Embedding</h2>
            <div class="status-grid">
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Status</span>
                  <div class="status-indicator-wrapper">
                    <span id="embedding-status-badge" class="badge inactive">Uninitialized</span>
                  </div>
                </div>
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Model</span>
                  <span class="text-mono text-sm" id="embedding-loaded-model" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Input</span>
                  <span class="text-mono text-sm" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">Mel Spectrogram</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Output</span>
                  <span class="text-mono text-sm" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">Speech Embedding</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Feature Buffer</span>
                  <span class="text-mono text-sm" id="embedding-buffer-size" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0 / --</span>
                </div>
                
                <div id="embedding-progress-bar-container" style="display: none; width: 100%; margin-top: 8px;">
                  <div class="progress-bar-lbl" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 4px;">
                    <span>Downloading Model...</span>
                    <span id="embedding-progress-pct">0%</span>
                  </div>
                  <div class="progress-bar-bg" style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div id="embedding-progress-fill" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div>
                  </div>
                </div>
              </div>
              
              <div class="status-item flex-col-layout">
                <div class="status-row">
                  <span class="status-label">Inference Count</span>
                  <span class="text-mono" id="embedding-metric-inferences" style="font-weight: 600; color: var(--primary);">0</span>
                </div>
                <div class="status-row" style="margin-top: 8px;">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Average Latency</span>
                  <span class="text-mono text-sm" id="embedding-metric-avg-latency" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">-- ms</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Max Latency</span>
                  <span class="text-mono text-sm" id="embedding-metric-max-latency" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">-- ms</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Dropped Frames</span>
                  <span class="text-mono text-sm" id="embedding-metric-dropped" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">0</span>
                </div>
                <div class="status-row">
                  <span class="status-label text-sm" style="font-size: 0.8rem; color: var(--color-text-muted);">Last Embedding</span>
                  <span class="text-mono text-sm" id="embedding-metric-last-time" style="font-size: 0.85rem; font-family: var(--font-mono); color: var(--color-text-main);">--</span>
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
                  <span class="timing-lbl">Mel Spectrogram</span>
                  <span class="timing-val" id="timing-melspec">-- ms</span>
                </div>
                <div class="timing-item">
                  <span class="timing-lbl">Speech Embedding</span>
                  <span class="timing-val" id="timing-embedding">-- ms</span>
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
      melspecBadge: document.getElementById('status-melspec-badge'),
      wwBadge: document.getElementById('status-ww-badge'),
      metricLatency: document.getElementById('metric-latency'),
      metricFps: document.getElementById('metric-fps'),
      metricCpu: document.getElementById('metric-cpu'),
      logsList: document.getElementById('console-logs-list'),
      canvas: document.getElementById('audio-visualizer'),
      timingMic: document.getElementById('timing-mic'),
      timingDsp: document.getElementById('timing-dsp'),
      timingVad: document.getElementById('timing-vad'),
      timingMelspec: document.getElementById('timing-melspec'),
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
      wwCooldownBadge: document.getElementById('ww-cooldown-badge'),
      wwMetricDropped: document.getElementById('ww-metric-dropped'),
      wwMetricConfidence: document.getElementById('ww-metric-confidence'),
      wwMetricThreshold: document.getElementById('ww-metric-threshold'),
      wwMetricInferences: document.getElementById('ww-metric-inferences'),
      
      // Mel Spectrogram DOM element caches
      melspecStatusBadge: document.getElementById('melspec-status-badge'),
      melspecLoadedModel: document.getElementById('melspec-loaded-model'),
      melspecBufferSize: document.getElementById('melspec-buffer-size'),
      melspecProgressBarContainer: document.getElementById('melspec-progress-bar-container'),
      melspecProgressPct: document.getElementById('melspec-progress-pct'),
      melspecProgressFill: document.getElementById('melspec-progress-fill'),
      melspecMetricFrames: document.getElementById('melspec-metric-frames'),
      melspecMetricAvgLatency: document.getElementById('melspec-metric-avg-latency'),
      melspecMetricMaxLatency: document.getElementById('melspec-metric-max-latency'),
      melspecMetricDropped: document.getElementById('melspec-metric-dropped'),
      melspecMetricLastTime: document.getElementById('melspec-metric-last-time'),

      // Speech Embedding badge
      embeddingBadge: document.getElementById('status-embedding-badge'),
      timingEmbedding: document.getElementById('timing-embedding'),

      // Speech Embedding DOM element caches
      embeddingStatusBadge: document.getElementById('embedding-status-badge'),
      embeddingLoadedModel: document.getElementById('embedding-loaded-model'),
      embeddingBufferSize: document.getElementById('embedding-buffer-size'),
      embeddingProgressBarContainer: document.getElementById('embedding-progress-bar-container'),
      embeddingProgressPct: document.getElementById('embedding-progress-pct'),
      embeddingProgressFill: document.getElementById('embedding-progress-fill'),
      embeddingMetricInferences: document.getElementById('embedding-metric-inferences'),
      embeddingMetricAvgLatency: document.getElementById('embedding-metric-avg-latency'),
      embeddingMetricMaxLatency: document.getElementById('embedding-metric-max-latency'),
      embeddingMetricDropped: document.getElementById('embedding-metric-dropped'),
      embeddingMetricLastTime: document.getElementById('embedding-metric-last-time')
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
        if (this.elements.timingMelspec) {
          this.elements.timingMelspec.textContent = `${timings.melspec.toFixed(2)} ms`;
        }
        if (this.elements.timingEmbedding) {
          this.elements.timingEmbedding.textContent = `${timings.embedding.toFixed(2)} ms`;
        }
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
      this._handleWakewordStatus('Waiting...');
      if (this.elements.wwStatusBadge) {
        this.elements.wwStatusBadge.textContent = 'Waiting for Embedding Model';
        this.elements.wwStatusBadge.className = 'badge warning';
      }
      if (this.elements.wwLoadedModel) {
        this.elements.wwLoadedModel.textContent = 'hey_louie.onnx';
      }
      if (this.elements.wwModeBadge) {
        this.elements.wwModeBadge.textContent = 'Production/Custom';
      }
      if (this.elements.wwInferenceReason) {
        this.elements.wwInferenceReason.textContent = 'Speech Embedding Pending';
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

    // Mel Spectrogram subscriptions
    eventBus.on(EVENTS.MELSPEC_READY, () => {
      this._handleMelspecStatus('Ready');
      if (this.elements.melspecStatusBadge) {
        this.elements.melspecStatusBadge.textContent = 'Ready';
        this.elements.melspecStatusBadge.className = 'badge success';
      }
      if (this.elements.melspecLoadedModel) {
        this.elements.melspecLoadedModel.textContent = 'melspectrogram.onnx';
      }
    });

    eventBus.on(EVENTS.MELSPEC_ERROR, () => {
      this._handleMelspecStatus('Error');
      if (this.elements.melspecStatusBadge) {
        this.elements.melspecStatusBadge.textContent = 'Error';
        this.elements.melspecStatusBadge.className = 'badge danger';
      }
      if (this.elements.melspecProgressBarContainer) {
        this.elements.melspecProgressBarContainer.style.display = 'none';
      }
    });

    eventBus.on(EVENTS.MELSPEC_PROGRESS, (progress) => {
      if (this.elements.melspecProgressBarContainer) {
        this.elements.melspecProgressBarContainer.style.display = 'block';
        this.elements.melspecProgressPct.textContent = `${progress}%`;
        this.elements.melspecProgressFill.style.width = `${progress}%`;
        
        if (this.elements.melspecStatusBadge) {
          this.elements.melspecStatusBadge.textContent = `Downloading (${progress}%)`;
          this.elements.melspecStatusBadge.className = 'badge warning';
        }
        
        if (progress >= 100) {
          setTimeout(() => {
            if (this.elements.melspecProgressBarContainer) {
              this.elements.melspecProgressBarContainer.style.display = 'none';
            }
          }, 1000);
        }
      }
    });

    eventBus.on(EVENTS.MELSPEC_METRICS, (metrics) => {
      if (metrics.status) {
        this._handleMelspecStatus(metrics.status);
      }
      if (this.elements.melspecBufferSize) {
        this.elements.melspecBufferSize.textContent = `${metrics.bufferSize} samples`;
      }
      if (this.elements.melspecMetricFrames) {
        this.elements.melspecMetricFrames.textContent = metrics.framesProduced;
      }
      if (this.elements.melspecMetricAvgLatency) {
        this.elements.melspecMetricAvgLatency.textContent = metrics.avgLatency ? `${metrics.avgLatency.toFixed(2)} ms` : '-- ms';
      }
      if (this.elements.melspecMetricMaxLatency) {
        this.elements.melspecMetricMaxLatency.textContent = metrics.maxLatency ? `${metrics.maxLatency.toFixed(2)} ms` : '-- ms';
      }
      if (this.elements.melspecMetricDropped) {
        this.elements.melspecMetricDropped.textContent = metrics.droppedFrames || 0;
      }
      if (this.elements.melspecMetricLastTime) {
        this.elements.melspecMetricLastTime.textContent = metrics.lastFeatureTime || '--';
      }
    });

    // Speech Embedding subscriptions
    eventBus.on(EVENTS.EMBEDDING_READY, () => {
      this._handleEmbeddingStatus('Ready');
      if (this.elements.embeddingStatusBadge) {
        this.elements.embeddingStatusBadge.textContent = 'Ready';
        this.elements.embeddingStatusBadge.className = 'badge success';
      }
      if (this.elements.embeddingLoadedModel) {
        this.elements.embeddingLoadedModel.textContent = 'embedding_model.onnx';
      }
    });

    eventBus.on(EVENTS.EMBEDDING_ERROR, () => {
      this._handleEmbeddingStatus('Error');
      if (this.elements.embeddingStatusBadge) {
        this.elements.embeddingStatusBadge.textContent = 'Error';
        this.elements.embeddingStatusBadge.className = 'badge danger';
      }
      if (this.elements.embeddingProgressBarContainer) {
        this.elements.embeddingProgressBarContainer.style.display = 'none';
      }
    });

    eventBus.on(EVENTS.EMBEDDING_PROGRESS, (progress) => {
      if (this.elements.embeddingProgressBarContainer) {
        this.elements.embeddingProgressBarContainer.style.display = 'block';
        this.elements.embeddingProgressPct.textContent = `${progress}%`;
        this.elements.embeddingProgressFill.style.width = `${progress}%`;
        
        if (this.elements.embeddingStatusBadge) {
          this.elements.embeddingStatusBadge.textContent = `Downloading (${progress}%)`;
          this.elements.embeddingStatusBadge.className = 'badge warning';
        }
        
        if (progress >= 100) {
          setTimeout(() => {
            if (this.elements.embeddingProgressBarContainer) {
              this.elements.embeddingProgressBarContainer.style.display = 'none';
            }
          }, 1000);
        }
      }
    });

    eventBus.on(EVENTS.EMBEDDING_METRICS, (metrics) => {
      if (metrics.status) {
        this._handleEmbeddingStatus(metrics.status);
      }
      if (this.elements.embeddingBufferSize) {
        this.elements.embeddingBufferSize.textContent = `${metrics.bufferSize} / ${metrics.requiredFrames || 76}`;
      }
      if (this.elements.embeddingMetricInferences) {
        this.elements.embeddingMetricInferences.textContent = metrics.inferenceCount;
      }
      if (this.elements.embeddingMetricAvgLatency) {
        this.elements.embeddingMetricAvgLatency.textContent = metrics.avgLatency ? `${metrics.avgLatency.toFixed(2)} ms` : '-- ms';
      }
      if (this.elements.embeddingMetricMaxLatency) {
        this.elements.embeddingMetricMaxLatency.textContent = metrics.maxLatency ? `${metrics.maxLatency.toFixed(2)} ms` : '-- ms';
      }
      if (this.elements.embeddingMetricDropped) {
        this.elements.embeddingMetricDropped.textContent = metrics.droppedFrames || 0;
      }
      if (this.elements.embeddingMetricLastTime) {
        this.elements.embeddingMetricLastTime.textContent = metrics.lastEmbeddingTime || '--';
      }
    });

    // Wake Word Metrics UI listener
    eventBus.on(EVENTS.WAKEWORD_METRICS, (metrics) => {
      if (metrics.status && this.elements.wwStatusBadge) {
        this.elements.wwStatusBadge.textContent = metrics.status;
        this.elements.wwStatusBadge.className = 'badge';
        if (metrics.status === 'Ready' || metrics.status === 'Active') {
          this.elements.wwStatusBadge.classList.add('success');
        } else if (metrics.status === 'Error') {
          this.elements.wwStatusBadge.classList.add('danger');
        } else {
          this.elements.wwStatusBadge.classList.add('inactive');
        }
      }
      if (metrics.inferenceStatus && this.elements.wwInferenceStatus) {
        this.elements.wwInferenceStatus.textContent = metrics.inferenceStatus;
        this.elements.wwInferenceStatus.className = 'badge';
        if (metrics.inferenceStatus === 'Active') {
          this.elements.wwInferenceStatus.classList.add('success');
        } else if (metrics.inferenceStatus === 'Cooldown') {
          this.elements.wwInferenceStatus.classList.add('warning');
        } else if (metrics.inferenceStatus === 'Buffering') {
          this.elements.wwInferenceStatus.classList.add('warning');
        } else {
          this.elements.wwInferenceStatus.classList.add('inactive');
        }
      }
      if (metrics.reason && this.elements.wwInferenceReason) {
        this.elements.wwInferenceReason.textContent = metrics.reason;
      }
      if (this.elements.wwLoadedModel) {
        this.elements.wwLoadedModel.textContent = 'hey_louie.onnx';
      }
      if (this.elements.wwModeBadge) {
        this.elements.wwModeBadge.textContent = 'Production/Custom';
      }
      if (metrics.lastConfidence !== undefined && this.elements.wwMetricConfidence) {
        this.elements.wwMetricConfidence.textContent = metrics.lastConfidence.toFixed(4);
      }
      if (this.elements.wwMetricThreshold) {
        this.elements.wwMetricThreshold.textContent = '0.50';
      }
      if (metrics.inferenceCount !== undefined && this.elements.wwMetricInferences) {
        this.elements.wwMetricInferences.textContent = metrics.inferenceCount;
      }
      if (metrics.droppedFrames !== undefined && this.elements.wwMetricDropped) {
        this.elements.wwMetricDropped.textContent = metrics.droppedFrames;
      }
      if (this.elements.wwMetricLastDetect) {
        this.elements.wwMetricLastDetect.textContent = metrics.lastDetectionTime || '--';
      }
      if (metrics.detectionCount !== undefined && this.elements.wwMetricDetections) {
        this.elements.wwMetricDetections.textContent = metrics.detectionCount;
      }
      if (this.elements.wwCooldownBadge) {
        const active = !!metrics.cooldownActive;
        this.elements.wwCooldownBadge.textContent = active ? 'Active' : 'Inactive';
        this.elements.wwCooldownBadge.className = active ? 'badge warning alert-glow' : 'badge inactive';
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
   * Update Mel Spectrogram badge.
   */
  _handleMelspecStatus(state) {
    const badge = this.elements.melspecBadge;
    if (!badge) return;
    badge.textContent = state;
    if (state === 'Ready') {
      badge.className = 'badge success';
    } else if (state === 'Processing') {
      badge.className = 'badge primary-glow';
    } else if (state === 'Loading') {
      badge.className = 'badge warning';
    } else if (state === 'Error') {
      badge.className = 'badge danger';
    } else {
      badge.className = 'badge inactive';
    }
  }

  /**
   * Update Speech Embedding badge.
   */
  _handleEmbeddingStatus(state) {
    const badge = this.elements.embeddingBadge;
    if (!badge) return;
    badge.textContent = state;
    if (state === 'Ready') {
      badge.className = 'badge success';
    } else if (state === 'Processing') {
      badge.className = 'badge primary-glow';
    } else if (state === 'Loading') {
      badge.className = 'badge warning';
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
