import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { environment } from '../../config/environment.mjs';
import { paths } from '../../config/paths.mjs';
import { log, serializeError } from '../../infrastructure/logger.mjs';

const pollIntervalMs = 5_000;
const processingTimeoutMs = 20 * 60 * 1000;
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const activeStatuses = new Set(['queued', 'processing', 'extracting']);
const persistedStatuses = new Set([...activeStatuses, 'submitting', 'downloading', 'completed', 'failed']);
const jobs = new Map();
let initialization;
let processingQueue = Promise.resolve();
let queuedCount = 0;

const jobsRoot = join(paths.modalRoot, '.jobs');
const uploadsRoot = join(paths.modalRoot, '.uploads');

async function ensureWorkingDirectories() {
  await Promise.all([
    mkdir(jobsRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
}

function normalizeArchiveEntry(entryName) {
  return entryName.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function inspectArchive(zip) {
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw Object.assign(new Error('Modal returned an empty ZIP archive'), { code: 'RESULT_ZIP_EMPTY' });
  }

  const topLevelFolders = new Set();
  for (const entry of entries) {
    const entryName = normalizeArchiveEntry(entry.entryName);
    if (!entryName) continue;
    const segments = entryName.split('/');
    if (entryName.includes('\0') || entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName) || segments.includes('..')) {
      throw Object.assign(new Error(`Modal ZIP contains an unsafe path: ${entry.entryName}`), {
        code: 'RESULT_ZIP_UNSAFE_PATH',
      });
    }
    if (segments[0] !== '__MACOSX') topLevelFolders.add(segments[0]);
  }

  if (topLevelFolders.size !== 1) {
    throw Object.assign(new Error('Modal ZIP must contain exactly one track folder'), {
      code: 'RESULT_ZIP_INVALID_LAYOUT',
      detail: [...topLevelFolders],
    });
  }
  const folderName = [...topLevelFolders][0];
  if (folderName.startsWith('.')) {
    throw Object.assign(new Error('Modal ZIP track folder must be a visible directory'), {
      code: 'RESULT_ZIP_INVALID_LAYOUT',
      detail: [folderName],
    });
  }
  return folderName;
}

function discardMacMetadata(zip) {
  for (const entry of [...zip.getEntries()]) {
    const entryName = normalizeArchiveEntry(entry.entryName);
    if (entryName.split('/')[0] === '__MACOSX') zip.deleteFile(entry);
  }
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

function jobFilePath(jobId) {
  return join(jobsRoot, `${jobId}.json`);
}

async function persistJob(job) {
  await ensureWorkingDirectories();
  const destination = jobFilePath(job.id);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(job));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function removeStagedFiles(job) {
  await Promise.allSettled([
    rm(job.inputPath, { force: true }),
    rm(job.zipPath, { force: true }),
  ]);
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
      try {
        await updateJob(job, {
          status: 'failed',
          error: error.message || 'Audio processing failed',
          errorCode: error.code ?? 'AUDIO_PROCESSING_FAILED',
        });
      } catch (persistenceError) {
        log('error', 'AudioQueue', '无法保存音频任务失败状态', {
          requestId: job.requestId,
          jobId: job.id,
          error: serializeError(persistenceError),
        });
      }
      await removeStagedFiles(job);
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
  await ensureWorkingDirectories();
  const entries = await readdir(jobsRoot, { withFileTypes: true });
  const restoredJobs = [];
  for (const entry of entries) {
    const storedJobPath = join(jobsRoot, entry.name);
    if (!entry.isFile()) {
      await rm(storedJobPath, { recursive: true, force: true });
      continue;
    }
    if (entry.name.endsWith('.tmp')) {
      await rm(storedJobPath, { force: true });
      continue;
    }
    if (!entry.name.endsWith('.json')) {
      await rm(storedJobPath, { force: true });
      continue;
    }
    try {
      const job = JSON.parse(await readFile(storedJobPath, 'utf8'));
      if (!job?.id || !persistedStatuses.has(job.status) || entry.name !== `${job.id}.json`) {
        await rm(storedJobPath, { force: true });
        continue;
      }
      job.inputPath = join(uploadsRoot, `${job.id}.upload`);
      job.zipPath = join(uploadsRoot, `${job.id}.zip`);
      jobs.set(job.id, job);
      if (job.status === 'submitting') {
        await updateJob(job, {
          status: 'failed',
          error: 'Node restarted while submitting the audio; the upload will not be sent twice',
        });
        await removeStagedFiles(job);
        continue;
      }
      if (job.status === 'downloading') {
        await updateJob(job, {
          status: 'failed',
          error: 'Node restarted while downloading the processed ZIP; the completed download will not be requested twice',
          errorCode: 'RESULT_DOWNLOAD_INTERRUPTED',
        });
        await removeStagedFiles(job);
        continue;
      }
      if (activeStatuses.has(job.status)) restoredJobs.push(job);
      else await removeStagedFiles(job);
    } catch (error) {
      log('warn', 'AudioQueue', '无法恢复音频任务', { filename: entry.name, error: serializeError(error) });
      await rm(storedJobPath, { force: true });
    }
  }

  const retainedUploadNames = new Set(restoredJobs.flatMap(job => [
    `${job.id}.upload`,
    `${job.id}.zip`,
  ]));
  const uploadEntries = await readdir(uploadsRoot, { withFileTypes: true });
  await Promise.allSettled(uploadEntries
    .filter(entry => !entry.isFile() || !retainedUploadNames.has(entry.name))
    .map(entry => rm(join(uploadsRoot, entry.name), { recursive: true, force: true })));

  restoredJobs.sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt));
  for (const job of restoredJobs) {
    if (await fileExists(job.inputPath) || await fileExists(job.zipPath)) enqueue(job);
    else {
      await updateJob(job, { status: 'failed', error: 'Staged upload was lost before processing completed' });
      await removeStagedFiles(job);
    }
  }
}

async function ensureInitialized() {
  initialization ??= initializeJobs();
  await initialization;
  await ensureWorkingDirectories();
}

async function stageUpload(upload, requestId) {
  await ensureInitialized();
  const id = randomUUID();
  const inputPath = join(uploadsRoot, `${id}.upload`);
  const now = new Date().toISOString();
  const job = {
    id,
    requestId,
    filename: upload.filename,
    size: upload.data.length,
    inputPath,
    zipPath: join(uploadsRoot, `${id}.zip`),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  try {
    await writeFile(inputPath, upload.data);
    await persistJob(job);
    jobs.set(id, job);
  } catch (error) {
    await removeStagedFiles(job);
    throw error;
  }
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

function modalApiUrl(pathname) {
  return `${environment.modalUrl.replace(/\/$/, '')}${pathname}`;
}

async function delay(duration = pollIntervalMs) {
  await new Promise(resolve => setTimeout(resolve, duration));
}

async function submitModalJob(job) {
  await updateJob(job, { status: 'submitting', error: null });
  const form = new FormData();
  form.set('file', await openAsBlob(job.inputPath), job.filename);
  const response = await fetch(modalApiUrl('/submit'), {
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
  return modalApiUrl(`/result/${encodeURIComponent(callId)}`);
}

async function waitForModalResult(job) {
  while (true) {
    const deadlineAt = Date.parse(job.processingDeadlineAt);
    const remainingMs = deadlineAt - Date.now();
    if (!job.processingDeadlineAt || !Number.isFinite(deadlineAt) || remainingMs <= 0) {
      throw Object.assign(new Error('Audio processing exceeded the 20 minute limit'), { code: 'AUDIO_PROCESSING_TIMEOUT' });
    }

    let response;
    const controller = new AbortController();
    const responseTimer = setTimeout(() => controller.abort(), Math.min(60_000, remainingMs));
    try {
      response = await fetch(modalResultUrl(job.modalCallId), {
        headers: modalHeaders(),
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.name !== 'TimeoutError' && error?.name !== 'TypeError') throw error;
      log('warn', 'Modal', '查询任务结果连接异常，准备重试', { requestId: job.requestId, jobId: job.id, error: serializeError(error) });
      await delay(Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now())));
      continue;
    } finally {
      clearTimeout(responseTimer);
    }

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

    if (!response.body) throw new Error('Modal returned an empty ZIP response');
    const contentType = response.headers.get('content-type') ?? '';
    await updateJob(job, { status: 'downloading', resultContentType: contentType || null });
    await ensureWorkingDirectories();
    await rm(job.zipPath, { force: true });
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(job.zipPath));
      return;
    } catch (error) {
      await rm(job.zipPath, { force: true });
      throw Object.assign(new Error('Processed ZIP download failed'), {
        cause: error,
        code: 'RESULT_DOWNLOAD_FAILED',
      });
    }
  }
}

async function extractModalResult(job) {
  let zip;
  let folderName;
  try {
    zip = new AdmZip(job.zipPath);
    folderName = inspectArchive(zip);
  } catch (error) {
    if (error?.code?.startsWith('RESULT_ZIP_')) throw error;
    throw Object.assign(new Error(`Modal returned an invalid ZIP archive (${job.resultContentType || 'unknown content type'})`), {
      cause: error,
      code: 'RESULT_ZIP_INVALID',
    });
  }

  const destinationFolder = join(paths.modalRoot, folderName);
  await updateJob(job, { status: 'extracting', folderName });
  let destinationClaimed = false;
  try {
    // Upload results are replacements: remove the complete previous track so
    // stale files from an older archive cannot remain in the library.
    await rm(destinationFolder, { recursive: true, force: true });
    await mkdir(destinationFolder);
    destinationClaimed = true;

    discardMacMetadata(zip);
    await zip.extractAllToAsync(paths.modalRoot, false, false);
    const extractedStats = await stat(destinationFolder);
    if (!extractedStats.isDirectory()) {
      throw Object.assign(new Error('Modal ZIP top-level entry is not a track folder'), {
        code: 'RESULT_ZIP_INVALID_LAYOUT',
      });
    }
  } catch (error) {
    if (destinationClaimed) await rm(destinationFolder, { recursive: true, force: true });
    throw error;
  }

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
      await removeStagedFiles(job);
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
