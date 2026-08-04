import { Midi } from '@tonejs/midi';
import type { Hand, Note, TempoPoint } from '../../../entities/music/model/types';

export type ImportedMidi = {
  bpm: number;
  keySignature: string;
  name: string;
  notes: Note[];
  tempoMap: TempoPoint[];
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
  if (!notes.length) return null;

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
    bpm: Math.round(midiBpm),
    keySignature: midiKey ? `${midiKey.key}:${midiKey.scale}` : 'C:major',
    name: file.name,
    notes,
    tempoMap,
  };
}
