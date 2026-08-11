# Hey Louie Wake-Word Training Dataset

This directory holds the training data for the custom "Hey Louie" wake-word classifier. It supports combining synthetic SAPI5 voices with real human recordings once they are collected.

## Directory Structure

```text
dataset/
  positive/
    speaker_01/         ← Folder per real human speaker saying "Hey Louie"
      sample_1.wav
      sample_2.wav
    speaker_02/
    speaker_03/
    speaker_04/
  negative/
    similar_phrases/    ← Phrases that sound similar (e.g. "Hey Louis", "Hello Louie", "Louie Louie")
    normal_speech/      ← General conversation clips or non-wake speech
    background_noise/   ← Environment noises (e.g. room hum, fan noise)
```

## Detailed Recording Guidelines

To ensure the classifier can generalize robustly to real-world environments:

1. **Audio Format**: Files must be standard WAV files.
   - **Sample Rate**: 16000 Hz (16 kHz) is required.
   - **Channels**: Mono (1 channel).
   - **Bit Depth**: 16-bit PCM.
2. **Recording Duration**: **2 to 4 seconds** per recording.
3. **Trigger Content**: Each recording in the `positive/` speaker folders should contain exactly **one natural utterance** of "Hey Louie".
4. **Diversity Requirements**:
   - **Multiple Speakers**: Collect recordings from at least 3–5 different human speakers.
   - **Different Speaking Speeds**: Record some slow, natural, and fast utterances.
   - **Different Volumes**: Include soft (whispered/low-volume) and loud speaking levels.
   - **Different Microphone Distances**: Record near the mic (0.5m), at normal range (1-2m), and far field (3m+).
   - **Varied Environments**: Capture samples in quiet rooms as well as moderately noisy settings (e.g., with air conditioning, music, or keyboard clicks in the background).
5. **Negative Samples**:
   - **Similar Distractor Phrases**: Say similar phrases (e.g. "Hey Louis", "Hey Louise", "Hey Lucy", "Hey Larry", "Hey Bluey", "Hello Louie", "Louie Louie") and place them in `negative/similar_phrases/`.
   - **Normal Conversation**: Record normal continuous conversation or sentences not containing the wake word and save in `negative/normal_speech/`.
   - **Background Noise**: Record pure environment noise (silence, room hums, device noise) and place in `negative/background_noise/`.

## Proper Data Split & Speaker Independence

To ensure the model is evaluated without bias (preventing speaker leakage):
- The training script groups all positive recordings by speaker folder.
- Validation and test splits will contain speakers that were **completely excluded** from the training set.
- If no human recordings are present, the training script will verify the folders and notify that human recordings are required to begin training.
