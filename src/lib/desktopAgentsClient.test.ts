import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  desktopAgentsBaseUrl,
  desktopAgentsUrl,
  getDesktopAgentManifest,
  listDesktopAgents,
  parseDesktopAgentSseMessages,
  queryDesktopMemoryContext,
  streamDesktopAgentChat,
} from './desktopAgentsClient';

afterEach(() => {
  delete (globalThis as any).fetch;
});

test('desktopAgentsUrl normalizes base URL and path', () => {
  assert.equal(desktopAgentsUrl('api/agents', 'http://127.0.0.1:8000/'), 'http://127.0.0.1:8000/api/agents');
  assert.equal(desktopAgentsUrl('/health', 'http://127.0.0.1:8000///'), 'http://127.0.0.1:8000/health');
});

test('desktopAgentsBaseUrl rejects remote URLs by default', () => {
  assert.throws(() => desktopAgentsBaseUrl('https://desktop.example'), /localhost/);
  assert.equal(desktopAgentsBaseUrl('http://localhost:8000'), 'http://localhost:8000');
});

test('listDesktopAgents consumes the backend agents DTO', async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ agents: [{ id: 'agent-1', name: 'Naitang' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const agents = await listDesktopAgents('http://127.0.0.1:18000');

  assert.deepEqual(requests, ['http://127.0.0.1:18000/api/agents']);
  assert.equal(agents[0].id, 'agent-1');
  assert.equal(agents[0].name, 'Naitang');
});

test('getDesktopAgentManifest encodes agent id and keeps manifest flexible', async () => {
  let requestedUrl = '';
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ states: { idle: { gif: '/assets/idle.gif' }, talk: { rive: { src: '/assets/character.riv' } } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const manifest = await getDesktopAgentManifest('agent/with space', 'http://127.0.0.1:18000');

  assert.equal(requestedUrl, 'http://127.0.0.1:18000/api/agents/agent%2Fwith%20space/animation-manifest');
  assert.equal(manifest.states.idle.gif, '/assets/idle.gif');
  assert.equal(manifest.states.talk.rive?.src, '/assets/character.riv');
});

test('queryDesktopMemoryContext posts a JSON body', async () => {
  const requests: Array<{ url: string; body: any; method?: string }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ memories: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await queryDesktopMemoryContext({ text: 'hello', agent_id: 'agent-1', limit: 3 }, 'http://127.0.0.1:18000');

  assert.deepEqual(result, { memories: [] });
  assert.equal(requests[0].url, 'http://127.0.0.1:18000/api/memory/context');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { text: 'hello', agent_id: 'agent-1', limit: 3 });
});

test('parseDesktopAgentSseMessages parses named events and plain data', () => {
  const events = parseDesktopAgentSseMessages([
    'event: message',
    'data: {"content":"hi"}',
    '',
    'event: partial',
    'data: plain text',
    '',
  ].join('\n'));

  assert.deepEqual(events, [
    { event: 'message', data: { content: 'hi' } },
    { event: 'partial', data: 'plain text' },
  ]);
});

test('streamDesktopAgentChat emits parsed events from the SSE response', async () => {
  const chunks = [
    'event: agent_state\n',
    'data: {"state":"talk"}\n\n',
    'event: final\n',
    'data: {"ok":true}\n\n',
  ];
  const encoder = new TextEncoder();
  const events: unknown[] = [];
  let requestBody: any = null;

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  }) as typeof fetch;

  await streamDesktopAgentChat('agent-1', 'hello', (event) => events.push(event), 'http://127.0.0.1:18000');

  assert.deepEqual(requestBody, { text: 'hello', channel: 'direct' });
  assert.deepEqual(events, [
    { event: 'agent_state', data: { state: 'talk' } },
    { event: 'final', data: { ok: true } },
  ]);
});
