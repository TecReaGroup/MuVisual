import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { environment } from '../../config/environment.mjs';
import { paths } from '../../config/paths.mjs';
import { log, serializeError } from '../../infrastructure/logger.mjs';

const execFileAsync = promisify(execFile);
const pollIntervalMs = 5_000;
const processingTimeoutMs = 20 * 60 * 1000;
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const activeStatuses = new Set(['queued', 'processing', 'downloading', 'extracting']);
const jobs = new Map();
let initialization;
let processingQueue = Promise.resolve();
let queuedCount = 0;

const jobsRoot = join(paths.modalRoot, '.jobs');
const uploadsRoot = join(paths.modalRoot, '.uploads');

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

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
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

function jobFilePath(jobId) {
  return join(jobsRoot, `${jobId}.json`);
}

async function persistJob(job) {
  await mkdir(jobsRoot, { recursive: true });
  const destination = jobFilePath(job.id);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(job));
  await rename(temporary, destination);
}

async function updateJob(job, fields) {
  Object.assign(job, fields, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  await persistJob(job);
}

function publicJob(job) {
  return {
    id: job.id,
    filename: job.filename,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
  };
}

function enqueue(job) {
  queuedCount += 1;
  const position = queuedCount;
  log('info', 'AudioQueue', '音频任务已进入队列', {
    requestId: job.requestId,
    jobId: job.id,
    filename: job.filename,
    position,
    queueSize: queuedCount,
  });

  const run = async () => {
    const startedAt = Date.now();
    log('info', 'AudioQueue', '开始处理音频任务', {
      requestId: job.requestId,
      jobId: job.id,
      filename: job.filename,
      queueSize: queuedCount,
    });
    try {
      await processJob(job);
      log('info', 'AudioQueue', '音频任务处理完成', {
        requestId: job.requestId,
        jobId: job.id,
        filename: job.filename,
        folderName: job.folderName,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await updateJob(job, {
        status: 'failed',
        error: error.message || 'Audio processing failed',
        errorCode: error.code ?? 'AUDIO_PROCESSING_FAILED',
      });
      await Promise.allSettled([
        rm(job.inputPath, { force: true }),
        rm(job.zipPath, { force: true }),
      ]);
      log('error', 'AudioQueue', '音频任务处理失败', {
        requestId: job.requestId,
        jobId: job.id,
        filename: job.filename,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
    } finally {
      queuedCount -= 1;
    }
  };

  const result = processingQueue.then(run, run);
  processingQueue = result.then(() => undefined, () => undefined);
}

async function initializeJobs() {
  await Promise.all([
    mkdir(paths.modalRoot, { recursive: true }),
    mkdir(jobsRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
  const entries = await readdir(jobsRoot, { withFileTypes: true });
  for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json'))) {
    try {
      const job = JSON.parse(await readFile(join(jobsRoot, entry.name), 'utf8'));
      if (!job?.id || !job?.status) continue;
      jobs.set(job.id, job);
      if (job.status === 'submitting' && !job.modalCallId) {
        await updateJob(job, {
          status: 'failed',
          error: 'Node restarted while submitting the audio; the upload will not be sent twice',
        });
        continue;
      }
      if (activeStatuses.has(job.status)) {
        if (await fileExists(job.inputPath) || await fileExists(job.zipPath)) enqueue(job);
        else await updateJob(job, { status: 'failed', error: 'Staged upload was lost before processing completed' });
      }
    } catch (error) {
      log('warn', 'AudioQueue', '无法恢复音频任务', { filename: entry.name, error: serializeError(error) });
    }
  }
}

async function ensureInitialized() {
  initialization ??= initializeJobs();
  return initialization;
}

async function stageUpload(upload, requestId) {
  await ensureInitialized();
  const id = randomUUID();
  const inputPath = join(uploadsRoot, `${id}-${upload.filename}`);
  const now = new Date().toISOString();
  await writeFile(inputPath, upload.data);
  const job = {
    id,
    requestId,
    filename: upload.filename,
    size: upload.data.length,
    inputPath,
    zipPath: `${inputPath}.zip`,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  await persistJob(job);
  log('info', 'AudioUpload', '上传文件已暂存', { requestId, jobId: id, filename: upload.filename, size: upload.data.length });
  return job;
}

function modalHeaders() {
  const headers = {};
  if (environment.modalKey && environment.modalSecret) {
    headers['Modal-Key'] = environment.modalKey;
    headers['Modal-Secret'] = environment.modalSecret;
  }
  return headers;
}

async function delay(duration = pollIntervalMs) {
  await new Promise(resolve => setTimeout(resolve, duration));
}

async function submitModalJob(job) {
  await updateJob(job, { status: 'submitting', error: null });
  const form = new FormData();
  form.set('file', await openAsBlob(job.inputPath), job.filename);
  const response = await fetch(environment.modalUrl, {
    method: 'POST',
    headers: modalHeaders(),
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2000);
    throw Object.assign(new Error(`Modal job submission failed (${response.status})`), { detail });
  }
  const result = await response.json();
  const modalCallId = result.call_id ?? result.callId;
  if (typeof modalCallId !== 'string' || !modalCallId) throw new Error('Modal submission did not return call_id');
  const processingStartedAt = new Date().toISOString();
  await updateJob(job, {
    status: 'processing',
    modalCallId,
    processingStartedAt,
    processingDeadlineAt: new Date(Date.now() + processingTimeoutMs).toISOString(),
  });
}

function modalResultUrl(callId) {
  return `${environment.modalUrl.replace(/\/$/, '')}/${encodeURIComponent(callId)}`;
}

async function waitForModalResult(job) {
  while (true) {
    const deadlineAt = Date.parse(job.processingDeadlineAt);
    const remainingMs = deadlineAt - Date.now();
    if (!job.processingDeadlineAt || !Number.isFinite(deadlineAt) || remainingMs <= 0) {
      throw Object.assign(new Error('Audio processing exceeded the 20 minute limit'), { code: 'AUDIO_PROCESSING_TIMEOUT' });
    }
    try {
      const response = await fetch(modalResultUrl(job.modalCallId), {
        headers: modalHeaders(),
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(60_000, remainingMs)),
      });
      if (response.status === 202) {
        await delay(Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now())));
        continue;
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 2000);
        if (retryableStatuses.has(response.status)) {
          log('warn', 'Modal', '查询任务结果暂时失败，准备重试', { requestId: job.requestId, jobId: job.id, status: response.status });
          await delay(Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now())));
          continue;
        }
        throw Object.assign(new Error(`Modal result polling failed (${response.status})`), { detail });
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/zip')) throw new Error(`Modal returned non-ZIP result: ${contentType || 'unknown'}`);
      if (!response.body) throw new Error('Modal returned an empty ZIP response');
      await updateJob(job, { status: 'downloading' });
      await rm(job.zipPath, { force: true });
      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(job.zipPath));
        return;
      } catch (error) {
        await rm(job.zipPath, { force: true });
        log('warn', 'Modal', '下载处理结果中断，准备重新查询结果', {
          requestId: job.requestId,
          jobId: job.id,
          error: serializeError(error),
        });
        await updateJob(job, { status: 'processing' });
        await delay(Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now())));
      }
    } catch (error) {
      if (error?.name !== 'TimeoutError' && error?.name !== 'TypeError') throw error;
      log('warn', 'Modal', '查询任务结果连接异常，准备重试', { requestId: job.requestId, jobId: job.id, error: serializeError(error) });
      await delay(Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now())));
    }
  }
}

async function extractModalResult(job) {
  await updateJob(job, { status: 'extracting' });
  const { stdout } = await execFileAsync('tar', ['-tf', job.zipPath], { encoding: 'buffer' });
  const archiveFolder = findArchiveFolder(stdout);
  if (!archiveFolder || archiveFolder === '..') throw new Error('Modal ZIP did not contain a track folder');
  const foldersBefore = await listTrackFolders();
  await execFileAsync('tar', ['-xf', job.zipPath, '-C', paths.modalRoot]);
  const foldersAfter = await listTrackFolders();
  const folderName = resolveExtractedFolder(archiveFolder, foldersBefore, foldersAfter);
  if (!folderName) throw Object.assign(new Error('Extracted track folder could not be resolved'), {
    code: 'EXTRACTED_TRACK_FOLDER_NOT_FOUND',
    detail: archiveFolder,
  });
  await updateJob(job, { status: 'completed', folderName, error: null });
  log('info', 'Archive', '处理结果解压完成', { requestId: job.requestId, jobId: job.id, filename: job.filename, folderName });
}

async function processJob(job) {
  if (!environment.modalUrl) throw new Error('MODAL_URL is not configured');
  try {
    if (job.status === 'extracting' && await fileExists(job.zipPath)) {
      await extractModalResult(job);
      return;
    }
    if (!job.modalCallId) await submitModalJob(job);
    await waitForModalResult(job);
    await extractModalResult(job);
  } finally {
    if (job.status === 'completed') {
      await Promise.allSettled([
        rm(job.inputPath, { force: true }),
        rm(job.zipPath, { force: true }),
      ]);
    }
  }
}

export async function queueAudioProcessing(upload, requestId) {
  const job = await stageUpload(upload, requestId);
  enqueue(job);
  return publicJob(job);
}

export async function getAudioProcessingJob(jobId) {
  await ensureInitialized();
  const job = jobs.get(jobId);
  return job ? { ...publicJob(job), folderName: job.folderName ?? null } : null;
}
