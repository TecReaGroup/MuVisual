import { CacheStorage, HttpStorage, LAYERS, Soundfont, SplendidGrandPiano } from 'smplr';

export type TimbreId = 'piano' | 'string';
export type TimbreStart = { note: number; time: number; duration: number; velocity: number; decayTime?: number; onEnded?: () => void };
type StopFn = (time?: number) => void;
export type TimbrePlayer = SplendidGrandPiano | Soundfont;
export type TimbreDefinition = {
  player: TimbrePlayer;
  velocity: (volume: number) => number;
  start: (note: TimbreStart) => StopFn;
};

const PIANO_CACHE_NAME = 'muvisual-piano-v1';
const PIANO_BASE_URL = `${import.meta.env.BASE_URL}audio/splendid-grand-piano`;
const PIANO_VELOCITY_RANGE: [number, number] = [68, 84];
const STRING_INSTRUMENT = 'string_ensemble_1';
const STRING_INSTRUMENT_URL = `${import.meta.env.BASE_URL}audio/soundfonts/string_ensemble_1-mp3.js`;

const pianoLayer = LAYERS.find(layer => (
  layer.vel_range[0] === PIANO_VELOCITY_RANGE[0]
  && layer.vel_range[1] === PIANO_VELOCITY_RANGE[1]
));
const pianoNotes = (pianoLayer?.samples ?? [])
  .filter(([, name]) => !String(name).includes('#'))
  .filter((_, index, samples) => index % 2 === 0 || index === samples.length - 1)
  .map(([note]) => Number(note));

export type TimbreLibrary = {
  definitions: Record<TimbreId, TimbreDefinition>;
  load: Promise<boolean>;
};

export function createTimbreLibrary(context: AudioContext, destinations: Record<TimbreId, AudioNode>): TimbreLibrary {
  const piano = new SplendidGrandPiano(context, {
    baseUrl: PIANO_BASE_URL,
    destination: destinations.piano,
    storage: new CacheStorage(PIANO_CACHE_NAME),
    notesToLoad: { notes: pianoNotes, velocityRange: PIANO_VELOCITY_RANGE },
  });
  const string = new Soundfont(context, {
    instrument: STRING_INSTRUMENT,
    instrumentUrl: STRING_INSTRUMENT_URL,
    destination: destinations.string,
    storage: HttpStorage,
  });
  const pianoDefinition: TimbreDefinition = {
    player: piano,
    velocity: volume => Math.round(PIANO_VELOCITY_RANGE[0] + (PIANO_VELOCITY_RANGE[1] - PIANO_VELOCITY_RANGE[0]) * volume / 100),
    start: note => piano.start({ ...note, decayTime: Math.max(0.025, Math.min(0.18, note.duration * 0.4)) }),
  };
  const stringDefinition: TimbreDefinition = {
    player: string,
    velocity: volume => Math.round(32 + 95 * volume / 100),
    start: note => string.start(note),
  };
  return {
    definitions: { piano: pianoDefinition, string: stringDefinition },
    load: Promise.all([piano.load, string.load]).then(() => true),
  };
}
