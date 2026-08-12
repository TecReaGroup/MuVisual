import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { environment } from '../config/environment.mjs';
import { limits } from '../config/constants.mjs';
import { log, serializeError } from '../infrastructure/logger.mjs';
import { queueAudioProcessing } from '../modules/audio-processing/audio-processing-service.mjs';
import { readMultipartFile } from '../modules/audio-processing/multipart.mjs';
import { createSession, hasValidSession, secureEqual, sessionCookie } from '../modules/auth/auth-service.mjs';
import { encodeLibraryId, findInstrumentMedia, findMedia, readLibrary } from '../modules/library/library-service.mjs';
import { readJsonBody, sendJson } from '../shared/http.mjs';
import { streamMedia } from './media-handler.mjs';
import { streamFrontend } from './static-handler.mjs';

async function routeRequest(request, response, url, requestId) {
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
    const body = await readJsonBody(request, limits.loginBodySize);
    if (typeof body?.password === 'string' && secureEqual(body.password, environment.authPassword)) {
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
    const upload = await readMultipartFile(request, limits.uploadSize);
    const folderName = await queueAudioProcessing(upload, requestId);
    if (!folderName) throw new Error('Modal ZIP did not contain a track folder');
    const item = (await readLibrary()).find(entry => entry.id === encodeLibraryId('upload', folderName));
    if (!item) throw Object.assign(new Error('Processed track was not found after extraction'), { code: 'PROCESSED_TRACK_NOT_FOUND', detail: folderName });
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
}

export async function handleRequest(request, response) {
  const requestId = request.headers['x-request-id']?.toString().slice(0, 128) || randomUUID();
  const startedAt = Date.now();
  let requestPath = request.url ?? '/';
  response.setHeader('X-Request-Id', requestId);

  request.once('aborted', () => log('warn', 'HTTP', '客户端中断请求', {
    requestId,
    method: request.method,
    path: requestPath,
    durationMs: Date.now() - startedAt,
  }));
  response.once('finish', () => {
    if (response.statusCode >= 400) log('warn', 'HTTP', '请求返回异常状态', {
      requestId,
      method: request.method,
      path: requestPath,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    requestPath = url.pathname;
    await routeRequest(request, response, url, requestId);
  } catch (error) {
    log('error', 'HTTP', '请求处理失败', {
      requestId,
      method: request.method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    });
    if ([400, 413, 415].includes(error?.statusCode)) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    sendJson(response, 500, { error: 'Unable to read the visual library' });
  }
}
