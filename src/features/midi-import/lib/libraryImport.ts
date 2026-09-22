import { importAudio } from './audioImport';
import { supportsAudioMetadata } from './audioMetadata';
import { log, serializeError } from '../../../shared/lib/logger';

export type NavidromeSong = { id: string; title: string; album: string; artist: string; suffix: string };

export async function searchLibrarySongs(query: string, signal: AbortSignal): Promise<{ songs: NavidromeSong[]; hasMore: boolean }> {
  const startedAt = performance.now();
  const endpoint = '/api/navidrome/search';
  let response: Response | undefined;
  log('debug', 'Navidrome', '开始加载曲目', { endpoint, method: 'GET' });
  try {
    response = await fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`, { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'NAVIDROME_REQUEST_FAILED');
    if (typeof payload.hasMore !== 'boolean' || !Array.isArray(payload.songs) || !payload.songs.every((song: NavidromeSong) => song
      && ['id', 'title', 'album', 'artist', 'suffix'].every(key => typeof song[key as keyof NavidromeSong] === 'string'))) {
      throw new Error('Invalid Navidrome search response');
    }
    log('debug', 'Navidrome', '曲目加载完成', { endpoint, statusCode: response.status, requestId: response.headers.get('X-Request-Id'), durationMs: Math.round(performance.now() - startedAt), count: payload.songs.length });
    return { songs: payload.songs, hasMore: payload.hasMore };
  } catch (error) {
    log(signal.aborted ? 'debug' : 'error', 'Navidrome', signal.aborted ? '曲目请求已取消' : '曲目加载失败', {
      ...(!signal.aborted ? serializeError(error) : {}), endpoint, method: 'GET', statusCode: response?.status,
      requestId: response?.headers.get('X-Request-Id'), contentType: response?.headers.get('Content-Type'), durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

export async function importLibrarySong(song: NavidromeSong): Promise<unknown> {
  const title = song.title.trim();
  const album = song.album.trim();
  if (!title || !album) {
    throw Object.assign(new Error('Song title and album are required'), { code: 'AUDIO_METADATA_REQUIRED' });
  }
  const filename = `${title}.${song.suffix}`;
  if (!supportsAudioMetadata(new File([], filename))) {
    throw Object.assign(new Error('Unsupported audio format'), { code: 'AUDIO_FORMAT_UNSUPPORTED' });
  }
  let audio: Blob;
  try {
    const response = await fetch(`/api/navidrome/songs/${encodeURIComponent(song.id)}/download`);
    if (!response.ok) throw Object.assign(new Error('Library download failed'), { statusCode: response.status, requestId: response.headers.get('X-Request-Id') });
    audio = await response.blob();
  } catch (cause) {
    throw Object.assign(new Error('Library download failed'), {
      cause, code: 'LIBRARY_DOWNLOAD_FAILED',
      ...(cause instanceof Error ? { statusCode: (cause as Error & { statusCode?: number }).statusCode, requestId: (cause as Error & { requestId?: string }).requestId } : {}),
    });
  }
  return importAudio(new File([audio], filename, { type: audio.type }), title, album);
}
