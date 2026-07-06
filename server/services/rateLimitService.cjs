function requestIp(req, trustForwardedFor = false) {
  const forwarded = trustForwardedFor
    ? String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
    : '';
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function cleanupBuckets(buckets, now) {
  for (const [bucketKey, value] of buckets.entries()) {
    if (value.resetAt <= now) buckets.delete(bucketKey);
  }
}

function createRateLimitFactory(options = {}) {
  const {
    maxBuckets = 10_000,
    now = () => Date.now(),
    trustForwardedFor = false,
  } = options;

  return function rateLimit({ windowMs, max, label }) {
    const buckets = new Map();

    return (req, res, next) => {
      const currentTime = now();
      if (buckets.size > maxBuckets) cleanupBuckets(buckets, currentTime);

      const key = `${label}:${requestIp(req, trustForwardedFor)}`;
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= currentTime) {
        buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
        return next();
      }

      bucket.count += 1;
      if (bucket.count > max) {
        res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - currentTime) / 1000)));
        return res.status(429).json({ error: `Too many ${label} requests. Please try again later.` });
      }

      return next();
    };
  };
}

module.exports = {
  createRateLimitFactory,
  requestIp,
};
