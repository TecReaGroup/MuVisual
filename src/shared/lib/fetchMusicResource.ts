const MUSIC_CACHE_NAME = 'muvisual-studio-audio-v1';
const MUSIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MUSIC_CACHE_TIME_HEADER = 'x-muvisual-cached-at';

export async function fetchMusicResource(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const request = new Request(url, { credentials: 'same-origin' });
  let cache: Cache | null = null;

  if ('caches' in window) {
    try {
      cache = await caches.open(MUSIC_CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        const cachedAt = Number(cached.headers.get(MUSIC_CACHE_TIME_HEADER));
        if (Number.isFinite(cachedAt) && Date.now() - cachedAt < MUSIC_CACHE_TTL_MS) {
          const resourceBytes = await cached.arrayBuffer();
          signal.throwIfAborted();
          return resourceBytes;
        }
        signal.throwIfAborted();
        await cache.delete(request);
      }
    } catch {
      signal.throwIfAborted();
      cache = null;
    }
  }

  signal.throwIfAborted();
  const response = await fetch(request, { signal });
  if (!response.ok) throw new Error(`Unable to load music resource: ${url}`);
  const resourceBytes = await response.arrayBuffer();
  signal.throwIfAborted();

  if (cache) {
    try {
      const headers = new Headers(response.headers);
      headers.set(MUSIC_CACHE_TIME_HEADER, String(Date.now()));
      await cache.put(request, new Response(resourceBytes.slice(0), {
        status: response.status,
        statusText: response.statusText,
        headers,
      }));
    } catch {
      // Playback can continue when persistent browser caching is unavailable.
    }
  }

  signal.throwIfAborted();
  return resourceBytes;
}
