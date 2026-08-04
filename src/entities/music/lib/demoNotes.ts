import type { Note } from '../model/types';

export function createDemoNotes(): Note[] {
  const chords = [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 59]];
  const notes: Note[] = [];

  for (let index = 0; index < 12; index += 1) {
    const chord = chords[index % chords.length];
    const time = 1 + index * 2;
    chord.forEach((pitch, chordIndex) => notes.push({
      pitch,
      start: time + chordIndex * 0.05,
      duration: 1.8,
      beat: (time + chordIndex * 0.05) * 92 / 60,
      durationBeats: 1.8 * 92 / 60,
      hand: 'left',
    }));
    [chord[3] + 12, chord[2] + 12, chord[3] + 12, chord[1] + 12].forEach((pitch, chordIndex) => notes.push({
      pitch,
      start: time + chordIndex * 0.5,
      duration: 0.38,
      beat: (time + chordIndex * 0.5) * 92 / 60,
      durationBeats: 0.38 * 92 / 60,
      hand: 'right',
    }));
  }

  return notes;
}
