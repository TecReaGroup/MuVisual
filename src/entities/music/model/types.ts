export type Hand = 'left' | 'right';

export type Note = {
  pitch: number;
  /** MIDI note-on velocity, in the 0-127 range. */
  velocity: number;
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

export type BeatAnalysis = {
  beats: number[];
  downbeats: number[];
};

export type SongMetadata = BeatAnalysis & {
  bpm: number;
  keySignature: string;
  timeSignature: string;
  beatsPerMeasure: number;
  chords: Array<{ beat: number; time: number; chord: string }>;
};

export type LabelMode = 'name' | 'number';

export type ViewMode = 'roll' | 'score';

export type AudioSource = 'midi' | 'instrument' | 'original';
export type Instrument = 'piano' | 'other' | 'vocals' | 'bass' | 'drums' | 'guitar';
