import { createServer } from 'node:http';
import { log, serializeError } from './infrastructure/logger.mjs';
import { handleRequest } from './http/request-handler.mjs';

export function createApp() {
  const server = createServer(handleRequest);
  server.on('clientError', (error, socket) => {
    // Disconnects and malformed methods are expected from media clients and public network probes.
    if (error?.code === 'ECONNRESET'
      || error?.code === 'ECONNABORTED'
      || error?.code === 'HPE_INVALID_METHOD') {
      if (socket.writable) socket.end();
      return;
    }
    log('warn', 'HTTP', '客户端连接异常', { error: serializeError(error) });
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
