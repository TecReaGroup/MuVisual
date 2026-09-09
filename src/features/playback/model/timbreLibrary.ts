import { DrumMachine, Soundfont, type DrumMachineOptions, type Storage } from 'smplr';
import type { Instrument } from '../../../entities/music/model/types';

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

// GM percussion 35-81. Missing TR-808 voices use the closest available family.
const GM_DRUM_SAMPLES = [
  'kick', 'kick', 'rimshot', 'snare', 'clap', 'snare',
  'tom-low', 'hihat-close', 'tom-low', 'hihat-close', 'mid-tom', 'hihat-open',
  'mid-tom', 'tom-hi', 'cymbal', 'tom-hi', 'cymbal', 'cymbal', 'cowbell',
  'hihat-close', 'cymbal', 'cowbell', 'cymbal', 'clave', 'cymbal',
  'conga-hi', 'conga-low', 'conga-hi', 'conga-hi', 'conga-low',
  'tom-hi', 'tom-low', 'cowbell', 'cowbell', 'maraca', 'maraca',
  'clave', 'clave', 'maraca', 'maraca', 'clave', 'clave', 'clave',
  'conga-hi', 'conga-low', 'cowbell', 'cowbell',
] as const;

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
    const options = { destination, storage: sampleStorage, disableScheduler: true };
    if (source === 'TR-808') {
      const baseUrl = `${import.meta.env.BASE_URL}sample-library/TR-808-v1`;
      const manifest: unknown = await (await sampleStorage.fetch(`${baseUrl}/dm.json`)).json();
      if (!manifest || typeof manifest !== 'object' || !('samples' in manifest)
        || !Array.isArray(manifest.samples) || !manifest.samples.length
        || !manifest.samples.every((sample: unknown) => typeof sample === 'string')) {
        throw new Error('Invalid TR-808 sample manifest');
      }
      // Supplying the manifest avoids smplr's unhandled secondary promise on fetch failure.
      const instrument: Exclude<DrumMachineOptions['instrument'], string | undefined> = {
        baseUrl, name: source, samples: manifest.samples, sampleNames: [],
        nameToSample: {}, sampleNameVariations: {},
      };
      for (const sample of instrument.samples) {
        const name = sample.includes('/') ? sample : sample.replace('-', '/');
        const [family] = name.split('/');
        instrument.nameToSample[name] = name;
        instrument.nameToSample[family] ??= name;
        if (!instrument.sampleNames.includes(family)) instrument.sampleNames.push(family);
        (instrument.sampleNameVariations[family] ??= []).push(name);
      }
      if (GM_DRUM_SAMPLES.some(name => !instrument.nameToSample[name])) {
        throw new Error('TR-808 manifest is missing required percussion samples');
      }
      const drums = new DrumMachine(context, { ...options, instrument });
      try {
        await drums.load;
      } catch (error) {
        drums.output.disconnect();
        throw error;
      }
      return {
        start: ({ note, duration: _duration, ...hit }) => {
          const sample = GM_DRUM_SAMPLES[note - 35];
          if (!sample) {
            hit.onEnded();
            return () => undefined;
          }
          // Percussion plays its natural tail; transport stop still cancels the hit.
          return drums.start({ ...hit, note: sample });
        },
      };
    }
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
    return { start: note => soundfont.start(note) };
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
