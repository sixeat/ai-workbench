const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyUpstreamError,
  safeUpstreamErrorData,
  safeUpstreamErrorMessage,
  safeTaskError,
  safeUpstreamTaskError,
} = require('./httpErrors.cjs');

test('safeTaskError hides internal error messages by default', () => {
  const error = Object.assign(new Error('database path C:\\secret\\db.sqlite failed'), { status: 500 });
  assert.deepEqual(
    safeTaskError(error, 'Image generation failed.'),
    { message: 'Image generation failed.' }
  );
});

test('safeTaskError can expose marked client errors', () => {
  const error = Object.assign(new Error('Direct API credentials are disabled.'), {
    expose: true,
    status: 400,
  });

  assert.deepEqual(
    safeTaskError(error, 'Request failed.'),
    { message: 'Direct API credentials are disabled.' }
  );
});

test('safeUpstreamTaskError stores only an upstream summary', () => {
  const result = {
    status: 502,
    statusText: 'Bad Gateway',
    data: {
      error: 'secret upstream payload',
      token: 'should-not-be-stored',
    },
  };

  assert.deepEqual(
    safeUpstreamTaskError(result, 'Upstream failed.'),
    {
      message: 'Upstream failed.',
      upstreamStatus: 502,
      upstreamStatusText: 'Bad Gateway',
      upstreamCategory: 'server',
      upstreamRetryable: true,
      upstream: {
        status: 502,
        statusText: 'Bad Gateway',
        category: 'server',
        retryable: true,
      },
    }
  );
});

test('safeUpstreamTaskError extracts known provider fields without storing raw payloads', () => {
  const result = {
    status: 400,
    statusText: 'Bad Request',
    headers: {
      'x-request-id': 'req-header-1',
    },
    data: {
      error: {
        message: 'Model does not support reference images.',
        type: 'invalid_request_error',
        code: 'unsupported_reference_image',
        param: 'reference_images',
      },
      apiKey: 'should-not-be-stored',
    },
  };

  assert.deepEqual(
    safeUpstreamTaskError(result, 'Image generation upstream request failed.'),
    {
      message: 'Image generation upstream request failed.',
      upstreamStatus: 400,
      upstreamStatusText: 'Bad Request',
      upstreamCategory: 'invalid_request',
      upstreamRetryable: false,
      upstreamCode: 'unsupported_reference_image',
      upstreamType: 'invalid_request_error',
      upstreamMessage: 'Model does not support reference images.',
      upstreamParam: 'reference_images',
      upstreamRequestId: 'req-header-1',
      upstream: {
        status: 400,
        statusText: 'Bad Request',
        category: 'invalid_request',
        retryable: false,
        code: 'unsupported_reference_image',
        type: 'invalid_request_error',
        message: 'Model does not support reference images.',
        param: 'reference_images',
        requestId: 'req-header-1',
      },
    }
  );
});

test('safeUpstreamErrorData returns the same normalized error envelope for clients', () => {
  const data = safeUpstreamErrorData({
    status: 429,
    statusText: 'Too Many Requests',
    data: {
      code: 'Throttling',
      message: 'Rate limit exceeded.',
      request_id: 'dashscope-req-1',
    },
  }, 'Text generation upstream request failed.');

  assert.equal(data.error.message, 'Text generation upstream request failed.');
  assert.equal(data.error.upstreamStatus, 429);
  assert.equal(data.error.upstreamCategory, 'rate_limit');
  assert.equal(data.error.upstreamRetryable, true);
  assert.equal(data.error.upstreamCode, 'Throttling');
  assert.equal(data.error.upstreamMessage, 'Rate limit exceeded.');
  assert.equal(data.error.upstreamRequestId, 'dashscope-req-1');
});

test('safeUpstreamTaskError redacts URLs and keys from provider messages', () => {
  const error = safeUpstreamTaskError({
    status: 401,
    statusText: 'Unauthorized for https://private.example.com/file.png',
    data: {
      error: {
        code: 'invalid_api_key',
        message: 'Authorization: Bearer sk-secret123456 failed for https://private.example.com/file.png and data:image/png;base64,abc',
      },
    },
  }, 'Image generation upstream request failed.');

  const serialized = JSON.stringify(error);
  assert.equal(serialized.includes('sk-secret123456'), false);
  assert.equal(serialized.includes('private.example.com'), false);
  assert.equal(serialized.includes('data:image/png'), false);
  assert.equal(error.upstreamStatusText, 'Unauthorized for [redacted-url]');
  assert.equal(error.upstreamMessage, 'Authorization=[redacted] [redacted] failed for [redacted-url] and [redacted-data-url]');
  assert.equal(error.upstreamCategory, 'auth');
});

test('safeUpstreamErrorMessage returns a sanitized one-line provider error', () => {
  const message = safeUpstreamErrorMessage({
    status: 403,
    data: {
      error: 'Bearer ark-secret123456 cannot access https://private.example.com/model',
    },
  }, 'Model list request failed.');

  assert.equal(message, 'HTTP 403: Bearer [redacted] cannot access [redacted-url]');
  assert.equal(message.includes('ark-secret123456'), false);
  assert.equal(message.includes('private.example.com'), false);
});

test('safeUpstreamTaskError normalizes Volcengine rate limit errors', () => {
  const error = safeUpstreamTaskError({
    status: 429,
    statusText: 'Too Many Requests',
    headers: {
      'x-tt-logid': 'volc-log-1',
    },
    data: {
      error: {
        code: 'RateLimitExceeded',
        message: 'QPS exceeded.',
      },
    },
  }, 'Video generation upstream request failed.');

  assert.equal(error.upstreamCategory, 'rate_limit');
  assert.equal(error.upstreamRetryable, true);
  assert.equal(error.upstreamCode, 'RateLimitExceeded');
  assert.equal(error.upstreamRequestId, 'volc-log-1');
  assert.equal(error.upstream.category, 'rate_limit');
});

test('safeUpstreamTaskError normalizes DashScope output errors', () => {
  const error = safeUpstreamTaskError({
    status: 400,
    statusText: 'Bad Request',
    headers: {
      'x-acs-request-id': 'dashscope-header-1',
    },
    data: {
      output: {
        code: 'InvalidParameter',
        message: 'duration only supports configured values.',
        request_id: 'dashscope-output-1',
      },
      apiKey: 'should-not-be-stored',
    },
  }, 'Video generation upstream request failed.');

  assert.equal(error.upstreamCategory, 'invalid_request');
  assert.equal(error.upstreamRetryable, false);
  assert.equal(error.upstreamCode, 'InvalidParameter');
  assert.equal(error.upstreamMessage, 'duration only supports configured values.');
  assert.equal(error.upstreamRequestId, 'dashscope-output-1');
  assert.equal(JSON.stringify(error).includes('should-not-be-stored'), false);
});

test('safeUpstreamTaskError normalizes nested provider errors under output and data', () => {
  const outputError = safeUpstreamTaskError({
    status: 200,
    statusText: 'OK',
    headers: {
      'x-acs-request-id': 'dashscope-nested-header',
    },
    data: {
      output: {
        task_status: 'FAILED',
        request_id: 'dashscope-output-request',
        error: {
          code: 'InvalidParameter',
          message: 'resolution is not supported by this model.',
          param: 'resolution',
        },
      },
      apiKey: 'should-not-be-stored',
    },
  }, 'Video task failed upstream.');

  assert.equal(outputError.upstreamCategory, 'invalid_request');
  assert.equal(outputError.upstreamRetryable, false);
  assert.equal(outputError.upstreamCode, 'InvalidParameter');
  assert.equal(outputError.upstreamMessage, 'resolution is not supported by this model.');
  assert.equal(outputError.upstreamParam, 'resolution');
  assert.equal(outputError.upstreamRequestId, 'dashscope-output-request');
  assert.equal(JSON.stringify(outputError).includes('should-not-be-stored'), false);

  const innerDataError = safeUpstreamTaskError({
    status: 200,
    data: {
      data: {
        request_id: 'provider-inner-request',
        error: {
          code: 'AuthenticationFailed',
          message: 'invalid api key.',
        },
      },
    },
  }, 'Image generation upstream request failed.');

  assert.equal(innerDataError.upstreamCategory, 'auth');
  assert.equal(innerDataError.upstreamRetryable, false);
  assert.equal(innerDataError.upstreamCode, 'AuthenticationFailed');
  assert.equal(innerDataError.upstreamMessage, 'invalid api key.');
  assert.equal(innerDataError.upstreamRequestId, 'provider-inner-request');
});

test('safeUpstreamTaskError normalizes provider content policy errors', () => {
  const error = safeUpstreamTaskError({
    status: 400,
    statusText: 'Bad Request',
    data: {
      error: {
        code: 'SensitiveContentDetected',
        message: 'The input was blocked by the content policy.',
      },
    },
  }, 'Video generation upstream request failed.');

  assert.equal(error.upstreamCategory, 'content_policy');
  assert.equal(error.upstreamRetryable, false);
  assert.equal(error.upstreamCode, 'SensitiveContentDetected');
  assert.equal(error.upstreamMessage, 'The input was blocked by the content policy.');
});

test('classifyUpstreamError marks auth, quota, and timeout consistently', () => {
  assert.deepEqual(classifyUpstreamError({ status: 401 }, {}), { category: 'auth', retryable: false });
  assert.deepEqual(classifyUpstreamError({ status: 400 }, { message: 'insufficient balance' }), { category: 'quota', retryable: false });
  assert.deepEqual(classifyUpstreamError({ status: 504 }, {}), { category: 'timeout', retryable: true });
  assert.deepEqual(classifyUpstreamError({ status: 200 }, { code: 'DataInspectionFailed' }), { category: 'content_policy', retryable: false });
});

test('classifyUpstreamError handles compact provider error codes', () => {
  assert.deepEqual(classifyUpstreamError({ status: 400 }, { code: 'InvalidApiKey' }), { category: 'auth', retryable: false });
  assert.deepEqual(classifyUpstreamError({ status: 400 }, { code: 'TooManyRequests' }), { category: 'rate_limit', retryable: true });
  assert.deepEqual(classifyUpstreamError({ status: 400 }, { code: 'ModelNotFound' }), { category: 'not_found', retryable: false });
  assert.deepEqual(classifyUpstreamError({ status: 400 }, { code: 'ServiceUnavailable' }), { category: 'server', retryable: true });
});
