import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  Sparkles,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import type { Edge } from '@xyflow/react';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import { useCanvasStore } from '../../stores/canvasStore';
import { generateId } from '../../lib/utils';
import type { NodeType } from '../../types/nodes';
import {
  getDesktopAgentManifest,
  listDesktopAgents,
  streamDesktopAgentChat,
  type DesktopAgent,
  type DesktopAnimationManifest,
} from '../../lib/desktopAgentsClient';
import {
  appendDesktopAgentSystemMessage,
  appendDesktopAgentUserMessage,
  createDesktopAgentWelcomeMessage,
  reduceDesktopAgentChatEvent,
  reduceDesktopAgentChatStatus,
  type DesktopAgentChatMessage,
  type DesktopAgentChatStatus,
} from '../../lib/desktopAgentChatState';
import { selectDesktopAnimationState, type DesktopAnimationAssetKind } from '../../lib/desktopAgentAnimationState';

interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

type AgentPanelMode = 'workflow' | 'desktop';

interface WorkflowPlan {
  nodes: { type: NodeType; x: number; y: number }[];
  edges: { sourceIndex: number; sourceHandle: string; targetIndex: number; targetHandle: string }[];
  description: string;
}

const WORKFLOW_TEMPLATES: Record<string, WorkflowPlan> = {
  image: {
    nodes: [
      { type: 'textInput', x: 100, y: 150 },
      { type: 'imageGen', x: 420, y: 150 },
      { type: 'preview', x: 760, y: 150 },
    ],
    edges: [
      { sourceIndex: 0, sourceHandle: 'text', targetIndex: 1, targetHandle: 'prompt' },
      { sourceIndex: 1, sourceHandle: 'image', targetIndex: 2, targetHandle: 'content' },
    ],
    description: '文本输入 -> 图片生成 -> 预览',
  },
  video: {
    nodes: [
      { type: 'textInput', x: 100, y: 150 },
      { type: 'videoGen', x: 420, y: 150 },
      { type: 'preview', x: 760, y: 150 },
    ],
    edges: [
      { sourceIndex: 0, sourceHandle: 'text', targetIndex: 1, targetHandle: 'prompt' },
      { sourceIndex: 1, sourceHandle: 'video', targetIndex: 2, targetHandle: 'content' },
    ],
    description: '文本输入 -> 视频生成 -> 预览',
  },
  script: {
    nodes: [
      { type: 'textInput', x: 100, y: 150 },
      { type: 'script', x: 420, y: 150 },
      { type: 'preview', x: 760, y: 150 },
    ],
    edges: [
      { sourceIndex: 0, sourceHandle: 'text', targetIndex: 1, targetHandle: 'prompt' },
      { sourceIndex: 1, sourceHandle: 'script', targetIndex: 2, targetHandle: 'content' },
    ],
    description: '主题 -> 剧本生成 -> 预览',
  },
  storyboard: {
    nodes: [
      { type: 'textInput', x: 80, y: 120 },
      { type: 'script', x: 380, y: 120 },
      { type: 'shotSplit', x: 680, y: 120 },
      { type: 'promptOptimize', x: 980, y: 120 },
      { type: 'imageGen', x: 1280, y: 120 },
      { type: 'preview', x: 1600, y: 120 },
    ],
    edges: [
      { sourceIndex: 0, sourceHandle: 'text', targetIndex: 1, targetHandle: 'prompt' },
      { sourceIndex: 1, sourceHandle: 'script', targetIndex: 2, targetHandle: 'script' },
      { sourceIndex: 2, sourceHandle: 'shotList', targetIndex: 3, targetHandle: 'content' },
      { sourceIndex: 3, sourceHandle: 'prompt', targetIndex: 4, targetHandle: 'prompt' },
      { sourceIndex: 4, sourceHandle: 'image', targetIndex: 5, targetHandle: 'content' },
    ],
    description: '主题 -> 剧本 -> 分镜 -> 提示词优化 -> 生图 -> 预览',
  },
  text: {
    nodes: [
      { type: 'textInput', x: 100, y: 150 },
      { type: 'textModel', x: 420, y: 150 },
      { type: 'preview', x: 760, y: 150 },
    ],
    edges: [
      { sourceIndex: 0, sourceHandle: 'text', targetIndex: 1, targetHandle: 'prompt' },
      { sourceIndex: 1, sourceHandle: 'text', targetIndex: 2, targetHandle: 'content' },
    ],
    description: '文本输入 -> 文本模型 -> 预览',
  },
};

function analyzeIntent(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('分镜') || lower.includes('storyboard') || lower.includes('剧本生图')) return 'storyboard';
  if (lower.includes('视频') || lower.includes('video') || lower.includes('短片')) return 'video';
  if (lower.includes('剧本') || lower.includes('script') || lower.includes('故事')) return 'script';
  if (lower.includes('图片') || lower.includes('image') || lower.includes('photo') || lower.includes('生图')) return 'image';
  return 'text';
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function desktopAnimationAssetLabel(kind: DesktopAnimationAssetKind): string {
  if (kind === 'rive') return 'Rive';
  if (kind === 'gif') return 'GIF';
  if (kind === 'frames') return 'PNG 帧';
  return '无资源';
}

export function AgentPanel({ isOpen, onClose }: AgentPanelProps) {
  const [mode, setMode] = useState<AgentPanelMode>('workflow');
  const [workflowMessages, setWorkflowMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: '告诉我你想做什么，我会先帮你搭一个可运行的节点模板。比如：生成图片、写剧本、剧本拆分镜、生成视频。',
      timestamp: Date.now(),
    },
  ]);
  const [desktopAgents, setDesktopAgents] = useState<DesktopAgent[]>([]);
  const [selectedDesktopAgentId, setSelectedDesktopAgentId] = useState('');
  const [desktopManifest, setDesktopManifest] = useState<DesktopAnimationManifest | null>(null);
  const [desktopManifestLoading, setDesktopManifestLoading] = useState(false);
  const [desktopMessages, setDesktopMessages] = useState<DesktopAgentChatMessage[]>([]);
  const [desktopStatus, setDesktopStatus] = useState<DesktopAgentChatStatus>({ state: 'idle', speaking: false });
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [desktopLoadAttempted, setDesktopLoadAttempted] = useState(false);
  const [desktopSending, setDesktopSending] = useState(false);
  const [desktopError, setDesktopError] = useState('');
  const [agentSelectOpen, setAgentSelectOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const agentSelectRef = useRef<HTMLDivElement>(null);
  const { addNode, setEdges } = useCanvasStore();
  const selectedDesktopAgent = desktopAgents.find((agent) => agent.id === selectedDesktopAgentId) || desktopAgents[0] || null;
  const selectedDesktopAgentLabel = selectedDesktopAgent?.name || selectedDesktopAgent?.id || '暂无 Agent';
  const desktopAnimation = selectDesktopAnimationState(desktopManifest, desktopStatus);
  const desktopAnimationLabel = desktopAnimationAssetLabel(desktopAnimation.assetKind);

  const loadDesktopAgents = async () => {
    setDesktopLoadAttempted(true);
    setDesktopLoading(true);
    setDesktopError('');
    setAgentSelectOpen(false);
    try {
      const agents = await listDesktopAgents();
      setDesktopAgents(agents);
      const firstAgent = agents[0] || null;
      setSelectedDesktopAgentId((current) => (current && agents.some((agent) => agent.id === current) ? current : firstAgent?.id || ''));
      setDesktopMessages((current) => current.length ? current : [createDesktopAgentWelcomeMessage(firstAgent)]);
    } catch (error) {
      const message = messageFromError(error, '无法连接 desktop-agents 后端。');
      setDesktopAgents([]);
      setSelectedDesktopAgentId('');
      setDesktopError(message);
    } finally {
      setDesktopLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || mode !== 'desktop' || desktopLoadAttempted || desktopLoading) return;
    void loadDesktopAgents();
  }, [isOpen, mode, desktopLoadAttempted, desktopLoading]);

  useEffect(() => {
    if (!agentSelectOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentSelectRef.current?.contains(event.target as Node)) setAgentSelectOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [agentSelectOpen]);

  useEffect(() => {
    if (!isOpen || mode !== 'desktop' || !selectedDesktopAgentId) {
      setDesktopManifest(null);
      return;
    }

    let cancelled = false;
    setDesktopManifestLoading(true);
    setDesktopManifest(null);
    getDesktopAgentManifest(selectedDesktopAgentId)
      .then((manifest) => {
        if (!cancelled) setDesktopManifest(manifest);
      })
      .catch((error) => {
        if (cancelled) return;
        setDesktopManifest(null);
        setDesktopError(messageFromError(error, '无法读取动画 manifest。'));
      })
      .finally(() => {
        if (!cancelled) setDesktopManifestLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, selectedDesktopAgentId]);

  const handleSubmit = async () => {
    const prompt = input.trim();
    if (!prompt || isProcessing || desktopSending) return;

    if (mode === 'desktop') {
      await handleDesktopSubmit(prompt);
      return;
    }

    setWorkflowMessages((prev) => [...prev, { id: generateId(), role: 'user', content: prompt, timestamp: Date.now() }]);
    setInput('');
    setIsProcessing(true);

    window.setTimeout(() => {
      const plan = WORKFLOW_TEMPLATES[analyzeIntent(prompt)];
      const beforeCount = useCanvasStore.getState().nodes.length;

      plan.nodes.forEach((node) => addNode(node.type, { x: node.x, y: node.y }));

      window.setTimeout(() => {
        const state = useCanvasStore.getState();
        const createdNodes = state.nodes.slice(beforeCount, beforeCount + plan.nodes.length);
        if (createdNodes.length === plan.nodes.length) {
          const newEdges: Edge[] = plan.edges.map((edge) => ({
            id: generateId(),
            source: createdNodes[edge.sourceIndex].id,
            target: createdNodes[edge.targetIndex].id,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          }));
          setEdges([...state.edges, ...newEdges]);
        }
      }, 0);

      setWorkflowMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'agent',
          content: `已创建工作流：${plan.description}\n\n共添加 ${plan.nodes.length} 个节点和 ${plan.edges.length} 条连接。你可以继续调整节点参数，然后点击运行。`,
          timestamp: Date.now(),
        },
      ]);
      setIsProcessing(false);
    }, 500);
  };

  const handleDesktopSubmit = async (prompt: string) => {
    if (!selectedDesktopAgent) {
      setDesktopError('请先连接后端并选择一个 Agent。');
      return;
    }

    setInput('');
    setDesktopError('');
    setDesktopSending(true);
    setDesktopStatus({ state: 'talk', mood: desktopStatus.mood, speaking: true });
    setDesktopMessages((prev) => appendDesktopAgentUserMessage(prev, prompt));

    try {
      await streamDesktopAgentChat(selectedDesktopAgent.id, prompt, (event) => {
        setDesktopMessages((prev) => reduceDesktopAgentChatEvent(prev, event));
        setDesktopStatus((prev) => reduceDesktopAgentChatStatus(prev, event));
      });
    } catch (error) {
      const message = messageFromError(error, '聊天流调用失败。');
      setDesktopError(message);
      setDesktopMessages((prev) => appendDesktopAgentSystemMessage(prev, `发送失败：${message}`));
    } finally {
      setDesktopSending(false);
      setDesktopStatus((prev) => ({ ...prev, state: prev.state === 'talk' ? 'idle' : prev.state, speaking: false }));
    }
  };

  const handleDesktopAgentChange = (agentId: string) => {
    const agent = desktopAgents.find((item) => item.id === agentId) || null;
    setSelectedDesktopAgentId(agentId);
    setAgentSelectOpen(false);
    setDesktopError('');
    setDesktopStatus({ state: 'idle', speaking: false });
    setDesktopMessages([createDesktopAgentWelcomeMessage(agent)]);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const activeMessages = mode === 'workflow' ? workflowMessages : desktopMessages;
  const isBusy = mode === 'workflow' ? isProcessing : desktopSending;

  if (!isOpen) return null;

  return (
    <FloatingWindow contentClassName="h-[70vh] w-[600px] flex-col">
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20">
              <BrainCircuit className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{mode === 'workflow' ? '工作流助手' : '桌面 Agent'}</h2>
              <p className="text-[10px] text-gray-500">
                {mode === 'workflow' ? '快速创建可编辑的节点模板' : '通过 desktop-agents 后端聊天流响应'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-2">
          <div className="flex rounded-lg bg-canvas-bg p-1">
            <button
              onClick={() => setMode('workflow')}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors', mode === 'workflow' ? 'bg-accent/20 text-white' : 'text-gray-500 hover:text-gray-300')}
            >
              <Workflow className="h-3.5 w-3.5" />
              工作流
            </button>
            <button
              onClick={() => setMode('desktop')}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors', mode === 'desktop' ? 'bg-accent/20 text-white' : 'text-gray-500 hover:text-gray-300')}
            >
              <Bot className="h-3.5 w-3.5" />
              桌面 Agent
            </button>
          </div>

          {mode === 'desktop' && (
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('rounded-full px-2 py-1 text-[10px]', desktopError ? 'bg-red-500/10 text-red-300' : desktopStatus.speaking ? 'bg-emerald-500/10 text-emerald-300' : 'bg-gray-700/40 text-gray-400')}>
                {desktopError ? '连接异常' : desktopStatus.speaking ? '说话中' : `状态：${desktopStatus.state}`}
              </span>
              <span
                className="max-w-[150px] truncate rounded-full bg-gray-700/40 px-2 py-1 text-[10px] text-gray-400"
                title={desktopAnimation.assetUrl || '暂无可用动画资源'}
              >
                {desktopManifestLoading ? '资源：加载中' : `资源：${desktopAnimationLabel}${desktopAnimation.fallback ? ' / fallback' : ''}`}
              </span>
              <div ref={agentSelectRef} className="relative w-[180px]">
                <button
                  type="button"
                  onClick={() => {
                    if (!desktopLoading && desktopAgents.length) setAgentSelectOpen((current) => !current);
                  }}
                  disabled={desktopLoading || !desktopAgents.length}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md border border-panel-border bg-canvas-bg px-2.5 text-left text-xs text-white transition-colors',
                    agentSelectOpen ? 'border-accent' : 'hover:border-gray-600',
                    (desktopLoading || !desktopAgents.length) && 'cursor-not-allowed opacity-60 hover:border-panel-border'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{selectedDesktopAgentLabel}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform', agentSelectOpen && 'rotate-180')} />
                </button>

                {agentSelectOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-50 max-h-64 w-full overflow-auto rounded-lg border border-panel-border bg-[#0c0f12] p-1.5 shadow-2xl">
                    {desktopAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => handleDesktopAgentChange(agent.id)}
                        className={cn(
                          'flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[#151a20]',
                          agent.id === selectedDesktopAgentId && 'bg-accent/10 text-accent'
                        )}
                      >
                        <span className="truncate text-xs font-medium">{agent.name || agent.id}</span>
                        {agent.name && <span className="mt-0.5 max-w-full truncate text-[10px] text-gray-500">{agent.id}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={loadDesktopAgents}
                disabled={desktopLoading || desktopSending}
                className="rounded-md border border-panel-border bg-canvas-bg p-1.5 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                title="刷新 desktop-agents"
              >
                <RefreshCcw className={cn('h-3.5 w-3.5', desktopLoading && 'animate-spin')} />
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {mode === 'desktop' && (
            <div className="rounded-lg border border-panel-border bg-canvas-bg px-3 py-2 text-[11px] text-gray-400">
              <div className="flex flex-wrap items-center gap-2">
                <span>动画状态：{desktopAnimation.state}</span>
                <span>资源类型：{desktopManifestLoading ? '加载中' : desktopAnimationLabel}</span>
                <span>说话：{desktopAnimation.speaking ? '是' : '否'}</span>
                {desktopAnimation.mood && <span>情绪：{desktopAnimation.mood}</span>}
              </div>
              <div className="mt-1 truncate text-gray-500">
                资源路径：{desktopAnimation.assetUrl || '等待 manifest 或 fallback 资源'}
              </div>
            </div>
          )}

          {activeMessages.map((message) => (
            <div key={message.id} className={cn('flex gap-3', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', message.role === 'user' ? 'bg-gray-700' : message.role === 'system' ? 'bg-gray-700/50' : 'bg-accent/20')}>
                {message.role === 'user'
                  ? <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                  : message.role === 'system'
                    ? <Bot className="h-3.5 w-3.5 text-gray-400" />
                  : <Sparkles className="h-3.5 w-3.5 text-accent" />}
              </div>
              <div className={cn('max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed', message.role === 'user' ? 'bg-accent/20 text-white' : message.role === 'system' ? 'bg-gray-700/30 text-gray-400' : 'bg-canvas-bg text-gray-300')}>
                {message.content}
                {'pending' in message && message.pending && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
              </div>
            </div>
          ))}

          {isBusy && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                <span className="text-xs text-gray-400">{mode === 'workflow' ? '正在分析需求并创建节点...' : '正在等待后端流式响应...'}</span>
              </div>
            </div>
          )}

          {mode === 'desktop' && desktopError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {desktopError}
            </div>
          )}
        </div>

        <div className="border-t border-panel-border px-4 py-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'workflow' ? '例如：帮我做一个文生剧本再拆分镜并生成图片的工作流' : '例如：今天状态怎么样？'}
                rows={2}
                className="w-full resize-none rounded-lg border border-panel-border bg-canvas-bg px-3 py-2 pr-20 text-xs text-white transition-colors placeholder-gray-600 focus:border-accent focus:outline-none"
              />
              {mode === 'workflow' && <div className="absolute bottom-2 right-2 flex gap-1">
                <button onClick={() => setInput('生成一张赛博朋克风格的猫咪图片')} className="rounded bg-gray-700/30 p-1.5 text-gray-500 transition-colors hover:bg-gray-700/50 hover:text-gray-300" title="图片生成">
                  <ImageIcon className="h-3 w-3" />
                </button>
                <button onClick={() => setInput('写一个科幻短剧本，并拆成分镜再生成图片')} className="rounded bg-gray-700/30 p-1.5 text-gray-500 transition-colors hover:bg-gray-700/50 hover:text-gray-300" title="剧本分镜">
                  <FileText className="h-3 w-3" />
                </button>
                <button onClick={() => setInput('帮我生成一段短视频')} className="rounded bg-gray-700/30 p-1.5 text-gray-500 transition-colors hover:bg-gray-700/50 hover:text-gray-300" title="视频生成">
                  <Video className="h-3 w-3" />
                </button>
              </div>}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isProcessing || desktopSending || (mode === 'desktop' && (!selectedDesktopAgent || desktopLoading))}
              className={cn('self-end rounded-lg px-3 py-2 transition-all', input.trim() && !isProcessing && !desktopSending && (mode === 'workflow' || (selectedDesktopAgent && !desktopLoading)) ? 'bg-accent text-white hover:bg-accent-hover' : 'cursor-not-allowed bg-gray-700 text-gray-500')}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
    </FloatingWindow>
  );
}
