import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendDesktopAgentUserMessage,
  createDesktopAgentWelcomeMessage,
  reduceDesktopAgentChatEvent,
  reduceDesktopAgentChatStatus,
} from './desktopAgentChatState';

test('createDesktopAgentWelcomeMessage names the selected backend agent', () => {
  const message = createDesktopAgentWelcomeMessage({ id: 'agent-1', name: '奶糖' }, 100);

  assert.equal(message.id, 'desktop-agent-welcome-100');
  assert.equal(message.role, 'system');
  assert.match(message.content, /奶糖/);
  assert.match(message.content, /HTTP\/SSE/);
});

test('appendDesktopAgentUserMessage appends a local user message', () => {
  const messages = appendDesktopAgentUserMessage([], '你好', 200);

  assert.deepEqual(messages, [
    {
      id: 'desktop-agent-user-200',
      role: 'user',
      content: '你好',
      timestamp: 200,
    },
  ]);
});

test('reduceDesktopAgentChatEvent upserts partial text and finalizes it', () => {
  const partial = reduceDesktopAgentChatEvent([], { event: 'partial', data: { text: '你' } }, 300);
  const nextPartial = reduceDesktopAgentChatEvent(partial, { event: 'partial', data: { text: '你好' } }, 301);
  const final = reduceDesktopAgentChatEvent(nextPartial, { event: 'final', data: { text: '你好呀' } }, 302);

  assert.equal(partial.length, 1);
  assert.equal(nextPartial.length, 1);
  assert.equal(nextPartial[0].content, '你好');
  assert.equal(nextPartial[0].pending, true);
  assert.equal(final.length, 1);
  assert.equal(final[0].content, '你好呀');
  assert.equal(final[0].pending, false);
});

test('reduceDesktopAgentChatEvent ignores echoed user messages and stores agent messages', () => {
  const withUser = reduceDesktopAgentChatEvent([], { event: 'message', data: { kind: 'user', text: '你好' } }, 400);
  const withAgent = reduceDesktopAgentChatEvent(withUser, { event: 'message', data: { kind: 'agent', text: '我在' } }, 401);

  assert.equal(withUser.length, 0);
  assert.equal(withAgent.length, 1);
  assert.equal(withAgent[0].role, 'agent');
  assert.equal(withAgent[0].content, '我在');
});

test('reduceDesktopAgentChatEvent does not duplicate message followed by final', () => {
  const withAgent = reduceDesktopAgentChatEvent([], { event: 'message', data: { kind: 'agent', text: '我在' } }, 410);
  const withFinal = reduceDesktopAgentChatEvent(withAgent, { event: 'final', data: { text: '我在' } }, 411);

  assert.equal(withFinal.length, 1);
  assert.equal(withFinal[0].content, '我在');
});

test('reduceDesktopAgentChatStatus tracks speaking state from agent_state events', () => {
  const talking = reduceDesktopAgentChatStatus(
    { state: 'idle', speaking: false },
    { event: 'agent_state', data: { state: 'talk', mood: 'happy' } }
  );
  const idle = reduceDesktopAgentChatStatus(talking, { event: 'agent_state', data: { state: 'idle' } });

  assert.deepEqual(talking, { state: 'talk', mood: 'happy', speaking: true });
  assert.deepEqual(idle, { state: 'idle', mood: 'happy', speaking: false });
});

test('reduceDesktopAgentChatEvent stores backend error events as system messages', () => {
  const messages = reduceDesktopAgentChatEvent([], { event: 'error', data: { message: 'boom' } }, 500);

  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'boom');
});
