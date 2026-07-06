import type { NodeType } from './nodes';

export interface ProviderTemplate {
  id: string;
  name: string;
  description: string;
  category: 'text' | 'image' | 'video' | 'multi';
  authType: 'bearer' | 'apiKey' | 'custom';
  defaultBaseUrl: string;
  endpoints: {
    chat?: string;
    image?: string;
    video?: string;
    models?: string;
  };
  headers?: Record<string, string>;
  requestFormat: 'openai' | 'anthropic' | 'dashscope' | 'custom';
  supportedNodes: NodeType[];
  defaultModels?: string[];
}

export interface ApiInstance {
  id: string;
  name: string;
  providerId: string;
  apiKeyId?: string;
  keyScope?: 'user' | 'server';
  apiKey: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  models: string[];
  modelFetchMode: 'auto' | 'manual';
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthConfig {
  type: 'bearer' | 'apiKey' | 'custom';
  apiKey: string;
  extraHeaders?: Record<string, string>;
}

export interface GenericApiRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, any>;
}

export interface ModelsListResponse {
  models: { id: string; name?: string }[];
}

export interface ApiProvider {
  id: string;
  name: string;
  type: 'text' | 'image' | 'video';
  baseUrl: string;
  models: string[];
  requiresKey: boolean;
  customHeaders?: Record<string, string>;
}

export interface ApiKeyConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  isEncrypted: boolean;
}
