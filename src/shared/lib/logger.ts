type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, string | number | boolean | null | undefined>;

function redactLogText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, address => {
    try {
      const url = new URL(address);
      return `${url.origin}${url.pathname}`;
    } catch { return '[redacted URL]'; }
  }).replace(/\b(password|token|authorization|cookie|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

export function serializeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { message: typeof error === 'string' ? redactLogText(error) : 'Unknown error' };
  const diagnostic = error as Error & { code?: string | number; statusCode?: number; requestId?: string; jobId?: string; cause?: unknown };
  return {
    name: error.name,
    message: redactLogText(error.message),
    stack: error.stack && redactLogText(error.stack),
    code: diagnostic.code,
    statusCode: diagnostic.statusCode,
    requestId: diagnostic.requestId,
    jobId: diagnostic.jobId,
    cause: diagnostic.cause instanceof Error ? redactLogText(diagnostic.cause.message) : undefined,
  };
}

// DEBUG: request lifecycle/cancellation; INFO: completed milestones;
// WARN: recoverable failures; ERROR: failed operations. Log once at the owning boundary.
// Fields must be diagnostic scalars, never credentials, bodies, search terms or raw URLs.
export function log(level: LogLevel, module: string, message: string, fields: LogFields = {}) {
  const safeFields = Object.fromEntries(Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, /password|token|authorization|cookie|secret/i.test(key)
      ? '[redacted]' : typeof value === 'string' ? redactLogText(value) : value]));
  console[level](`[${new Date().toISOString()}] [${level.toUpperCase()}] [${module}] - ${message}`, safeFields);
}
