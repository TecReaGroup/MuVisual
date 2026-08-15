import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config/paths.mjs';

export function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = error.cause;
  return {
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.statusCode ? { statusCode: error.statusCode } : {}),
    ...(error.detail ? { detail: error.detail } : {}),
    ...(cause ? { cause: {
      ...(cause.message ? { message: cause.message } : {}),
      ...(cause.code ? { code: cause.code } : {}),
    } } : {}),
  };
}

const levelLabels = {
  debug: 'DEBUG',
  error: 'ERROR',
  info: 'INFO',
  warn: 'WARN',
};

let fileLoggingAvailable = true;

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatLogDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimezone(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absoluteMinutes / 60))}:${pad(absoluteMinutes % 60)}`;
}

function formatTimestamp(date) {
  return `${formatLogDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${formatTimezone(date)}`;
}

function formatEntry(level, module, message, fields, date) {
  const label = levelLabels[level] ?? String(level).toUpperCase();
  return `[${formatTimestamp(date)}] [${label}] [${String(module)}] - ${message}${formatFields(fields)}`;
}

function writeConsole(level, entry) {
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else if (level === 'debug') console.debug(entry);
  else console.log(entry);
}

function formatValue(value) {
  if (typeof value === 'string') {
    return /[\s,=]/u.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return JSON.stringify(value);
}

function formatFieldValue(key, value) {
  if ((key === 'requestId' || key === 'jobId') && typeof value === 'string') return value.slice(0, 8);
  if (key === 'size' && typeof value === 'number') {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${value}B`;
  }
  if (key === 'durationMs' && typeof value === 'number') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
  }
  return formatValue(value);
}

function formatFields(fields) {
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === 'error' && value && typeof value === 'object') {
      for (const [errorKey, errorValue] of Object.entries(value)) {
        values.push(`${errorKey}=${formatFieldValue(errorKey, errorValue)}`);
      }
      continue;
    }
    values.push(`${key}=${formatFieldValue(key, value)}`);
  }
  return values.length > 0 ? ` ${values.join(', ')}` : '';
}

try {
  mkdirSync(paths.logRoot, { recursive: true });
} catch (error) {
  fileLoggingAvailable = false;
  writeConsole('error', formatEntry('error', 'Logger', '无法创建日志目录', {
    path: paths.logRoot,
    error: serializeError(error),
  }, new Date()));
}

export function log(level, module, message, fields = {}) {
  const date = new Date();
  const entry = formatEntry(level, module, message, fields, date);
  writeConsole(level, entry);

  if (!fileLoggingAvailable) return;
  const logFile = join(paths.logRoot, `log_${formatLogDate(date)}.log`);
  try {
    appendFileSync(logFile, `${entry}\n`, 'utf8');
  } catch (error) {
    fileLoggingAvailable = false;
    writeConsole('error', formatEntry('error', 'Logger', '无法写入日志文件', {
      path: logFile,
      error: serializeError(error),
    }, new Date()));
  }
}
