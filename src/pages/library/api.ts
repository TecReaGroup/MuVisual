import type { Instrument } from '../../entities/music';

export type LibraryItem = {
  album: string;
  audioUrl: string | null;
  beatUrl: string | null;
  id: string;
  instruments: Partial<Record<Instrument, {
    audioUrl: string | null;
    midiUrl: string | null;
  }>>;
  size: number;
  title: string;
  updatedAt: string | null;
};

export async function getBeatAnalysis(url: string | null) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const value = await response.json() as { beats?: unknown; downbeats?: unknown };
  if (!Array.isArray(value.beats) || !Array.isArray(value.downbeats)) return null;
  const beats = value.beats.filter((time): time is number => typeof time === 'number' && Number.isFinite(time));
  const downbeats = value.downbeats.filter((time): time is number => typeof time === 'number' && Number.isFinite(time));
  return beats.length >= 2 ? { beats, downbeats } : null;
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
