import type { BeatAnalysis } from '../model/types';

export type BeatGridLine = {
  downbeat: boolean;
  subdivision: number;
  time: number;
};

export type MusicalTimeline = {
  gridLines: (startTime: number, endTime: number, subdivisions?: number) => BeatGridLine[];
  positionAt: (time: number) => number;
  timeAt: (position: number) => number;
};

function lowerBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearestIndex(values: number[], target: number) {
  const after = lowerBound(values, target);
  if (after <= 0) return 0;
  if (after >= values.length) return values.length - 1;
  return target - values[after - 1] <= values[after] - target ? after - 1 : after;
}

function normalizedRemainder(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

export function createMusicalTimeline(
  bpm: number,
  gridDelay: number,
  analysis: BeatAnalysis | null,
): MusicalTimeline {
  const analyzedBeats = analysis?.beats
    .filter((time, index, values) => Number.isFinite(time) && (index === 0 || time > values[index - 1])) ?? [];
  const usesAnalysis = analyzedBeats.length >= 2;
  const uniformInterval = 60 / Math.max(1, bpm);
  const beatTimes = usesAnalysis ? analyzedBeats : [gridDelay / 1000, gridDelay / 1000 + uniformInterval];
  const downbeatIndices = new Set<number>();

  if (usesAnalysis) {
    analysis?.downbeats.forEach(time => {
      if (!Number.isFinite(time)) return;
      const index = nearestIndex(beatTimes, time);
      const localInterval = index + 1 < beatTimes.length
        ? beatTimes[index + 1] - beatTimes[index]
        : beatTimes[index] - beatTimes[index - 1];
      if (Math.abs(beatTimes[index] - time) <= localInterval / 3) downbeatIndices.add(index);
    });
  }

  const firstDownbeat = usesAnalysis && downbeatIndices.size
    ? Math.min(...downbeatIndices)
    : 0;

  const rawPositionAt = (time: number) => {
    const after = lowerBound(beatTimes, time);
    if (after === 0) return (time - beatTimes[0]) / (beatTimes[1] - beatTimes[0]);
    if (after === beatTimes.length) {
      const last = beatTimes.length - 1;
      return last + (time - beatTimes[last]) / (beatTimes[last] - beatTimes[last - 1]);
    }
    const before = after - 1;
    return before + (time - beatTimes[before]) / (beatTimes[after] - beatTimes[before]);
  };

  const rawTimeAt = (position: number) => {
    const before = Math.floor(position);
    const fraction = position - before;
    if (before < 0) return beatTimes[0] + position * (beatTimes[1] - beatTimes[0]);
    if (before >= beatTimes.length - 1) {
      const last = beatTimes.length - 1;
      return beatTimes[last] + (position - last) * (beatTimes[last] - beatTimes[last - 1]);
    }
    return beatTimes[before] + fraction * (beatTimes[before + 1] - beatTimes[before]);
  };

  const positionAt = (time: number) => rawPositionAt(time) - firstDownbeat;
  const timeAt = (position: number) => rawTimeAt(position + firstDownbeat);
  const isDownbeat = (beat: number) => usesAnalysis
    ? downbeatIndices.has(beat + firstDownbeat)
    : normalizedRemainder(beat, 4) === 0;

  return {
    positionAt,
    timeAt,
    gridLines(startTime, endTime, subdivisions = 4) {
      const safeSubdivisions = Math.max(1, Math.round(subdivisions));
      const firstStep = Math.floor(positionAt(startTime) * safeSubdivisions) - 1;
      const lastStep = Math.ceil(positionAt(endTime) * safeSubdivisions) + 1;
      const lines: BeatGridLine[] = [];
      for (let step = firstStep; step <= lastStep; step += 1) {
        const subdivision = normalizedRemainder(step, safeSubdivisions);
        const beat = Math.floor(step / safeSubdivisions);
        const time = timeAt(step / safeSubdivisions);
        if (time < startTime || time > endTime) continue;
        lines.push({
          downbeat: subdivision === 0 && isDownbeat(beat),
          subdivision,
          time,
        });
      }
      return lines;
    },
  };
}
