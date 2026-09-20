import type { Instrument } from '../../entities/music';
import type { SongMetadata } from '../../entities/music/model/types';

export type LibraryItem = {
  album: string;
  audioUrl: string | null;
  metadataUrl: string | null;
  id: string;
  instruments: Partial<Record<Instrument, {
    audioUrl: string | null;
    midiUrl: string | null;
  }>>;
  size: number;
  source?: 'preset' | 'upload';
  title: string;
  updatedAt: string | null;
};

export async function getSongMetadata(url: string | null): Promise<SongMetadata | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Song metadata request failed');
  const value = await response.json();
  const validTimes = (times: unknown): times is number[] => Array.isArray(times)
    && times.every((time, index) => typeof time === 'number' && Number.isFinite(time) && time >= 0 && (index === 0 || time > times[index - 1]));
  if (!value || !validTimes(value.beats) || value.beats.length < 2 || !validTimes(value.downbeats)
    || typeof value.key !== 'string' || !/^[A-G](?:#|b)? (major|minor)$/.test(value.key)
    || typeof value.time_signature !== 'string' || !/^[1-9]\d*\/(1|2|4|8|16|32)$/.test(value.time_signature)
    || !Array.isArray(value.chords) || !value.chords.every((entry: SongMetadata['chords'][number]) => entry
      && Number.isInteger(entry.beat) && entry.beat >= 1 && entry.beat <= value.beats.length
      && Number.isFinite(entry.time) && entry.time >= 0 && typeof entry.chord === 'string' && entry.chord.length > 0)) {
    throw new Error('Invalid song metadata');
  }
  const beats: number[] = value.beats;
  const intervals = beats.slice(1).map((time, index) => time - beats[index]).sort((first, second) => first - second);
  return {
    beats,
    downbeats: value.downbeats,
    bpm: Math.round(60 / intervals[Math.floor(intervals.length / 2)]),
    keySignature: value.key.replace(' ', ':'),
    timeSignature: value.time_signature,
    beatsPerMeasure: Number(value.time_signature.split('/')[0]),
    chords: [...value.chords].sort((first, second) => first.time - second.time),
  };
}

type LibraryResponse = {
  items: LibraryItem[];
  total: number;
};

export async function getLibrary(signal: AbortSignal) {
  const response = await fetch('/api/library', { signal });
  if (!response.ok) throw new Error('Library request failed');
  return response.json() as Promise<LibraryResponse>;
}
