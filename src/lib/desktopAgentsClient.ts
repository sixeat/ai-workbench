const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};

export const DEFAULT_DESKTOP_AGENTS_BASE_URL = 'http://127.0.0.1:8000';

export interface DesktopAgent {
  id: string;
  type_id?: string;
  type_name?: string;
  name: string;
  color?: [number, number, number];
  avatar_path?: string | null;
  mood_avatar_paths?: Record<string, string>;
  deployed?: boolean;
  x?: number;
  y?: number;
  persona_path?: string | null;
  lora_adapter_path?: string | null;
  lora_base_model?: string;
  [key: string]: unknown;
}

export interface DesktopAgentsListPayload {
  agents: DesktopAgent[];
}

export interface DesktopAnimationAsset {
  src?: string;
  artboard?: string;
  state_machine?: string;
  animations?: string[] | Record<string, string>;
  inputs?: Record<string, string | number | boolean>;
  fit?: string;
  alignment?: string;
  [key: string]: unknown;
}

export interface DesktopAnimationState {
  rive?: DesktopAnimationAsset;
  gif?: string;
  frames?: string[];
  [key: string]: unknown;
}

export interface DesktopAnimationManifest {
  character_id?: string;
  states: Record<string, DesktopAnimationState>;
  [key: string]: unknown;
}

export interface DesktopMemoryStatus {
  worker?: {
    running?: boolean;
    queue_size?: number;
    processed?: number;
    failed?: number;
    last_error?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DesktopMemoryContextPayload {
  text: string;
  agent_id?: string;
  limit?: number;
}

export interface DesktopEventPayload {
  events: Array<Record<string, unknown>>;
}

export interface DesktopChatStreamEvent {
  event: string;
  data: unknown;
}

function allowRemoteDesktopAgents(): boolean {
  return String(viteEnv.VITE_ALLOW_REMOTE_DESKTOP_AGENTS || '').toLowerCase() === 'true';
}

function isLoopbackDesktopAgentUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function desktopAgentsBaseUrl(baseUrl = viteEnv.VITE_DESKTOP_AGENTS_URL || DEFAULT_DESKTOP_AGENTS_BASE_URL): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (!allowRemoteDesktopAgents() && !isLoopbackDesktopAgentUrl(normalized)) {
    throw new Error('Desktop Agent can only connect to localhost by default.');
  }
  return normalized;
}

export function desktopAgentsUrl(path: string, baseUrl?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${desktopAgentsBaseUrl(baseUrl)}${normalizedPath}`;
}

async function requestDesktopJson<T>(path: string, init: RequestInit = {}, baseUrl?: string): Promise<T> {
  const response = await fetch(desktopAgentsUrl(path, baseUrl), {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorData = data as { detail?: string; error?: string };
    throw new Error(errorData.detail || errorData.error || `HTTP ${response.status}`);
  }
  return data as T;
}

export async function desktopAgentsHealth(baseUrl?: string): Promise<{ status: string }> {
  return requestDesktopJson('/health', {}, baseUrl);
}

export async function listDesktopAgents(baseUrl?: string): Promise<DesktopAgent[]> {
  const payload = await requestDesktopJson<DesktopAgentsListPayload>('/api/agents', {}, baseUrl);
  return payload.agents;
}

export async function getDesktopAgentManifest(agentId: string, baseUrl?: string): Promise<DesktopAnimationManifest> {
  return requestDesktopJson(`/api/agents/${encodeURIComponent(agentId)}/animation-manifest`, {}, baseUrl);
}

export async function getDesktopMemoryStatus(baseUrl?: string): Promise<DesktopMemoryStatus> {
  return requestDesktopJson('/api/memory/status', {}, baseUrl);
}

export async function getDesktopRecentEvents(limit = 20, baseUrl?: string): Promise<DesktopEventPayload> {
  return requestDesktopJson(`/api/events/recent?limit=${encodeURIComponent(String(limit))}`, {}, baseUrl);
}

export async function queryDesktopMemoryContext(payload: DesktopMemoryContextPayload, baseUrl?: string): Promise<Record<string, unknown>> {
  return requestDesktopJson('/api/memory/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, baseUrl);
}

export function parseDesktopAgentSseMessages(text: string): DesktopChatStreamEvent[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
      }
      const rawData = dataLines.join('\n');
      let data: unknown = rawData;
      if (rawData) {
        try {
          data = JSON.parse(rawData);
        } catch {
          data = rawData;
        }
      }
      return { event, data };
    });
}

export async function streamDesktopAgentChat(
  agentId: string,
  message: string,
  onEvent: (event: DesktopChatStreamEvent) => void,
  baseUrl?: string,
  channel = 'direct'
): Promise<void> {
  const response = await fetch(desktopAgentsUrl(`/api/agents/${encodeURIComponent(agentId)}/chat-stream`, baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: message, channel }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const errorData = data as { detail?: string; error?: string };
    throw new Error(errorData.detail || errorData.error || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Streaming response body is not available');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary >= 0) {
      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);
      for (const event of parseDesktopAgentSseMessages(complete)) onEvent(event);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    for (const event of parseDesktopAgentSseMessages(buffer)) onEvent(event);
  }
}
