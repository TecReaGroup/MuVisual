import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { staticContentTypes } from '../config/constants.mjs';
import { paths } from '../config/paths.mjs';

export async function streamFrontend(response, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(paths.distRoot, requestedPath);
  const relativePath = relative(paths.distRoot, filePath);
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
