/**
 * Dataset Manager
 * ---------------
 * Manages dataset recording categories, speaker IDs, auto-incrementing take numbers,
 * canonical target paths for repository export, and session take history.
 */

export const RECORDING_CATEGORIES = {
  POSITIVE: 'positive',
  SIMILAR_PHRASES: 'similar_phrases',
  NORMAL_SPEECH: 'normal_speech',
  BACKGROUND_NOISE: 'background_noise'
};

export const CATEGORY_INFO = {
  [RECORDING_CATEGORIES.POSITIVE]: {
    id: RECORDING_CATEGORIES.POSITIVE,
    label: 'Hey Louie (Positive)',
    targetFolder: (speakerId) => `dataset/positive/${speakerId}/`,
    filePrefix: 'hey_louie_',
    prompt: 'Say: Hey Louie',
    guidance: 'One clean utterance of "Hey Louie". Vary speeds, volumes, and distances across takes.',
    isSpeakerSpecific: true
  },
  [RECORDING_CATEGORIES.SIMILAR_PHRASES]: {
    id: RECORDING_CATEGORIES.SIMILAR_PHRASES,
    label: 'Similar Phrase (Negative)',
    targetFolder: () => 'dataset/negative/similar_phrases/',
    filePrefix: 'similar_',
    prompt: 'Say a near-miss distractor phrase',
    suggestions: [
      'Hey Louis', 'Hey Louise', 'Hey Lucy', 'Hey Bluey',
      'Hello Louie', 'Louie Louie', 'Hey Rudy', 'Hey Dewey',
      'Hey Zooey', 'Hey Lily', 'Hey Larry', 'Hey Chloe'
    ],
    guidance: 'Pronounce near-miss phonetic phrases clearly to prevent false triggers.',
    isSpeakerSpecific: false
  },
  [RECORDING_CATEGORIES.NORMAL_SPEECH]: {
    id: RECORDING_CATEGORIES.NORMAL_SPEECH,
    label: 'Normal Speech (Negative)',
    targetFolder: () => 'dataset/negative/normal_speech/',
    filePrefix: 'normal_',
    prompt: 'Say normal conversational speech or assistant commands',
    suggestions: [
      'What is the time right now?',
      'Turn off the living room lights',
      'Set a reminder for tomorrow morning',
      'How is the weather forecast today?',
      'Can you play the next song in the playlist?',
      'Open the document and review the text'
    ],
    guidance: 'Everyday conversational dialogue or assistant commands without the wake word.',
    isSpeakerSpecific: false
  },
  [RECORDING_CATEGORIES.BACKGROUND_NOISE]: {
    id: RECORDING_CATEGORIES.BACKGROUND_NOISE,
    label: 'Background Noise (Negative)',
    targetFolder: () => 'dataset/negative/background_noise/',
    filePrefix: 'noise_',
    prompt: 'Capture ambient sound (no human speech)',
    suggestions: [
      'Room tone and quiet room silence',
      'Computer fan whir / AC hum',
      'Keyboard typing and mouse clicks',
      'Paper rustling and chair creaks',
      'Distant traffic or street noise'
    ],
    guidance: 'Pure ambient sound without speech. Maintain quiet natural environmental noise.',
    isSpeakerSpecific: false
  }
};

const STORAGE_KEY_SPEAKER = 'hey_louie_recorder_speaker';
const STORAGE_KEY_INDEXES = 'hey_louie_recorder_indexes';

export class DatasetManager {
  constructor() {
    this.speakerId = this._loadSpeakerId();
    this.currentCategory = RECORDING_CATEGORIES.POSITIVE;
    this.takeIndexes = this._loadTakeIndexes();
    this.sessionTakes = [];
  }

  _loadSpeakerId() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SPEAKER);
      return saved ? this.sanitizeSpeakerId(saved) : 'speaker_01';
    } catch {
      return 'speaker_01';
    }
  }

  _loadTakeIndexes() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INDEXES);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }

  _saveTakeIndexes() {
    try {
      localStorage.setItem(STORAGE_KEY_INDEXES, JSON.stringify(this.takeIndexes));
    } catch {
      // Ignore storage errors in private browsing
    }
  }

  /**
   * Clean and normalize a speaker identifier.
   * @param {string} raw 
   * @returns {string} e.g. "speaker_01"
   */
  sanitizeSpeakerId(raw) {
    if (!raw) return 'speaker_01';
    const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
    return cleaned || 'speaker_01';
  }

  /**
   * Set active speaker ID.
   * @param {string} id 
   */
  setSpeakerId(id) {
    this.speakerId = this.sanitizeSpeakerId(id);
    try {
      localStorage.setItem(STORAGE_KEY_SPEAKER, this.speakerId);
    } catch {
      // Ignore
    }
  }

  /**
   * Set active recording category.
   * @param {string} category 
   */
  setCategory(category) {
    if (CATEGORY_INFO[category]) {
      this.currentCategory = category;
    }
  }

  /**
   * Get the storage key for current category and speaker.
   */
  _getIndexKey() {
    if (this.currentCategory === RECORDING_CATEGORIES.POSITIVE) {
      return `positive_${this.speakerId}`;
    }
    return this.currentCategory;
  }

  /**
   * Get the next take number (1-based index).
   * @returns {number}
   */
  getNextTakeNumber() {
    const key = this._getIndexKey();
    const current = this.takeIndexes[key] || 0;
    return current + 1;
  }

  /**
   * Increment take number when a recording is successfully saved.
   */
  incrementTakeNumber() {
    const key = this._getIndexKey();
    const current = this.takeIndexes[key] || 0;
    this.takeIndexes[key] = current + 1;
    this._saveTakeIndexes();
    return this.takeIndexes[key];
  }

  /**
   * Generate canonical filename for current configuration.
   * @param {number} [takeNumber]
   * @returns {string} e.g. "hey_louie_001.wav"
   */
  generateFilename(takeNumber) {
    const num = takeNumber || this.getNextTakeNumber();
    const pad = String(num).padStart(3, '0');
    const info = CATEGORY_INFO[this.currentCategory];
    return `${info.filePrefix}${pad}.wav`;
  }

  /**
   * Generate repository destination folder path.
   * @returns {string} e.g. "dataset/positive/speaker_01/"
   */
  getTargetFolder() {
    const info = CATEGORY_INFO[this.currentCategory];
    return info.targetFolder(this.speakerId);
  }

  /**
   * Generate complete repository relative destination path.
   * @param {number} [takeNumber]
   * @returns {string} e.g. "dataset/positive/speaker_01/hey_louie_001.wav"
   */
  getFullTargetPath(takeNumber) {
    return `${this.getTargetFolder()}${this.generateFilename(takeNumber)}`;
  }

  /**
   * Add a saved recording to current session history.
   * @param {Object} take 
   */
  addSessionTake(take) {
    this.sessionTakes.unshift({
      id: `take_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      category: this.currentCategory,
      speakerId: this.speakerId,
      filename: take.filename,
      targetFolder: take.targetFolder,
      fullPath: take.fullPath,
      duration: take.duration,
      rmsDb: take.rmsDb,
      peakDb: take.peakDb,
      blob: take.blob,
      url: take.url
    });
  }

  /**
   * Remove a take from session history and revoke object URL.
   * @param {string} id 
   */
  removeSessionTake(id) {
    const index = this.sessionTakes.findIndex(t => t.id === id);
    if (index !== -1) {
      const take = this.sessionTakes[index];
      if (take.url) {
        URL.revokeObjectURL(take.url);
      }
      this.sessionTakes.splice(index, 1);
    }
  }

  /**
   * Get count of session takes for a specific category.
   * @param {string} category 
   * @returns {number}
   */
  getSessionCount(category) {
    return this.sessionTakes.filter(t => t.category === category).length;
  }
}
