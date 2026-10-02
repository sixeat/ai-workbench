// 积分定价。
//
// 单价有三个来源，按优先级从高到低：
//   1. 调用方显式传入的 modelCreditCost（平台模型上的覆盖价）
//   2. 选中模型能力表里的 creditCost（按模型分档，见 modelCapabilities.cjs 的 preset）
//   3. 全局默认单价（环境变量，兜底）
//
// 为什么要按模型分档：不同模型的上游成本差好几个量级——
// 文本约 ¥0.005/次、图片约 ¥0.4/张、视频约 ¥3/条（5 秒 720P）。
// 用同一套全局单价收所有模型，低档会亏、高档会赶客。
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

/**
 * 只挑出有效的成本字段。
 *
 * 刻意不把 `0` 当成"缺失"——显式写 0 表示免费，是合法配置。
 * 但负数与非法值要忽略，否则会算出负价。
 */
function sanitizeCreditCost(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of ['imagePerItem', 'textPerRequest', 'videoPerSecond']) {
    if (!Object.hasOwn(value, key)) continue;
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0) continue;
    result[key] = number;
  }
  return result;
}

/**
 * 解析某次调用实际适用的单价。
 *
 * 逐字段回退：模型只声明了 videoPerSecond 时，图片与文本仍走全局默认，
 * 这样 preset 可以只写关心的那一项。
 */
function resolveUnitPrices({ modelCreditCost, prices, nodeType }) {
  const modelCost = sanitizeCreditCost(modelCreditCost);
  const key = nodeType === 'image' ? 'imagePerItem' : nodeType === 'video' ? 'videoPerSecond' : 'textPerRequest';
  const modelUnit = Object.hasOwn(modelCost, key) ? modelCost[key] : undefined;
  return {
    modelUnit,
    prices: { ...prices, ...modelCost },
    source: modelUnit === undefined ? 'global' : 'model',
    unit: modelUnit === undefined ? prices[key] : modelUnit,
  };
}

function createCreditPricingService({ env = process.env, prices: priceOverrides = {} } = {}) {
  const prices = {
    ...resolveCreditPrices(env),
    ...priceOverrides,
  };

  /**
   * 估算一次任务的积分消耗。
   *
   * @param modelCreditCost 选中模型声明的单价（能力表的 creditCost，或平台模型覆盖价）
   */
  function estimate({ body = {}, keyScope = 'server', modelCreditCost, nodeType }) {
    const normalizedNodeType = String(nodeType || '').trim().toLowerCase();
    const normalizedKeyScope = normalizeKeyScope(keyScope);
    const multiplier = multiplierForKeyScope(normalizedKeyScope, prices);
    const resolved = resolveUnitPrices({ modelCreditCost, nodeType: normalizedNodeType, prices });

    let quantity = 1;
    let unitName = 'request';

    if (normalizedNodeType === 'text') {
      quantity = 1;
    } else if (normalizedNodeType === 'image') {
      quantity = imageQuantity(body);
      unitName = 'image';
    } else if (normalizedNodeType === 'video') {
      // 时长缺失时用全局默认秒数；模型也可以声明自己的默认时长
      quantity = positiveInteger(
        body.duration ?? body.seconds ?? body.videoSeconds,
        positiveInteger(resolved.prices.videoDefaultSeconds ?? prices.videoDefaultSeconds, prices.videoDefaultSeconds)
      );
      unitName = 'second';
    }

    const cost = Math.max(0, Math.ceil(resolved.unit * quantity * multiplier));
    return {
      billable: cost > 0,
      cost,
      keyScope: normalizedKeyScope,
      nodeType: normalizedNodeType,
      priceSource: resolved.source,
      quantity,
      unit: resolved.unit,
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
  resolveUnitPrices,
  sanitizeCreditCost,
  videoSeconds,
};
