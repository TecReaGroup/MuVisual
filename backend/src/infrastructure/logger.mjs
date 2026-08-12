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
  debug: 'DBG',
  error: 'ERR',
  info: 'INF',
  warn: 'WRN',
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date) {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

export function log(level, module, message, fields = {}) {
  const label = levelLabels[level] ?? String(level).toUpperCase().slice(0, 3);
  const source = String(module).slice(0, 12);
  const entry = `[${formatTimestamp(new Date())}] [${label}] [${source}] - ${message}${formatFields(fields)}`;
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else if (level === 'debug') console.debug(entry);
  else console.log(entry);
}
