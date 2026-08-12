import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { openAsBlob } from 'node:fs';

if (process.env.NODE_ENV !== 'production') {
  try {
    loadEnvFile();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const PORT = Number(process.env.PORT || 8787);
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
if (!AUTH_PASSWORD) throw new Error('AUTH_PASSWORD is required');

const visualRoot = fileURLToPath(new URL('./data/visual/', import.meta.url));
const modalRoot = fileURLToPath(new URL('./data/modal/', import.meta.url));
const execFileAsync = promisify(execFile);
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const instrumentNames = ['piano', 'other', 'vocals', 'bass', 'drums', 'guitar'];
const isProduction = process.env.NODE_ENV === 'production';
const authCookieName = isProduction ? '__Host-muvisual_auth' : 'muvisual_auth';
const sessionMaxAge = 30 * 24 * 60 * 60;
const maxLoginBodySize = 4 * 1024;
const maxUploadSize = 512 * 1024 * 1024;

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
const encodeLibraryId = (source, folderName) => encodeId(`${source}:${folderName}`);

function secureEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionMaxAge;
  const signature = createHmac('sha256', AUTH_PASSWORD).update(String(expiresAt)).digest('base64url');
  return `${expiresAt}.${signature}`;
}

function hasValidSession(request) {
  const cookies = Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap(part => {
    const separator = part.indexOf('=');
    if (separator === -1) return [];
    return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
  }));
  const session = cookies[authCookieName];
  if (!session) return false;

  const separator = session.indexOf('.');
  if (separator === -1) return false;
  const expiresAt = session.slice(0, separator);
  const signature = session.slice(separator + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac('sha256', AUTH_PASSWORD).update(expiresAt).digest('base64url');
  return secureEqual(signature, expected);
}

function sessionCookie(value, maxAge = sessionMaxAge) {
  const attributes = [
    `${authCookieName}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength > maxLoginBodySize) {
    request.resume();
    throw Object.assign(new Error('Login request is too large'), { statusCode: 413 });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxLoginBodySize) throw Object.assign(new Error('Login request is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

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
    const root = source === 'preset' ? visualRoot : source === 'upload' ? modalRoot : null;
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
  for (const root of [modalRoot, visualRoot]) {
    try { const entry = await stat(join(root, folderName)); if (entry.isDirectory()) return { folderName, root }; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return null;
}

async function readMultipartFile(request) {
  const contentType = request.headers['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error('Multipart upload required'), { statusCode: 415 });
  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxUploadSize) throw Object.assign(new Error('Audio file is too large'), { statusCode: 413 }); chunks.push(chunk); }
  const body = Buffer.concat(chunks); const start = body.indexOf(Buffer.from('\r\n\r\n'));
  const end = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), start + 4);
  if (start < 0 || end < 0) throw Object.assign(new Error('Missing upload field'), { statusCode: 400 });
  const header = body.subarray(0, start).toString('utf8');
  if (!/name="file"/i.test(header)) throw Object.assign(new Error('Upload field must be file'), { statusCode: 400 });
  const filename = (header.match(/filename="([^"]+)"/i)?.[1] ?? 'audio.bin').replace(/[\\/]/g, '_');
  return { filename, data: body.subarray(start + 4, end) };
}

async function processAudioUpload(request) {
  if (!process.env.MODAL_URL) throw new Error('MODAL_URL is not configured');
  const upload = await readMultipartFile(request);
  const tempRoot = join(modalRoot, '.uploads'); await mkdir(tempRoot, { recursive: true });
  const inputPath = join(tempRoot, `${Date.now()}-${upload.filename}`); const zipPath = `${inputPath}.zip`;
  await (await import('node:fs/promises')).writeFile(inputPath, upload.data);
  const form = new FormData(); form.set('file', await openAsBlob(inputPath), upload.filename);
  const headers = {}; if (process.env.MODAL_KEY && process.env.MODAL_SECRET) { headers['Modal-Key'] = process.env.MODAL_KEY; headers['Modal-Secret'] = process.env.MODAL_SECRET; }
  const result = await fetch(process.env.MODAL_URL, { method: 'POST', headers, body: form, redirect: 'follow', signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!result.ok || !result.body) throw new Error(`Modal request failed (${result.status})`);
  const type = result.headers.get('content-type') ?? ''; if (!type.includes('application/zip')) throw new Error(`Modal returned non-ZIP: ${type}`);
  const output = createWriteStream(zipPath); for await (const chunk of result.body) output.write(chunk); output.end(); await new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); });
  await mkdir(modalRoot, { recursive: true }); await execFileAsync('tar', ['-xf', zipPath, '-C', modalRoot]);
  await rm(inputPath, { force: true }); await rm(zipPath, { force: true });
  const entries = await readdir(modalRoot, { withFileTypes: true }); const folder = entries.find(entry => entry.isDirectory() && entry.name !== '.uploads');
  return folder?.name ?? null;
}

async function readLibrary() {
  const libraryFolders = [];
  for (const [source, root] of [['preset', visualRoot], ['upload', modalRoot]]) {
    let entries = [];
    try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) libraryFolders.push({ folderName: entry.name, root, source });
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

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
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

async function findInstrumentMedia(id, instrument, kind) {
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
    const authenticated = hasValidSession(request);

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      sendJson(response, 200, { authenticated });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/login') {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        sendJson(response, 415, { error: 'Unsupported content type' });
        return;
      }
      const body = await readJsonBody(request);
      if (typeof body?.password === 'string' && secureEqual(body.password, AUTH_PASSWORD)) {
        sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': sessionCookie(createSession()) });
        return;
      }
      sendJson(response, 401, { authenticated: false, error: 'Invalid password' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/logout') {
      sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', 0) });
      return;
    }

    if (!authenticated && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/'))) {
      sendJson(response, 401, { error: 'Authentication required' });
      return;
    }

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

    if (request.method === 'POST' && url.pathname === '/api/process-audio') {
      const folderName = await processAudioUpload(request);
      if (!folderName) throw new Error('Modal ZIP did not contain a track folder');
      const item = (await readLibrary()).find(entry => entry.id === encodeLibraryId('upload', folderName));
      sendJson(response, 201, { item });
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
    if ([400, 413, 415].includes(error?.statusCode)) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    sendJson(response, 500, { error: 'Unable to read the visual library' });
  }
});

server.listen(PORT, () => {
  console.log(`MuVisual backend listening on http://localhost:${PORT}`);
});
