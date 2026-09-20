import { DrumMachine, type DrumMachineOptions, type Storage } from 'smplr';

type DrumHit = { note: number; time: number; velocity: number; onEnded: () => void };

// GM percussion 35-81. Missing LM-2 voices use the closest available family.
const GM_DRUM_SAMPLES = [
  'kick/alt', 'kick', 'stick/m', 'snare/m', 'clap', 'snare/h',
  'tom/ll', 'hhclosed', 'tom/l', 'hhclosed/short', 'tom/m', 'hhopen',
  'tom/m', 'tom/h', 'crash', 'tom/hh', 'ride', 'crash', 'cowbell',
  'tambourine', 'crash', 'cowbell', 'crash', 'stick/h', 'ride',
  'conga/hh', 'conga/ll', 'conga/h', 'conga/m', 'conga/l',
  'tom/h', 'tom/l', 'cowbell', 'cowbell', 'cabasa', 'cabasa',
  'stick/h', 'stick/l', 'cabasa', 'cabasa', 'stick/m', 'stick/h', 'stick/l',
  'conga/h', 'conga/l', 'cowbell', 'cowbell',
] as const;

// LM-2 peaks are already near full scale; balance body and cymbal sustain, not peaks.
const DRUM_FAMILY_TRIM_DB = {
  'kick/alt': 3, kick: 4.5, 'snare/m': 0, 'snare/h': 0, clap: -3,
  'stick/h': -3, 'stick/m': -3, 'stick/l': -3,
  'tom/ll': -2, 'tom/l': -2, 'tom/m': -2, 'tom/h': -2, 'tom/hh': -2,
  hhclosed: -6, 'hhclosed/short': -8, hhopen: -7, crash: -8, ride: -6,
  cowbell: -5, tambourine: -6, cabasa: -6,
  'conga/hh': -3, 'conga/h': -3, 'conga/m': -3, 'conga/l': -3, 'conga/ll': -3,
} as const satisfies Record<typeof GM_DRUM_SAMPLES[number], number>;

export async function loadDrumKit(context: AudioContext, destination: AudioNode, storage: Storage) {
  const baseUrl = `${import.meta.env.BASE_URL}sample-library/LM-2-v1`;
  const manifest: unknown = await (await storage.fetch(`${baseUrl}/dm.json`)).json();
  if (!manifest || typeof manifest !== 'object' || !('samples' in manifest)
    || !Array.isArray(manifest.samples) || !manifest.samples.length
    || !manifest.samples.every((sample: unknown) => typeof sample === 'string')) {
    throw new Error('Invalid LM-2 sample manifest');
  }
  // Supplying the manifest avoids smplr's unhandled secondary promise on fetch failure.
  const instrument: Exclude<DrumMachineOptions['instrument'], string | undefined> = {
    baseUrl, name: 'LM-2', samples: manifest.samples, sampleNames: [],
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
    throw new Error('LM-2 manifest is missing required percussion samples');
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
      if (note === 42 || note === 44) drums.stop({ stopId: 'hhopen', time });
      const trimDb = DRUM_FAMILY_TRIM_DB[sample];
      // smplr squares velocity: this gives drums a gentler 1.5-power gain curve.
      const drumVelocity = 127 * (velocity / 127) ** 0.75;
      // MIDI note duration does not truncate percussion's natural tail.
      return drums.start({ note: sample, time, velocity: drumVelocity, onEnded, gainOffset: 10 ** (trimDb / 20) });
    },
  };
}
