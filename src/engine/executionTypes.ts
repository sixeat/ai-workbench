import type { NodeData } from '../types/nodes';
import type { ExecutionLog } from '../types/workflow';

export interface TextModelContext {
  instanceId?: string;
  apiKeyModelId?: string;
  platformModelId?: string;
  model: string;
  providerId?: string;
  sourceNodeId?: string;
  sourceNodeType?: string;
  sourceNodeLabel?: string;
}

export interface ExecutionContext {
  nodeId?: string;
  nodeType?: string;
  nodeLabel?: string;
  modelContext?: TextModelContext | null;
  upstreamTaskIds?: string[];
}

export interface ExecutionPatch {
  nodeId: string;
  data: Partial<NodeData>;
}

export type ExecutionEvent =
  | { type: 'log'; log: ExecutionLog }
  | { type: 'progress'; progress: number }
  | { type: 'error'; error: string }
  | { type: 'complete' };

export interface NodeExecutionResult {
  ok: boolean;
  patches: ExecutionPatch[];
  events: ExecutionEvent[];
}
