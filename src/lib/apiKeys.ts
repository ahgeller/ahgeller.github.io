// API Provider definitions
export interface ApiProvider {
  id: string;
  name: string;
  category: 'free' | 'paid' | 'image';
  apiKeyUrl?: string;
  models: string[]; // Model IDs that use this provider
}

export const API_PROVIDERS: ApiProvider[] = [
  // Primary: OpenRouter (supports all models)
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'free',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    models: [
      'openrouter/sherlock-think-alpha',
      'tngtech/deepseek-r1t2-chimera:free',
      'openrouter/sherlock-dash-alpha',
      'qwen/qwen3-coder:free',
      'kwaipilot/kat-coder-pro:free',
      'z-ai/glm-4.5-air:free',
      'tngtech/deepseek-r1-chimera:free',
    ]
  },
  {
    id: 'custom',
    name: 'Other API (custom provider)',
    category: 'free',
    apiKeyUrl: undefined,
    models: []
  },
  // Image Generation
  {
    id: 'stability',
    name: 'Stability.ai',
    category: 'image',
    apiKeyUrl: 'https://platform.stability.ai/account/keys',
    models: []
  },
  {
    id: 'fal',
    name: 'Fal.ai',
    category: 'image',
    apiKeyUrl: 'https://fal.ai/dashboard/keys',
    models: []
  }
];

// API Key Storage
export function getApiKey(providerId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`api_key_${providerId}`);
}

export function setApiKey(providerId: string, apiKey: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`api_key_${providerId}`, apiKey);
}

export function hasApiKey(providerId: string): boolean {
  const key = getApiKey(providerId);
  return key !== null && key.trim() !== '';
}

export function removeApiKey(providerId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`api_key_${providerId}`);
}

// Get provider for a model
export function getProviderForModel(modelId: string): ApiProvider | null {
  return API_PROVIDERS.find(provider => provider.models.includes(modelId)) || null;
}

// Check if model has API key
export function modelHasApiKey(modelId: string): boolean {
  const provider = getProviderForModel(modelId);
  if (!provider) return false;
  return hasApiKey(provider.id);
}

// Get all available models (those with API keys)
export function getAvailableModels(): string[] {
  const available: string[] = [];
  API_PROVIDERS.forEach(provider => {
    if (hasApiKey(provider.id)) {
      available.push(...provider.models);
    }
  });
  return available;
}

