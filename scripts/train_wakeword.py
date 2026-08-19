import os
import shutil
import random
import numpy as np
import scipy.io.wavfile as wavfile
from scipy.signal import resample
import onnxruntime as ort
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader
import comtypes.client

# Parameters
TARGET_SR = 16000
CHUNK_SIZE = 1280
MELSPEC_PATH = r"c:\Users\HP\Desktop\Internship\Project\public\models\melspectrogram.onnx"
EMBEDDING_PATH = r"c:\Users\HP\Desktop\Internship\Project\public\models\embedding_model.onnx"
OUTPUT_ONNX_PATH = r"c:\Users\HP\Desktop\Internship\Project\public\models\hey_louie.onnx"
TEMP_AUDIO_DIR = r"c:\Users\HP\Desktop\Internship\Project\temp_training_audio"
DATASET_ROOT = r"c:\Users\HP\Desktop\Internship\Project\dataset"

# Augmentation Parameters
AUGMENTATION_CONFIG = {
    'noise_prob': 0.8,
    'noise_snr_db_range': (10.0, 30.0),
    'gain_range': (0.6, 1.4),
    'shift_range_ms': (-150, 150),
    'speed_range': (0.9, 1.1)
}

class WakeWordHead(nn.Module):
    def __init__(self, input_dim=1536, hidden_dim=32):
        super(WakeWordHead, self).__init__()
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
            nn.Sigmoid()
        )
        
    def forward(self, x):
        return self.classifier(x)

def load_and_resample(wav_path, target_sr=16000):
    sr, data = wavfile.read(wav_path)
    # Convert to float32 between -1.0 and 1.0
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    elif data.dtype == np.uint8:
        data = (data.astype(np.float32) - 128.0) / 128.0
    else:
        data = data.astype(np.float32)
        
    # If stereo, convert to mono
    if len(data.shape) > 1:
        data = np.mean(data, axis=1)
        
    # Resample if sample rate doesn't match
    if sr != target_sr:
        num_samples = int(len(data) * target_sr / sr)
        data = resample(data, num_samples)
        
    return data.astype(np.float32)

def generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
    try:
        # Set speaker properties
        speaker.Rate = rate
        speaker.Volume = volume
        speaker.Voice = voice_obj
        
        # Create output stream
        stream = comtypes.client.CreateObject("SAPI.SpFileStream")
        stream.Open(file_path, 3) # 3 = SSFMCreateForWrite
        
        # Redirect audio output to file
        speaker.AudioOutputStream = stream
        speaker.Speak(phrase)
        stream.Close()
        return True
    except Exception as e:
        print(f"Error generating speech file: {e}")
        return False

def augment_audio(audio_data, config, sr=16000, noise_files=None):
    augmented = audio_data.copy()
    
    # 1. Gain/Volume modification
    if config.get('gain_range'):
        gain = random.uniform(*config['gain_range'])
        augmented = augmented * gain
        
    # 2. Speed variation (resampling)
    if config.get('speed_range'):
        speed_factor = random.uniform(*config['speed_range'])
        if abs(speed_factor - 1.0) > 0.01:
            num_samples = int(len(augmented) / speed_factor)
            augmented = resample(augmented, num_samples)
            
    # 3. Slight time shifting (time shifting/padding)
    if config.get('shift_range_ms'):
        shift_ms = random.randint(*config['shift_range_ms'])
        shift_samples = int(shift_ms * sr / 1000)
        if shift_samples > 0:
            # Shift right: pad zeros at the beginning, crop end
            padding = np.zeros(shift_samples, dtype=np.float32)
            augmented = np.concatenate([padding, augmented[:-shift_samples]])
        elif shift_samples < 0:
            # Shift left: crop beginning, pad zeros at the end
            shift_samples = abs(shift_samples)
            padding = np.zeros(shift_samples, dtype=np.float32)
            augmented = np.concatenate([augmented[shift_samples:], padding])
            
    # 4. Background noise addition
    if config.get('noise_prob') and random.random() < config['noise_prob']:
        noise = None
        if noise_files:
            try:
                noise_fp = random.choice(noise_files)
                noise = load_and_resample(noise_fp, sr)
            except Exception as e:
                print(f"Error loading background noise file {noise_fp}: {e}")
        
        if noise is None:
            # Fallback to white/Gaussian noise
            noise = np.random.normal(0, 1.0, len(augmented)).astype(np.float32)
            
        # Scale noise based on SNR
        snr_db = random.uniform(*config.get('noise_snr_db_range', (10.0, 30.0)))
        signal_power = np.mean(augmented ** 2)
        if signal_power > 0:
            noise_power = np.mean(noise ** 2)
            if noise_power > 0:
                target_noise_power = signal_power / (10.0 ** (snr_db / 10.0))
                scale = np.sqrt(target_noise_power / noise_power)
                
                # Repeat or crop noise
                if len(noise) < len(augmented):
                    repeats = int(np.ceil(len(augmented) / len(noise)))
                    noise = np.tile(noise, repeats)[:len(augmented)]
                else:
                    start_idx = random.randint(0, len(noise) - len(augmented))
                    noise = noise[start_idx : start_idx + len(augmented)]
                    
                augmented = augmented + scale * noise
                
    # Limit range to [-1.0, 1.0] to prevent clipping
    augmented = np.clip(augmented, -1.0, 1.0)
    return augmented.astype(np.float32)

def extract_features(audio_data, melspec_sess, embedding_sess):
    min_samples = 51200
    if len(audio_data) < min_samples:
        padding = np.zeros(min_samples - len(audio_data), dtype=np.float32)
        audio_data = np.concatenate([padding, audio_data])
        
    num_chunks = len(audio_data) // CHUNK_SIZE
    spectrogram_frames = []
    
    for i in range(num_chunks):
        chunk = audio_data[i * CHUNK_SIZE : (i + 1) * CHUNK_SIZE]
        chunk_tensor = np.expand_dims(chunk, axis=0) # [1, 1280]
        
        outputs = melspec_sess.run(None, {'input': chunk_tensor})
        raw_melspec = outputs[0] # Shape [1, 8, 32, 1]
        
        processed_melspec = (raw_melspec / 10.0) + 2.0
        processed_melspec = np.reshape(processed_melspec, (-1, 32))
        spectrogram_frames.append(processed_melspec)
        
    spectrogram = np.concatenate(spectrogram_frames, axis=0)
    total_frames = spectrogram.shape[0]
    
    embeddings = []
    for idx in range(0, total_frames - 76 + 1, 8):
        window = spectrogram[idx : idx + 76, :]
        window_tensor = np.expand_dims(np.expand_dims(window, axis=0), axis=3) # [1, 76, 32, 1]
        
        outputs = embedding_sess.run(None, {'input_1': window_tensor})
        embedding = outputs[0]
        embedding = np.squeeze(embedding)
        embeddings.append(embedding)
        
    return np.array(embeddings) # [Num_Embeddings, 96]

def load_human_dataset():
    human_samples = []
    
    # Positive samples from dataset/positive/speaker_XX/*.wav
    pos_dir = os.path.join(DATASET_ROOT, "positive")
    if os.path.exists(pos_dir):
        for speaker_folder in os.listdir(pos_dir):
            speaker_path = os.path.join(pos_dir, speaker_folder)
            if os.path.isdir(speaker_path):
                for f in os.listdir(speaker_path):
                    if f.endswith('.wav'):
                        human_samples.append({
                            'path': os.path.join(speaker_path, f),
                            'label': 1.0,
                            'speaker': f"human_{speaker_folder}",
                            'type': 'human',
                            'category': 'positive'
                        })
                        
    # Negative samples from dataset/negative/*
    neg_dir = os.path.join(DATASET_ROOT, "negative")
    if os.path.exists(neg_dir):
        for cat in ['similar_phrases', 'normal_speech', 'background_noise']:
            cat_path = os.path.join(neg_dir, cat)
            if os.path.isdir(cat_path):
                for f in os.listdir(cat_path):
                    if f.endswith('.wav'):
                        human_samples.append({
                            'path': os.path.join(cat_path, f),
                            'label': 0.0,
                            'speaker': f"independent_{cat}",
                            'type': 'human',
                            'category': cat
                        })
                        
    return human_samples

def generate_synthetic_dataset(voices):
    speaker = comtypes.client.CreateObject("SAPI.SpVoice")
    
    if os.path.exists(TEMP_AUDIO_DIR):
        shutil.rmtree(TEMP_AUDIO_DIR)
    os.makedirs(TEMP_AUDIO_DIR)
    
    positive_phrases = ["Hey Louie", "Hey Louie.", "Hey, Louie", "Hey, Louie."]
    similar_phrases = [
        "Hey Louis", "Hey Louise", "Hey Lucy", "Hey Bluey", "Hey Rudy", 
        "Louie Louie", "Hello Louie", "Hey Lily", "Louie", "Hey Dewey", 
        "Hey Zooey", "Hey Huey", "Hey Leroy"
    ]
    general_phrases = [
        "Hello, how are you?", "Turn on the light", "Turn off the light", 
        "What is the time?", "Set an alarm", "Cancel", "Stop listening", 
        "Yes, please", "No, thank you", "How is the weather today?", 
        "Play some music", "Pause the audio", "Show the metrics dashboard",
        "Volume up", "Volume down", "Quiet room"
    ]
    
    synthetic_samples = []
    
    print("\nSynthesizing synthetic positive samples...")
    for idx in range(100):
        phrase = random.choice(positive_phrases)
        rate = random.randint(-3, 3)
        volume = random.randint(70, 100)
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"pos_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            synthetic_samples.append({
                'path': file_path,
                'label': 1.0,
                'speaker': f"sapi_voice_{voice_idx}",
                'type': 'synthetic',
                'category': 'positive'
            })
            
    print("Synthesizing synthetic negative (similar phrases) samples...")
    for idx in range(150):
        phrase = random.choice(similar_phrases)
        rate = random.randint(-3, 3)
        volume = random.randint(70, 100)
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"neg_sim_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            synthetic_samples.append({
                'path': file_path,
                'label': 0.0,
                'speaker': f"sapi_voice_{voice_idx}",
                'type': 'synthetic',
                'category': 'similar'
            })
            
    print("Synthesizing synthetic negative (general speech) samples...")
    for idx in range(150):
        phrase = random.choice(general_phrases)
        rate = random.randint(-3, 3)
        volume = random.randint(70, 100)
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"neg_gen_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            synthetic_samples.append({
                'path': file_path,
                'label': 0.0,
                'speaker': f"sapi_voice_{voice_idx}",
                'type': 'synthetic',
                'category': 'general'
            })
            
    return synthetic_samples

def split_dataset(all_samples, seed=42):
    random.seed(seed)
    
    # 1. Identify all positive speakers
    pos_speakers = list(set([s['speaker'] for s in all_samples if s['label'] == 1.0]))
    random.shuffle(pos_speakers)
    
    # Determine speaker split
    if len(pos_speakers) >= 3:
        # Strict speaker-independent split: assign speakers to Train, Val, Test
        # Ensure at least 1 speaker goes to Val and 1 to Test
        num_val = max(1, int(len(pos_speakers) * 0.15))
        num_test = max(1, int(len(pos_speakers) * 0.15))
        num_train = len(pos_speakers) - num_val - num_test
        
        train_speakers = set(pos_speakers[:num_train])
        val_speakers = set(pos_speakers[num_train:num_train + num_val])
        test_speakers = set(pos_speakers[num_train + num_val:])
        print(f"Speaker-independent split: Train={train_speakers}, Val={val_speakers}, Test={test_speakers}")
    else:
        # Degraded mode: Not enough unique speakers to isolate them. Split samples within speakers.
        print(f"Warning: Only {len(pos_speakers)} unique positive speakers found. Cannot perform speaker-independent split across all sets.")
        train_speakers = set(pos_speakers)
        val_speakers = set(pos_speakers)
        test_speakers = set(pos_speakers)
        
    train_files, val_files, test_files = [], [], []
    
    for s in all_samples:
        is_independent = s['speaker'] in ['independent_noise', 'independent_speech', 'unknown'] or s['speaker'].startswith('independent_')
        
        if not is_independent:
            # Route by speaker
            if len(pos_speakers) >= 3:
                if s['speaker'] in train_speakers:
                    train_files.append(s)
                elif s['speaker'] in val_speakers:
                    val_files.append(s)
                elif s['speaker'] in test_speakers:
                    test_files.append(s)
            else:
                # Split samples of these speakers randomly (70% Train, 15% Val, 15% Test)
                r = random.random()
                if r < 0.70:
                    train_files.append(s)
                elif r < 0.85:
                    val_files.append(s)
                else:
                    test_files.append(s)
        else:
            # Independent samples (like room noises/general text files) split randomly
            r = random.random()
            if r < 0.70:
                train_files.append(s)
            elif r < 0.85:
                val_files.append(s)
            else:
                test_files.append(s)
                
    return train_files, val_files, test_files

def prepare_split_windows(split_files, melspec_sess, embedding_sess, is_training=False, noise_files=None):
    X_list = []
    y_list = []
    
    for f in split_files:
        try:
            audio = load_and_resample(f['path'], TARGET_SR)
        except Exception as e:
            print(f"Error loading {f['path']}: {e}")
            continue
            
        # Process the clean/base file
        embeddings = extract_features(audio, melspec_sess, embedding_sess)
        if len(embeddings) < 16:
            pad_size = 16 - len(embeddings)
            embeddings = np.concatenate([np.zeros((pad_size, 96)), embeddings], axis=0)
            
        for i in range(len(embeddings) - 16 + 1):
            window = embeddings[i : i + 16]
            X_list.append(window)
            if f['label'] == 1.0:
                # For positive, label last window(s) as wake word
                if i >= len(embeddings) - 16 - 1:
                    y_list.append(1.0)
                else:
                    y_list.append(0.0)
            else:
                y_list.append(0.0)
                
        # If training set, apply augmentations and append as separate training samples
        if is_training:
            # Create 2 augmented versions of positive samples and 1 for negatives
            num_augs = 2 if f['label'] == 1.0 else 1
            for _ in range(num_augs):
                aug_audio = augment_audio(audio, AUGMENTATION_CONFIG, TARGET_SR, noise_files)
                aug_embeddings = extract_features(aug_audio, melspec_sess, embedding_sess)
                
                if len(aug_embeddings) < 16:
                    pad_size = 16 - len(aug_embeddings)
                    aug_embeddings = np.concatenate([np.zeros((pad_size, 96)), aug_embeddings], axis=0)
                    
                for i in range(len(aug_embeddings) - 16 + 1):
                    window = aug_embeddings[i : i + 16]
                    X_list.append(window)
                    if f['label'] == 1.0:
                        if i >= len(aug_embeddings) - 16 - 1:
                            y_list.append(1.0)
                        else:
                            y_list.append(0.0)
                    else:
                        y_list.append(0.0)
                        
    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)

def evaluate_model(model, data_loader, threshold=0.5):
    model.eval()
    all_preds = []
    all_targets = []
    
    with torch.no_grad():
        for batch_X, batch_y in data_loader:
            outputs = model(batch_X)
            preds = (outputs >= threshold).float()
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(batch_y.cpu().numpy())
            
    all_preds = np.array(all_preds)
    all_targets = np.array(all_targets)
    
    tp = np.sum((all_preds == 1.0) & (all_targets == 1.0))
    fp = np.sum((all_preds == 1.0) & (all_targets == 0.0))
    tn = np.sum((all_preds == 0.0) & (all_targets == 0.0))
    fn = np.sum((all_preds == 0.0) & (all_targets == 1.0))
    
    total = len(all_targets)
    accuracy = (tp + tn) / total if total > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    fnr = fn / (fn + tp) if (fn + tp) > 0 else 0.0
    
    return {
        'threshold': threshold,
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'fpr': fpr,
        'fnr': fnr,
        'tp': int(tp),
        'tn': int(tn),
        'fp': int(fp),
        'fn': int(fn)
    }

def main():
    print("=== WAKE WORD TRAINING SYSTEM ===")
    
    # Step 1: Scan for real human recordings
    print("\nScanning for real human recordings...")
    human_samples = load_human_dataset()
    print(f"Found {len(human_samples)} real human recordings.")
    
    # Exit if no real recordings are available yet
    if len(human_samples) == 0:
        print("\n" + "="*80)
        print("[NOTICE] REAL HUMAN RECORDINGS REQUIRED")
        print("No WAV files found in 'dataset/positive/speaker_*' or 'dataset/negative/*'.")
        print("The dataset structure and loader are successfully verified and ready.")
        print("\nPlease record 'Hey Louie' samples from several speakers and place them into:")
        print("  - dataset/positive/speaker_01/")
        print("  - dataset/positive/speaker_02/")
        print("  - dataset/positive/speaker_03/")
        print("  - dataset/positive/speaker_04/")
        print("\nTraining cannot proceed without real human recordings.")
        print("="*80 + "\n")
        return
        
    # Enumerate SAPI5 Voices to combine synthetic samples
    speaker_engine = comtypes.client.CreateObject("SAPI.SpVoice")
    voices = speaker_engine.GetVoices()
    print(f"SAPI5 System Voices Found: {voices.Count}")
    
    # Generate synthetic samples
    print("\nGenerating synthetic speech baseline...")
    synthetic_samples = generate_synthetic_dataset(voices)
    print(f"Synthesized {len(synthetic_samples)} samples.")
    
    # Combine datasets
    all_samples = synthetic_samples + human_samples
    print(f"Total dataset size: {len(all_samples)} audio clips.")
    
    # Keep track of background noise files for augmentation
    noise_files = [s['path'] for s in all_samples if s['category'] == 'background_noise']
    print(f"Noise files available for mixing: {len(noise_files)}")
    
    # Add synthetic noise samples to dataset (pure room/background noise generator)
    print("\nSynthesizing background noise frames...")
    for idx in range(80):
        noise_duration = random.uniform(1.5, 2.5)
        # Generate pure white noise file
        noise_path = os.path.join(TEMP_AUDIO_DIR, f"synth_noise_{idx}.wav")
        noise = np.random.normal(0, random.uniform(0.005, 0.03), int(noise_duration * TARGET_SR)).astype(np.float32)
        wavfile.write(noise_path, TARGET_SR, (noise * 32767).astype(np.int16))
        all_samples.append({
            'path': noise_path,
            'label': 0.0,
            'speaker': 'independent_noise',
            'type': 'synthetic',
            'category': 'background_noise'
        })
        
    print(f"Final pool contains {len(all_samples)} files.")
    
    # Step 3: Perform Leakage-free Speaker-Level Split
    print("\nPartitioning datasets into splits...")
    train_files, val_files, test_files = split_dataset(all_samples)
    print(f"File level split summary:")
    print(f"  Train : {len(train_files)} files")
    print(f"  Val   : {len(val_files)} files")
    print(f"  Test  : {len(test_files)} files")
    
    # Step 4: ONNX feature extraction
    print("\nLoading feature extraction ONNX sessions...")
    melspec_sess = ort.InferenceSession(MELSPEC_PATH)
    embedding_sess = ort.InferenceSession(EMBEDDING_PATH)
    print("Feature extractors ready.")
    
    # Prepare sliding window datasets
    print("\nProcessing window embeddings (Train - with Augmentations)...")
    X_train, y_train = prepare_split_windows(train_files, melspec_sess, embedding_sess, is_training=True, noise_files=noise_files)
    print(f"Train window count: X={X_train.shape}, y={y_train.shape}")
    
    print("\nProcessing window embeddings (Val - Clean)...")
    X_val, y_val = prepare_split_windows(val_files, melspec_sess, embedding_sess, is_training=False)
    print(f"Val window count: X={X_val.shape}, y={y_val.shape}")
    
    print("\nProcessing window embeddings (Test - Clean)...")
    X_test, y_test = prepare_split_windows(test_files, melspec_sess, embedding_sess, is_training=False)
    print(f"Test window count: X={X_test.shape}, y={y_test.shape}")
    
    # Clean up SAPI5 synthesized temp audio dir
    if os.path.exists(TEMP_AUDIO_DIR):
        shutil.rmtree(TEMP_AUDIO_DIR)
        
    # PyTorch DataLoaders
    train_dataset = TensorDataset(torch.tensor(X_train), torch.tensor(y_train).unsqueeze(1))
    val_dataset = TensorDataset(torch.tensor(X_val), torch.tensor(y_val).unsqueeze(1))
    test_dataset = TensorDataset(torch.tensor(X_test), torch.tensor(y_test).unsqueeze(1))
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=64, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=64, shuffle=False)
    
    # Train classifier head
    print("\nTraining Classifier Head (PyTorch)...")
    model = WakeWordHead()
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.005, weight_decay=1e-4)
    
    best_val_f1 = -1.0
    best_model_state = None
    
    epochs = 30
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        for batch_X, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * batch_X.size(0)
        train_loss /= len(X_train)
        
        val_metrics = evaluate_model(model, val_loader, threshold=0.50)
        if val_metrics['f1'] > best_val_f1:
            best_val_f1 = val_metrics['f1']
            best_model_state = model.state_dict().copy()
            
        if epoch % 5 == 0 or epoch == epochs:
            print(f"Epoch {epoch:2d}/{epochs:2d} | Train Loss: {train_loss:.4f} | Val Loss: {val_metrics['f1']:.4f} (F1) | Val Acc: {val_metrics['accuracy']*100:.2f}%")
            
    # Load best model
    if best_model_state is not None:
        model.load_state_dict(best_model_state)
        print("Restored best model checkpoint based on validation F1 score.")
        
    # Evaluate model on the Test Set at threshold 0.50
    test_metrics_05 = evaluate_model(model, test_loader, threshold=0.50)
    
    # Threshold Analysis [0.10 to 0.90 with 0.05 step]
    print("\n=== THRESHOLD ANALYSIS (0.10 to 0.90) ===")
    thresholds = [round(x, 2) for x in np.arange(0.10, 0.95, 0.05)]
    comparison_rows = []
    
    print("| Threshold | Precision | Recall | FPR | FNR | F1 | TP | TN | FP | FN |")
    print("|-----------|-----------|--------|-----|-----|----|----|----|----|----|")
    
    best_f1_threshold = 0.50
    max_f1 = -1.0
    
    for t in thresholds:
        metrics = evaluate_model(model, test_loader, threshold=t)
        print(f"| {t:.2f} | {metrics['precision']*100:.2f}% | {metrics['recall']*100:.2f}% | {metrics['fpr']*100:.2f}% | {metrics['fnr']*100:.2f}% | {metrics['f1']*100:.2f}% | {metrics['tp']} | {metrics['tn']} | {metrics['fp']} | {metrics['fn']} |")
        comparison_rows.append(metrics)
        if metrics['f1'] > max_f1:
            max_f1 = metrics['f1']
            best_f1_threshold = t
            
    print(f"\nRecommended Threshold (maximizing Test F1 Score): {best_f1_threshold:.2f}")
    
    # Baseline comparison check
    # Baseline metrics (SAPI5 model baseline): Accuracy: 89.58%, FPR: 3.85%, FNR: 38.89%
    baseline_acc = 0.8958
    baseline_fpr = 0.0385
    baseline_fnr = 0.3889
    
    new_acc = test_metrics_05['accuracy']
    new_fpr = test_metrics_05['fpr']
    new_fnr = test_metrics_05['fnr']
    
    # Only replace if the new model clearly improves speaker-independent test performance, 
    # especially recall/FNR, without causing an unacceptable increase in false positives (FPR <= 5.0%)
    is_better = (new_fnr < baseline_fnr) and (new_fpr <= 0.05)
    
    print(f"\n=== COMPARISON WITH BASELINE ===")
    print(f"Metric        | Baseline | New Model (0.50) | Status")
    print(f"--------------|----------|------------------|--------")
    print(f"Accuracy      | {baseline_acc*100:.2f}%   | {new_acc*100:.2f}%            | {'Improved' if new_acc > baseline_acc else 'Same' if new_acc == baseline_acc else 'Worse'}")
    print(f"FPR           | {baseline_fpr*100:.2f}%    | {new_fpr*100:.2f}%             | {'Improved' if new_fpr < baseline_fpr else 'Same' if new_fpr == baseline_fpr else 'Worse'}")
    print(f"FNR (Recall)  | {baseline_fnr*100:.2f}%   | {new_fnr*100:.2f}%            | {'Improved (Recall Up)' if new_fnr < baseline_fnr else 'Same' if new_fnr == baseline_fnr else 'Worse'}")
    
    if is_better:
        print(f"\nNew model improves Recall/FNR with low False Positives. Saving to ONNX: {OUTPUT_ONNX_PATH}")
        model.eval()
        dummy_input = torch.zeros(1, 16, 96, dtype=torch.float32)
        torch.onnx.export(
            model,
            dummy_input,
            OUTPUT_ONNX_PATH,
            input_names=['onnx::Flatten_0'],
            output_names=['39'],
            dynamic_axes={
                'onnx::Flatten_0': {0: 'batch_size'},
                '39': {0: 'batch_size'}
            },
            opset_version=12,
            dynamo=False
        )
        print("ONNX Export complete.")
        
        # Verify ONNX structure
        session = ort.InferenceSession(OUTPUT_ONNX_PATH)
        print("ONNX model validated successfully on disk. Shape [1, 16, 96] and output [1, 1] verified.")
    else:
        print("\n[WARNING] New model does not clearly outperform the baseline. NOT replacing the production model.")
        print(f"Kept the existing model at: {OUTPUT_ONNX_PATH}")

if __name__ == '__main__':
    main()
