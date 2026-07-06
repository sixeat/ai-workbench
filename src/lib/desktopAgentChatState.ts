import type { DesktopAgent, DesktopChatStreamEvent } from './desktopAgentsClient';

export type DesktopAgentMessageRole = 'user' | 'agent' | 'system';

export interface DesktopAgentChatMessage {
  id: string;
  role: DesktopAgentMessageRole;
  content: string;
  timestamp: number;
  pending?: boolean;
}

export interface DesktopAgentChatStatus {
  state: string;
  mood?: string;
  speaking: boolean;
}

export function createDesktopAgentWelcomeMessage(agent?: DesktopAgent | null, now = Date.now()): DesktopAgentChatMessage {
  const name = agent?.name || '桌面 Agent';
  return {
    id: `desktop-agent-welcome-${now}`,
    role: 'system',
    content: `已连接到 ${name}。这里走 desktop-agents 后端的 HTTP/SSE，不再使用本地模拟回复。`,
    timestamp: now,
  };
}

export function appendDesktopAgentUserMessage(
  messages: DesktopAgentChatMessage[],
  content: string,
  now = Date.now()
): DesktopAgentChatMessage[] {
  return [
    ...messages,
    {
      id: `desktop-agent-user-${now}`,
      role: 'user',
      content,
      timestamp: now,
    },
  ];
}

export function appendDesktopAgentSystemMessage(
  messages: DesktopAgentChatMessage[],
  content: string,
  now = Date.now()
): DesktopAgentChatMessage[] {
  return [
    ...messages,
    {
      id: `desktop-agent-system-${now}`,
      role: 'system',
      content,
      timestamp: now,
    },
  ];
}

export function reduceDesktopAgentChatStatus(
  status: DesktopAgentChatStatus,
  event: DesktopChatStreamEvent
): DesktopAgentChatStatus {
  if (event.event !== 'agent_state') return status;
  const data = eventData(event.data);
  const state = stringField(data, 'state') || status.state;
  const mood = stringField(data, 'mood') || status.mood;
  return {
    state,
    mood,
    speaking: state === 'talk',
  };
}

export function reduceDesktopAgentChatEvent(
  messages: DesktopAgentChatMessage[],
  event: DesktopChatStreamEvent,
  now = Date.now()
): DesktopAgentChatMessage[] {
  const data = eventData(event.data);
  if (event.event === 'partial') {
    return upsertPendingAgentMessage(messages, textFromData(data), now);
  }
  if (event.event === 'final') {
    return finalizeAgentMessage(messages, textFromData(data), now);
  }
  if (event.event === 'message') {
    if (stringField(data, 'kind') === 'user') return messages;
    if (stringField(data, 'kind') === 'agent') return finalizeAgentMessage(messages, textFromData(data), now);
  }
  if (event.event === 'error') {
    return appendDesktopAgentSystemMessage(messages, stringField(data, 'message') || '后端返回了错误事件。', now);
  }
  return messages;
}

function upsertPendingAgentMessage(
  messages: DesktopAgentChatMessage[],
  content: string,
  now: number
): DesktopAgentChatMessage[] {
  if (!content) return messages;
  const existingIndex = messages.findIndex((message) => message.pending);
  if (existingIndex >= 0) {
    return messages.map((message, index) => (
      index === existingIndex
        ? { ...message, content, timestamp: now, pending: true }
        : message
    ));
  }
  return [
    ...messages,
    {
      id: `desktop-agent-pending-${now}`,
      role: 'agent',
      content,
      timestamp: now,
      pending: true,
    },
  ];
}

function finalizeAgentMessage(
  messages: DesktopAgentChatMessage[],
  content: string,
  now: number
): DesktopAgentChatMessage[] {
  if (!content) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === 'agent' && !last.pending && last.content === content) return messages;
  const existingIndex = messages.findIndex((message) => message.pending);
  if (existingIndex >= 0) {
    return messages.map((message, index) => (
      index === existingIndex
        ? { ...message, content, timestamp: now, pending: false }
        : message
    ));
  }
  return [
    ...messages,
    {
      id: `desktop-agent-final-${now}`,
      role: 'agent',
      content,
      timestamp: now,
      pending: false,
    },
  ];
}

function eventData(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function textFromData(data: Record<string, unknown>): string {
  return stringField(data, 'text') || stringField(data, 'content') || stringField(data, 'message');
}
