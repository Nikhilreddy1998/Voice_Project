import { eventBus } from '../events/event-bus.js';
import { EVENTS } from '../utils/constants.js';
import { microphoneManager } from '../audio/microphone.js';
import { DatasetAudioRecorder } from '../dataset/recorder.js';
import { DatasetManager, RECORDING_CATEGORIES, CATEGORY_INFO } from '../dataset/dataset-manager.js';

/**
 * DatasetRecorderComponent
 * ------------------------
 * Interactive UI component for collecting real human audio recordings
 * for the Hey Louie dataset.
 */
export class DatasetRecorderComponent {
  constructor(container) {
    this.container = container;
    this.recorder = new DatasetAudioRecorder();
    this.datasetManager = new DatasetManager();
    this.currentTakeResult = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.recorder.setOnProgress(({ elapsedSec, vuLevel }) => {
      this._updateLiveTelemetry(elapsedSec, vuLevel);
    });

    eventBus.on(EVENTS.DATASET_RECORDING_READY, (data) => {
      this.currentTakeResult = data;
      this._renderReviewState(data);
    });

    eventBus.on(EVENTS.DATASET_RECORDING_DISCARDED, () => {
      this.currentTakeResult = null;
      this._renderIdleState();
    });

    eventBus.on(EVENTS.DATASET_RECORDING_ERROR, (err) => {
      this._showError(err.message || 'An error occurred during recording.');
    });

    eventBus.on(EVENTS.MIC_INITIALIZED, (data = {}) => {
      const rate = data.sampleRate || microphoneManager.sampleRate;
      this._updateMicRateBadge(rate);
    });
  }

  _updateMicRateBadge(sampleRate) {
    const badge = this.container.querySelector('#dataset-mic-rate-badge');
    if (!badge) return;
    if (sampleRate === 16000) {
      badge.innerHTML = '<span class="icon">🎙️</span> 16.0 kHz Verified Context &bull; 16-bit PCM';
      badge.classList.remove('badge-warn');
      badge.title = 'AudioContext is running at verified 16000 Hz.';
    } else if (sampleRate) {
      badge.innerHTML = `<span class="icon">🎙️</span> Mic: ${sampleRate} Hz &rarr; Resampled to 16 kHz WAV`;
      badge.classList.add('badge-warn');
      badge.title = `AudioContext runs at ${sampleRate} Hz. Captures are resampled to standard 16000 Hz.`;
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="dataset-recorder-wrapper">
        <!-- Top Banner & Guidelines -->
        <section class="card recorder-header-card">
          <div class="card-header-row">
            <div>
              <h2>Human Audio Data Collection</h2>
              <p class="section-desc">Record diverse real human audio samples for training and evaluating the Hey Louie wake-word engine.</p>
            </div>
            <div class="dataset-badge-tag" id="dataset-mic-rate-badge">
              <span class="icon">🎙️</span> ${microphoneManager.isInitialized ? (microphoneManager.sampleRate === 16000 ? '16.0 kHz Verified Context &bull; 16-bit PCM' : `Mic: ${microphoneManager.sampleRate} Hz &rarr; 16 kHz WAV`) : '16 kHz Mono 16-bit PCM'}
            </div>
          </div>

          <!-- Dataset Rules Alert -->
          <div class="guidelines-banner">
            <div class="rule-item">
              <span class="rule-icon">👤</span>
              <div class="rule-text">
                <strong>Real Humans Only:</strong> Positive samples must be genuine human voices. Synthetic TTS voices are strictly prohibited for production evaluation.
              </div>
            </div>
            <div class="rule-item">
              <span class="rule-icon">👥</span>
              <div class="rule-text">
                <strong>Strict Speaker Independence:</strong> At least 3 distinct human speakers are required to ensure unbiased Train/Val/Test evaluation splits.
              </div>
            </div>
            <div class="rule-item">
              <span class="rule-icon">🎯</span>
              <div class="rule-text">
                <strong>Acoustic Diversity:</strong> Vary speaking speed (fast/slow), volume (quiet/projected), distance (near/mid/far), and natural environments.
              </div>
            </div>
          </div>
        </section>

        <!-- Main Recording Workspace Grid -->
        <div class="recorder-workspace-grid">
          <!-- Left Column: Controls & Review -->
          <div class="recorder-main-column">
            <!-- Configuration Card -->
            <section class="card config-card">
              <div class="config-row">
                <div class="config-group speaker-group">
                  <label for="input-speaker-id">Speaker ID</label>
                  <div class="speaker-input-wrapper">
                    <input type="text" id="input-speaker-id" value="${this.datasetManager.speakerId}" placeholder="e.g. speaker_01" spellcheck="false" />
                    <div class="speaker-quick-pills">
                      <button type="button" class="quick-pill ${this.datasetManager.speakerId === 'speaker_01' ? 'active' : ''}" data-speaker="speaker_01">01</button>
                      <button type="button" class="quick-pill ${this.datasetManager.speakerId === 'speaker_02' ? 'active' : ''}" data-speaker="speaker_02">02</button>
                      <button type="button" class="quick-pill ${this.datasetManager.speakerId === 'speaker_03' ? 'active' : ''}" data-speaker="speaker_03">03</button>
                      <button type="button" class="quick-pill ${this.datasetManager.speakerId === 'speaker_04' ? 'active' : ''}" data-speaker="speaker_04">04</button>
                    </div>
                  </div>
                </div>

                <div class="config-group category-group">
                  <label>Recording Category</label>
                  <div class="category-segmented-control">
                    <button type="button" class="cat-btn ${this.datasetManager.currentCategory === RECORDING_CATEGORIES.POSITIVE ? 'active' : ''}" data-cat="${RECORDING_CATEGORIES.POSITIVE}">
                      <span class="cat-badge pos">Positive</span>
                      <span class="cat-title">Hey Louie</span>
                    </button>
                    <button type="button" class="cat-btn ${this.datasetManager.currentCategory === RECORDING_CATEGORIES.SIMILAR_PHRASES ? 'active' : ''}" data-cat="${RECORDING_CATEGORIES.SIMILAR_PHRASES}">
                      <span class="cat-badge neg">Negative</span>
                      <span class="cat-title">Similar Phrase</span>
                    </button>
                    <button type="button" class="cat-btn ${this.datasetManager.currentCategory === RECORDING_CATEGORIES.NORMAL_SPEECH ? 'active' : ''}" data-cat="${RECORDING_CATEGORIES.NORMAL_SPEECH}">
                      <span class="cat-badge neg">Negative</span>
                      <span class="cat-title">Normal Speech</span>
                    </button>
                    <button type="button" class="cat-btn ${this.datasetManager.currentCategory === RECORDING_CATEGORIES.BACKGROUND_NOISE ? 'active' : ''}" data-cat="${RECORDING_CATEGORIES.BACKGROUND_NOISE}">
                      <span class="cat-badge neg">Negative</span>
                      <span class="cat-title">Background Noise</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <!-- Recording Prompt & Stage Card -->
            <section class="card recording-stage-card">
              <!-- Prompt Banner -->
              <div id="recording-prompt-container" class="prompt-container">
                <!-- Dynamically rendered -->
              </div>

              <!-- Live Recording Zone (when recording) -->
              <div id="recording-live-zone" class="recording-live-zone" style="display: none;">
                <div class="timer-display-wrapper">
                  <span id="live-timer-text" class="live-timer">0.0s</span>
                  <span id="live-status-badge" class="badge warning pulsing">Recording...</span>
                </div>

                <!-- Duration Target Gauge -->
                <div class="duration-gauge-wrapper">
                  <div class="duration-gauge-bar">
                    <div id="duration-gauge-progress" class="duration-gauge-fill" style="width: 0%;"></div>
                    <div class="gauge-marker min" title="2.0s Minimum Required">
                      <span>2.0s</span>
                    </div>
                    <div class="gauge-marker max" title="4.0s Maximum Target">
                      <span>4.0s</span>
                    </div>
                  </div>
                  <div class="gauge-legend">
                    <span>0.0s</span>
                    <span id="gauge-zone-label" class="gauge-status-text">Encourage 2.0s – 4.0s</span>
                    <span>4.0s Max</span>
                  </div>
                </div>

                <!-- Audio Level VU Meter -->
                <div class="vu-meter-container">
                  <span class="vu-label">Mic Input Level</span>
                  <div class="vu-meter-bar">
                    <div id="vu-meter-fill" class="vu-fill" style="width: 0%;"></div>
                  </div>
                </div>

                <div class="recording-action-bar">
                  <button id="btn-stop-recording" class="btn danger pulse-danger">
                    <span class="btn-icon">⏹</span> STOP RECORDING
                  </button>
                </div>
              </div>

              <!-- Idle Control Zone (when ready to record) -->
              <div id="recording-idle-zone" class="recording-idle-zone">
                <div class="target-path-banner">
                  <div class="path-label">Repository Target Location:</div>
                  <div class="path-box">
                    <span class="folder-part" id="target-folder-display">${this.datasetManager.getTargetFolder()}</span>
                    <strong class="file-part" id="target-filename-display">${this.datasetManager.generateFilename()}</strong>
                  </div>
                </div>

                <div class="recording-action-bar">
                  <button id="btn-start-recording" class="btn primary btn-large pulse-glow">
                    <span class="btn-icon">🎙️</span> START RECORDING
                  </button>
                </div>
                <div class="auto-stop-note text-xs text-muted">
                  Audio captures in 16 kHz Mono 16-bit PCM. Recording will automatically stop at 4.0 seconds if not stopped manually.
                </div>
              </div>

              <!-- Review Zone (after recording) -->
              <div id="recording-review-zone" class="recording-review-zone" style="display: none;">
                <!-- Populated dynamically -->
              </div>
            </section>
          </div>

          <!-- Right Column: Checklist & Session History -->
          <div class="recorder-side-column">
            <!-- Checklist Card -->
            <section class="card checklist-card">
              <div class="card-title-row">
                <h2>Recording Checklist</h2>
                <span class="badge info text-xs" id="checklist-category-badge">Positive Samples</span>
              </div>
              <p class="text-xs text-muted">Check off variations to maximize classifier robustness:</p>

              <div id="checklist-items-container" class="checklist-items">
                <!-- Populated dynamically -->
              </div>
            </section>

            <!-- Session History Card -->
            <section class="card session-history-card">
              <div class="card-title-row">
                <h2>Session History</h2>
                <span class="badge inactive text-xs" id="session-count-badge">0 Takes</span>
              </div>
              <div id="session-history-list" class="session-history-list">
                <div class="empty-history-note">No takes recorded in this browser session yet.</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    this._cacheElements();
    this._attachDomListeners();
    this._renderPromptBanner();
    this._renderChecklist();
  }

  _cacheElements() {
    this.el = {
      inputSpeakerId: this.container.querySelector('#input-speaker-id'),
      quickPills: this.container.querySelectorAll('.quick-pill'),
      catButtons: this.container.querySelectorAll('.cat-btn'),
      promptContainer: this.container.querySelector('#recording-prompt-container'),
      idleZone: this.container.querySelector('#recording-idle-zone'),
      liveZone: this.container.querySelector('#recording-live-zone'),
      reviewZone: this.container.querySelector('#recording-review-zone'),
      targetFolderDisplay: this.container.querySelector('#target-folder-display'),
      targetFilenameDisplay: this.container.querySelector('#target-filename-display'),
      btnStart: this.container.querySelector('#btn-start-recording'),
      btnStop: this.container.querySelector('#btn-stop-recording'),
      liveTimerText: this.container.querySelector('#live-timer-text'),
      liveStatusBadge: this.container.querySelector('#live-status-badge'),
      durationProgress: this.container.querySelector('#duration-gauge-progress'),
      gaugeZoneLabel: this.container.querySelector('#gauge-zone-label'),
      vuMeterFill: this.container.querySelector('#vu-meter-fill'),
      checklistBadge: this.container.querySelector('#checklist-category-badge'),
      checklistContainer: this.container.querySelector('#checklist-items-container'),
      sessionHistoryList: this.container.querySelector('#session-history-list'),
      sessionCountBadge: this.container.querySelector('#session-count-badge')
    };
  }

  _attachDomListeners() {
    // Speaker ID input
    this.el.inputSpeakerId.addEventListener('input', (e) => {
      this.datasetManager.setSpeakerId(e.target.value);
      this._updatePathDisplays();
      this._updateQuickPills();
    });

    // Speaker quick pills
    this.el.quickPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const spk = pill.dataset.speaker;
        this.datasetManager.setSpeakerId(spk);
        this.el.inputSpeakerId.value = spk;
        this._updatePathDisplays();
        this._updateQuickPills();
      });
    });

    // Category segmented control
    this.el.catButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        this.datasetManager.setCategory(cat);
        this.el.catButtons.forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
        this._updatePathDisplays();
        this._renderPromptBanner();
        this._renderChecklist();
      });
    });

    // Start recording button
    this.el.btnStart.addEventListener('click', async () => {
      try {
        this.el.btnStart.disabled = true;
        this.el.btnStart.textContent = 'Initializing mic...';
        await this.recorder.startRecording();
        this._renderRecordingState();
      } catch (err) {
        this.el.btnStart.disabled = false;
        this.el.btnStart.innerHTML = '<span class="btn-icon">🎙️</span> START RECORDING';
        this._showError(err.message);
      }
    });

    // Stop recording button
    this.el.btnStop.addEventListener('click', async () => {
      await this.recorder.stopRecording(false);
    });
  }

  _updateQuickPills() {
    this.el.quickPills.forEach(p => {
      p.classList.toggle('active', p.dataset.speaker === this.datasetManager.speakerId);
    });
  }

  _updatePathDisplays() {
    if (this.el.targetFolderDisplay) {
      this.el.targetFolderDisplay.textContent = this.datasetManager.getTargetFolder();
    }
    if (this.el.targetFilenameDisplay) {
      this.el.targetFilenameDisplay.textContent = this.datasetManager.generateFilename();
    }
  }

  _renderPromptBanner() {
    const info = CATEGORY_INFO[this.datasetManager.currentCategory];
    const isPositive = this.datasetManager.currentCategory === RECORDING_CATEGORIES.POSITIVE;

    if (isPositive) {
      this.el.promptContainer.innerHTML = `
        <div class="prompt-box positive-box">
          <div class="prompt-tag">TARGET WAKE PHRASE</div>
          <div class="prompt-text-large">Say: &ldquo;Hey Louie&rdquo;</div>
          <div class="prompt-hint">${info.guidance}</div>
        </div>
      `;
    } else {
      let suggestionsHtml = '';
      if (info.suggestions && info.suggestions.length > 0) {
        suggestionsHtml = `
          <div class="prompt-suggestions-wrapper">
            <span class="suggestions-label">Suggestions to choose from:</span>
            <div class="suggestion-tags">
              ${info.suggestions.map(s => `<span class="tag-pill">&ldquo;${s}&rdquo;</span>`).join('')}
            </div>
          </div>
        `;
      }

      this.el.promptContainer.innerHTML = `
        <div class="prompt-box negative-box">
          <div class="prompt-tag">${info.label.toUpperCase()}</div>
          <div class="prompt-text-medium">${info.prompt}</div>
          <div class="prompt-hint">${info.guidance}</div>
          ${suggestionsHtml}
        </div>
      `;
    }
  }

  _renderChecklist() {
    const isPositive = this.datasetManager.currentCategory === RECORDING_CATEGORIES.POSITIVE;
    this.el.checklistBadge.textContent = isPositive ? 'Positive "Hey Louie"' : 'Negative Samples';

    if (isPositive) {
      this.el.checklistContainer.innerHTML = `
        <label class="check-row">
          <input type="checkbox" checked />
          <span>Utterance: Exactly <strong>"Hey Louie"</strong></span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Speed: Normal conversational pace</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Speed: Fast / hurried pace</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Speed: Slow / deliberate pace</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Volume: Normal conversational volume</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Volume: Soft / whisper take</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Volume: Loud / projected call</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Distance: Near-field (~0.3m – 0.5m)</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Distance: Mid-field (~1.0m – 1.5m)</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Distance: Far-field (~2.5m – 3.5m)</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Environment: Varied background noise</span>
        </label>
      `;
    } else {
      this.el.checklistContainer.innerHTML = `
        <label class="check-row">
          <input type="checkbox" checked />
          <span>Target: No presence of "Hey Louie"</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Duration: 2.0 to 4.0 seconds duration</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Quality: Uncompressed 16kHz mono audio</span>
        </label>
        <label class="check-row">
          <input type="checkbox" />
          <span>Variety: Multiple unique sentences / sounds</span>
        </label>
      `;
    }
  }

  _renderRecordingState() {
    this.el.idleZone.style.display = 'none';
    this.el.reviewZone.style.display = 'none';
    this.el.liveZone.style.display = 'block';

    this.el.liveTimerText.textContent = '0.0s';
    this.el.durationProgress.style.width = '0%';
    this.el.durationProgress.className = 'duration-gauge-fill';
    this.el.gaugeZoneLabel.textContent = 'Recording started... (Aim for 2.0s – 4.0s)';
    this.el.gaugeZoneLabel.className = 'gauge-status-text';
  }

  _updateLiveTelemetry(elapsedSec, vuLevel) {
    if (this.el.liveTimerText) {
      this.el.liveTimerText.textContent = `${elapsedSec.toFixed(1)}s`;
    }

    if (this.el.vuMeterFill) {
      const pct = Math.round(vuLevel * 100);
      this.el.vuMeterFill.style.width = `${pct}%`;
    }

    // Update duration gauge (scale 0 to 4.0s = 0% to 100%)
    if (this.el.durationProgress) {
      const pct = Math.min(100, Math.round((elapsedSec / 4.0) * 100));
      this.el.durationProgress.style.width = `${pct}%`;

      if (elapsedSec < 2.0) {
        this.el.durationProgress.className = 'duration-gauge-fill short';
        this.el.gaugeZoneLabel.textContent = 'Too short (< 2.0s)';
        this.el.gaugeZoneLabel.className = 'gauge-status-text text-warning';
      } else if (elapsedSec <= 4.0) {
        this.el.durationProgress.className = 'duration-gauge-fill good';
        this.el.gaugeZoneLabel.textContent = '✓ Good duration (2.0s – 4.0s)';
        this.el.gaugeZoneLabel.className = 'gauge-status-text text-success';
      } else {
        this.el.durationProgress.className = 'duration-gauge-fill long';
        this.el.gaugeZoneLabel.textContent = 'Auto-stopping at 4.0s...';
        this.el.gaugeZoneLabel.className = 'gauge-status-text text-danger';
      }
    }
  }

  _renderReviewState(data) {
    this.el.liveZone.style.display = 'none';
    this.el.idleZone.style.display = 'none';
    this.el.reviewZone.style.display = 'block';

    const { wavResult, validation, objectUrl, autoStopped } = data;
    const { metrics, isValid, errors, warnings } = validation;

    const targetFolder = this.datasetManager.getTargetFolder();
    const filename = this.datasetManager.generateFilename();
    const fullPath = this.datasetManager.getFullTargetPath();

    const actualRate = data.actualSampleRate || metrics.actualSampleRate || metrics.sampleRate;
    const finalRate = wavResult.sampleRate || metrics.sampleRate;
    const wasResampled = Boolean(data.wasResampled || metrics.wasResampled);

    let statusBadgeClass = isValid ? 'badge success' : 'badge danger';
    let statusText = isValid ? 'VALID RECORDING' : 'VALIDATION ISSUES';

    // Build validation items HTML with explicit ACTUAL and FINAL sample rates
    const valItems = [
      {
        label: 'Final WAV Sample Rate',
        value: `${finalRate} Hz Mono 16-bit PCM`,
        pass: finalRate === 16000,
        note: wasResampled ? `Resampled from ${actualRate} Hz` : 'Standard 16.0 kHz'
      },
      {
        label: 'AudioContext Source Rate',
        value: `${actualRate} Hz`,
        pass: true,
        note: actualRate === 16000 
          ? 'Native 16.0 kHz AudioContext' 
          : `Native rate (automatically resampled to ${finalRate} Hz)`
      },
      {
        label: 'Recording Duration',
        value: `${metrics.duration.toFixed(2)}s ${autoStopped ? '(Auto-stopped at 4.0s)' : ''}`,
        pass: metrics.duration >= 2.0 && metrics.duration <= 4.05,
        note: metrics.duration < 2.0 ? 'Too short (< 2.0s)' : (metrics.duration > 4.05 ? 'Exceeds 4.0s' : 'Target: 2.0s – 4.0s')
      },
      {
        label: 'Signal Energy (RMS)',
        value: `${metrics.rmsDb.toFixed(1)} dBFS (RMS: ${metrics.rms.toFixed(4)})`,
        pass: metrics.rms >= 0.003,
        note: metrics.rms < 0.003 ? 'Audio silent/empty' : 'Adequate voice energy'
      },
      {
        label: 'Peak Amplitude',
        value: `${metrics.peakDb.toFixed(1)} dBFS (Peak: ${metrics.peak.toFixed(3)})`,
        pass: metrics.peak < 0.999,
        note: metrics.peak >= 0.999 ? 'Peak clipped at 0 dB' : 'No clipping'
      },
      {
        label: 'DC Offset Bias',
        value: `${(metrics.dcOffset * 100).toFixed(2)}%`,
        pass: metrics.dcOffset <= 0.08,
        note: metrics.dcOffset > 0.08 ? 'Noticeable DC offset' : 'Normal natural bias'
      }
    ];

    this.el.reviewZone.innerHTML = `
      <div class="review-card-inner">
        <div class="review-header">
          <div class="review-title-group">
            <h3>Take Review &amp; Quality Check</h3>
            <span class="${statusBadgeClass}">${statusText}</span>
          </div>
          <span class="text-sm text-mono duration-badge">${metrics.duration.toFixed(2)}s</span>
        </div>

        <!-- Audio Player Preview -->
        <div class="audio-player-wrapper">
          <audio controls src="${objectUrl}" preload="auto" class="native-audio-player"></audio>
        </div>

        <!-- File Placement Notice -->
        <div class="export-destination-banner">
          <div class="dest-icon">📁</div>
          <div class="dest-details">
            <div class="dest-label">Repository Destination:</div>
            <div class="dest-code">
              <span class="dest-folder">${targetFolder}</span><strong class="dest-file">${filename}</strong>
            </div>
            <div class="dest-hint">
              Browsers cannot write directly to local disk without user download. Click <strong>Download WAV</strong> below, then place this file into the repository at <code>${targetFolder}</code>.
            </div>
          </div>
        </div>

        <!-- Validation Results Breakdown -->
        <div class="validation-summary-box">
          <div class="val-grid">
            ${valItems.map(item => `
              <div class="val-row ${item.pass ? 'pass' : 'fail'}">
                <span class="val-check">${item.pass ? '✓' : '⚠️'}</span>
                <span class="val-name">${item.label}:</span>
                <span class="val-val text-mono">${item.value}</span>
                ${item.note ? `<span class="val-note">(${item.note})</span>` : ''}
              </div>
            `).join('')}
          </div>

          ${errors.length > 0 ? `
            <div class="val-error-alerts">
              ${errors.map(err => `<div class="val-msg error">❌ ${err}</div>`).join('')}
            </div>
          ` : ''}

          ${wasResampled ? `
            <div class="val-info-alerts" style="margin-top: 8px; padding: 6px 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; font-size: 0.8rem; color: #60a5fa;">
              ℹ️ <strong>Sample Rate Resampled:</strong> Captured at browser native ${actualRate} Hz and resampled to exact 16000 Hz before 16-bit PCM WAV encoding.
            </div>
          ` : `
            <div class="val-info-alerts" style="margin-top: 8px; padding: 6px 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; font-size: 0.8rem; color: #34d399;">
              ✓ <strong>AudioContext Verified:</strong> Captured natively at exact 16000 Hz sample rate.
            </div>
          `}

          ${warnings.length > 0 ? `
            <div class="val-warning-alerts">
              ${warnings.map(w => `<div class="val-msg warning">⚠️ ${w}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Actions -->
        <div class="review-action-row">
          <button id="btn-discard-take" class="btn secondary">
            <span class="btn-icon">🗑️</span> Discard Take
          </button>
          <a id="btn-download-wav" href="${objectUrl}" download="${filename}" class="btn success btn-download ${isValid ? '' : 'btn-warn'}">
            <span class="btn-icon">💾</span> Download WAV (${filename})
          </a>
        </div>
      </div>
    `;

    // Wire up review buttons
    const btnDiscard = this.el.reviewZone.querySelector('#btn-discard-take');
    const btnDownload = this.el.reviewZone.querySelector('#btn-download-wav');

    btnDiscard.addEventListener('click', () => {
      this.recorder.discardRecording();
    });

    btnDownload.addEventListener('click', () => {
      // Record in session history
      this.datasetManager.addSessionTake({
        filename,
        targetFolder,
        fullPath,
        duration: metrics.duration,
        rmsDb: metrics.rmsDb,
        peakDb: metrics.peakDb,
        blob: wavResult.blob,
        url: objectUrl
      });

      // Increment take index for next recording
      this.datasetManager.incrementTakeNumber();
      this.recorder.markSaved();

      // Update session history UI
      this._updateSessionHistory();

      // Reset to idle ready state for next take
      setTimeout(() => {
        this._renderIdleState();
      }, 300);
    });
  }

  _renderIdleState() {
    this.el.liveZone.style.display = 'none';
    this.el.reviewZone.style.display = 'none';
    this.el.idleZone.style.display = 'block';

    this.el.btnStart.disabled = false;
    this.el.btnStart.innerHTML = '<span class="btn-icon">🎙️</span> START RECORDING';
    this._updatePathDisplays();
  }

  _updateSessionHistory() {
    const takes = this.datasetManager.sessionTakes;
    this.el.sessionCountBadge.textContent = `${takes.length} ${takes.length === 1 ? 'Take' : 'Takes'}`;

    if (takes.length === 0) {
      this.el.sessionHistoryList.innerHTML = '<div class="empty-history-note">No takes recorded in this browser session yet.</div>';
      return;
    }

    this.el.sessionHistoryList.innerHTML = takes.map(take => `
      <div class="session-take-item">
        <div class="take-item-main">
          <div class="take-item-title">
            <span class="badge ${take.category === RECORDING_CATEGORIES.POSITIVE ? 'success' : 'inactive'} text-xs">
              ${take.category === RECORDING_CATEGORIES.POSITIVE ? 'Pos' : 'Neg'}
            </span>
            <strong class="text-mono take-fname">${take.filename}</strong>
          </div>
          <div class="take-item-meta text-xs text-muted">
            <span>${take.duration.toFixed(2)}s</span> &bull; 
            <span>${take.targetFolder}</span> &bull; 
            <span>${take.timestamp}</span>
          </div>
        </div>
        <div class="take-item-actions">
          <audio src="${take.url}" preload="none"></audio>
          <button type="button" class="btn-icon-sm btn-play-take" title="Play recording">▶</button>
          <a href="${take.url}" download="${take.filename}" class="btn-icon-sm" title="Re-download WAV">💾</a>
        </div>
      </div>
    `).join('');

    // Wire up mini play buttons
    const playButtons = this.el.sessionHistoryList.querySelectorAll('.btn-play-take');
    playButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.session-take-item');
        const audio = item.querySelector('audio');
        if (audio.paused) {
          audio.play();
          btn.textContent = '⏸';
          audio.onended = () => { btn.textContent = '▶'; };
        } else {
          audio.pause();
          btn.textContent = '▶';
        }
      });
    });
  }

  _showError(message) {
    const existing = this.container.querySelector('.recorder-error-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.className = 'recorder-error-alert';
    alert.innerHTML = `
      <span>⚠️ <strong>Error:</strong> ${message}</span>
      <button type="button" class="btn-close-alert">&times;</button>
    `;

    alert.querySelector('.btn-close-alert').addEventListener('click', () => alert.remove());
    this.container.querySelector('.recorder-stage-card').prepend(alert);
  }

  dispose() {
    this.recorder.dispose();
  }
}
