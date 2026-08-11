# Hey Louie Wake-Word Training Dataset

This directory holds the training data for the custom "Hey Louie" wake-word classifier. It supports combining synthetic SAPI5 voices with real human recordings.

## Directory Structure

```text
dataset/
  positive/
    speaker_01/         ← Folder per real human speaker saying "Hey Louie"
      sample_1.wav
      sample_2.wav
    speaker_02/
      ...
  negative/
    similar_phrases/    ← Phrases that sound similar (e.g. "Hey Louis", "Hello Louie", "Louie Louie")
    normal_speech/      ← General conversation clips or non-wake speech
    background_noise/   ← Environment noises (e.g. room hum, fan noise)
```

## Recording Guidelines

To get the best real-world results:
1. **Audio Format**: Files must be standard WAV files.
   - **Sample Rate**: 16000 Hz (16 kHz) is required (any other sample rates will be resampled by the script).
   - **Channels**: Mono (1 channel).
   - **Bit Depth**: 16-bit PCM.
2. **Positive Samples**: Real human speakers saying "Hey Louie". Ensure a variety of speaker pitches, speeds, and distances. Place each speaker's recordings in a unique subfolder (e.g., `speaker_01/`, `speaker_02/`) under `positive/`.
3. **Negative Samples**: 
   - Record similar distractor phrases (e.g. "Hey Louis", "Hey Louise", "Hey Lucy", "Hey Larry", "Hey Bluey", "Hello Louie", "Louie Louie"). Place them in `negative/similar_phrases/`.
   - Record normal continuous conversation or sentences. Place them in `negative/normal_speech/`.
   - Record background room noises under different conditions. Place them in `negative/background_noise/`.

## Proper Data Split & Speaker Independence

To ensure the model is evaluated without bias (preventing speaker leakage):
- The training script groups all positive recordings by speaker folder.
- Validation and test splits will contain speakers that were **completely excluded** from the training set.
- If no human recordings are present, the training script falls back to SAPI5 synthetic generation.
