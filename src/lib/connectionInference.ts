import type { Edge, Node } from '@xyflow/react';
import { getNodeDefinition } from '../data/nodeRegistry';
import type { NodeData, Port, PortType } from '../types/nodes';

export const MAIN_INPUT = '__main_input';
export const MAIN_OUTPUT = '__main_output';

export interface InferredConnection {
  sourceKey: string;
  targetKey: string;
  label: string;
}

export interface EdgeConnectionData {
  sourceKey?: unknown;
  targetKey?: unknown;
}

export function getEdgeConnectionData(edge: Edge): EdgeConnectionData {
  return (edge.data || {}) as EdgeConnectionData;
}

function primaryOutputForNode(node: Node<NodeData>): string {
  const definition = getNodeDefinition(node.data.type);
  if (definition?.connection?.primaryOutput) return definition.connection.primaryOutput;
  return definition?.outputs[0]?.id || 'content';
}

function usedTargetKeys(targetId: string, edges: Edge[]): Set<string> {
  return new Set(
    edges
      .filter((edge) => edge.target === targetId)
      .map((edge) => String(getEdgeConnectionData(edge).targetKey || edge.targetHandle || ''))
      .filter(Boolean)
  );
}

function pickRoundRobinInput(targetId: string, inputs: string[], edges: Edge[]): string {
  const used = usedTargetKeys(targetId, edges);
  return inputs.find((input) => !used.has(input)) || inputs[inputs.length - 1] || 'content';
}

function hasAnyTargetInput(targetId: string, keys: string[], edges: Edge[]): boolean {
  const used = usedTargetKeys(targetId, edges);
  return keys.some((key) => used.has(key));
}

function portTypeMatches(sourceType: PortType, targetType: PortType): boolean {
  if (targetType === 'any' || sourceType === 'any') return true;
  if (sourceType === targetType) return true;
  if (sourceType === 'text' && targetType === 'string') return true;
  if (sourceType === 'string' && targetType === 'text') return true;
  if (sourceType === 'prompt' && ['text', 'any'].includes(targetType)) return true;
  if (sourceType === 'script' && ['text', 'any'].includes(targetType)) return true;
  if (sourceType === 'shotList' && ['any', 'asset'].includes(targetType)) return true;
  if (sourceType === 'image' && ['asset', 'any'].includes(targetType)) return true;
  if (sourceType === 'parameter' && ['any', 'parameter'].includes(targetType)) return true;
  return false;
}

function findOutputPort(node: Node<NodeData>, sourceKey: string): Port | undefined {
  return getNodeDefinition(node.data.type)?.outputs.find((output) => output.id === sourceKey);
}

function pickCompatibleInput(sourceNode: Node<NodeData>, targetNode: Node<NodeData>, sourceKey: string): string | null {
  const targetDefinition = getNodeDefinition(targetNode.data.type);
  const inputs = targetDefinition?.inputs || [];
  if (inputs.length === 0) return null;

  const sourcePort = findOutputPort(sourceNode, sourceKey);
  if (!sourcePort) return inputs[0]?.id || null;

  return inputs.find((input) => portTypeMatches(sourcePort.type, input.type))?.id || null;
}

export function inferTargetInputKey(
  sourceNode: Node<NodeData>,
  targetNode: Node<NodeData>,
  sourceKey: string,
  edges: Edge[]
): string {
  const targetDefinition = getNodeDefinition(targetNode.data.type);
  const rules = targetDefinition?.connection;

  if (rules?.roundRobinInputs?.length) {
    return pickRoundRobinInput(targetNode.id, rules.roundRobinInputs, edges);
  }

  if (rules?.targetBySource?.[sourceKey]) {
    return rules.targetBySource[sourceKey];
  }

  if (rules?.imageInput?.sourceKeys.includes(sourceKey)) {
    return hasAnyTargetInput(targetNode.id, [rules.imageInput.singleInput, rules.imageInput.multipleInput], edges)
      ? rules.imageInput.multipleInput
      : rules.imageInput.singleInput;
  }

  return pickCompatibleInput(sourceNode, targetNode, sourceKey) || rules?.defaultInput || 'content';
}

export function inferConnection(
  sourceNode: Node<NodeData>,
  targetNode: Node<NodeData>,
  edges: Edge[] = []
): InferredConnection {
  const sourceKey = primaryOutputForNode(sourceNode);
  const targetKey = inferTargetInputKey(sourceNode, targetNode, sourceKey, edges);
  return {
    sourceKey,
    targetKey,
    label: targetKey,
  };
}

export function getEditableEdgeOptions(targetNode: Node<NodeData>): Array<{ label: string; value: string }> {
  const definition = getNodeDefinition(targetNode.data.type);
  const inputs = definition?.inputs || [];
  if (inputs.length === 0) return [{ label: 'content', value: 'content' }];

  return inputs.map((input) => ({
    label: `${input.label} (${input.id})`,
    value: input.id,
  }));
}
