import { createHttpError } from '../../shared/http.mjs';

export async function readMultipartFile(request, maxSize) {
  const contentType = request.headers['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw createHttpError('Multipart upload required', 415);

  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw createHttpError('Audio file is too large', 413);
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  const start = body.indexOf(Buffer.from('\r\n\r\n'));
  const end = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), start + 4);
  if (start < 0 || end < 0) throw createHttpError('Missing upload field', 400);

  const header = body.subarray(0, start).toString('utf8');
  if (!/name="file"/i.test(header)) throw createHttpError('Upload field must be file', 400);
  const filename = (header.match(/filename="([^"]+)"/i)?.[1] ?? 'audio.bin').replace(/[\\/]/g, '_');
  return { filename, data: body.subarray(start + 4, end) };
}
