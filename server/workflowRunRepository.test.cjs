// 工作流运行数据访问的回归测试。
//
// 关注两件事：
// 1. 仓储只是薄转发，overrides 能替换每个方法（拆分服务时靠它注入）。
// 2. 多租户隔离：按用户查询与按幂等键查询都不能跨用户命中。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-wfrun-repo-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { createUser, db } = require('./db.cjs');
const {
  createWorkflowRunRepository,
  workflowRunRepository,
} = require('./repositories/workflowRunRepository.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const EXPECTED_METHODS = [
  'countWorkflowRuns',
  'createWorkflowRun',
  'createWorkflowRunNode',
  'getTaskByWorkflowRunNode',
  'getWorkflowRun',
  'getWorkflowRunByIdempotencyKey',
  'getWorkflowRunForUser',
  'getWorkflowRunNode',
  'linkWorkflowRunNodeTask',
  'listActiveWorkflowRuns',
  'listWorkflowRunNodes',
  'listWorkflowRuns',
  'updateWorkflowRun',
  'updateWorkflowRunNode',
];

test('工作流运行仓储暴露完整的数据访问方法集', () => {
  for (const method of EXPECTED_METHODS) {
    assert.equal(typeof workflowRunRepository[method], 'function', `缺少方法 ${method}`);
  }
  assert.deepEqual(Object.keys(workflowRunRepository).sort(), [...EXPECTED_METHODS].sort());
});

test('工作流运行仓储的每个方法都可以被 overrides 替换', () => {
  const overrides = Object.fromEntries(EXPECTED_METHODS.map((method) => [method, () => `stub:${method}`]));
  const repository = createWorkflowRunRepository(overrides);

  for (const method of EXPECTED_METHODS) {
    assert.equal(repository[method](), `stub:${method}`, `${method} 未被替换`);
  }
});

test('未提供 overrides 时回落到真实实现', () => {
  const repository = createWorkflowRunRepository();
  for (const method of EXPECTED_METHODS) {
    assert.equal(typeof repository[method], 'function', `${method} 未回落到默认实现`);
  }
});

test('按用户与按幂等键查询都不会跨用户命中', () => {
  const alice = createUser({
    email: 'wfrun-alice@example.com',
    username: 'wfrun-alice@example.com',
    name: 'Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'wfrun-bob@example.com',
    username: 'wfrun-bob@example.com',
    name: 'Bob',
    passwordHash: 'test',
  });

  const run = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-shared-id',
    userId: alice.id,
    status: 'queued',
    idempotencyKey: 'same-key',
    definition: { nodes: [], edges: [] },
  });

  assert.equal(workflowRunRepository.getWorkflowRunForUser(run.id, alice.id)?.id, run.id);
  assert.equal(workflowRunRepository.getWorkflowRunForUser(run.id, bob.id), null);
  assert.equal(workflowRunRepository.getWorkflowRunByIdempotencyKey(alice.id, 'same-key')?.id, run.id);
  assert.equal(workflowRunRepository.getWorkflowRunByIdempotencyKey(bob.id, 'same-key'), null);
  assert.equal(workflowRunRepository.listWorkflowRuns(bob.id).length, 0);
  assert.equal(workflowRunRepository.countWorkflowRuns(bob.id), 0);
});

test('同一用户的幂等键唯一，不同用户可复用同一个键', () => {
  const carol = createUser({
    email: 'wfrun-carol@example.com',
    username: 'wfrun-carol@example.com',
    name: 'Carol',
    passwordHash: 'test',
  });
  const dave = createUser({
    email: 'wfrun-dave@example.com',
    username: 'wfrun-dave@example.com',
    name: 'Dave',
    passwordHash: 'test',
  });

  const first = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-1',
    userId: carol.id,
    idempotencyKey: 'dup-key',
    definition: { nodes: [], edges: [] },
  });
  assert.ok(first);

  assert.throws(
    () => workflowRunRepository.createWorkflowRun({
      workflowId: 'wf-1',
      userId: carol.id,
      idempotencyKey: 'dup-key',
      definition: { nodes: [], edges: [] },
    }),
    /UNIQUE|constraint/i,
    '同一用户重复使用幂等键应当被唯一索引拒绝'
  );

  const other = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-1',
    userId: dave.id,
    idempotencyKey: 'dup-key',
    definition: { nodes: [], edges: [] },
  });
  assert.ok(other, '不同用户应当可以使用同一个幂等键');
  assert.notEqual(other.id, first.id);
});

test('不传幂等键的运行不参与唯一约束', () => {
  const erin = createUser({
    email: 'wfrun-erin@example.com',
    username: 'wfrun-erin@example.com',
    name: 'Erin',
    passwordHash: 'test',
  });

  const a = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-1',
    userId: erin.id,
    definition: { nodes: [], edges: [] },
  });
  const b = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-1',
    userId: erin.id,
    definition: { nodes: [], edges: [] },
  });

  assert.notEqual(a.id, b.id);
  assert.equal(workflowRunRepository.getWorkflowRunByIdempotencyKey(erin.id, ''), null);
});

test('节点按 run + nodeId 幂等 upsert，不会产生重复行', () => {
  const frank = createUser({
    email: 'wfrun-frank@example.com',
    username: 'wfrun-frank@example.com',
    name: 'Frank',
    passwordHash: 'test',
  });
  const run = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-1',
    userId: frank.id,
    definition: { nodes: [], edges: [] },
  });

  workflowRunRepository.createWorkflowRunNode({
    runId: run.id,
    nodeId: 'node-1',
    nodeType: 'textInput',
    status: 'pending',
  });
  const updated = workflowRunRepository.createWorkflowRunNode({
    runId: run.id,
    nodeId: 'node-1',
    nodeType: 'textInput',
    status: 'succeeded',
    output: { text: 'hello' },
  });

  assert.equal(updated.status, 'succeeded');
  assert.deepEqual(updated.output, { text: 'hello' });
  assert.equal(workflowRunRepository.listWorkflowRunNodes(run.id).length, 1, '不应产生重复节点行');
});

test('活跃运行扫描排除终态，且工作流删除后运行仍可读', () => {
  const grace = createUser({
    email: 'wfrun-grace@example.com',
    username: 'wfrun-grace@example.com',
    name: 'Grace',
    passwordHash: 'test',
  });
  // 刻意用一个不存在于 workflows 表的 id：运行记录必须能独立存活
  const orphaned = workflowRunRepository.createWorkflowRun({
    workflowId: 'wf-does-not-exist',
    userId: grace.id,
    status: 'running',
    definition: { nodes: [], edges: [] },
  });

  const active = workflowRunRepository.listActiveWorkflowRuns();
  assert.equal(active.some((item) => item.id === orphaned.id), true, 'running 应出现在活跃列表');

  workflowRunRepository.updateWorkflowRun(orphaned.id, { status: 'succeeded' });
  const afterDone = workflowRunRepository.listActiveWorkflowRuns();
  assert.equal(afterDone.some((item) => item.id === orphaned.id), false, '终态不应出现在活跃列表');
  assert.equal(workflowRunRepository.getWorkflowRun(orphaned.id)?.status, 'succeeded');
});
