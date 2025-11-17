import jiwer
import os
from pathlib import Path

# Directory where test files are stored
TEST_DATA_DIR = Path(__file__).parent / "test-data"

def load_text_file(filepath):
    """Load the content of a text file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read().strip()

def get_test_files():
    """List all test file pairs (ref + hypo)."""
    files = sorted(os.listdir(TEST_DATA_DIR))
    
    # Group files by prefix (01_, 02_, 03_)
    test_pairs = []
    prefixes = set()
    
    for file in files:
        if file.endswith('_ref.txt'):
            prefix = file.replace('_ref.txt', '')
            prefixes.add(prefix)
    
    for prefix in sorted(prefixes):
        ref_file = TEST_DATA_DIR / f"{prefix}_ref.txt"
        hypo_file = TEST_DATA_DIR / f"{prefix}_hypo.txt"
        
        if ref_file.exists() and hypo_file.exists():
            test_pairs.append({
                'name': prefix,
                'ref_file': ref_file,
                'hypo_file': hypo_file
            })
    
    return test_pairs

def calculate_wer(reference, hypothesis, test_name):
    """Calculate WER and display detailed results."""
    print(f"\n{'='*60}")
    print(f"TEST: {test_name}")
    print(f"{'='*60}")
    
    # Calculate basic WER
    error_rate = jiwer.wer(reference, hypothesis)
    
    # Get detailed metrics
    result = jiwer.process_words([reference], [hypothesis])
    
    total_words_ref = result.hits + result.substitutions + result.deletions
    
    print(f"\nRESULTS:")
    print(f"  WER (Error Rate):          {error_rate:.2%}")
    print(f"  Hits (Correct):            {result.hits}")
    print(f"  Substitutions:             {result.substitutions}")
    print(f"  Deletions:                 {result.deletions}")
    print(f"  Insertions:                {result.insertions}")
    print(f"  Total reference words:     {total_words_ref}")
    print(f"\n{'='*60}\n")
    
    return {
        'name': test_name,
        'wer': error_rate,
        'hits': result.hits,
        'substitutions': result.substitutions,
        'deletions': result.deletions,
        'insertions': result.insertions,
        'total_words': total_words_ref
    }

def main():
    """Main function that processes all tests."""
    print("\nWER CALCULATOR - MULTIPLE TESTS\n")
    
    # Check if directory exists
    if not TEST_DATA_DIR.exists():
        print(f"ERROR: Directory {TEST_DATA_DIR} not found!")
        return
    
    # Get test files
    test_pairs = get_test_files()
    
    if not test_pairs:
        print(f"ERROR: No test file pairs found in {TEST_DATA_DIR}")
        print("   Make sure you have files in the format: XX_name_ref.txt and XX_name_hypo.txt")
        return
    
    print(f"Found {len(test_pairs)} test(s):\n")
    for pair in test_pairs:
        print(f"  - {pair['name']}")
    
    # Process each test
    results = []
    for pair in test_pairs:
        try:
            reference = load_text_file(pair['ref_file'])
            hypothesis = load_text_file(pair['hypo_file'])
            
            if not reference or not hypothesis:
                print(f"\nWARNING: {pair['name']} - empty file(s), skipping...")
                continue
            
            result = calculate_wer(reference, hypothesis, pair['name'])
            results.append(result)
            
        except Exception as e:
            print(f"\nERROR processing {pair['name']}: {e}")
    
    # Final summary
    if results:
        print("\n" + "="*60)
        print("OVERALL SUMMARY")
        print("="*60)
        for r in results:
            print(f"{r['name']:20} | WER: {r['wer']:.2%} | Words: {r['total_words']}")
        print("="*60 + "\n")

if __name__ == "__main__":
    main()
