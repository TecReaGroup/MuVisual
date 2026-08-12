import { createApp } from './src/app.mjs';
import { environment, validateEnvironment } from './src/config/environment.mjs';
import { log, serializeError } from './src/infrastructure/logger.mjs';

const missingVariables = validateEnvironment();
if (missingVariables.length > 0) {
  log('error', 'Server', '服务配置不完整', { missingVariables });
  throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`);
}

const server = createApp();
server.on('error', error => {
  log('error', 'Server', '服务器发生错误', { error: serializeError(error) });
  process.exitCode = 1;
});

server.listen(environment.port, () => {
  log('info', 'Server', '服务已启动', {
    port: environment.port,
    environment: environment.isProduction ? 'production' : 'development',
  });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    log('info', 'Server', '正在关闭服务', { signal });
    server.close(error => {
      if (error) {
        log('error', 'Server', '服务关闭失败', { signal, error: serializeError(error) });
        process.exitCode = 1;
      } else {
        log('info', 'Server', '服务已关闭', { signal });
      }
    });
  });
}
