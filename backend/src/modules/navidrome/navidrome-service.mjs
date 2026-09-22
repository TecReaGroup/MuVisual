import { createHash, randomBytes } from 'node:crypto';
import { environment } from '../../config/environment.mjs';
import { limits } from '../../config/constants.mjs';

async function requestNavidrome(endpoint, parameters) {
  const { navidromeUrl, navidromeAccount, navidromePassword } = environment;
  if (!navidromeUrl || !navidromeAccount || !navidromePassword) {
    throw new Error('NAVIDROME_NOT_CONFIGURED');
  }
  const salt = randomBytes(16).toString('hex');
  const token = createHash('md5').update(navidromePassword + salt).digest('hex');
  const url = new URL(`${navidromeUrl.replace(/\/+$/, '')}/rest/${endpoint}.view`);
  url.search = new URLSearchParams({ u: navidromeAccount, t: token, s: salt, v: '1.16.1', c: 'MuVisual', f: 'json', ...parameters }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error('NAVIDROME_REQUEST_FAILED'), { statusCode: response.status, detail: endpoint });
  }
  return response;
}

export async function searchNavidrome(query) {
  const response = await requestNavidrome('search3', { query, songCount: '51', artistCount: '0', albumCount: '0' });
  const payload = (await response.json())['subsonic-response'];
  if (payload?.status !== 'ok') throw Object.assign(new Error('NAVIDROME_REQUEST_FAILED'), { code: payload?.error?.code, detail: 'search3' });
  const songs = (payload.searchResult3?.song ?? []).map(song => ({
    id: song.id,
    title: song.title ?? '',
    album: song.album ?? '',
    artist: song.artist ?? '',
    suffix: song.suffix ?? '',
  }));
  const keyword = query.trim().toLowerCase();
  if (keyword) {
    const matchPriority = song => {
      if (song.title.toLowerCase().includes(keyword)) return 0;
      if (song.album.toLowerCase().includes(keyword)) return 1;
      if (song.artist.toLowerCase().includes(keyword)) return 2;
      return 3;
    };
    songs.sort((first, second) => matchPriority(first) - matchPriority(second));
  }
  return { songs: songs.slice(0, 50), hasMore: songs.length > 50 };
}

export async function downloadNavidromeSong(songId) {
  const response = await requestNavidrome('download', { id: songId });
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  // Subsonic reports authentication and missing-song errors with HTTP 200.
  if (/json|xml|text\/html/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('NAVIDROME_REQUEST_FAILED');
  }
  if (Number(response.headers.get('content-length')) > limits.uploadSize) {
    await response.body?.cancel();
    throw new Error('NAVIDROME_AUDIO_TOO_LARGE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limits.uploadSize) throw new Error('NAVIDROME_AUDIO_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!size) throw new Error('NAVIDROME_REQUEST_FAILED');
  return { audio: Buffer.concat(chunks), contentType };
}
