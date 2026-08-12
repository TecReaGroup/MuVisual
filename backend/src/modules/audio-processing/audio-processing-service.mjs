import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

function decodeArchiveOutput(output) {
  if (typeof output === 'string') return output;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    return new TextDecoder('gb18030').decode(output);
  }
}

function findArchiveFolder(output) {
  return decodeArchiveOutput(output).split(/\r?\n/)
    .map(entry => entry.replace(/\\/g, '/').replace(/^\.\//, '').split('/')[0])
    .find(entry => entry && entry !== '.');
}

async function listTrackFolders() {
  const entries = await readdir(paths.modalRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name);
}

function resolveExtractedFolder(expectedFolder, foldersBefore, foldersAfter) {
  const existingFolders = new Set(foldersBefore);
  const addedFolders = foldersAfter.filter(folderName => !existingFolders.has(folderName));
  if (addedFolders.length === 1) return addedFolders[0];

  const expectedName = expectedFolder.normalize('NFC');
  return foldersAfter.find(folderName => folderName.normalize('NFC') === expectedName) ?? null;
}

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

async function downloadModalResult(job) {
  const startedAt = Date.now();
  log('info', 'Modal', '正在上传音频并等待处理结果', { requestId: job.requestId, jobId: job.jobId, filename: job.filename, size: job.size });
  await rm(job.zipPath, { force: true });

  try {
    const form = new FormData();
    form.set('file', await openAsBlob(job.inputPath), job.filename);
    const headers = {};
    if (environment.modalKey && environment.modalSecret) {
      headers['Modal-Key'] = environment.modalKey;
      headers['Modal-Secret'] = environment.modalSecret;
    }
    const result = await fetch(environment.modalUrl, {
      method: 'POST',
      headers,
      body: form,
      redirect: 'follow',
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
    log('info', 'Modal', 'Modal 处理完成，开始下载结果', {
      requestId: job.requestId,
      jobId: job.jobId,
      filename: job.filename,
      status: result.status,
      contentType: result.headers.get('content-type'),
      contentLength: result.headers.get('content-length'),
      durationMs: Date.now() - startedAt,
    });

    if (!result.ok) {
      const detail = (await result.text()).slice(0, 2000);
      throw Object.assign(new Error(`Modal request failed (${result.status})`), { code: 'MODAL_HTTP_ERROR', statusCode: result.status, detail });
    }
    if (!result.body) throw Object.assign(new Error('Modal returned an empty response body'), { code: 'MODAL_EMPTY_RESPONSE' });

    const contentType = result.headers.get('content-type') ?? '';
    if (!contentType.includes('application/zip')) throw new Error(`Modal returned non-ZIP: ${contentType}`);
    await pipeline(Readable.fromWeb(result.body), createWriteStream(job.zipPath));

    const zipStats = await stat(job.zipPath);
    log('info', 'Archive', '处理结果下载完成', {
      requestId: job.requestId,
      jobId: job.jobId,
      filename: job.filename,
      size: zipStats.size,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await rm(job.zipPath, { force: true });
    log('error', 'Modal', 'Modal 处理或结果下载失败', {
      requestId: job.requestId,
      jobId: job.jobId,
      filename: job.filename,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    });
    if (error.code === 'MODAL_HTTP_ERROR') throw error;
    throw Object.assign(new Error('Modal response transfer failed'), {
      cause: error,
      code: 'MODAL_TRANSFER_ERROR',
      statusCode: 502,
    });
  }
}

async function processJob(job) {
  if (!environment.modalUrl) throw new Error('MODAL_URL is not configured');
  try {
    await downloadModalResult(job);

    const { stdout } = await execFileAsync('tar', ['-tf', job.zipPath], { encoding: 'buffer' });
    const archiveFolder = findArchiveFolder(stdout);
    if (!archiveFolder || archiveFolder === '..') throw new Error('Modal ZIP did not contain a track folder');

    await mkdir(paths.modalRoot, { recursive: true });
    const foldersBefore = await listTrackFolders();
    await execFileAsync('tar', ['-xf', job.zipPath, '-C', paths.modalRoot]);
    const foldersAfter = await listTrackFolders();
    const folderName = resolveExtractedFolder(archiveFolder, foldersBefore, foldersAfter);
    if (!folderName) throw Object.assign(new Error('Extracted track folder could not be resolved'), {
      code: 'EXTRACTED_TRACK_FOLDER_NOT_FOUND',
      detail: archiveFolder,
    });
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
