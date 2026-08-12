import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { environment } from '../../config/environment.mjs';
import { paths } from '../../config/paths.mjs';
import { log, serializeError } from '../../infrastructure/logger.mjs';

const execFileAsync = promisify(execFile);
let processingQueue = Promise.resolve();
let queuedCount = 0;

function enqueue(job, task) {
  queuedCount += 1;
  const position = queuedCount;
  log('info', 'AudioQueue', '音频任务已进入队列', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, position, queueSize: queuedCount });

  const run = async () => {
    const startedAt = Date.now();
    log('info', 'AudioQueue', '开始处理音频任务', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, queueSize: queuedCount });
    try {
      const result = await task();
      log('info', 'AudioQueue', '音频任务处理完成', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, folderName: result, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      log('error', 'AudioQueue', '音频任务处理失败', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, durationMs: Date.now() - startedAt, error: serializeError(error) });
      throw error;
    } finally {
      queuedCount -= 1;
    }
  };

  const result = processingQueue.then(run, run);
  processingQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function stageUpload(upload, requestId) {
  const tempRoot = join(paths.modalRoot, '.uploads');
  await mkdir(tempRoot, { recursive: true });
  const jobId = randomUUID();
  const inputPath = join(tempRoot, `${jobId}-${upload.filename}`);
  await writeFile(inputPath, upload.data);
  log('info', 'AudioUpload', '上传文件已暂存', { requestId, jobId, filename: upload.filename, size: upload.data.length });
  return { filename: upload.filename, inputPath, jobId, requestId, size: upload.data.length, zipPath: `${inputPath}.zip` };
}

async function requestModal(job) {
  let result;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptStartedAt = Date.now();
    log('info', 'Modal', '正在调用音频处理接口', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, size: job.size, attempt });
    try {
      const form = new FormData();
      form.set('file', await openAsBlob(job.inputPath), job.filename);
      const headers = {};
      if (environment.modalKey && environment.modalSecret) {
        headers['Modal-Key'] = environment.modalKey;
        headers['Modal-Secret'] = environment.modalSecret;
      }
      result = await fetch(environment.modalUrl, {
        method: 'POST',
        headers,
        body: form,
        redirect: 'follow',
        signal: AbortSignal.timeout(60 * 60 * 1000),
      });
      log('info', 'Modal', '已收到音频处理响应', {
        requestId: job.requestId,
        jobId: job.jobId,
        filename: job.filename,
        attempt,
        status: result.status,
        contentType: result.headers.get('content-type'),
        durationMs: Date.now() - attemptStartedAt,
      });
      break;
    } catch (error) {
      const socketClosed = error?.cause?.code === 'UND_ERR_SOCKET';
      log(socketClosed && attempt < 2 ? 'warn' : 'error', 'Modal', socketClosed && attempt < 2 ? '接口连接中断，准备重试' : '音频处理接口调用失败', {
        requestId: job.requestId,
        jobId: job.jobId,
        filename: job.filename,
        attempt,
        retrying: socketClosed && attempt < 2,
        durationMs: Date.now() - attemptStartedAt,
        error: serializeError(error),
      });
      if (!socketClosed || attempt === 2) throw error;
    }
  }
  return result;
}

async function processJob(job) {
  if (!environment.modalUrl) throw new Error('MODAL_URL is not configured');
  try {
    const result = await requestModal(job);
    if (!result) throw new Error('Modal request did not return a response');
    if (!result.ok) {
      const detail = (await result.text()).slice(0, 2000);
      throw Object.assign(new Error(`Modal request failed (${result.status})`), { code: 'MODAL_HTTP_ERROR', statusCode: result.status, detail });
    }
    if (!result.body) throw Object.assign(new Error('Modal returned an empty response body'), { code: 'MODAL_EMPTY_RESPONSE' });

    const contentType = result.headers.get('content-type') ?? '';
    if (!contentType.includes('application/zip')) throw new Error(`Modal returned non-ZIP: ${contentType}`);
    await pipeline(Readable.fromWeb(result.body), createWriteStream(job.zipPath));
    const zipStats = await stat(job.zipPath);
    log('info', 'Archive', '处理结果下载完成', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, size: zipStats.size });

    const { stdout } = await execFileAsync('tar', ['-tf', job.zipPath]);
    const folderName = stdout.split(/\r?\n/)
      .map(entry => entry.replace(/\\/g, '/').replace(/^\.\//, '').split('/')[0])
      .find(entry => entry && entry !== '.');
    if (!folderName || folderName === '..') throw new Error('Modal ZIP did not contain a track folder');

    await mkdir(paths.modalRoot, { recursive: true });
    await execFileAsync('tar', ['-xf', job.zipPath, '-C', paths.modalRoot]);
    log('info', 'Archive', '处理结果解压完成', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, folderName });
    return folderName;
  } finally {
    const cleanupResults = await Promise.allSettled([
      rm(job.inputPath, { force: true }),
      rm(job.zipPath, { force: true }),
    ]);
    cleanupResults.forEach((result, index) => {
      if (result.status === 'rejected') log('warn', 'AudioUpload', '临时文件清理失败', {
        requestId: job.requestId,
        jobId: job.jobId,
        filename: job.filename,
        fileType: index === 0 ? 'input' : 'zip',
        error: serializeError(result.reason),
      });
    });
  }
}

export async function queueAudioProcessing(upload, requestId) {
  const job = await stageUpload(upload, requestId);
  return enqueue(job, () => processJob(job));
}
