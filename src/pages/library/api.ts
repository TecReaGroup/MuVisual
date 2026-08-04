export type LibraryItem = {
  album: string;
  audioUrl: string | null;
  id: string;
  midiUrl: string | null;
  pianoUrl: string | null;
  size: number;
  title: string;
  updatedAt: string | null;
};

type LibraryResponse = {
  items: LibraryItem[];
  total: number;
};

export async function getLibrary(signal: AbortSignal) {
  const response = await fetch('/api/library', { signal });
  if (!response.ok) throw new Error('Library request failed');
  return response.json() as Promise<LibraryResponse>;
}
