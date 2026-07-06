// OpenAI 兼容格式 API 客户端
// 通过本地 Node.js 代理服务器，绕过浏览器 CORS

import { proxyOpenAIChat, proxyOpenAIImage, type ProxyCredentialRef } from '../../lib/apiProxy';

export interface OpenAIChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  upstreamTaskIds?: string[];
}

export interface OpenAIChatResponse {
  choices: {
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface OpenAIImageRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
}

export interface OpenAIImageResponse {
  data: { url?: string; b64_json?: string }[];
}

export async function callOpenAIChat(
  apiKey: string,
  baseUrl: string,
  request: OpenAIChatRequest,
  credential?: ProxyCredentialRef
): Promise<OpenAIChatResponse> {
  return proxyOpenAIChat(baseUrl, apiKey, request, credential);
}

export async function callOpenAIImage(
  apiKey: string,
  baseUrl: string,
  request: OpenAIImageRequest,
  credential?: ProxyCredentialRef
): Promise<OpenAIImageResponse> {
  return proxyOpenAIImage(baseUrl, apiKey, request, credential);
}
