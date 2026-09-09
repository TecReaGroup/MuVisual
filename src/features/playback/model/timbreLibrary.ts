import { Soundfont, type Storage } from 'smplr';
import type { Instrument } from '../../../entities/music/model/types';
import { loadDrumKit } from './drumKit';

const TIMBRE_SOURCES = {
  piano: 'acoustic_grand_piano',
  bass: 'electric_bass_finger',
  guitar: 'electric_guitar_clean',
  other: 'string_ensemble_1',
  vocals: 'string_ensemble_1',
  drums: 'TR-808',
} as const satisfies Record<Instrument, string>;

type TimbreSource = typeof TIMBRE_SOURCES[Instrument];
type TimbreStart = { note: number; time: number; duration: number; velocity: number; onEnded: () => void };
type TimbreDefinition = { start: (note: TimbreStart) => (time?: number) => void };

// Source trims are independent of note velocity and the user's master volume.
const TIMBRE_TRIM_DB = {
  acoustic_grand_piano: 0,
  electric_bass_finger: 4.5,
  electric_guitar_clean: 0,
  string_ensemble_1: -2,
} as const satisfies Record<Exclude<TimbreSource, 'TR-808'>, number>;

async function validateSampleResponse(response: Response, url: string) {
  if (!response.ok) throw new Error(`Timbre request failed (${response.status}): ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) throw new Error(`Expected audio resource but received HTML: ${url}`);
  if (new URL(url).pathname.endsWith('-mp3.js')) {
    const source = await response.clone().text();
    const header = source.indexOf('MIDI.Soundfont.');
    try {
      if (header < 0) throw new Error('Missing soundfont assignment');
      const start = source.indexOf('=', header) + 2;
      JSON.parse(source.slice(start, source.lastIndexOf(',')) + '}');
    } catch {
      throw new Error(`Invalid soundfont response (${contentType || 'unknown content type'}): ${url}`);
    }
  }
}

const sampleStorage: Storage = {
  async fetch(url) {
    const request = new Request(new URL(url, window.location.href));
    let cache: Cache | undefined;
    try {
      if ('caches' in window) {
        cache = await window.caches.open('muvisual-timbres-v1');
        const cached = await cache.match(request);
        if (cached) {
          try {
            await validateSampleResponse(cached, request.url);
            return cached;
          } catch {
            await cache.delete(request);
          }
        }
      }
    } catch {
      // Private browsing and quota policies must not prevent playback.
      cache = undefined;
    }
    // Bypass HTTP cache on a persistent-cache miss, including invalid cached responses.
    const response = await fetch(request, { cache: 'reload' });
    await validateSampleResponse(response, request.url);
    if (cache) {
      try {
        await cache.put(request, response.clone());
      } catch {
        // Network playback remains available when persistent storage fails.
      }
    }
    return response;
  },
};

export function createTimbreLibrary(context: AudioContext, destination: AudioNode) {
  const definitions = new Map<TimbreSource, TimbreDefinition>();
  const pending = new Map<TimbreSource, Promise<TimbreDefinition>>();

  async function loadSource(source: TimbreSource): Promise<TimbreDefinition> {
    if (source === 'TR-808') return loadDrumKit(context, destination, sampleStorage);
    const options = { destination, storage: sampleStorage, disableScheduler: true };
    const soundfont = new Soundfont(context, {
      ...options,
      instrument: source,
       instrumentUrl: `${import.meta.env.BASE_URL}sample-library/FluidR3_GM-v1/${source}-mp3.js`,
    });
    try {
      await soundfont.load;
    } catch (error) {
      soundfont.disconnect();
      throw error;
    }
    const gainOffset = 10 ** (TIMBRE_TRIM_DB[source] / 20);
    return { start: note => soundfont.start({ ...note, gainOffset }) };
  }

  return {
    get(instrument: Instrument) {
      return definitions.get(TIMBRE_SOURCES[instrument]);
    },
    load(instrument: Instrument): Promise<TimbreDefinition> {
      const source = TIMBRE_SOURCES[instrument];
      const ready = definitions.get(source);
      if (ready) return Promise.resolve(ready);
      const loading = pending.get(source);
      if (loading) return loading;
      const promise = loadSource(source).then(definition => {
        definitions.set(source, definition);
        return definition;
      }).finally(() => pending.delete(source));
      pending.set(source, promise);
      return promise;
    },
  };
}

export type TimbreLibrary = ReturnType<typeof createTimbreLibrary>;
