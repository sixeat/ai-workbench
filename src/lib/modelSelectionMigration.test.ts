import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWorkflowModelSelections } from './modelSelectionMigration';
import type { ProxyApiKeyModel } from './apiProxy';

function personalModel(id: string, apiKeyId: string, upstreamModel: string): ProxyApiKeyModel {
  return {
    id,
    apiKeyId,
    upstreamModel,
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-chat',
    displayName: upstreamModel,
    capabilities: { chat: true },
    capabilitySource: 'matched-rules',
    isEnabled: true,
    discoveryStatus: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('legacy user key and model fields migrate to a stable personal model selection', () => {
  const nodes: Array<{ data: { config: Record<string, unknown> } }> = [
    { data: { config: { instanceId: 'user:key-a', model: 'same-model' } } },
  ];
  const result = migrateWorkflowModelSelections(nodes, [
    personalModel('model-a', 'key-a', 'same-model'),
    personalModel('model-b', 'key-b', 'same-model'),
  ]);

  assert.equal(result.migratedCount, 1);
  assert.equal(result.nodes[0].data?.config?.apiKeyModelId, 'model-a');
  assert.deepEqual(result.nodes[0].data?.config?.modelSelection, {
    source: 'personal',
    apiKeyModelId: 'model-a',
  });
});

test('ambiguous legacy models and removed server key selections are not guessed', () => {
  const nodes = [
    { data: { config: { instanceId: 'legacy-local', model: 'same-model' } } },
    { data: { config: { instanceId: 'server:old-key', model: 'same-model' } } },
  ];
  const result = migrateWorkflowModelSelections(nodes, [
    personalModel('model-a', 'key-a', 'same-model'),
    personalModel('model-b', 'key-b', 'same-model'),
  ]);

  assert.equal(result.migratedCount, 0);
  assert.equal(result.nodes[0], nodes[0]);
  assert.equal(result.nodes[1], nodes[1]);
});

test('existing stable IDs receive a ModelSelection without changing their route', () => {
  const nodes: Array<{ data: { config: Record<string, unknown> } }> = [
    { data: { config: { apiKeyModelId: 'model-a' } } },
    { data: { config: { platformModelId: 'platform-a' } } },
  ];
  const result = migrateWorkflowModelSelections(nodes, []);

  assert.equal(result.migratedCount, 2);
  assert.deepEqual(result.nodes[0].data?.config?.modelSelection, {
    source: 'personal',
    apiKeyModelId: 'model-a',
  });
  assert.deepEqual(result.nodes[1].data?.config?.modelSelection, {
    source: 'platform',
    platformModelId: 'platform-a',
  });
});
