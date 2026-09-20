import {
  AdtsOutputFormat,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  type OutputFormat,
} from 'mediabunny';

const audioFormats = {
  aac: { output: () => new AdtsOutputFormat(), mimeType: 'audio/aac' },
  flac: { output: () => new FlacOutputFormat(), mimeType: 'audio/flac' },
  m4a: { output: () => new Mp4OutputFormat(), mimeType: 'audio/mp4' },
  mp3: { output: () => new Mp3OutputFormat(), mimeType: 'audio/mpeg' },
  oga: { output: () => new OggOutputFormat(), mimeType: 'audio/ogg' },
  ogg: { output: () => new OggOutputFormat(), mimeType: 'audio/ogg' },
  opus: { output: () => new OggOutputFormat(), mimeType: 'audio/ogg' },
  wav: { output: () => new WavOutputFormat(), mimeType: 'audio/wav' },
} satisfies Record<string, { output: () => OutputFormat; mimeType: string }>;

type AudioExtension = keyof typeof audioFormats;

export const supportedAudioAccept = Object.keys(audioFormats).map(extension => `.${extension}`).join(',');

function getAudioExtension(file: File) {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  return extension && extension in audioFormats ? extension as AudioExtension : null;
}

function createAudioInput(file: File) {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export function supportsAudioMetadata(file: File) {
  return getAudioExtension(file) !== null;
}

export async function readAudioMetadata(file: File) {
  const input = createAudioInput(file);
  try {
    const tags = await input.getMetadataTags();
    return { title: tags.title?.trim() ?? '', album: tags.album?.trim() ?? '' };
  } finally {
    input.dispose();
  }
}

export async function prepareAudioWithMetadata(file: File, title: string, album: string) {
  const extension = getAudioExtension(file);
  if (!extension) throw new Error('Unsupported audio format');

  const input = createAudioInput(file);
  const target = new BufferTarget();
  const output = new Output({ format: audioFormats[extension].output(), target });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      // Copying source tags can corrupt ID3 framing: the current writer sizes UTF-8 lyrics by character count.
      tags: { title, album },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error('Unsupported audio codec');
    await conversion.execute();
    if (!target.buffer) throw new Error('Audio metadata output is empty');
    const taggedFile = new File([target.buffer], file.name, {
      type: file.type || audioFormats[extension].mimeType,
      lastModified: file.lastModified,
    });
    // Verify the serialized file, since accepting tags does not guarantee the container preserved them.
    try {
      const writtenTags = await readAudioMetadata(taggedFile);
      if (writtenTags.title !== title || writtenTags.album !== album) {
        throw new Error('Written audio metadata does not match the requested title and album');
      }
    } catch (cause) {
      throw Object.assign(new Error('Audio metadata verification failed'), {
        cause,
        code: 'AUDIO_METADATA_WRITE_FAILED',
      });
    }
    return taggedFile;
  } finally {
    input.dispose();
  }
}
