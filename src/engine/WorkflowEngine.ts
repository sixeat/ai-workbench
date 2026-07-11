import type { Edge, Node } from '@xyflow/react';
import type { NodeData, NodeInputs, NodeOutputs, NodeRunAssetSummary, NodeRunSummary } from '../types/nodes';
import { getNodeDefinition } from '../data/nodeRegistry';
import { inferTargetInputKey, MAIN_INPUT, MAIN_OUTPUT } from '../lib/connectionInference';
import { generateId } from '../lib/utils';
import { useCanvasStore } from '../stores/canvasStore';
import { useModelCatalogStore } from '../stores/modelCatalogStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { executeMerge, executePreview, executeTextInput, getExecutor } from './nodeExecutors';
import { validateNodeConfig, validateNodeInputs } from './nodeIoSchema';
import { makeModelContext } from './nodeExecutors/textGeneration';
import type { ExecutionContext, ExecutionEvent, ExecutionPatch, NodeExecutionResult, TextModelContext } from './executionTypes';

interface ExecuteOptions {
  force?: boolean;
}

interface ExecutionSink {
  startExecution: () => void;
  applyPatch: (patch: ExecutionPatch) => void;
  applyEvent: (event: ExecutionEvent) => void;
}

interface WorkflowEdgeData {
  sourceKey?: unknown;
  targetKey?: unknown;
}

function buildGraph(edges: Edge[]) {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    if (!inDegree.has(edge.source)) inDegree.set(edge.source, 0);
  }

  return { adj, inDegree };
}

function topologicalSort(nodes: Node<NodeData>[], edges: Edge[]): string[] {
  const { adj, inDegree } = buildGraph(edges);
  const queue: string[] = [];
  const result: string[] = [];

  for (const node of nodes) {
    if ((inDegree.get(node.id) || 0) === 0) queue.push(node.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adj.get(current) || []) {
      const nextDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) queue.push(neighbor);
    }
  }

  return result;
}

function primaryOutputKeyForNode(node: Node<NodeData>): string {
  const definition = getNodeDefinition(node.data.type);
  return definition?.connection?.primaryOutput || definition?.outputs[0]?.id || 'content';
}

function edgeData(edge: Edge): WorkflowEdgeData {
  return (edge.data || {}) as WorkflowEdgeData;
}

function pickMainOutput(node: Node<NodeData>): unknown {
  const outputs = node.data.outputs || {};
  const primaryOutput = primaryOutputKeyForNode(node);
  if (outputs[primaryOutput] !== undefined && outputs[primaryOutput] !== null) return outputs[primaryOutput];

  const preferred = [
    'negativePrompt',
    'style',
    'size',
    'quality',
    'seed',
    'count',
    'strength',
    'shotParams',
    'shotList',
    'image',
    'images',
    'prompt',
    'script',
    'text',
    'video',
    'task',
    'merged',
    'url',
    'content',
  ];

  for (const key of preferred) {
    if (outputs[key] !== undefined && outputs[key] !== null) return outputs[key];
  }

  const first = Object.values(outputs)[0];
  return first ?? outputs;
}

function shouldCollectMultipleInputs(inputKey: string, value: unknown): boolean {
  if (inputKey === 'prompt') return true;
  if (['image', 'images', 'referenceImage', 'referenceImages'].includes(inputKey)) return true;
  if (Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'image')) return true;
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'image';
}

function modelContextFromNode(node: Node<NodeData>): TextModelContext | null {
  const outputContext = node.data.outputs?.modelContext as TextModelContext | undefined;
  if (outputContext?.instanceId || outputContext?.apiKeyModelId || outputContext?.platformModelId) {
    return {
      ...outputContext,
      sourceNodeId: outputContext.sourceNodeId || node.id,
      sourceNodeType: outputContext.sourceNodeType || node.data.type,
      sourceNodeLabel: outputContext.sourceNodeLabel || node.data.label,
    };
  }

  if (!['textModel', 'script', 'shotSplit', 'promptOptimize'].includes(node.data.type)) return null;

  return makeModelContext(
    {
      instanceId: typeof node.data.config?.instanceId === 'string' ? node.data.config.instanceId : undefined,
      apiKeyModelId: typeof node.data.config?.apiKeyModelId === 'string' ? node.data.config.apiKeyModelId : undefined,
      platformModelId: typeof node.data.config?.platformModelId === 'string' ? node.data.config.platformModelId : undefined,
      model: typeof node.data.config?.model === 'string' ? node.data.config.model : undefined,
    },
    {
      sourceNodeId: node.id,
      sourceNodeType: node.data.type,
      sourceNodeLabel: node.data.label,
    }
  );
}

function getUpstreamModelContext(
  nodeId: string,
  edges: Edge[],
  nodeMap: Map<string, Node<NodeData>>
): TextModelContext | null {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;
    const context = modelContextFromNode(sourceNode);
    if (context?.instanceId || context?.apiKeyModelId || context?.platformModelId) return context;
  }
  return null;
}

function getExecutionContext(
  node: Node<NodeData>,
  edges: Edge[],
  nodeMap: Map<string, Node<NodeData>>
): ExecutionContext {
  return {
    nodeId: node.id,
    nodeType: node.data.type,
    nodeLabel: node.data.label,
    modelContext: getUpstreamModelContext(node.id, edges, nodeMap),
    upstreamTaskIds: collectDirectUpstreamTaskIds(node.id, edges, nodeMap),
  };
}

function getSelectedModelCapabilities(node: Node<NodeData>) {
  const platformModelId = typeof node.data.config.platformModelId === 'string'
    ? node.data.config.platformModelId
    : '';
  const apiKeyModelId = typeof node.data.config.apiKeyModelId === 'string'
    ? node.data.config.apiKeyModelId
    : '';
  const { platformModels, personalModels } = useModelCatalogStore.getState();

  if (platformModelId) {
    return platformModels.find((model) => model.id === platformModelId)?.capabilities || null;
  }

  if (apiKeyModelId) {
    return personalModels.find((model) => model.id === apiKeyModelId)?.capabilities || null;
  }

  return null;
}

function getNodeInputs(
  nodeId: string,
  edges: Edge[],
  nodeMap: Map<string, Node<NodeData>>
): NodeInputs {
  const inputs: NodeInputs = {};
  const targetNode = nodeMap.get(nodeId);
  if (!targetNode) return inputs;

  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;

    const rawSourceKey = String(edgeData(edge).sourceKey || edge.sourceHandle || MAIN_OUTPUT);
    const sourceKey = rawSourceKey === MAIN_OUTPUT ? primaryOutputKeyForNode(sourceNode) : rawSourceKey;
    const targetKey = String(edgeData(edge).targetKey || edge.targetHandle || MAIN_INPUT);
    const value = sourceNode.data.outputs[sourceKey] ?? pickMainOutput(sourceNode);
    const inputKey = targetKey === MAIN_INPUT
      ? inferTargetInputKey(sourceNode, targetNode, sourceKey, edges)
      : targetKey;

    if (inputs[inputKey] === undefined) {
      inputs[inputKey] = value;
    } else if (Array.isArray(inputs[inputKey])) {
      inputs[inputKey] = [...inputs[inputKey], value];
    } else if (shouldCollectMultipleInputs(inputKey, value)) {
      inputs[inputKey] = [inputs[inputKey], value];
    } else {
      inputs[inputKey] = value;
    }
  }

  return inputs;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectRunAssets(value: unknown, assets: NodeRunAssetSummary[] = []): NodeRunAssetSummary[] {
  if (!value) return assets;
  if (Array.isArray(value)) {
    for (const item of value) collectRunAssets(item, assets);
    return assets;
  }
  if (!isObjectRecord(value)) return assets;

  const type = String(value.type || '');
  const url = typeof value.url === 'string' ? value.url : '';
  if (url && (type === 'image' || type === 'video' || type === 'asset')) {
    assets.push({
      id: typeof value.id === 'string' ? value.id : undefined,
      type: type || 'asset',
      url,
      fileName: typeof value.fileName === 'string' ? value.fileName : undefined,
    });
  }

  for (const item of Object.values(value)) collectRunAssets(item, assets);
  return assets;
}

function uniqueRunAssets(assets: NodeRunAssetSummary[]): NodeRunAssetSummary[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = String(asset.id || asset.url || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksLikeTask(value: Record<string, unknown>): boolean {
  if (value.type === 'image' || value.type === 'video' || value.type === 'asset') return false;
  const status = String(value.status || '');
  return Boolean(
    typeof value.id === 'string' &&
    (
      value.kind ||
      value.nodeType ||
      value.input ||
      value.output ||
      value.upstream ||
      value.type === 'videoTask' ||
      ['queued', 'submitted', 'waiting_upstream', 'processing', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)
    )
  );
}

function collectTaskRecords(value: unknown, tasks: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!value) return tasks;
  if (Array.isArray(value)) {
    for (const item of value) collectTaskRecords(item, tasks);
    return tasks;
  }
  if (!isObjectRecord(value)) return tasks;
  if (looksLikeTask(value)) tasks.push(value);
  for (const item of Object.values(value)) collectTaskRecords(item, tasks);
  return tasks;
}

const PENDING_TASK_STATUSES = new Set(['queued', 'submitted', 'waiting_upstream', 'processing', 'running']);

function isPendingTask(task: Record<string, unknown>): boolean {
  return PENDING_TASK_STATUSES.has(String(task.status || '').toLowerCase());
}

function hasPendingTask(outputs: NodeOutputs): boolean {
  return collectTaskRecords(outputs).some(isPendingTask);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function taskNestedRecord(task: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = task[key];
  return isObjectRecord(value) ? value : null;
}

function taskOutputRecord(task: Record<string, unknown>): Record<string, unknown> | null {
  return taskNestedRecord(task, 'output');
}

function taskUpstreamRecord(task: Record<string, unknown>): Record<string, unknown> | null {
  const direct = taskNestedRecord(task, 'upstream');
  if (direct) return direct;
  const output = taskOutputRecord(task);
  return output ? taskNestedRecord(output, 'upstream') : null;
}

function addTaskId(ids: Set<string>, value: unknown) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) addTaskId(ids, item);
    return;
  }
  ids.add(String(value));
}

function collectDirectUpstreamTaskIds(
  nodeId: string,
  edges: Edge[],
  nodeMap: Map<string, Node<NodeData>>
): string[] {
  const ids = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;

    addTaskId(ids, sourceNode.data.lastRun?.taskIds);
    addTaskId(ids, sourceNode.data.lastRun?.taskId);

    for (const task of collectTaskRecords(sourceNode.data.outputs)) {
      addTaskId(ids, task.id);
    }
  }

  return [...ids];
}

function summarizeNodeRun(
  node: Node<NodeData>,
  outputs: NodeOutputs,
  durationMs: number,
  status: NodeRunSummary['status'],
  error?: string
): NodeRunSummary {
  const tasks = collectTaskRecords(outputs);
  const taskIds = [...new Set(tasks.map((task) => String(task.id)).filter(Boolean))];
  const assets = uniqueRunAssets(collectRunAssets(outputs));
  const firstTask = tasks[0];
  const upstream = firstTask ? taskUpstreamRecord(firstTask) : null;

  return {
    status,
    taskId: taskIds[0],
    taskIds,
    taskStatus: typeof firstTask?.status === 'string' ? firstTask.status : undefined,
    upstreamTaskId: firstString(firstTask?.upstreamTaskId, upstream?.taskId, upstream?.id),
    upstreamStatus: firstString(firstTask?.upstreamStatus, upstream?.status, upstream?.rawStatus),
    model: typeof firstTask?.model === 'string' ? firstTask.model : typeof node.data.config.model === 'string' ? node.data.config.model : undefined,
    providerId: typeof firstTask?.providerId === 'string' ? firstTask.providerId : undefined,
    durationMs,
    assetCount: assets.length,
    assets,
    error,
    completedAt: new Date().toISOString(),
  };
}

function makeExecutionFingerprint(node: Node<NodeData>, inputs: NodeInputs, context: ExecutionContext): string {
  return stableStringify({
    type: node.data.type,
    config: node.data.config,
    inputs,
    context: {
      modelContext: context.modelContext
        ? {
          instanceId: context.modelContext.instanceId,
          apiKeyModelId: context.modelContext.apiKeyModelId,
          platformModelId: context.modelContext.platformModelId,
          model: context.modelContext.model,
          sourceNodeId: context.modelContext.sourceNodeId,
        }
        : null,
    },
  });
}

function logEvent(node: Node<NodeData>, message: string, level: 'info' | 'success' | 'error'): ExecutionEvent {
  return {
    type: 'log',
    log: {
      id: generateId(),
      nodeId: node.id,
      nodeType: node.data.type,
      timestamp: Date.now(),
      message,
      level,
    },
  };
}

function applyExecutionPatchToNodeMap(patch: ExecutionPatch, nodeMap: Map<string, Node<NodeData>>) {
  const node = nodeMap.get(patch.nodeId);
  if (node) {
    nodeMap.set(patch.nodeId, { ...node, data: { ...node.data, ...patch.data } });
  }
}

function createStoreExecutionSink(): ExecutionSink {
  return {
    startExecution: () => useWorkflowStore.getState().startExecution(),
    applyPatch: (patch) => useCanvasStore.getState().updateNodeData(patch.nodeId, patch.data),
    applyEvent: (event) => {
      const workflow = useWorkflowStore.getState();
      if (event.type === 'log') workflow.addLog(event.log);
      if (event.type === 'progress') workflow.setProgress(event.progress);
      if (event.type === 'error') workflow.setError(event.error);
      if (event.type === 'complete') workflow.completeExecution();
    },
  };
}

function applyNodeExecutionResult(
  result: NodeExecutionResult,
  nodeMap: Map<string, Node<NodeData>>,
  sink: ExecutionSink
) {
  for (const patch of result.patches) {
    applyExecutionPatchToNodeMap(patch, nodeMap);
    sink.applyPatch(patch);
  }
  for (const event of result.events) sink.applyEvent(event);
}

async function runNodeWithInputs(
  node: Node<NodeData>,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const executor = getExecutor(node.data.type);
  if (executor) return executor(node.data.config, inputs, context);

  switch (node.data.type) {
    case 'textInput':
      return executeTextInput(node.data.config);
    case 'merge':
      return executeMerge(node.data.config, inputs);
    case 'preview':
      return executePreview(inputs);
    default:
      return { result: 'unknown' };
  }
}

async function* executeNodeInContext(
  nodeId: string,
  edges: Edge[],
  nodeMap: Map<string, Node<NodeData>>,
  options: ExecuteOptions = {}
): AsyncGenerator<NodeExecutionResult> {
  const node = nodeMap.get(nodeId);
  if (!node) {
    yield { ok: false, patches: [], events: [] };
    return;
  }

  const inputs = getNodeInputs(nodeId, edges, nodeMap);
  const context = getExecutionContext(node, edges, nodeMap);
  const inputValidation = validateNodeInputs(node.data, inputs);
  if (!inputValidation.ok) {
    const error = inputValidation.errors.join('\n');
    yield {
      ok: false,
      patches: [{
        nodeId,
        data: {
          status: 'error',
          inputs,
          outputs: { error },
          error,
        },
      }],
      events: [logEvent(node, `节点输入类型不匹配：${node.data.label} - ${error}`, 'error')],
    };
    return;
  }

  const configValidation = validateNodeConfig(node.data, getSelectedModelCapabilities(node));
  if (!configValidation.ok) {
    const error = configValidation.errors.join('\n');
    yield {
      ok: false,
      patches: [{
        nodeId,
        data: {
          status: 'error',
          inputs,
          outputs: { error },
          error,
        },
      }],
      events: [logEvent(node, `节点配置不完整：${node.data.label} - ${error}`, 'error')],
    };
    return;
  }

  const fingerprint = makeExecutionFingerprint(node, inputs, context);

  if (!options.force && node.data.status === 'completed' && node.data.executionFingerprint === fingerprint) {
    yield {
      ok: true,
      patches: [],
      events: [logEvent(node, `复用已完成节点：${node.data.label}`, 'info')],
    };
    return;
  }

  const runningPatch: ExecutionPatch = {
    nodeId,
    data: {
      status: 'running',
      error: undefined,
      lastRun: {
        status: 'running',
        model: typeof node.data.config.model === 'string' ? node.data.config.model : undefined,
        assetCount: 0,
        assets: [],
        startedAt: new Date().toISOString(),
      },
    },
  };

  yield {
    ok: true,
    patches: [runningPatch],
    events: [logEvent(node, `开始执行节点：${node.data.label}`, 'info')],
  };

  const startTime = Date.now();
  const outputs = await runNodeWithInputs(node, inputs, context);
  const durationMs = Date.now() - startTime;
  const hasError = Boolean(outputs.error);
  const hasPendingOutputTask = !hasError && hasPendingTask(outputs);
  const runStatus: NodeRunSummary['status'] = hasError ? 'error' : hasPendingOutputTask ? 'running' : 'completed';
  const nextData: Partial<NodeData> = {
    status: hasError ? 'error' : hasPendingOutputTask ? 'running' : 'completed',
    inputs,
    outputs,
    error: hasError ? String(outputs.error) : undefined,
    executionTime: durationMs,
    executionFingerprint: fingerprint,
    lastRun: summarizeNodeRun(
      node,
      outputs,
      durationMs,
      runStatus,
      hasError ? String(outputs.error) : undefined
    ),
  };

  yield {
    ok: !hasError,
    patches: [{ nodeId, data: nextData }],
    events: [
      logEvent(
        node,
        hasError
          ? `节点执行失败：${node.data.label} - ${outputs.error}`
          : hasPendingOutputTask
            ? `节点任务已提交，等待上游完成：${node.data.label}`
          : `节点执行完成：${node.data.label}`,
        hasError ? 'error' : hasPendingOutputTask ? 'info' : 'success'
      ),
    ],
  };
}

function collectUpstreamNodeIds(targetNodeId: string, edges: Edge[]): Set<string> {
  const upstream = new Set<string>();
  const visit = (nodeId: string) => {
    for (const edge of edges.filter((item) => item.target === nodeId)) {
      if (upstream.has(edge.source)) continue;
      upstream.add(edge.source);
      visit(edge.source);
    }
  };
  visit(targetNodeId);
  upstream.add(targetNodeId);
  return upstream;
}

async function executeNodeIdsOnGraph(
  nodeIds: Set<string>,
  label: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  sink: ExecutionSink,
  options: ExecuteOptions = {}
) {
  if (nodes.length === 0) {
    sink.applyEvent({ type: 'error', error: '工作流为空，请先添加节点。' });
    return;
  }

  const relevantNodes = nodes.filter((node) => nodeIds.has(node.id));
  const relevantEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const executionOrder = topologicalSort(relevantNodes, relevantEdges);

  if (executionOrder.length !== relevantNodes.length) {
    sink.applyEvent({ type: 'error', error: '工作流中存在循环依赖，无法执行。' });
    return;
  }

  sink.startExecution();
  sink.applyEvent({
    type: 'log',
    log: {
      id: generateId(),
      nodeId: '',
      nodeType: '',
      timestamp: Date.now(),
      message: label,
      level: 'info',
    },
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  try {
    for (let i = 0; i < executionOrder.length; i += 1) {
      sink.applyEvent({ type: 'progress', progress: Math.round((i / executionOrder.length) * 100) });

      let ok = true;
      for await (const result of executeNodeInContext(executionOrder[i], edges, nodeMap, options)) {
        applyNodeExecutionResult(result, nodeMap, sink);
        if (!result.ok) ok = false;
      }

      if (!ok) break;
    }
    sink.applyEvent({ type: 'progress', progress: 100 });
    sink.applyEvent({ type: 'complete' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '执行出错';
    sink.applyEvent({ type: 'error', error: errorMsg });
    sink.applyEvent({
      type: 'log',
      log: {
        id: generateId(),
        nodeId: '',
        nodeType: '',
        timestamp: Date.now(),
        message: errorMsg,
        level: 'error',
      },
    });
  }
}

async function executeNodeIds(nodeIds: Set<string>, label: string, options: ExecuteOptions = {}) {
  const { nodes, edges } = useCanvasStore.getState();
  await executeNodeIdsOnGraph(nodeIds, label, nodes, edges, createStoreExecutionSink(), options);
}

export async function executeWorkflow() {
  const { nodes } = useCanvasStore.getState();
  await executeNodeIds(new Set(nodes.map((node) => node.id)), '运行全部工作流');
}

export async function executeSingleNode(nodeId: string, options: ExecuteOptions = { force: true }) {
  await executeNodeIds(new Set([nodeId]), options.force ? '强制运行单个节点' : '运行单个节点', options);
}

export async function executeUntilNode(nodeId: string, options: ExecuteOptions = {}) {
  const { edges } = useCanvasStore.getState();
  await executeNodeIds(
    collectUpstreamNodeIds(nodeId, edges),
    options.force ? '强制运行到当前节点' : '运行到当前节点并复用已完成节点',
    options
  );
}

export async function executeSelectedNodes(nodeIds: string[], options: ExecuteOptions = {}) {
  const { nodes, edges } = useCanvasStore.getState();
  const existingIds = new Set(nodes.map((node) => node.id));
  const selectedIds = nodeIds.filter((id) => existingIds.has(id));
  const executionIds = new Set<string>();

  for (const nodeId of selectedIds) {
    for (const upstreamId of collectUpstreamNodeIds(nodeId, edges)) {
      executionIds.add(upstreamId);
    }
  }

  await executeNodeIds(
    executionIds,
    options.force ? '强制运行选区' : '运行选区并复用已完成节点',
    options
  );
}

export { buildGraph, topologicalSort, getNodeInputs, collectUpstreamNodeIds, executeNodeIdsOnGraph };
