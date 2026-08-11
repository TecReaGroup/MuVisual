import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const visualRoot = fileURLToPath(new URL('./data/visual/', import.meta.url));
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const instrumentNames = ['piano', 'other', 'vocals', 'bass', 'drums', 'guitar'];

const staticContentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const encodeId = value => Buffer.from(value, 'utf8').toString('base64url');
const decodeId = value => Buffer.from(value, 'base64url').toString('utf8');

function splitFolderName(folderName) {
  const separator = folderName.indexOf('_');
  return separator === -1
    ? { title: folderName, album: 'MuVisual Library' }
    : { title: folderName.slice(0, separator), album: folderName.slice(separator + 1) };
}

async function readLibrary() {
  const entries = await readdir(visualRoot, { withFileTypes: true });
  const folders = entries.filter(entry => entry.isDirectory());

  const items = await Promise.all(folders.map(async folder => {
    const folderPath = join(visualRoot, folder.name);
    const id = encodeId(folder.name);
    const files = (await readdir(folderPath, { withFileTypes: true })).filter(file => file.isFile());
    const sourceAudio = files.find(file => file.name === `${folder.name}.mp3`)
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
    const { title, album } = splitFolderName(folder.name);
    return {
      id,
      title,
      album,
      audioUrl: sourceAudio ? `/media/${id}/audio` : null,
      beatUrl: beatAnalysis ? `/media/${id}/beats` : null,
      instruments,
      size: fileStats?.size ?? 0,
      updatedAt: fileStats?.mtime.toISOString() ?? null,
    };
  }));

  return items.sort((first, second) => first.title.localeCompare(second.title, 'zh-CN'));
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function streamFrontend(response, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(distRoot, requestedPath);
  const relativePath = relative(distRoot, filePath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return false;

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) return false;

    response.writeHead(200, {
      'Content-Type': staticContentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': fileStats.size,
      'Cache-Control': pathname.startsWith('/assets/')
        || pathname.startsWith('/audio/')
        || pathname.startsWith('/fonts/')
        || pathname === '/favicon.svg'
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function findMedia(id, kind) {
  const folderName = decodeId(id);
  const folders = await readdir(visualRoot, { withFileTypes: true });
  if (!folders.some(folder => folder.isDirectory() && folder.name === folderName)) return null;

  const folderPath = join(visualRoot, folderName);
  const files = (await readdir(folderPath, { withFileTypes: true })).filter(file => file.isFile());
  const matchers = {
    audio: file => file.name === `${folderName}.mp3` || file.name.toLowerCase().endsWith('.mp3'),
    beats: file => file.name.toLowerCase().endsWith('_beat.json'),
  };
  const file = files.find(matchers[kind]);
  return file ? join(folderPath, file.name) : null;
}

async function findInstrumentMedia(id, instrument, kind) {
  if (!instrumentNames.includes(instrument)) return null;
  const folderName = decodeId(id);
  const folders = await readdir(visualRoot, { withFileTypes: true });
  if (!folders.some(folder => folder.isDirectory() && folder.name === folderName)) return null;
  const instrumentPath = join(visualRoot, folderName, instrument);
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

async function streamMedia(request, response, filePath) {
  const fileStats = await stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const contentType = extension === '.mp3'
    ? 'audio/mpeg'
    : extension === '.json' ? 'application/json; charset=utf-8' : 'audio/midi';
  const range = request.headers.range;

  if (!range) {
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': fileStats.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    createReadStream(filePath).pipe(response);
    return;
  }

  const [startText, endText] = range.replace('bytes=', '').split('-');
  const start = Number(startText);
  const end = endText ? Number(endText) : fileStats.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= fileStats.size) {
    response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` });
    response.end();
    return;
  }

  response.writeHead(206, {
    'Content-Type': contentType,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${fileStats.size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  });
  createReadStream(filePath, { start, end }).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/library') {
      const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('zh-CN');
      const library = await readLibrary();
      const items = query
        ? library.filter(item => `${item.title} ${item.album}`.toLocaleLowerCase('zh-CN').includes(query))
        : library;
      sendJson(response, 200, { items, total: items.length });
      return;
    }

    const detailMatch = request.method === 'GET' && url.pathname.match(/^\/api\/library\/([^/]+)$/);
    if (detailMatch) {
      const item = (await readLibrary()).find(entry => entry.id === detailMatch[1]);
      sendJson(response, item ? 200 : 404, item ?? { error: 'Track not found' });
      return;
    }

    const mediaMatch = request.method === 'GET' && url.pathname.match(/^\/media\/([^/]+)\/(audio|beats)$/);
    if (mediaMatch) {
      const filePath = await findMedia(mediaMatch[1], mediaMatch[2]);
      if (!filePath) {
        sendJson(response, 404, { error: 'Media not found' });
        return;
      }
      await streamMedia(request, response, filePath);
      return;
    }

    const instrumentMediaMatch = request.method === 'GET' && url.pathname.match(/^\/media\/([^/]+)\/instrument\/([^/]+)\/(audio|midi)$/);
    if (instrumentMediaMatch) {
      const filePath = await findInstrumentMedia(instrumentMediaMatch[1], instrumentMediaMatch[2], instrumentMediaMatch[3]);
      if (!filePath) {
        sendJson(response, 404, { error: 'Instrument media not found' });
        return;
      }
      await streamMedia(request, response, filePath);
      return;
    }

    if (request.method === 'GET') {
      if (await streamFrontend(response, url.pathname)) return;
      if (!extname(url.pathname) && await streamFrontend(response, '/')) return;
    }

    sendJson(response, 404, { error: 'Route not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Unable to read the visual library' });
  }
});

server.listen(PORT, () => {
  console.log(`MuVisual backend listening on http://localhost:${PORT}`);
});
