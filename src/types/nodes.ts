export type PortType =
  | 'string'
  | 'number'
  | 'image'
  | 'video'
  | 'text'
  | 'script'
  | 'shotList'
  | 'prompt'
  | 'parameter'
  | 'asset'
  | 'any';

export interface TextValue {
  type: 'text';
  text: string;
}

export interface PromptValue {
  type: 'prompt';
  prompt: string;
  negativePrompt?: string;
  style?: string;
}

export interface ParameterValue {
  type: 'parameter';
  key: string;
  value: string | number | boolean;
  label?: string;
}

export interface ImageAsset {
  type: 'image';
  id: string;
  url: string;
  fileName: string;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  createdAt: string;
}

export interface VideoAsset {
  type: 'video';
  id: string;
  url: string;
  fileName?: string;
  prompt?: string;
  createdAt: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
}

export interface ScriptValue {
  type: 'script';
  title?: string;
  text: string;
  scenes?: string[];
}

export interface Shot {
  id: string;
  index: number;
  title: string;
  description: string;
  visualPrompt?: string;
  negativePrompt?: string;
  camera?: string;
  duration?: number;
  image?: ImageAsset;
  error?: string;
}

export interface ShotList {
  type: 'shotList';
  items: Shot[];
}

export type WorkflowValue =
  | string
  | number
  | boolean
  | TextValue
  | ImageAsset
  | VideoAsset
  | ScriptValue
  | ShotList
  | PromptValue
  | ParameterValue
  | WorkflowValue[];

export type NodeConfig = Record<string, unknown>;
export type NodeInputs = Record<string, unknown>;
export type NodeOutputs = Record<string, unknown>;

export interface NodeRunAssetSummary {
  id?: string;
  type: string;
  url: string;
  fileName?: string;
}

export interface NodeRunSummary {
  status: 'running' | 'completed' | 'error';
  taskId?: string;
  taskIds?: string[];
  taskStatus?: string;
  model?: string;
  providerId?: string;
  durationMs?: number;
  assetCount: number;
  assets: NodeRunAssetSummary[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Port {
  id: string;
  label: string;
  type: PortType;
  direction: 'input' | 'output';
  required?: boolean;
  defaultValue?: unknown;
}

export interface NodeConnectionRules {
  primaryOutput?: string;
  defaultInput?: string;
  targetBySource?: Record<string, string>;
  imageInput?: {
    sourceKeys: string[];
    singleInput: string;
    multipleInput: string;
  };
  roundRobinInputs?: string[];
}

export type NodeType =
  | 'textInput'
  | 'imageInput'
  | 'multiImageInput'
  | 'promptParam'
  | 'negativePromptParam'
  | 'styleParam'
  | 'sizeParam'
  | 'qualityParam'
  | 'seedParam'
  | 'countParam'
  | 'referenceStrengthParam'
  | 'shotParam'
  | 'textModel'
  | 'imageGen'
  | 'imageToImage'
  | 'videoGen'
  | 'multiImageVideo'
  | 'script'
  | 'shotSplit'
  | 'promptOptimize'
  | 'preview'
  | 'merge';

export interface NodeDefinition {
  type: NodeType;
  label: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  inputs: Port[];
  outputs: Port[];
  configFields: ConfigField[];
  connection?: NodeConnectionRules;
  hidden?: boolean;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password';
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  placeholder?: string;
  required?: boolean;
}

export interface NodeData {
  [key: string]: unknown;
  label: string;
  type: NodeType;
  config: NodeConfig;
  inputs: NodeInputs;
  outputs: NodeOutputs;
  status: 'idle' | 'running' | 'completed' | 'error';
  error?: string;
  executionTime?: number;
  executionFingerprint?: string;
  lastRun?: NodeRunSummary;
}

export interface WorkflowNode {
  [key: string]: unknown;
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: NodeData;
}

export interface WorkflowEdge {
  [key: string]: unknown;
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export const NODE_COLORS: Record<NodeType, string> = {
  textInput: '#10b981',
  imageInput: '#22c55e',
  multiImageInput: '#14b8a6',
  promptParam: '#f97316',
  negativePromptParam: '#fb7185',
  styleParam: '#a855f7',
  sizeParam: '#38bdf8',
  qualityParam: '#eab308',
  seedParam: '#64748b',
  countParam: '#84cc16',
  referenceStrengthParam: '#ec4899',
  shotParam: '#0ea5e9',
  textModel: '#3b82f6',
  imageGen: '#f59e0b',
  imageToImage: '#d97706',
  videoGen: '#ef4444',
  multiImageVideo: '#dc2626',
  script: '#8b5cf6',
  shotSplit: '#7c3aed',
  promptOptimize: '#06b6d4',
  preview: '#0891b2',
  merge: '#84cc16',
};

export const NODE_LABELS: Record<NodeType, string> = {
  textInput: '文本输入',
  imageInput: '图片输入',
  multiImageInput: '多图输入',
  promptParam: 'Prompt 参数',
  negativePromptParam: '反向词参数',
  styleParam: '风格参数',
  sizeParam: '尺寸参数',
  qualityParam: '质量参数',
  seedParam: 'Seed 参数',
  countParam: '数量参数',
  referenceStrengthParam: '参考强度参数',
  shotParam: '镜头参数',
  textModel: '文本模型',
  imageGen: '图片生成',
  imageToImage: '图生图',
  videoGen: '视频生成',
  multiImageVideo: '多图生视频',
  script: '剧本生成',
  shotSplit: '分镜拆解',
  promptOptimize: '提示词优化',
  preview: '预览',
  merge: '合并',
};

export const NODE_CATEGORIES: Record<string, string> = {
  input: '输入',
  parameter: '参数',
  text: '文本/剧本',
  image: '图片',
  video: '视频',
  utility: '工具',
  output: '输出',
};
