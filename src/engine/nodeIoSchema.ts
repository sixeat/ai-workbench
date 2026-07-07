import { getNodeDefinition } from '../data/nodeRegistry';
import type { ConfigField, NodeData, NodeType, Port, PortType } from '../types/nodes';
import type { ModelCapabilities } from '../types/modelCapabilities';
import {
  isImageAsset,
  isParameterValue,
  isPromptValue,
  isRecord,
  isScriptValue,
  isShotList,
  isVideoAsset,
} from './workflowValues';

export interface PortSchema {
  id: string;
  label: string;
  type: PortType;
  required: boolean;
}

export interface NodeIOSchema {
  nodeType: NodeType;
  inputs: Record<string, PortSchema>;
  outputs: Record<string, PortSchema>;
}

export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: ConfigField['type'];
  required: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
}

export interface NodeConfigSchema {
  nodeType: NodeType;
  fields: Record<string, ConfigFieldSchema>;
}

export interface InputValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
}

function portToSchema(port: Port): PortSchema {
  return {
    id: port.id,
    label: port.label,
    type: port.type,
    required: Boolean(port.required),
  };
}

function configFieldToSchema(field: ConfigField): ConfigFieldSchema {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    defaultValue: field.defaultValue,
    options: field.options,
  };
}

function optionList(values: unknown): { label: string; value: string }[] | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values.map((value) => ({ label: String(value), value: String(value) }));
}

const VIDEO_MODE_LABELS: Record<string, string> = {
  auto: '自动识别输入',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'images-to-video': '多图生视频',
  'shotlist-to-video': '分镜生视频',
};

function videoModeOptions(values: unknown): { label: string; value: string }[] | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const modes = ['auto', ...values.map(String)];
  return [...new Set(modes)].map((value) => ({
    label: VIDEO_MODE_LABELS[value] || value,
    value,
  }));
}

function getRecordValue(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function applyCapabilitiesToConfigField(
  nodeType: NodeType,
  field: ConfigFieldSchema,
  capabilities: ModelCapabilities | null
): ConfigFieldSchema {
  if (!capabilities) return field;
  const image = getRecordValue(capabilities, 'image');
  const video = getRecordValue(capabilities, 'video');

  if ((nodeType === 'imageGen' || nodeType === 'imageToImage') && field.key === 'n') {
    return { ...field, min: 1, max: typeof image.maxImages === 'number' ? image.maxImages : undefined };
  }

  if ((nodeType === 'videoGen' || nodeType === 'multiImageVideo') && field.key === 'duration') {
    return {
      ...field,
      min: typeof video.durationMin === 'number' ? video.durationMin : undefined,
      max: typeof video.durationMax === 'number' ? video.durationMax : undefined,
    };
  }

  if ((nodeType === 'videoGen' || nodeType === 'multiImageVideo') && field.key === 'resolution') {
    return { ...field, options: optionList(video.resolutions) || field.options };
  }

  if ((nodeType === 'videoGen' || nodeType === 'multiImageVideo') && field.key === 'aspectRatio') {
    return { ...field, options: optionList(video.ratios) || field.options };
  }

  if ((nodeType === 'videoGen' || nodeType === 'multiImageVideo') && field.key === 'mode') {
    return { ...field, options: videoModeOptions(video.modes) || field.options };
  }

  if ((nodeType === 'imageGen' || nodeType === 'imageToImage') && field.key === 'size') {
    return { ...field, options: optionList(image.sizeAliases || image.sizes) || field.options };
  }

  return field;
}

export function getNodeIOSchema(type: NodeType): NodeIOSchema | null {
  const definition = getNodeDefinition(type);
  if (!definition) return null;

  return {
    nodeType: type,
    inputs: Object.fromEntries(definition.inputs.map((port) => [port.id, portToSchema(port)])),
    outputs: Object.fromEntries(definition.outputs.map((port) => [port.id, portToSchema(port)])),
  };
}

export function getNodeConfigSchema(type: NodeType, capabilities: ModelCapabilities | null = null): NodeConfigSchema | null {
  const definition = getNodeDefinition(type);
  if (!definition) return null;

  return {
    nodeType: type,
    fields: Object.fromEntries(definition.configFields.map((field) => {
      const schema = applyCapabilitiesToConfigField(type, configFieldToSchema(field), capabilities);
      return [field.key, schema];
    })),
  };
}

function isTextLike(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isPromptValue(value) ||
    isScriptValue(value) ||
    isShotList(value)
  );
}

function valueMatchesPortType(value: unknown, type: PortType): boolean {
  if (value == null || type === 'any') return true;
  if (Array.isArray(value)) return value.every((item) => valueMatchesPortType(item, type) || type === 'asset');

  if (type === 'string') return typeof value === 'string' || isTextLike(value);
  if (type === 'number') return typeof value === 'number' || !Number.isNaN(Number(value));
  if (type === 'text') return isTextLike(value);
  if (type === 'prompt') return isPromptValue(value) || isTextLike(value);
  if (type === 'script') return isScriptValue(value) || isTextLike(value);
  if (type === 'shotList') return isShotList(value);
  if (type === 'image') return isImageAsset(value) || (typeof value === 'string' && value.trim().length > 0);
  if (type === 'video') return isVideoAsset(value) || (typeof value === 'string' && value.trim().length > 0);
  if (type === 'parameter') return isParameterValue(value) || ['string', 'number', 'boolean'].includes(typeof value);
  if (type === 'asset') return isImageAsset(value) || isVideoAsset(value) || isShotList(value) || typeof value === 'string';
  return false;
}

export function validateNodeInputs(node: Pick<NodeData, 'type'>, inputs: Record<string, unknown>): InputValidationResult {
  const schema = getNodeIOSchema(node.type);
  if (!schema) return { ok: true, errors: [] };

  const errors = Object.entries(inputs)
    .map(([key, value]) => {
      const inputSchema = schema.inputs[key];
      if (!inputSchema) return '';
      if (valueMatchesPortType(value, inputSchema.type)) return '';
      return `输入 ${inputSchema.label}(${key}) 需要 ${inputSchema.type} 类型`;
    })
    .filter(Boolean);

  return { ok: errors.length === 0, errors };
}

function isEmptyConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function valueMatchesConfigField(value: unknown, field: ConfigFieldSchema): boolean {
  if (isEmptyConfigValue(value)) return true;
  if (field.type === 'number') return typeof value === 'number' || !Number.isNaN(Number(value));
  if (field.type === 'boolean') return typeof value === 'boolean' || value === 'true' || value === 'false';
  if (field.type === 'select') {
    if (!field.options?.length) return true;
    return field.options.some((option) => option.value === String(value));
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function validateNodeConfig(
  node: Pick<NodeData, 'type' | 'config'>,
  capabilities: ModelCapabilities | null = null
): ConfigValidationResult {
  const schema = getNodeConfigSchema(node.type, capabilities);
  if (!schema) return { ok: true, errors: [] };

  const errors = Object.values(schema.fields)
    .map((field) => {
      const rawValue = node.config[field.key];
      const value = isEmptyConfigValue(rawValue) ? field.defaultValue : rawValue;
      if (field.key === 'instanceId' && !isEmptyConfigValue(node.config.platformModelId)) return '';
      if (field.required && isEmptyConfigValue(value)) return `配置 ${field.label}(${field.key}) 为必填`;
      if (!valueMatchesConfigField(value, field)) return `配置 ${field.label}(${field.key}) 需要 ${field.type} 类型`;
      if (field.type === 'number' && !isEmptyConfigValue(value)) {
        const numericValue = Number(value);
        if (field.min !== undefined && numericValue < field.min) return `配置 ${field.label}(${field.key}) 不能小于 ${field.min}`;
        if (field.max !== undefined && numericValue > field.max) return `配置 ${field.label}(${field.key}) 不能大于 ${field.max}`;
      }
      return '';
    })
    .filter(Boolean);

  return { ok: errors.length === 0, errors };
}
