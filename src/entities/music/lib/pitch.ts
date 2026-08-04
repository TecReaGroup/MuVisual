export const START_MIDI = 21;
export const END_MIDI = 108;

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const KEY_ROOTS: Record<string, number> = {
  C: 0, G: 7, D: 2, A: 9, E: 4, B: 11, F: 5,
  'F#': 6, 'C#': 1, Gb: 6, Db: 1, Ab: 8, Eb: 3, Bb: 10, Cb: 11,
};

export const KEY_SIGNATURE_OPTIONS = [
  'Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
].flatMap(key => [
  { value: `${key}:major`, label: `${key} major` },
  { value: `${key}:minor`, label: `${key} minor` },
]);

export const isWhitePitch = (pitch: number) => [0, 2, 4, 5, 7, 9, 11].includes(pitch % 12);

function parseKey(keySignature: string) {
  const [name = 'C', scale = 'major'] = keySignature.split(':');
  return { name, root: KEY_ROOTS[name] ?? 0, scale };
}

export function numberForPitch(pitch: number, keySignature: string) {
  const { name, root, scale } = parseKey(keySignature);
  const intervals = scale === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const relative = (pitch - 60 - root + 120) % 12;
  let degree = intervals.indexOf(relative);
  let accidental = '';

  if (degree < 0) {
    const preferFlat = name.includes('b') || ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].includes(name);
    const candidates = intervals.flatMap((interval, index) => [
      { index, offset: relative - interval },
      { index, offset: relative - interval - 12 },
      { index, offset: relative - interval + 12 },
    ]).filter(candidate => Math.abs(candidate.offset) === 1);
    const chosen = candidates.find(candidate => preferFlat ? candidate.offset < 0 : candidate.offset > 0) ?? candidates[0];
    degree = chosen?.index ?? 0;
    accidental = chosen?.offset && chosen.offset < 0 ? 'b' : '#';
  }

  const octave = Math.max(-2, Math.min(2, Math.floor((pitch - (60 + root)) / 12)));
  return { text: `${accidental}${degree + 1}`, octave };
}
