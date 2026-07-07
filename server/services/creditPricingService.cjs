const DEFAULT_PRICES = Object.freeze({
  imagePerItem: 10,
  textPerRequest: 1,
  userKeyMultiplier: 0,
  videoDefaultSeconds: 5,
  videoPerSecond: 20,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  return Math.max(1, Math.ceil(finiteNumber(value, fallback)));
}

function envNumber(env, name, fallback) {
  if (env[name] == null || env[name] === '') return fallback;
  const number = Number(env[name]);
  return Number.isFinite(number) ? number : fallback;
}

function resolveCreditPrices(env = process.env) {
  return {
    imagePerItem: envNumber(env, 'WORKBENCH_CREDIT_IMAGE_COST', DEFAULT_PRICES.imagePerItem),
    textPerRequest: envNumber(env, 'WORKBENCH_CREDIT_TEXT_COST', DEFAULT_PRICES.textPerRequest),
    userKeyMultiplier: envNumber(env, 'WORKBENCH_CREDIT_USER_KEY_MULTIPLIER', DEFAULT_PRICES.userKeyMultiplier),
    videoDefaultSeconds: envNumber(env, 'WORKBENCH_CREDIT_DEFAULT_VIDEO_SECONDS', DEFAULT_PRICES.videoDefaultSeconds),
    videoPerSecond: envNumber(env, 'WORKBENCH_CREDIT_VIDEO_SECOND_COST', DEFAULT_PRICES.videoPerSecond),
  };
}

function normalizeKeyScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'user_key' || scope === 'user') return 'user';
  if (scope === 'server_key' || scope === 'server') return 'server';
  return 'server';
}

function multiplierForKeyScope(keyScope, prices) {
  return normalizeKeyScope(keyScope) === 'user' ? prices.userKeyMultiplier : 1;
}

function imageQuantity(body = {}) {
  return positiveInteger(body.n ?? body.count ?? body.imageCount, 1);
}

function videoSeconds(body = {}, prices = DEFAULT_PRICES) {
  return positiveInteger(body.duration ?? body.seconds ?? body.videoSeconds, prices.videoDefaultSeconds);
}

function createCreditPricingService({ env = process.env, prices: priceOverrides = {} } = {}) {
  const prices = {
    ...resolveCreditPrices(env),
    ...priceOverrides,
  };

  function estimate({ body = {}, keyScope = 'server', nodeType }) {
    const normalizedNodeType = String(nodeType || '').trim().toLowerCase();
    const normalizedKeyScope = normalizeKeyScope(keyScope);
    const multiplier = multiplierForKeyScope(normalizedKeyScope, prices);
    let unit = 0;
    let quantity = 1;
    let unitName = 'request';

    if (normalizedNodeType === 'text') {
      unit = prices.textPerRequest;
      quantity = 1;
    } else if (normalizedNodeType === 'image') {
      unit = prices.imagePerItem;
      quantity = imageQuantity(body);
      unitName = 'image';
    } else if (normalizedNodeType === 'video') {
      unit = prices.videoPerSecond;
      quantity = videoSeconds(body, prices);
      unitName = 'second';
    }

    const cost = Math.max(0, Math.ceil(unit * quantity * multiplier));
    return {
      billable: cost > 0,
      cost,
      keyScope: normalizedKeyScope,
      nodeType: normalizedNodeType,
      quantity,
      unit,
      unitName,
    };
  }

  return {
    estimate,
    prices,
  };
}

module.exports = {
  DEFAULT_PRICES,
  createCreditPricingService,
  imageQuantity,
  normalizeKeyScope,
  resolveCreditPrices,
  videoSeconds,
};
