const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Convert a frequency in Hz to equal-tempered note data relative to A4 = 440 Hz.
 */
export function frequencyToNoteData(frequency) {
  if (!frequency || frequency <= 0) {
    return null;
  }

  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearestMidi = Math.round(midi);
  const noteIndex = (nearestMidi + 1200) % 12; // ensure positive
  const octave = Math.floor(nearestMidi / 12) - 1;
  const noteName = `${NOTE_NAMES[noteIndex]}${octave}`;
  const equalFrequency = 440 * Math.pow(2, (nearestMidi - 69) / 12);
  const cents = 1200 * Math.log2(frequency / equalFrequency);

  return {
    frequency,
    midi,
    nearestMidi,
    cents,
    equalFrequency,
    noteName,
  };
}

export function formatFrequency(frequency) {
  return `${frequency.toFixed(1)} Hz`;
}

export function formatCents(cents) {
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents.toFixed(1)} ¢`;
}
