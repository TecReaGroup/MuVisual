import { createServer } from 'node:http';
import { log, serializeError } from './infrastructure/logger.mjs';
import { handleRequest } from './http/request-handler.mjs';

export function createApp() {
  const server = createServer(handleRequest);
  server.on('clientError', (error, socket) => {
    log('warn', 'HTTP', '客户端连接异常', { error: serializeError(error) });
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
