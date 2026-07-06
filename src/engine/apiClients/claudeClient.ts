// Anthropic Claude API Client
// 通过本地 Node.js 代理服务器，绕过浏览器 CORS

import { proxyClaudeMessage, type ProxyCredentialRef } from '../../lib/apiProxy';

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: { role: string; content: string }[];
  system?: string;
  temperature?: number;
  upstreamTaskIds?: string[];
}

export interface ClaudeResponse {
  content: { type: string; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

export async function callClaude(
  apiKey: string,
  baseUrl: string,
  request: ClaudeRequest,
  credential?: ProxyCredentialRef
): Promise<ClaudeResponse> {
  return proxyClaudeMessage(baseUrl, apiKey, request, credential);
}
