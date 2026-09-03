# Hey Louie Wake-Word Training Dataset

This directory contains the dataset infrastructure for training and evaluating the custom **"Hey Louie"** wake-word detection model.

To build a robust, production-grade classifier that generalizes to real acoustic environments and different voices, the system relies on real human recordings and diverse negative audio samples.

---

## Directory Structure

```text
dataset/
├── positive/
│   ├── speaker_01/       ← Primary speaker recordings (your recordings)
│   ├── speaker_02/       ← Additional speaker recordings (future contributor)
│   ├── speaker_03/       ← Additional speaker recordings (future contributor)
│   └── speaker_04/       ← Additional speaker recordings (future contributor)
├── negative/
│   ├── similar_phrases/  ← Near-miss phonetic distractors (e.g., "Hey Louis")
│   ├── normal_speech/    ← Conversational speech, non-wake sentences, dialogue
│   └── background_noise/ ← Environmental silence, ambient sounds, room hum
├── README.md             ← Dataset guide and recording specifications
└── SOURCES.md            ← Provenance and licensing registry for external audio
```

---

## Audio Format Specifications

All audio files in the dataset must adhere to the following specifications:

| Parameter | Specification | Notes |
| :--- | :--- | :--- |
| **Container & Format** | Standard WAV (`.wav`) | Uncompressed PCM |
| **Sampling Rate** | **16,000 Hz (16 kHz)** | Required by openWakeWord feature extractors |
| **Channels** | **Mono (1 channel)** | Mono is preferred; stereo will be downmixed to mono |
| **Bit Depth** | **16-bit PCM** (`signed 16-bit little-endian`) | Standard signed integer PCM |
| **Duration** | **2.0 to 4.0 seconds** | Captures pre-roll, full utterance, and short post-roll |

---

## Positive Recording Guidelines

Recordings in `dataset/positive/speaker_XX/` provide the target wake-word training data.

- **Target Phrase**: Exactly **"Hey Louie"** (one clean utterance per file).
- **Human Voice Only**: Real human recordings only. Synthetic TTS voices may be used only as auxiliary training augmentations and **never** as a replacement for real human evaluation data.
- **Multiple Takes**: Record multiple takes (e.g., 20–50+ takes per speaker) to give the model sufficient variety.
- **Acoustic Diversity**:
  - **Speaking Speed**: Vary speed across takes — natural conversational speed, slow deliberate speech, and fast hurried speech.
  - **Volume & Intonation**: Capture normal speaking volume, quiet/soft takes, and louder projected takes. Include varied natural inflections (rising question tone, flat statement, energized call).
  - **Microphone Distance**:
    - *Near-field* (~0.3m to 0.5m): Typical laptop/headset distance.
    - *Mid-field* (~1.0m to 1.5m): Across a desk or workspace.
    - *Far-field* (~2.5m to 3.5m+): Across a room.
  - **Environments**: Record across different natural rooms where possible (quiet office, room with background fan or AC hum, kitchen with slight reverberation, room with typing/keyboard sounds).

---

## Negative Recording Guidelines

Negative data trains the classifier to reject non-target sounds without false triggers. Place recordings into their designated subdirectories under `dataset/negative/`:

### 1. Similar Phrases (`dataset/negative/similar_phrases/`)
Acoustic and phonetic near-misses are crucial to prevent false activations from similar names and words:
- `"Hey Louis"`
- `"Hey Louise"`
- `"Hey Lucy"`
- `"Hey Bluey"`
- `"Hello Louie"`
- `"Louie Louie"`
- Additional distractors: `"Hey Rudy"`, `"Hey Dewey"`, `"Hey Zooey"`, `"Hey Lily"`, `"Hey Larry"`, `"Hey Chloe"`

### 2. Normal Speech (`dataset/negative/normal_speech/`)
Conversational sentences, commands, and everyday speech that do **not** contain the wake word:
- Everyday assistant commands: *"What is the time?"*, *"Turn off the light"*, *"Set a reminder"*, *"Pause the music"*.
- General conversational dialogue, podcast excerpts, reading sentences aloud.

### 3. Background Noise (`dataset/negative/background_noise/`)
Pure environmental and ambient sound without human speech:
- Room tone and silence.
- HVAC hum, fan noise, computer fan whir.
- Keyboard typing, mouse clicks, chair creaks, paper rustling.
- Distant street/traffic sounds, household background sounds.

---

## Online Datasets & Licensing Compliance

Both personal recordings and appropriately licensed online datasets can be incorporated into `negative/normal_speech/` and `negative/background_noise/`.

> [!IMPORTANT]
> **Strict Licensing Requirement**:
> Any audio obtained from external online sources **must** have compatible open licensing (e.g., Creative Commons CC0, CC-BY, CC-BY-SA, MIT, or Apache 2.0).
> Always verify commercial vs. non-commercial restrictions before including external audio.

### Provenance Tracking (`dataset/SOURCES.md`)
Whenever adding audio from an external online dataset, you **must** record the source in [`dataset/SOURCES.md`](SOURCES.md) with:
1. Dataset / Source Name
2. Origin URL
3. License type (with link to license text if applicable)
4. Target category (`normal_speech` or `background_noise`)
5. Date obtained
6. Notes on attribution or filtering applied

---

## Speaker Handling & Strict Speaker Independence

To ensure the model generalizes to new, unseen users without overfitting, the dataset structure and training pipeline enforce **strict speaker independence**:

1. **Speaker Organization**:
   - `speaker_01`: Your primary recordings.
   - `speaker_02`, `speaker_03`, `speaker_04`, ...: Additional distinct human contributors.
2. **Zero Speaker Leakage**:
   - All recordings from any single speaker are assigned **exclusively** to one split (`Train`, `Validation`, or `Test`).
   - Under no circumstances will samples from the same speaker appear in both training and evaluation sets.
3. **Minimum Speaker Count**:
   - A minimum of **3 distinct positive human speakers** is required for an honest, leak-free 3-way split (e.g., 1–2 speakers for training, 1 speaker for validation, 1 speaker for final holdout testing).
   - If fewer than 3 speakers are present, the training pipeline will safely refuse to train in speaker-independent mode to prevent deceptive evaluation metrics.

---

## Validation & Training Safety

Before any training run, the dataset must be validated:

```powershell
python scripts/validate_dataset.py
```

The validation tool inspects:
- WAV file headers and openability
- Sampling rate (16 kHz check)
- Channel count (mono check)
- Bit depth (16-bit PCM check)
- Empty (0-byte) or corrupted files
- File counts per speaker and per negative category
- Category completeness and speaker-independence prerequisites

### Safety Guarantees
- Training will **never** overwrite the production model `public/models/hey_louie.onnx` unless the new model is proven to outperform the baseline on unseen test speakers with false positive rate <= 5.0%.
- Synthetic speech will never be treated as real human recordings.
- The pipeline safely aborts when real recordings are not yet available, preserving the existing production engine intact.
