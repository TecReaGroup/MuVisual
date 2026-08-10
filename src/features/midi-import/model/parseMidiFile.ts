import { Midi } from '@tonejs/midi';
import type { BeatAnalysis, Hand, Note, TempoPoint } from '../../../entities/music/model/types';

export type MidiVersion = 'original' | 'quantized';

export type MidiVariant = {
  backgroundDelayMs: number;
  bpm: number;
  keySignature: string;
  notes: Note[];
  tempoMap: TempoPoint[];
};

export type ImportedMidi = MidiVariant & {
  audioUrls?: { original: string | null; piano: string | null };
  beatAnalysis?: BeatAnalysis | null;
  defaultMidiVersion?: MidiVersion;
  name: string;
  variants?: Partial<Record<MidiVersion, MidiVariant>>;
};

function parseBackgroundDelayMs(meta: Array<{ text: string; ticks: number; type: string }>) {
  const textEvents = meta
    .filter(event => event.type === 'text')
    .sort((first, second) => first.ticks - second.ticks);

  for (const event of textEvents) {
    try {
      const metadata = JSON.parse(event.text) as {
        delay?: { duration?: unknown; timestamp?: unknown };
      };
      const duration = metadata?.delay?.duration;
      if (metadata?.delay?.timestamp === 0 && typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
        return Math.round(duration * 1000);
      }
    } catch {
      // Other FF 01 events may contain ordinary text rather than JSON metadata.
    }
  }

  return 0;
}

export async function parseMidiFile(file: File): Promise<ImportedMidi | null> {
  const midi = new Midi(await file.arrayBuffer());
  const noteTracks = midi.tracks.filter(track => track.notes.length);
  const ppq = midi.header.ppq;
  const notes = noteTracks.flatMap(track => track.notes.map(note => ({
    pitch: note.midi,
    start: note.time,
    duration: note.duration,
    beat: note.ticks / ppq,
    durationBeats: note.durationTicks / ppq,
    hand: (track.channel % 2 ? 'right' : 'left') as Hand,
  })));
  const midiBpm = midi.header.tempos[0]?.bpm ?? 120;
  const tempoMap = midi.header.tempos.length
    ? midi.header.tempos.map(tempo => ({
      beat: tempo.ticks / ppq,
      time: tempo.time ?? midi.header.ticksToSeconds(tempo.ticks),
      bpm: tempo.bpm,
    }))
    : [{ beat: 0, time: 0, bpm: midiBpm }];
  const midiKey = [...midi.header.keySignatures].sort((first, second) => first.ticks - second.ticks)[0];

  return {
    backgroundDelayMs: parseBackgroundDelayMs(midi.header.meta),
    bpm: Math.round(midiBpm),
    keySignature: midiKey ? `${midiKey.key}:${midiKey.scale}` : 'C:major',
    name: file.name,
    notes,
    tempoMap,
  };
}
