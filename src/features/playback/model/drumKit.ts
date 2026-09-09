import { DrumMachine, type DrumMachineOptions, type Storage } from 'smplr';

type DrumHit = { note: number; time: number; velocity: number; onEnded: () => void };

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

const DRUM_FAMILY_TRIM_DB = {
  kick: 0, snare: 0, rimshot: -3, clap: -3,
  'tom-low': -2, 'mid-tom': -2, 'tom-hi': -2,
  'hihat-close': -6, 'hihat-open': -5, cymbal: -6,
  cowbell: -5, clave: -6, maraca: -6, 'conga-hi': -3, 'conga-low': -3,
} as const satisfies Record<typeof GM_DRUM_SAMPLES[number], number>;

// Pedal hi-hat and ride need distinct levels even when they share an 808 sample.
const DRUM_NOTE_TRIM_DB: Partial<Record<number, number>> = { 44: -8, 51: -5, 59: -5 };

export async function loadDrumKit(context: AudioContext, destination: AudioNode, storage: Storage) {
  const baseUrl = `${import.meta.env.BASE_URL}sample-library/TR-808-v1`;
  const manifest: unknown = await (await storage.fetch(`${baseUrl}/dm.json`)).json();
  if (!manifest || typeof manifest !== 'object' || !('samples' in manifest)
    || !Array.isArray(manifest.samples) || !manifest.samples.length
    || !manifest.samples.every((sample: unknown) => typeof sample === 'string')) {
    throw new Error('Invalid TR-808 sample manifest');
  }
  // Supplying the manifest avoids smplr's unhandled secondary promise on fetch failure.
  const instrument: Exclude<DrumMachineOptions['instrument'], string | undefined> = {
    baseUrl, name: 'TR-808', samples: manifest.samples, sampleNames: [],
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
  const drums = new DrumMachine(context, { destination, storage, disableScheduler: true, instrument });
  try {
    await drums.load;
  } catch (error) {
    drums.output.disconnect();
    throw error;
  }
  return {
    start: ({ note, time, velocity, onEnded }: DrumHit) => {
      const sample = GM_DRUM_SAMPLES[note - 35];
      if (!sample) {
        onEnded();
        return () => undefined;
      }
      // Choke at the scheduled hit time, not when the lookahead queues it.
      if (note === 42 || note === 44) drums.stop({ stopId: 'hihat-open', time });
      const trimDb = DRUM_NOTE_TRIM_DB[note] ?? DRUM_FAMILY_TRIM_DB[sample];
      // MIDI note duration does not truncate percussion's natural tail.
      return drums.start({ note: sample, time, velocity, onEnded, gainOffset: 10 ** (trimDb / 20) });
    },
  };
}
