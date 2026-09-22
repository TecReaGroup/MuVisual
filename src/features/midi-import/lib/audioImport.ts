import { prepareAudioWithMetadata } from './audioMetadata';
import { log, serializeError } from '../../../shared/lib/logger';

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

async function waitForAudioJob(jobId: string): Promise<unknown> {
  let consecutiveFailures = 0;
  while (true) {
    await new Promise(resolve => window.setTimeout(resolve, 3000));
    try {
      const response = await fetch(`/api/process-audio/${encodeURIComponent(jobId)}`);
      if (retryableStatuses.has(response.status)) {
        consecutiveFailures += 1;
        if (consecutiveFailures === 1 || consecutiveFailures % 10 === 0) log('warn', 'AudioImport', '任务查询失败，继续重试', { jobId, consecutiveFailures, statusCode: response.status, requestId: response.headers.get('X-Request-Id') });
        continue;
      }
      if (!response.ok) throw Object.assign(new Error('Audio job request failed'), { statusCode: response.status, requestId: response.headers.get('X-Request-Id') });
      const payload = await response.json();
      if (consecutiveFailures) log('info', 'AudioImport', '任务查询恢复', { jobId, consecutiveFailures });
      consecutiveFailures = 0;
      if (payload.job?.status === 'failed') {
        throw Object.assign(new Error(payload.job.error || 'Audio processing failed'), { code: payload.job.errorCode, jobId, requestId: response.headers.get('X-Request-Id') });
      }
      if (payload.job?.status === 'completed' && payload.item) {
        log('info', 'AudioImport', '音频处理完成', { jobId });
        return payload.item;
      }
    } catch (error) {
      if (error instanceof TypeError) {
        consecutiveFailures += 1;
        if (consecutiveFailures === 1 || consecutiveFailures % 10 === 0) log('warn', 'AudioImport', '任务查询网络异常，继续重试', { ...serializeError(error), jobId, consecutiveFailures });
        continue;
      }
      throw error;
    }
  }
}

export async function importAudio(file: File, title: string, album: string): Promise<unknown> {
  const taggedFile = await prepareAudioWithMetadata(file, title, album);
  const form = new FormData();
  form.set('file', taggedFile);
  const response = await fetch('/api/process-audio', { method: 'POST', body: form });
  if (!response.ok) throw Object.assign(new Error('Audio upload failed'), { statusCode: response.status, requestId: response.headers.get('X-Request-Id') });
  const submission = await response.json();
  if (!submission.job?.id) throw new Error('Audio job ID missing');
  log('info', 'AudioImport', '音频处理任务已提交', { jobId: submission.job.id, requestId: response.headers.get('X-Request-Id'), size: taggedFile.size });
  return waitForAudioJob(submission.job.id);
}
