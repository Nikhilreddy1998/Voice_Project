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
MELSPEC_PATH = r"C:\Users\HP\Desktop\Internship\Project\public\models\melspectrogram.onnx"
EMBEDDING_PATH = r"C:\Users\HP\Desktop\Internship\Project\public\models\embedding_model.onnx"
OUTPUT_ONNX_PATH = r"C:\Users\HP\Desktop\Internship\Project\public\models\hey_louie.onnx"
TEMP_AUDIO_DIR = r"C:\Users\HP\Desktop\Internship\Project\temp_training_audio"

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

def main():
    print("--- STEP A: INITIALIZING AUDIO SYNTHESIS ENGINE ---")
    speaker = comtypes.client.CreateObject("SAPI.SpVoice")
    voices = speaker.GetVoices()
    print(f"Found {voices.Count} voices on system:")
    for i in range(voices.Count):
        print(f"  [{i}]: {voices.Item(i).GetDescription()}")
    
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
    
    print("\n--- STEP B: SYNTHESIZING POSITIVE AUDIO ---")
    pos_files = []
    for idx in range(100):
        phrase = random.choice(positive_phrases)
        rate = random.randint(-3, 3) # COM rate ranges -10 to 10
        volume = random.randint(70, 100) # COM volume ranges 0 to 100
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"pos_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            pos_files.append(file_path)
    print(f"Synthesized {len(pos_files)} positive samples.")
    
    print("\n--- STEP C: SYNTHESIZING NEGATIVE AUDIO ---")
    neg_files = []
    # Similar
    for idx in range(150):
        phrase = random.choice(similar_phrases)
        rate = random.randint(-3, 3)
        volume = random.randint(70, 100)
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"neg_sim_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            neg_files.append(file_path)
            
    # General
    for idx in range(150):
        phrase = random.choice(general_phrases)
        rate = random.randint(-3, 3)
        volume = random.randint(70, 100)
        voice_idx = random.randint(0, voices.Count - 1)
        voice_obj = voices.Item(voice_idx)
        file_path = os.path.join(TEMP_AUDIO_DIR, f"neg_gen_{idx}.wav")
        
        if generate_speech_file(speaker, phrase, file_path, rate, volume, voice_obj):
            neg_files.append(file_path)
    print(f"Synthesized {len(neg_files)} negative speech samples.")
    
    print("\n--- STEP D: INITIALIZING FEATURE EXTRACTION ONNX SESSIONS ---")
    melspec_sess = ort.InferenceSession(MELSPEC_PATH)
    embedding_sess = ort.InferenceSession(EMBEDDING_PATH)
    print("ONNX models loaded successfully.")
    
    print("\n--- STEP E: EXTRACTING EMBEDDING FEATURE WINDOWS ---")
    X_list = []
    y_list = []
    
    # Process positives
    for fp in pos_files:
        audio = load_and_resample(fp, TARGET_SR)
        noise_level = random.uniform(0.001, 0.01)
        audio = (audio + np.random.normal(0, noise_level, len(audio))).astype(np.float32)
        
        embeddings = extract_features(audio, melspec_sess, embedding_sess)
        if len(embeddings) < 16:
            pad_size = 16 - len(embeddings)
            embeddings = np.concatenate([np.zeros((pad_size, 96)), embeddings], axis=0)
            
        for i in range(len(embeddings) - 16 + 1):
            window = embeddings[i : i + 16]
            X_list.append(window)
            if i >= len(embeddings) - 16 - 1:
                y_list.append(1.0)
            else:
                y_list.append(0.0)
                
    # Process negatives
    for fp in neg_files:
        audio = load_and_resample(fp, TARGET_SR)
        noise_level = random.uniform(0.001, 0.01)
        audio = (audio + np.random.normal(0, noise_level, len(audio))).astype(np.float32)
        
        embeddings = extract_features(audio, melspec_sess, embedding_sess)
        if len(embeddings) < 16:
            pad_size = 16 - len(embeddings)
            embeddings = np.concatenate([np.zeros((pad_size, 96)), embeddings], axis=0)
            
        for i in range(len(embeddings) - 16 + 1):
            window = embeddings[i : i + 16]
            X_list.append(window)
            y_list.append(0.0)
            
    # Add pure background noise samples
    for idx in range(80):
        noise_duration = random.uniform(1.5, 2.5)
        noise = np.random.normal(0, random.uniform(0.005, 0.03), int(noise_duration * TARGET_SR)).astype(np.float32)
        
        embeddings = extract_features(noise, melspec_sess, embedding_sess)
        if len(embeddings) < 16:
            pad_size = 16 - len(embeddings)
            embeddings = np.concatenate([np.zeros((pad_size, 96)), embeddings], axis=0)
            
        for i in range(len(embeddings) - 16 + 1):
            window = embeddings[i : i + 16]
            X_list.append(window)
            y_list.append(0.0)
            
    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.float32)
    print(f"Dataset generated. Shape: X={X.shape}, y={y.shape}")
    print(f"Positive samples: {np.sum(y == 1.0)}, Negative samples: {np.sum(y == 0.0)}")
    
    # Clean up temp folder
    shutil.rmtree(TEMP_AUDIO_DIR)
    
    print("\n--- STEP F: TRAINING CLASSIFIER HEAD (PyTorch) ---")
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    split_idx = int(len(X) * 0.8)
    
    train_idx = indices[:split_idx]
    val_idx = indices[split_idx:]
    
    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]
    
    train_dataset = TensorDataset(torch.tensor(X_train), torch.tensor(y_train).unsqueeze(1))
    val_dataset = TensorDataset(torch.tensor(X_val), torch.tensor(y_val).unsqueeze(1))
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    
    model = WakeWordHead()
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.005, weight_decay=1e-4)
    
    epochs = 20
    print("Starting training loop...")
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
        
        # Validation
        model.eval()
        with torch.no_grad():
            val_outputs = model(torch.tensor(X_val))
            val_loss = criterion(val_outputs, torch.tensor(y_val).unsqueeze(1)).item()
            preds = (val_outputs.numpy() >= 0.5).astype(np.float32)
            acc = np.mean(preds == np.expand_dims(y_val, 1))
            
        if epoch % 2 == 0 or epoch == epochs:
            print(f"Epoch {epoch:2d}/{epochs:2d} | Train Loss: {train_loss:.4f} | Val Loss: {val_loss:.4f} | Val Acc: {acc*100:.2f}%")
            
    # Calculate detailed metrics
    model.eval()
    with torch.no_grad():
        val_outputs = model(torch.tensor(X_val)).numpy()
        preds = (val_outputs >= 0.5).astype(np.float32)
        y_val_exp = np.expand_dims(y_val, 1)
        
        tp = np.sum((preds == 1.0) & (y_val_exp == 1.0))
        fp = np.sum((preds == 1.0) & (y_val_exp == 0.0))
        tn = np.sum((preds == 0.0) & (y_val_exp == 0.0))
        fn = np.sum((preds == 0.0) & (y_val_exp == 1.0))
        
        accuracy = (tp + tn) / len(y_val)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        fnr = fn / (fn + tp) if (fn + tp) > 0 else 0.0
        
        print("\n--- FINAL EVALUATION METRICS (ON VALIDATION SET) ---")
        print(f"Accuracy               : {accuracy*100:.2f}%")
        print(f"False Positive Rate    : {fpr*100:.2f}%")
        print(f"False Negative Rate    : {fnr*100:.2f}%")
        print(f"True Positives: {tp}, False Positives: {fp}, True Negatives: {tn}, False Negatives: {fn}")
        
    print("\n--- STEP G: EXPORTING MODEL TO ONNX ---")
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
    print(f"ONNX Model saved to: {OUTPUT_ONNX_PATH}")
    
    print("\n--- STEP H: ONNX TECHNICAL VALIDATION ---")
    session = ort.InferenceSession(OUTPUT_ONNX_PATH)
    print(f"Model File     : {OUTPUT_ONNX_PATH}")
    print(f"Inputs         : {[x.name for x in session.get_inputs()]}")
    print(f"Input Shapes   : {[x.shape for x in session.get_inputs()]}")
    print(f"Outputs        : {[x.name for x in session.get_outputs()]}")
    print(f"Output Shapes  : {[x.shape for x in session.get_outputs()]}")
    
    print("\nVerification successful. custom 'hey_louie.onnx' is ready for integration.")

if __name__ == '__main__':
    main()
