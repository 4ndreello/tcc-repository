import os
import argparse
import numpy as np
from pydub import AudioSegment
from pydub.generators import WhiteNoise, Sine
import random

def add_white_noise(audio, noise_level_db=-20):
    """
    Add white noise to audio.
    
    Args:
        audio: AudioSegment object
        noise_level_db: Noise level in dB (negative value, closer to 0 = louder)
    
    Returns:
        AudioSegment with added noise
    """
    # Generate white noise with same duration as audio
    noise = WhiteNoise().to_audio_segment(duration=len(audio))
    
    # Adjust noise volume
    noise = noise + noise_level_db
    
    # Overlay noise on original audio
    return audio.overlay(noise)

def add_random_sounds(audio, sound_type='sine', num_sounds=5, volume_db=-10):
    """
    Add random sound effects to audio.
    
    Args:
        audio: AudioSegment object
        sound_type: Type of sound ('sine', 'beep', 'click')
        num_sounds: Number of random sounds to add
        volume_db: Volume of sounds in dB (default: -10 for more audible sounds)
    
    Returns:
        AudioSegment with added random sounds
    """
    audio_duration = len(audio)
    result = audio
    
    print(f"  Audio duration: {audio_duration}ms ({audio_duration/1000:.1f}s)")
    
    for i in range(num_sounds):
        # Random position in the audio
        position = random.randint(0, max(0, audio_duration - 1000))
        
        # Generate sound based on type
        if sound_type == 'sine':
            # Random frequency between 300Hz and 1500Hz
            frequency = random.randint(300, 1500)
            # Longer duration for sine waves (300ms to 1500ms)
            duration = random.randint(300, 1500)
            sound = Sine(frequency).to_audio_segment(duration=duration)
            print(f"  Sound {i+1}/{num_sounds}: Sine {frequency}Hz, {duration}ms at {position/1000:.1f}s")
        elif sound_type == 'beep':
            # More audible beep sound (440Hz or 880Hz)
            frequency = random.choice([440, 880, 1000])
            # Longer beeps (400ms to 800ms)
            duration = random.randint(400, 800)
            sound = Sine(frequency).to_audio_segment(duration=duration)
            print(f"  Sound {i+1}/{num_sounds}: Beep {frequency}Hz, {duration}ms at {position/1000:.1f}s")
        else:  # click
            # Audible click (100ms to 200ms)
            duration = random.randint(100, 200)
            sound = WhiteNoise().to_audio_segment(duration=duration)
            print(f"  Sound {i+1}/{num_sounds}: Click {duration}ms at {position/1000:.1f}s")
        
        # Adjust volume (louder for more audible sounds)
        sound = sound + volume_db
        
        # Overlay sound at random position
        result = result.overlay(sound, position=position)
    
    return result

def process_audio_file(input_file, output_file=None, add_noise=True, add_sounds=True, 
                       noise_level=-20, num_sounds=5, sound_type='sine', sound_volume=-10):
    """
    Process audio file by adding noise and/or random sounds.
    
    Args:
        input_file: Path to input MP3 file
        output_file: Path to output file (optional, will auto-generate if None)
        add_noise: Whether to add white noise
        add_sounds: Whether to add random sounds
        noise_level: Noise level in dB
        num_sounds: Number of random sounds to add
        sound_type: Type of random sounds
        sound_volume: Volume of random sounds in dB
    """
    # Check if input file exists
    if not os.path.exists(input_file):
        print(f"ERROR: File '{input_file}' not found!")
        return
    
    # Generate output filename if not provided
    if output_file is None:
        base_name = os.path.splitext(input_file)[0]
        suffix = []
        if add_noise:
            suffix.append('noise')
        if add_sounds:
            suffix.append('sounds')
        suffix_str = '-' + '-'.join(suffix) if suffix else '-processed'
        output_file = f"{base_name}{suffix_str}.mp3"
    
    print(f"Processing: {input_file}")
    print(f"Output: {output_file}")
    
    # Load audio file
    print("Loading audio file...")
    audio = AudioSegment.from_mp3(input_file)
    
    # Add white noise if requested
    if add_noise:
        print(f"Adding white noise (level: {noise_level} dB)...")
        audio = add_white_noise(audio, noise_level)
    
    # Add random sounds if requested
    if add_sounds:
        print(f"Adding {num_sounds} random {sound_type} sounds (volume: {sound_volume} dB)...")
        audio = add_random_sounds(audio, sound_type, num_sounds, sound_volume)
    
    # Export processed audio
    print("Exporting processed audio...")
    audio.export(output_file, format="mp3")
    
    print(f"SUCCESS: Saved to {output_file}")

def main():
    parser = argparse.ArgumentParser(
        description='Add noise and random sounds to MP3 files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Add both noise and sounds
  python add-noise.py input.mp3
  
  # Add only noise
  python add-noise.py input.mp3 --no-sounds
  
  # Add only sounds
  python add-noise.py input.mp3 --no-noise
  
  # Custom output filename
  python add-noise.py input.mp3 -o output.mp3
  
  # Adjust noise level (lower = louder, e.g., -10 is louder than -30)
  python add-noise.py input.mp3 --noise-level -15
  
  # Add more random sounds with different type
  python add-noise.py input.mp3 --num-sounds 10 --sound-type beep
        """)
    
    parser.add_argument('input', help='Input MP3 file')
    parser.add_argument('-o', '--output', help='Output file (default: auto-generated)')
    parser.add_argument('--no-noise', action='store_true', help='Do not add white noise')
    parser.add_argument('--no-sounds', action='store_true', help='Do not add random sounds')
    parser.add_argument('--noise-level', type=int, default=-20, 
                       help='Noise level in dB (default: -20, range: -40 to -5)')
    parser.add_argument('--num-sounds', type=int, default=5,
                       help='Number of random sounds to add (default: 5)')
    parser.add_argument('--sound-type', choices=['sine', 'beep', 'click'], default='sine',
                       help='Type of random sounds (default: sine)')
    parser.add_argument('--sound-volume', type=int, default=-10,
                       help='Volume of random sounds in dB (default: -10, range: -30 to 0)')
    
    args = parser.parse_args()
    
    process_audio_file(
        input_file=args.input,
        output_file=args.output,
        add_noise=not args.no_noise,
        add_sounds=not args.no_sounds,
        noise_level=args.noise_level,
        num_sounds=args.num_sounds,
        sound_type=args.sound_type,
        sound_volume=args.sound_volume
    )

if __name__ == "__main__":
    main()
