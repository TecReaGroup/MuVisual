export function createHttpError(message, statusCode, fields = {}) {
  return Object.assign(new Error(message), { statusCode, ...fields });
}

export function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

export async function readJsonBody(request, maxSize) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength > maxSize) {
    request.resume();
    throw createHttpError('Login request is too large', 413);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw createHttpError('Login request is too large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw createHttpError('Invalid JSON body', 400);
  }
}
