const LETTERS = 'CDEFGAB';
const NATURAL_PITCHES = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

function spelledPitch(noteName: string) {
  const letter = LETTERS.indexOf(noteName[0]);
  const alteration = [...noteName.slice(1)].reduce((sum, symbol) => sum + (symbol === '#' ? 1 : -1), 0);
  return { letter, pitch: NATURAL_PITCHES[letter] + alteration };
}

function chordDegree(noteName: string, tonicName: string) {
  const note = spelledPitch(noteName);
  const tonic = spelledPitch(tonicName);
  const degree = (note.letter - tonic.letter + 7) % 7;
  // Preserve the written letter: C-sharp and D-flat have different harmonic degrees.
  const alteration = ((note.pitch - tonic.pitch - MAJOR_INTERVALS[degree]) % 12 + 18) % 12 - 6;
  return `${alteration < 0 ? '♭'.repeat(-alteration) : '♯'.repeat(alteration)}${degree + 1}`;
}

export function numberForChord(chord: string, keySignature: string) {
  const normalized = chord.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const tonicName = keySignature.split(':')[0].replace(/♯/g, '#').replace(/♭/g, 'b');
  const parsed = /^([A-G][#b]{0,2})([^/]*?)(?:\/([A-G][#b]{0,2}))?$/.exec(normalized);
  if (!parsed || !/^[A-G][#b]{0,2}$/.test(tonicName)) return null;
  const [, root, suffix, bass] = parsed;
  const quality = suffix.replace(/^:/, '')
    .replace(/^major/, 'maj').replace(/^minor/, 'm').replace(/^min/, 'm')
    .replace(/^M(?=\d|$)/, 'maj').replace(/^-/, 'm');
  const standardQuality = quality === 'maj' ? '' : quality;
  const qualityMatch = /^(maj|m|dim|aug|sus|add|[+°øΔ])?(.*)$/.exec(standardQuality)!;
  const symbol = qualityMatch[1] ?? '';
  const extension = qualityMatch[2].replace(/#/g, '♯').replace(/b/g, '♭');
  return {
    root: chordDegree(root, tonicName),
    quality: symbol,
    extension,
    bass: bass ? chordDegree(bass, tonicName) : '',
  };
}
