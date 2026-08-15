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
const SAMPLE_END_MARGIN_SECONDS = 0.05;
const LONG_NOTE_RELEASE_MIN_SECONDS = 0.35;
const LONG_NOTE_RELEASE_MAX_SECONDS = 1.2;
const STRING_INSTRUMENT = 'string_ensemble_1';
const STRING_INSTRUMENT_URL = `${import.meta.env.BASE_URL}audio/soundfonts/string_ensemble_1-mp3.js`;
const STRING_SAMPLE_DURATION_SECONDS = 3.186;
const STRING_LOWEST_SAMPLE_PITCH = 21;
const STRING_HIGHEST_SAMPLE_PITCH = 108;

const pianoLayer = LAYERS.find(layer => (
  layer.vel_range[0] === PIANO_VELOCITY_RANGE[0]
  && layer.vel_range[1] === PIANO_VELOCITY_RANGE[1]
));
const pianoNotes = (pianoLayer?.samples ?? [])
  .filter(([, name]) => !String(name).includes('#'))
  .filter((_, index, samples) => index % 2 === 0 || index === samples.length - 1)
  .map(([note]) => Number(note));

function pianoPlaybackEnvelope(piano: SplendidGrandPiano, note: TimbreStart) {
  if (!pianoLayer) return note;

  let offset = 0;
  while (!piano.buffers[`${pianoLayer.name}${note.note + offset}`] && Math.abs(offset) < 127) {
    offset = offset > 0 ? -offset : 1 - offset;
  }
  const buffer = piano.buffers[`${pianoLayer.name}${note.note + offset}`];
  if (!buffer) return note;

  const detuneCents = -offset * 100;
  const playbackDuration = buffer.duration / Math.pow(2, detuneCents / 1200);
  const defaultRelease = Math.max(0.025, Math.min(0.18, note.duration * 0.4));
  if (note.duration + defaultRelease + SAMPLE_END_MARGIN_SECONDS < playbackDuration) {
    return { ...note, decayTime: defaultRelease };
  }

  const release = Math.min(
    LONG_NOTE_RELEASE_MAX_SECONDS,
    Math.max(LONG_NOTE_RELEASE_MIN_SECONDS, playbackDuration * 0.28),
  );
  return {
    ...note,
    duration: Math.max(0.05, playbackDuration - release - SAMPLE_END_MARGIN_SECONDS),
    decayTime: release,
  };
}

function stringPlaybackEnvelope(note: TimbreStart) {
  const samplePitch = Math.max(STRING_LOWEST_SAMPLE_PITCH, Math.min(STRING_HIGHEST_SAMPLE_PITCH, note.note));
  const detuneCents = (note.note - samplePitch) * 100;
  const playbackDuration = STRING_SAMPLE_DURATION_SECONDS / Math.pow(2, detuneCents / 1200);
  const defaultRelease = 0.2;
  if (note.duration + defaultRelease + SAMPLE_END_MARGIN_SECONDS < playbackDuration) {
    return note;
  }

  const release = Math.min(
    LONG_NOTE_RELEASE_MAX_SECONDS,
    Math.max(LONG_NOTE_RELEASE_MIN_SECONDS, playbackDuration * 0.28),
  );
  return {
    ...note,
    duration: Math.max(0.05, playbackDuration - release - SAMPLE_END_MARGIN_SECONDS),
    decayTime: release,
  };
}

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
    start: note => piano.start(pianoPlaybackEnvelope(piano, note)),
  };
  const stringDefinition: TimbreDefinition = {
    player: string,
    velocity: volume => Math.round(32 + 95 * volume / 100),
    start: note => string.start(stringPlaybackEnvelope(note)),
  };
  return {
    definitions: { piano: pianoDefinition, string: stringDefinition },
    load: Promise.all([piano.load, string.load]).then(() => true),
  };
}
