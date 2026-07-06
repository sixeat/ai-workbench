function sendSafeError(res, error, options = {}) {
  const status = Number(error?.status || options.status || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const exposedMessage = error?.expose && safeStatus < 500 ? error.message : '';
  const message = exposedMessage || options.message || (safeStatus >= 500 ? 'Internal server error.' : 'Request failed.');
  return res.status(safeStatus).json({ error: message });
}

function publicErrorMessage(error, fallback = 'Request failed.') {
  const status = Number(error?.status || 500);
  if (error?.expose && status >= 400 && status < 500 && error.message) {
    return error.message;
  }
  return fallback;
}

function safeTaskError(error, fallback = 'Task failed.') {
  return {
    message: publicErrorMessage(error, fallback),
    ...(error?.code ? { code: error.code } : {}),
  };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeSensitiveText(value, limit = 500) {
  const text = String(value || '');
  if (!text) return '';

  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|ak|ark)-[A-Za-z0-9_-]{8,}\b/gi, '[redacted-key]')
    .replace(/\b(api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*[^,\s"'{}]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/data:[^\s"'<>]+/gi, '[redacted-data-url]')
    .slice(0, limit);
}

function stringField(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return sanitizeSensitiveText(value.trim());
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function headerField(headers = {}, ...names) {
  const normalized = asRecord(headers);
  for (const name of names) {
    const value = normalized[name] ?? normalized[name.toLowerCase()] ?? normalized[name.toUpperCase()];
    const text = stringField(value);
    if (text) return text;
  }
  return '';
}

function extractUpstreamErrorDetails(result = {}) {
  const status = Number(result?.status || 0);
  const data = asRecord(result.data);
  const error = asRecord(data.error);
  const canUseStringError = status >= 400 && status < 500;
  const stringError = canUseStringError && typeof data.error === 'string' ? data.error : '';
  const output = asRecord(data.output);
  const outputError = asRecord(output.error);
  const innerData = asRecord(data.data);
  const innerDataError = asRecord(innerData.error);

  const requestId = stringField(
    data.request_id,
    data.requestId,
    data.RequestId,
    data.requestID,
    data.RequestID,
    data.req_id,
    data.trace_id,
    error.request_id,
    error.requestId,
    error.RequestId,
    output.request_id,
    output.RequestId,
    outputError.request_id,
    outputError.requestId,
    outputError.RequestId,
    innerData.request_id,
    innerData.RequestId,
    innerDataError.request_id,
    innerDataError.requestId,
    innerDataError.RequestId,
    headerField(result.headers, 'x-request-id', 'x-tt-logid', 'x-acs-request-id', 'request-id')
  );

  return {
    code: stringField(
      error.code,
      error.Code,
      error.error_code,
      error.ErrorCode,
      data.code,
      data.Code,
      data.error_code,
      data.ErrorCode,
      data.err_code,
      output.code,
      output.Code,
      outputError.code,
      outputError.Code,
      outputError.error_code,
      outputError.ErrorCode,
      innerData.code,
      innerData.Code,
      innerDataError.code,
      innerDataError.Code,
      innerDataError.error_code
    ),
    type: stringField(error.type, error.Type, data.type, data.Type, data.error_type, output.type, outputError.type, innerData.type, innerDataError.type),
    message: stringField(
      stringError,
      error.message,
      error.Message,
      data.message,
      data.Message,
      data.msg,
      data.error_message,
      data.error_description,
      data.ErrorMessage,
      output.message,
      output.Message,
      outputError.message,
      outputError.Message,
      outputError.error_message,
      outputError.ErrorMessage,
      innerData.message,
      innerData.Message,
      innerDataError.message,
      innerDataError.Message,
      innerDataError.error_message
    ),
    param: stringField(error.param, data.param, outputError.param, innerDataError.param),
    requestId,
  };
}

function includesAny(text, words) {
  const normalized = String(text || '').toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  return words.some((word) => {
    const normalizedWord = String(word || '').toLowerCase();
    const compactWord = normalizedWord.replace(/[^a-z0-9]+/g, '');
    return normalized.includes(normalizedWord) || Boolean(compactWord && compact.includes(compactWord));
  });
}

function classifyUpstreamError(result = {}, details = {}) {
  const status = Number(result?.status || 0);
  const joined = [
    details.code,
    details.type,
    details.message,
    result?.statusText,
  ].filter(Boolean).join(' ').toLowerCase();

  if (status === 408 || status === 504 || includesAny(joined, ['timeout', 'timed out', 'deadline'])) {
    return { category: 'timeout', retryable: true };
  }

  if (
    status === 429 ||
    includesAny(joined, ['rate limit', 'too many', 'throttle', 'throttling', 'qps', 'rpm'])
  ) {
    return { category: 'rate_limit', retryable: true };
  }

  if (
    status === 401 ||
    status === 403 ||
    includesAny(joined, ['unauthorized', 'forbidden', 'invalid api key', 'invalid_api_key', 'authentication'])
  ) {
    return { category: 'auth', retryable: false };
  }

  if (
    includesAny(joined, [
      'content policy',
      'content_filter',
      'datainspection',
      'data inspection',
      'data_inspection',
      'inspection failed',
      'inappropriate',
      'risk',
      'safety',
      'sensitive',
    ])
  ) {
    return { category: 'content_policy', retryable: false };
  }

  if (status === 404 || includesAny(joined, ['not found', 'not_found'])) {
    return { category: 'not_found', retryable: false };
  }

  if (includesAny(joined, ['quota', 'insufficient balance', 'balance not enough', 'billing'])) {
    return { category: 'quota', retryable: false };
  }

  if (status >= 500 || includesAny(joined, ['server error', 'internal error', 'bad gateway', 'service unavailable'])) {
    return { category: 'server', retryable: true };
  }

  if (
    status === 400 ||
    status === 422 ||
    includesAny(joined, ['invalid', 'unsupported', 'bad request', 'invalid_request', 'parameter'])
  ) {
    return { category: 'invalid_request', retryable: false };
  }

  return { category: 'unknown', retryable: false };
}

function safeUpstreamTaskError(result, fallback = 'Upstream request failed.') {
  const details = extractUpstreamErrorDetails(result);
  const normalized = classifyUpstreamError(result, details);
  const statusText = sanitizeSensitiveText(result?.statusText || '');
  const upstream = {
    status: result?.status || null,
    statusText,
    category: normalized.category,
    retryable: normalized.retryable,
    ...(details.code ? { code: details.code } : {}),
    ...(details.type ? { type: details.type } : {}),
    ...(details.message ? { message: details.message } : {}),
    ...(details.param ? { param: details.param } : {}),
    ...(details.requestId ? { requestId: details.requestId } : {}),
  };

  return {
    message: fallback,
    upstreamStatus: result?.status || null,
    upstreamStatusText: statusText,
    upstreamCategory: normalized.category,
    upstreamRetryable: normalized.retryable,
    ...(details.code ? { upstreamCode: details.code } : {}),
    ...(details.type ? { upstreamType: details.type } : {}),
    ...(details.message ? { upstreamMessage: details.message } : {}),
    ...(details.param ? { upstreamParam: details.param } : {}),
    ...(details.requestId ? { upstreamRequestId: details.requestId } : {}),
    upstream,
  };
}

function safeErrorData(error, fallback = 'Request failed.') {
  return {
    error: fallback,
    ...(error?.code ? { code: error.code } : {}),
  };
}

function safeUpstreamErrorData(result, fallback = 'Upstream request failed.') {
  return {
    error: safeUpstreamTaskError(result, fallback),
  };
}

function safeUpstreamErrorMessage(result, fallback = 'Upstream request failed.') {
  const normalized = safeUpstreamTaskError(result, fallback);
  const data = asRecord(result?.data);
  const rawStringError = typeof data.error === 'string' ? sanitizeSensitiveText(data.error) : '';
  const detail = rawStringError ||
    normalized.upstreamMessage ||
    normalized.upstreamCode ||
    normalized.upstreamType ||
    normalized.message ||
    fallback;
  const status = normalized.upstreamStatus ? `HTTP ${normalized.upstreamStatus}` : '';
  return [status, detail].filter(Boolean).join(': ');
}

module.exports = {
  classifyUpstreamError,
  publicErrorMessage,
  safeErrorData,
  safeUpstreamErrorMessage,
  safeTaskError,
  safeUpstreamErrorData,
  safeUpstreamTaskError,
  sendSafeError,
};
