#!/usr/bin/env python3
"""
Hey Louie Dataset Validation Utility
-----------------------------------
Validates the directory structure, audio specifications, and completeness
of the wake-word training dataset using only Python standard library modules.

Checks:
- Folder hierarchy: dataset/positive/speaker_* and dataset/negative/*
- Audio openability: standard WAV headers
- Sample rate: 16,000 Hz check
- Channel count: 1 channel (mono) check
- Bit depth: 16-bit PCM check
- Zero-byte or corrupted files
- Speaker isolation and file count summaries
- Training readiness verification
"""

import os
import sys
import wave
import argparse
from pathlib import Path


DEFAULT_DATASET_DIR = Path(__file__).resolve().parent.parent / "dataset"
EXPECTED_NEGATIVE_CATEGORIES = ("similar_phrases", "normal_speech", "background_noise")
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1
TARGET_BIT_DEPTH = 16  # sampwidth = 2 bytes


def inspect_wav_file(file_path):
    """
    Inspect a single WAV file using the standard library wave module.
    Returns:
        (is_valid, error_msg, info_dict)
    """
    try:
        file_size = os.path.getsize(file_path)
        if file_size == 0:
            return False, "File is empty (0 bytes)", None

        with wave.open(str(file_path), "rb") as wf:
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            nframes = wf.getnframes()
            duration = nframes / float(framerate) if framerate > 0 else 0.0
            bit_depth = sampwidth * 8

            if nframes == 0 or duration == 0:
                return False, "WAV contains 0 audio frames", None

            info = {
                "channels": channels,
                "sampwidth": sampwidth,
                "bit_depth": bit_depth,
                "framerate": framerate,
                "nframes": nframes,
                "duration": duration,
                "size_bytes": file_size,
            }
            return True, None, info

    except wave.Error as e:
        return False, f"Invalid WAV header/format: {e}", None
    except Exception as e:
        return False, f"Cannot open audio file: {e}", None


def validate_dataset(dataset_dir=None, verbose=False):
    """
    Validate the complete dataset directory structure and all audio files.
    Returns a dictionary containing all metrics, errors, warnings, and readiness status.
    """
    if dataset_dir is None:
        dataset_dir = DEFAULT_DATASET_DIR
    else:
        dataset_dir = Path(dataset_dir).resolve()

    report = {
        "dataset_dir": str(dataset_dir),
        "structure_valid": True,
        "positive": {},
        "positive_total": 0,
        "negative": {},
        "negative_total": 0,
        "total_files": 0,
        "corrupt_files": [],
        "warnings": [],
        "errors": [],
        "ready_for_training": False,
        "readiness_reason": "",
    }

    # 1. Check Root Directory
    if not dataset_dir.exists() or not dataset_dir.is_dir():
        report["structure_valid"] = False
        report["errors"].append(f"Dataset root directory does not exist: {dataset_dir}")
        report["readiness_reason"] = "Dataset root directory missing"
        return report

    pos_dir = dataset_dir / "positive"
    neg_dir = dataset_dir / "negative"

    # 2. Check Positive Directory & Speaker Subdirectories
    if not pos_dir.exists() or not pos_dir.is_dir():
        report["structure_valid"] = False
        report["errors"].append(f"Missing required directory: {pos_dir}")
    else:
        # Find all speaker directories
        speaker_dirs = sorted([d for d in pos_dir.iterdir() if d.is_dir()])
        if not speaker_dirs:
            report["warnings"].append("No speaker subdirectories found under dataset/positive/ (expected speaker_01, speaker_02, etc.)")

        for s_dir in speaker_dirs:
            speaker_name = s_dir.name
            wav_files = sorted([f for f in s_dir.iterdir() if f.is_file() and f.suffix.lower() == ".wav"])
            valid_count = 0

            for wf in wav_files:
                is_valid, err, info = inspect_wav_file(wf)
                if not is_valid:
                    report["corrupt_files"].append((str(wf), err))
                else:
                    valid_count += 1
                    # Check compliance with audio specifications
                    if info["framerate"] != TARGET_SAMPLE_RATE:
                        report["warnings"].append(f"{wf.name}: Sample rate is {info['framerate']} Hz (expected {TARGET_SAMPLE_RATE} Hz)")
                    if info["channels"] != TARGET_CHANNELS:
                        report["warnings"].append(f"{wf.name}: Channels = {info['channels']} (expected {TARGET_CHANNELS} / mono)")
                    if info["bit_depth"] != TARGET_BIT_DEPTH:
                        report["warnings"].append(f"{wf.name}: Bit depth is {info['bit_depth']}-bit (expected {TARGET_BIT_DEPTH}-bit PCM)")

            report["positive"][speaker_name] = valid_count
            report["positive_total"] += valid_count

    # 3. Check Negative Directory & Subcategories
    if not neg_dir.exists() or not neg_dir.is_dir():
        report["structure_valid"] = False
        report["errors"].append(f"Missing required directory: {neg_dir}")
    else:
        for cat in EXPECTED_NEGATIVE_CATEGORIES:
            cat_dir = neg_dir / cat
            if not cat_dir.exists() or not cat_dir.is_dir():
                report["structure_valid"] = False
                report["errors"].append(f"Missing negative category directory: {cat_dir}")
                report["negative"][cat] = 0
            else:
                wav_files = sorted([f for f in cat_dir.iterdir() if f.is_file() and f.suffix.lower() == ".wav"])
                valid_count = 0

                for wf in wav_files:
                    is_valid, err, info = inspect_wav_file(wf)
                    if not is_valid:
                        report["corrupt_files"].append((str(wf), err))
                    else:
                        valid_count += 1
                        if info["framerate"] != TARGET_SAMPLE_RATE:
                            report["warnings"].append(f"{wf.name}: Sample rate is {info['framerate']} Hz (expected {TARGET_SAMPLE_RATE} Hz)")
                        if info["channels"] != TARGET_CHANNELS:
                            report["warnings"].append(f"{wf.name}: Channels = {info['channels']} (expected {TARGET_CHANNELS} / mono)")
                        if info["bit_depth"] != TARGET_BIT_DEPTH:
                            report["warnings"].append(f"{wf.name}: Bit depth is {info['bit_depth']}-bit (expected {TARGET_BIT_DEPTH}-bit PCM)")

                report["negative"][cat] = valid_count
                report["negative_total"] += valid_count

    report["total_files"] = report["positive_total"] + report["negative_total"]

    # 4. Assess Training Readiness
    if not report["structure_valid"]:
        report["ready_for_training"] = False
        report["readiness_reason"] = "Directory structure validation failed"
    elif len(report["corrupt_files"]) > 0:
        report["ready_for_training"] = False
        report["readiness_reason"] = f"Found {len(report['corrupt_files'])} corrupt or unreadable audio file(s)"
    elif report["positive_total"] == 0 and report["negative_total"] == 0:
        report["ready_for_training"] = False
        report["readiness_reason"] = "Dataset structure is ready, but no audio recordings exist yet (dataset is empty)"
    elif report["positive_total"] == 0:
        report["ready_for_training"] = False
        report["readiness_reason"] = "No positive 'Hey Louie' recordings found"
    elif report["negative_total"] == 0:
        report["ready_for_training"] = False
        report["readiness_reason"] = "No negative recordings found (need similar_phrases, normal_speech, and background_noise)"
    else:
        # Check speaker count for strict speaker-independent split
        num_positive_speakers = sum(1 for count in report["positive"].values() if count > 0)
        missing_negative_cats = [cat for cat, cnt in report["negative"].items() if cnt == 0]

        if missing_negative_cats:
            report["ready_for_training"] = False
            report["readiness_reason"] = f"Missing negative samples in: {', '.join(missing_negative_cats)}"
        elif num_positive_speakers < 3:
            report["ready_for_training"] = False
            report["readiness_reason"] = (
                f"Only {num_positive_speakers} speaker(s) with recordings found in positive/. "
                f"At least 3 distinct human speakers (e.g. speaker_01, speaker_02, speaker_03) "
                f"are required to perform a leak-free speaker-independent Train/Val/Test split."
            )
        else:
            report["ready_for_training"] = True
            report["readiness_reason"] = "Dataset satisfies all validation and speaker-independence requirements"

    return report


def print_summary(report, verbose=False):
    """
    Print the exact required human-readable summary.
    """
    print("=" * 60)
    print("        HEY LOUIE DATASET VALIDATION REPORT")
    print("=" * 60)
    print(f"Dataset Location: {report['dataset_dir']}\n")

    print("Positive:")
    if report["positive"]:
        for speaker, count in report["positive"].items():
            print(f"  {speaker}: {count} files")
    else:
        print("  (no speaker directories found)")
    print(f"  total: {report['positive_total']}\n")

    print("Negative:")
    if report["negative"]:
        for cat in EXPECTED_NEGATIVE_CATEGORIES:
            count = report["negative"].get(cat, 0)
            print(f"  {cat}: {count} files")
    else:
        print("  (no negative categories found)")
    print(f"  total: {report['negative_total']}\n")

    print("-" * 60)
    print(f"Total Valid Audio Files: {report['total_files']}")

    # Report corrupt or invalid files
    if report["corrupt_files"]:
        print(f"\n[!] Corrupted or Unreadable Files ({len(report['corrupt_files'])}):")
        for path, err in report["corrupt_files"]:
            print(f"  - {path}: {err}")

    # Report structural errors
    if report["errors"]:
        print(f"\n[X] Structural Errors ({len(report['errors'])}):")
        for err in report["errors"]:
            print(f"  - {err}")

    # Report warnings if verbose
    if verbose and report["warnings"]:
        print(f"\n[*] Format Warnings ({len(report['warnings'])}):")
        for warn in report["warnings"][:10]:
            print(f"  - {warn}")
        if len(report["warnings"]) > 10:
            print(f"  ... and {len(report['warnings']) - 10} more warnings")

    print("\n" + "=" * 60)
    print("READINESS STATUS:")
    if report["ready_for_training"]:
        print("  STATUS: READY FOR TRAINING")
        print(f"  Details: {report['readiness_reason']}")
    elif report["positive_total"] == 0 and report["negative_total"] == 0 and report["structure_valid"]:
        print("  STATUS: INFRASTRUCTURE READY (Awaiting Audio Recordings)")
        print("  Notice: The directory structure is verified and properly organized.")
        print("          Please record real human 'Hey Louie' samples into 'dataset/positive/speaker_01/'")
        print("          and collect negative audio into 'dataset/negative/' before training.")
    else:
        print("  STATUS: NOT READY FOR TRAINING")
        print(f"  Reason: {report['readiness_reason']}")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Validate Hey Louie Wake-Word Dataset")
    parser.add_argument(
        "--dataset-dir",
        type=str,
        default=str(DEFAULT_DATASET_DIR),
        help="Path to the dataset directory (default: project/dataset)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show detailed audio format warnings (sample rate, channels, bit depth)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with non-zero code if dataset is not ready for training",
    )
    args = parser.parse_args()

    report = validate_dataset(args.dataset_dir, verbose=args.verbose)
    print_summary(report, verbose=args.verbose)

    if not report["structure_valid"] or len(report["corrupt_files"]) > 0:
        sys.exit(1)

    if args.strict and not report["ready_for_training"]:
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
