const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MODEL_CAPABILITY_LIMITS,
  createModelCapabilityService,
} = require('./services/modelCapabilityService.cjs');

function createModelCapabilityRepository(initial = []) {
  const auditLogs = [];
  const capabilities = new Map();

  for (const item of initial) {
    capabilities.set(`${item.providerId}:${item.modelPattern}`, {
      id: `${item.providerId}:${item.modelPattern}`,
      ...item,
    });
  }

  function list(query = {}) {
    const limit = Number(query.limit || 500);
    const offset = Number(query.offset || 0);
    const providerId = String(query.providerId || '').trim();
    const search = String(query.search || query.q || '').trim().toLowerCase();
    return Array.from(capabilities.values())
      .filter((item) => !providerId || item.providerId === providerId)
      .filter((item) => !search || item.providerId.toLowerCase().includes(search) || item.modelPattern.toLowerCase().includes(search))
      .sort((a, b) => `${a.providerId}:${a.modelPattern}`.localeCompare(`${b.providerId}:${b.modelPattern}`))
      .slice(offset, offset + limit);
  }

  return {
    auditLogs,
    capabilities,
    countModelCapabilities(query = {}) {
      return list({ ...query, limit: 10_000, offset: 0 }).length;
    },
    createAuditLog(log) {
      const next = {
        ...log,
        id: `audit-${auditLogs.length + 1}`,
      };
      auditLogs.push(next);
      return next;
    },
    listModelCapabilities: list,
    upsertModelCapability(providerId, modelPattern, capabilityValue) {
      capabilities.set(`${providerId}:${modelPattern}`, {
        capabilities: capabilityValue,
        id: `${providerId}:${modelPattern}`,
        modelPattern,
        providerId,
      });
    },
  };
}

function createRequest(userId = 'admin-1') {
  return {
    authUser: { id: userId },
    headers: { 'user-agent': 'Model Capability Browser' },
    socket: { remoteAddress: '198.51.100.88' },
  };
}

test('model capability service lists capabilities with pagination filters', () => {
  const repository = createModelCapabilityRepository([
    {
      capabilities: { imageGeneration: true },
      modelPattern: 'alpha-image-*',
      providerId: 'demo',
    },
    {
      capabilities: { videoGeneration: true },
      modelPattern: 'beta-video-*',
      providerId: 'demo',
    },
    {
      capabilities: { imageGeneration: true },
      modelPattern: 'alpha-hidden-*',
      providerId: 'other',
    },
  ]);
  const service = createModelCapabilityService({ modelCapabilityRepository: repository });

  const page = service.listCapabilities({ providerId: 'demo', search: 'image', limit: 1 });

  assert.equal(page.count, 1);
  assert.equal(page.total, 1);
  assert.equal(page.limit, 1);
  assert.equal(page.capabilities[0].modelPattern, 'alpha-image-*');
});

test('model capability service saves capabilities and writes safe create audit metadata', () => {
  const repository = createModelCapabilityRepository();
  const service = createModelCapabilityService({
    getRequestUserId: () => 'fallback-admin',
    modelCapabilityRepository: repository,
  });

  const capability = service.saveCapability(createRequest('admin-1'), {
    capabilities: {
      imageGeneration: true,
      image: { maxImages: 2, internalNote: 'do-not-log' },
    },
    modelPattern: 'image-*',
    providerId: 'demo',
  });

  assert.equal(capability.id, 'demo:image-*');
  assert.equal(capability.capabilities.chat, true);
  assert.equal(capability.capabilities.imageGeneration, true);
  assert.equal(capability.capabilities.image.maxImages, 2);
  assert.deepEqual(repository.auditLogs[0].metadata, {
    capabilityKeys: ['image', 'imageGeneration'],
    modelPattern: 'image-*',
    operation: 'create',
    providerId: 'demo',
  });
  assert.equal(JSON.stringify(repository.auditLogs[0].metadata).includes('do-not-log'), false);
  assert.equal(repository.auditLogs[0].actorUserId, 'admin-1');
});

test('model capability service updates capabilities and logs previous keys only', () => {
  const repository = createModelCapabilityRepository([
    {
      capabilities: {
        imageGeneration: true,
        image: { maxImages: 1, internalNote: 'old-secret' },
        seed: true,
      },
      modelPattern: 'pro-*',
      providerId: 'demo',
    },
  ]);
  const service = createModelCapabilityService({ modelCapabilityRepository: repository });

  service.saveCapability(createRequest(), {
    capabilities: {
      videoGeneration: true,
      video: { durationMax: 8, internalNote: 'new-secret' },
    },
    modelPattern: 'pro-*',
    providerId: 'demo',
  });

  assert.deepEqual(repository.auditLogs[0].metadata, {
    capabilityKeys: ['video', 'videoGeneration'],
    modelPattern: 'pro-*',
    operation: 'update',
    previousCapabilityKeys: ['image', 'imageGeneration', 'seed'],
    providerId: 'demo',
  });
  assert.equal(JSON.stringify(repository.auditLogs[0].metadata).includes('old-secret'), false);
  assert.equal(JSON.stringify(repository.auditLogs[0].metadata).includes('new-secret'), false);
});

test('model capability service rejects unsafe input before writing or auditing', () => {
  const repository = createModelCapabilityRepository();
  const service = createModelCapabilityService({ modelCapabilityRepository: repository });

  assert.throws(
    () => service.saveCapability(createRequest(), {
      capabilities: {},
      modelPattern: 'valid-*',
      providerId: 'bad/provider',
    }),
    /providerId can only include/
  );
  assert.throws(
    () => service.saveCapability(createRequest(), {
      capabilities: {},
      modelPattern: 'x'.repeat(MODEL_CAPABILITY_LIMITS.maxModelPatternLength + 1),
      providerId: 'demo',
    }),
    /modelPattern can include at most/
  );
  assert.throws(
    () => service.saveCapability(createRequest(), {
      capabilities: ['bad'],
      modelPattern: 'valid-*',
      providerId: 'demo',
    }),
    /capabilities must be an object/
  );

  assert.equal(repository.capabilities.size, 0);
  assert.equal(repository.auditLogs.length, 0);
});
