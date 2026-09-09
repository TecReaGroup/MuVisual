import { Midi } from '@tonejs/midi';
import type { BeatAnalysis, Hand, Instrument, Note, SongMetadata, TempoPoint } from '../../../entities/music/model/types';

export type MidiVariant = {
  backgroundDelayMs: number;
  bpm: number;
  keySignature: string;
  notes: Note[];
  tempoMap: TempoPoint[];
};

export type ImportedMidi = MidiVariant & {
  audioUrls?: { original: string | null; instrument: string | null };
  beatAnalysis?: BeatAnalysis | null;
  metadata?: SongMetadata | null;
  defaultInstrument?: Instrument;
  instruments?: Partial<Record<Instrument, { audioUrl: string | null; midiUrl?: string | null; midi: MidiVariant | null }>>;
  name: string;
};

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
  return {
    backgroundDelayMs: 0,
    bpm: 120,
    keySignature: 'C:major',
    name: file.name,
    notes,
    tempoMap: [],
  };
}
