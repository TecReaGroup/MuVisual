import type { Note, SongMetadata } from '../../../entities/music/model/types';
import type { MusicalTimeline } from '../../../entities/music/lib/musicalTimeline';

export type DrumHit = { key: string; foot: boolean; open?: boolean };
export const drumPitches: Record<number, DrumHit> = {
  35: { key: 'f/4', foot: true }, 36: { key: 'f/4', foot: true },
  37: { key: 'c/5/x2', foot: false }, 38: { key: 'c/5', foot: false }, 40: { key: 'c/5', foot: false },
  41: { key: 'g/4', foot: false }, 43: { key: 'a/4', foot: false },
  45: { key: 'b/4', foot: false }, 47: { key: 'd/5', foot: false },
  48: { key: 'e/5', foot: false }, 50: { key: 'f/5', foot: false },
  42: { key: 'g/5/x2', foot: false }, 44: { key: 'd/4/x2', foot: true },
  46: { key: 'g/5/x2', foot: false, open: true },
  49: { key: 'a/5/x2', foot: false }, 57: { key: 'a/5/x2', foot: false },
  51: { key: 'f/5/x2', foot: false }, 59: { key: 'f/5/x2', foot: false },
  52: { key: 'b/5/x2', foot: false }, 55: { key: 'a/5/d2', foot: false },
  53: { key: 'f/5/d2', foot: false }, 56: { key: 'e/5/t2', foot: false },
};
export type DrumCell = { step: number; length: number; hits: DrumHit[] };

export function createDrumScore(notes: Note[], timeline: MusicalTimeline, metadata?: SongMetadata | null) {
  const signature = /^(\d+)\/(4|8)$/.exec(metadata?.timeSignature ?? '4/4');
  const numerator = signature && +signature[1] > 0 && +signature[1] <= 12 ? +signature[1] : 4;
  const denominator = signature ? +signature[2] : 4;
  const measureSteps = numerator * 32 / denominator;
  const groupSteps = denominator === 8 ? (numerator % 3 === 0 ? 12 : 4) : 8;
  // The shared timeline counts detected pulses; metadata gives pulses per bar.
  const pulses = metadata?.beatsPerMeasure && metadata.beatsPerMeasure > 0 ? metadata.beatsPerMeasure : numerator * 4 / denominator;
  const stepsPerPulse = measureSteps / pulses;
  const onsets = new Map<number, DrumHit[]>();
  const unsupported = new Set<number>();
  let lastStep = 0;
  for (const note of notes) {
    const step = Math.max(0, Math.round(timeline.positionAt(note.start) * stepsPerPulse));
    lastStep = Math.max(lastStep, step);
    const hit = drumPitches[note.pitch];
    if (!hit) { unsupported.add(note.pitch); continue; }
    const chord = onsets.get(step) ?? [];
    if (!chord.some(existing => existing.key === hit.key && existing.open === hit.open)) chord.push(hit);
    onsets.set(step, chord);
  }
  const measures = Array.from({ length: Math.floor(lastStep / measureSteps) + 1 }, (_, measure) => {
    return [false, true].map(foot => {
      const cells: DrumCell[] = [];
      for (let group = 0; group < measureSteps; group += groupSteps) {
        const end = Math.min(measureSteps, group + groupSteps);
        let step = group;
        while (step < end) {
          const hits = (onsets.get(measure * measureSteps + step) ?? []).filter(hit => hit.foot === foot);
          let next = step + 1;
          while (next < end && !(onsets.get(measure * measureSteps + next) ?? []).some(hit => hit.foot === foot)) next++;
          // Dotted values start at the corresponding metric boundary. In
          // particular, a dotted sixteenth must not conceal an eighth boundary.
          const offset = step - group;
          const length = [12, 8, 6, 4, 3, 2, 1].find(value => value <= next - step &&
            (value === 12 || value === 6 ? offset === 0 : value === 3 ? offset % 4 === 0 : offset % value === 0))!;
          cells.push({ step, length, hits });
          step += length;
        }
      }
      return cells;
    });
  });
  return { measures, numerator, denominator, measureSteps, groupSteps, stepsPerPulse, unsupported: [...unsupported] };
}
