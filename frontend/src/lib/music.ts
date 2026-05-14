export const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export function midiToFreq(midi: number): number {
  // https://www.phys.unsw.edu.au/jw/notes.html
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function parseNoteToMidi(note: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!m) return null;
  const key = m[1].toUpperCase() + m[2];
  const pc = NOTE_TO_PC[key];
  if (pc === undefined) return null;
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

export const truemod = (n: number, m: number) => ((n % m) + m) % m;
