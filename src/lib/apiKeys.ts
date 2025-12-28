// API Provider definitions
import { getOpenRouterModels } from './openRouterModels';

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
      'mistralai/devstral-2512:free',
      'x-ai/grok-4.1-fast',
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
  // First check static providers
  const staticProvider = API_PROVIDERS.find(provider => provider.models.includes(modelId));
  if (staticProvider) return staticProvider;

  // If not found, check if it's a custom OpenRouter model
  try {
    const customModels = getOpenRouterModels();
    const isCustomOpenRouterModel = customModels.some(m => m.id === modelId);
    if (isCustomOpenRouterModel) {
      return API_PROVIDERS.find(p => p.id === 'openrouter') || null;
    }
  } catch (e) {
    console.error('Error loading custom OpenRouter models:', e);
  }

  return null;
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

// Get models from a specific provider
export function getModelsFromProvider(providerId: string): string[] {
  const provider = API_PROVIDERS.find(p => p.id === providerId);
  if (!provider || !hasApiKey(providerId)) {
    return [];
  }
  return provider.models;
}

// Get the first available model from the default API provider
export function getDefaultModelFromDefaultProvider(): string | null {
  const defaultProviderId = getDefaultApiProviderId();
  if (!defaultProviderId) {
    return null;
  }
  
  const models = getModelsFromProvider(defaultProviderId);
  if (models.length > 0) {
    // Check if there's a default model set, and if it's from this provider
    try {
      const { getDefaultModelId } = require("./openRouterModels");
      const defaultModelId = getDefaultModelId();
      if (defaultModelId && models.includes(defaultModelId)) {
        return defaultModelId;
      }
    } catch (e) {
      // Ignore errors
    }
    // Otherwise return the first model from the default provider
    return models[0];
  }
  
  return null;
}

// Default API provider storage
const DEFAULT_API_PROVIDER_STORAGE_KEY = 'default_api_provider';

// Get the default API provider ID
export function getDefaultApiProviderId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_API_PROVIDER_STORAGE_KEY);
  } catch (error) {
    console.error('Error loading default API provider:', error);
    return null;
  }
}

// Set the default API provider ID
export function setDefaultApiProviderId(providerId: string): void {
  try {
    localStorage.setItem(DEFAULT_API_PROVIDER_STORAGE_KEY, providerId);
    // Trigger update event
    window.dispatchEvent(new CustomEvent('default-api-provider-updated'));
  } catch (error) {
    console.error('Error saving default API provider:', error);
    throw error;
  }
}

// Clear the default API provider
export function clearDefaultApiProviderId(): void {
  try {
    localStorage.removeItem(DEFAULT_API_PROVIDER_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('default-api-provider-updated'));
  } catch (error) {
    console.error('Error clearing default API provider:', error);
  }
}

