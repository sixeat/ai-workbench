export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface ExecutionLog {
  id: string;
  nodeId: string;
  nodeType: string;
  timestamp: number;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface WorkflowExecutionState {
  status: WorkflowStatus;
  currentNodeId: string | null;
  progress: number; // 0-100
  logs: ExecutionLog[];
  startTime: number | null;
  endTime: number | null;
  error: string | null;
}

export interface ExecutionResult {
  nodeId: string;
  outputs: Record<string, any>;
  executionTime: number;
  success: boolean;
  error?: string;
}
