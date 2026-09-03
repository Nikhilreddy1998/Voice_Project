# External Dataset Sources & Licensing Registry

This registry tracks all external audio datasets, public domain audio, and licensed recordings used in the Hey Louie wake-word project.

Whenever external audio is incorporated into `dataset/negative/normal_speech/` or `dataset/negative/background_noise/`, record its provenance in the table below.

---

## Licensing Requirements

1. **Permitted Licenses**: Only audio with permissive, open licenses should be added. Examples:
   - **CC0 1.0 (Public Domain)**
   - **Creative Commons Attribution (CC-BY 4.0 / CC-BY 3.0)**
   - **MIT License / Apache 2.0**
   - **Open Data Commons (ODC-By / ODbL)**
2. **Restricted Licenses**: Avoid licenses with non-commercial (`-NC`) or no-derivatives (`-ND`) clauses unless you have confirmed compliance with your project goals.
3. **Attribution**: If the license requires attribution (e.g., CC-BY), document the author, year, and link in the Notes column below.
4. **Format Preparation**: Audio from online datasets should be converted to **16 kHz, 16-bit PCM, Mono WAV** before placing in the dataset directory.

---

## Registered Sources

| # | Dataset / Source Name | Origin URL | License | Target Category | Date Obtained | Notes / Attribution |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| *e.g.* | *ESC-50 (Environmental Noise)* | *https://github.com/karolpiczak/ESC-50* | *CC-BY-4.0* | *background_noise* | *YYYY-MM-DD* | *Selected natural ambient clips only; converted to 16kHz mono.* |
| *e.g.* | *Common Voice (English excerpt)* | *https://commonvoice.mozilla.org/* | *CC0* | *normal_speech* | *YYYY-MM-DD* | *Random sentences sliced to 3s windows.* |

*(Add your downloaded online dataset entries above when adding external negative files)*

---

## Directory Placement Reference

- General conversation clips, non-wake sentences, audiobook excerpts:
  `dataset/negative/normal_speech/`
- Environmental noise, silence, room tones, ambient chatter/hum:
  `dataset/negative/background_noise/`
