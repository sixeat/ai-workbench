import { create } from 'zustand';
import type { WorkflowExecutionState, ExecutionLog } from '../types/workflow';

interface WorkflowStore {
  execution: WorkflowExecutionState;
  addLog: (log: ExecutionLog) => void;
  setExecutionStatus: (status: WorkflowExecutionState['status']) => void;
  setCurrentNode: (nodeId: string | null) => void;
  setProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  startExecution: () => void;
  completeExecution: () => void;
  clearLogs: () => void;
  reset: () => void;
}

const initialState: WorkflowExecutionState = {
  status: 'idle',
  currentNodeId: null,
  progress: 0,
  logs: [],
  startTime: null,
  endTime: null,
  error: null,
};

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  execution: initialState,

  addLog: (log) =>
    set((state) => ({
      execution: {
        ...state.execution,
        logs: [...state.execution.logs, log],
      },
    })),

  setExecutionStatus: (status) =>
    set((state) => ({
      execution: { ...state.execution, status },
    })),

  setCurrentNode: (nodeId) =>
    set((state) => ({
      execution: { ...state.execution, currentNodeId: nodeId },
    })),

  setProgress: (progress) =>
    set((state) => ({
      execution: { ...state.execution, progress: Math.min(100, Math.max(0, progress)) },
    })),

  setError: (error) =>
    set((state) => ({
      execution: { ...state.execution, error, status: error ? 'error' : state.execution.status },
    })),

  startExecution: () =>
    set({
      execution: {
        ...initialState,
        status: 'running',
        startTime: Date.now(),
      },
    }),

  completeExecution: () =>
    set((state) => ({
      execution: {
        ...state.execution,
        status: 'completed',
        endTime: Date.now(),
        progress: 100,
      },
    })),

  clearLogs: () =>
    set((state) => ({
      execution: { ...state.execution, logs: [] },
    })),

  reset: () => set({ execution: initialState }),
}));
