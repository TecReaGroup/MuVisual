export const auth = {
  sessionMaxAge: 30 * 24 * 60 * 60,
};

export const limits = {
  loginBodySize: 4 * 1024,
  uploadSize: 512 * 1024 * 1024,
};

export const instrumentNames = ['piano', 'other', 'vocals', 'bass', 'drums', 'guitar'];

export const staticContentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.map': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
