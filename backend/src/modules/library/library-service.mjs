import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { instrumentNames } from '../../config/constants.mjs';
import { paths } from '../../config/paths.mjs';

const encodeId = value => Buffer.from(value, 'utf8').toString('base64url');
const decodeId = value => Buffer.from(value, 'base64url').toString('utf8');

export const encodeLibraryId = (source, folderName) => encodeId(`${source}:${folderName}`);

function splitFolderName(folderName) {
  const separator = folderName.indexOf('_');
  return separator === -1
    ? { title: folderName, album: 'MuVisual Library' }
    : { title: folderName.slice(0, separator), album: folderName.slice(separator + 1) };
}

async function resolveLibraryEntry(id) {
  const decoded = decodeId(id);
  const separator = decoded.indexOf(':');
  if (separator !== -1) {
    const source = decoded.slice(0, separator);
    const folderName = decoded.slice(separator + 1);
    const root = source === 'preset' ? paths.visualRoot : source === 'upload' ? paths.modalRoot : null;
    if (!root) return null;
    try {
      const entry = await stat(join(root, folderName));
      return entry.isDirectory() ? { folderName, root } : null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  const folderName = decoded;
  for (const root of [paths.modalRoot, paths.visualRoot]) {
    try {
      const entry = await stat(join(root, folderName));
      if (entry.isDirectory()) return { folderName, root };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

export async function readLibrary() {
  const libraryFolders = [];
  for (const [source, root] of [['preset', paths.visualRoot], ['upload', paths.modalRoot]]) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
      libraryFolders.push({ folderName: entry.name, root, source });
    }
  }

  const items = await Promise.all(libraryFolders.map(async ({ folderName, root, source }) => {
    const folderPath = join(root, folderName);
    const id = encodeLibraryId(source, folderName);
    const files = (await readdir(folderPath, { withFileTypes: true })).filter(file => file.isFile());
    const sourceAudio = files.find(file => file.name === `${folderName}.mp3`)
      ?? files.find(file => file.name.toLowerCase().endsWith('.mp3'));
    const beatAnalysis = files.find(file => file.name.toLowerCase().endsWith('_beat.json'));
    const instruments = {};

    for (const instrument of instrumentNames) {
      const instrumentPath = join(folderPath, instrument);
      let instrumentFiles;
      try {
        instrumentFiles = (await readdir(instrumentPath, { withFileTypes: true })).filter(file => file.isFile());
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const audio = instrumentFiles.find(file => file.name.toLowerCase().endsWith(`_${instrument}.mp3`));
      const midi = instrumentFiles.find(file => ['.mid', '.midi'].includes(extname(file.name).toLowerCase()) && file.name.toLowerCase().includes(`_${instrument}.`));
      if (audio || midi) {
        instruments[instrument] = {
          audioUrl: audio ? `/media/${id}/instrument/${instrument}/audio` : null,
          midiUrl: midi ? `/media/${id}/instrument/${instrument}/midi` : null,
        };
      }
    }

    const primaryFile = sourceAudio ?? beatAnalysis;
    const fileStats = primaryFile ? await stat(join(folderPath, primaryFile.name)) : null;
    const { title, album } = splitFolderName(folderName);
    return {
      id,
      title,
      album,
      source,
      audioUrl: sourceAudio ? `/media/${id}/audio` : null,
      beatUrl: beatAnalysis ? `/media/${id}/beats` : null,
      instruments,
      size: fileStats?.size ?? 0,
      updatedAt: fileStats?.mtime.toISOString() ?? null,
    };
  }));

  return items.sort((first, second) => first.title.localeCompare(second.title, 'zh-CN'));
}

export async function findMedia(id, kind) {
  const libraryEntry = await resolveLibraryEntry(id);
  if (!libraryEntry) return null;
  const { folderName, root } = libraryEntry;
  const folderPath = join(root, folderName);
  const files = (await readdir(folderPath, { withFileTypes: true })).filter(file => file.isFile());
  const matchers = {
    audio: file => file.name === `${folderName}.mp3` || file.name.toLowerCase().endsWith('.mp3'),
    beats: file => file.name.toLowerCase().endsWith('_beat.json'),
  };
  const file = files.find(matchers[kind]);
  return file ? join(folderPath, file.name) : null;
}

export async function findInstrumentMedia(id, instrument, kind) {
  if (!instrumentNames.includes(instrument)) return null;
  const libraryEntry = await resolveLibraryEntry(id);
  if (!libraryEntry) return null;
  const { folderName, root } = libraryEntry;
  const instrumentPath = join(root, folderName, instrument);
  try {
    const files = (await readdir(instrumentPath, { withFileTypes: true })).filter(file => file.isFile());
    const file = kind === 'audio'
      ? files.find(entry => entry.name.toLowerCase().endsWith(`_${instrument}.mp3`))
      : files.find(entry => ['.mid', '.midi'].includes(extname(entry.name).toLowerCase()) && entry.name.toLowerCase().includes(`_${instrument}.`));
    return file ? join(instrumentPath, file.name) : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
