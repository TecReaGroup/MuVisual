import { PITCH_NAMES } from '../../../entities/music/lib/pitch';

const CHORDS = [
  { intervals: [0, 4, 7, 11], suffix: 'maj7' },
  { intervals: [0, 3, 7, 10], suffix: 'm7' },
  { intervals: [0, 4, 7, 10], suffix: '7' },
  { intervals: [0, 3, 6, 10], suffix: 'm7b5' },
  { intervals: [0, 3, 6, 9], suffix: 'dim7' },
  { intervals: [0, 4, 7, 9], suffix: '6' },
  { intervals: [0, 3, 7, 9], suffix: 'm6' },
  { intervals: [0, 2, 4, 7], suffix: 'add9' },
  { intervals: [0, 2, 3, 7], suffix: 'madd9' },
  { intervals: [0, 4, 7], suffix: '' },
  { intervals: [0, 3, 7], suffix: 'm' },
  { intervals: [0, 3, 6], suffix: 'dim' },
  { intervals: [0, 4, 8], suffix: 'aug' },
  { intervals: [0, 2, 7], suffix: 'sus2' },
  { intervals: [0, 5, 7], suffix: 'sus4' },
] as const;

export function recognizeChord(activePitches: Set<number>): string | null {
  const pitchClasses = [...new Set([...activePitches].map(pitch => pitch % 12))].sort((a, b) => a - b);
  if (pitchClasses.length < 3) return null;
  const bass = Math.min(...activePitches) % 12;

  for (const root of pitchClasses) {
    const intervals = pitchClasses.map(note => (note - root + 12) % 12).sort((a, b) => a - b);
    const match = CHORDS.find(chord =>
      chord.intervals.length === intervals.length
      && chord.intervals.every((interval, index) => interval === intervals[index]));
    if (match) return `${PITCH_NAMES[root]}${match.suffix}${bass === root ? '' : `/${PITCH_NAMES[bass]}`}`;
  }
  return null;
}
