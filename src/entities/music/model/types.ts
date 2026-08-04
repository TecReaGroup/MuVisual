export type Hand = 'left' | 'right';

export type Note = {
  pitch: number;
  start: number;
  duration: number;
  beat: number;
  durationBeats: number;
  hand: Hand;
};

export type TimedNote = Note & { played?: boolean };

export type TempoPoint = {
  beat: number;
  time: number;
  bpm: number;
};

export type LabelMode = 'name' | 'number';

export type ViewMode = 'roll' | 'score';
