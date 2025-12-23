// OpenRouter model management
// Allows users to add, edit, and remove OpenRouter models

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLimit: number; // Total context window in tokens
  free: boolean;
  disabled: boolean;
  isDefault?: boolean; // Whether this model is the default selected AI
}

// Default OpenRouter models
const DEFAULT_MODELS: OpenRouterModel[] = [
  { id: "mistralai/devstral-2512:free", name: "Devstral 2512 (Free)", contextLimit: 262144, free: true, disabled: false },
  { id: "x-ai/grok-4.1-fast", name: "Grok 4.1 Fast", contextLimit: 2000000, free: true, disabled: false },
  { id: "openrouter/sherlock-think-alpha", name: "Sherlock Think Alpha", contextLimit: 128000, free: false, disabled: true },
  { id: "tngtech/deepseek-r1t2-chimera:free", name: "DeepSeek R1T2 Chimera (Free)", contextLimit: 164000, free: true, disabled: false },
  { id: "openrouter/sherlock-dash-alpha", name: "Sherlock Dash Alpha", contextLimit: 128000, free: true, disabled: true },
  { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (Free)", contextLimit: 262000, free: true, disabled: false },
  { id: "kwaipilot/kat-coder-pro:free", name: "Kat Coder Pro (Free)", contextLimit: 256000, free: true, disabled: false },
  { id: "z-ai/glm-4.5-air:free", name: "GLM 4.5 Air (Free)", contextLimit: 131000, free: true, disabled: false },
];

const STORAGE_KEY = 'openrouter_models';

// Load models from localStorage, merge with defaults
export function getOpenRouterModels(): OpenRouterModel[] {
  try {
    const defaultModelId = getDefaultModelId();
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as OpenRouterModel[];
      // Merge with defaults, giving priority to stored models
      const storedMap = new Map(parsed.map(m => [m.id, m]));
      
      // Start with defaults
      const merged: OpenRouterModel[] = [];
      
      // Add all stored models (they override defaults)
      // CRITICAL: Only set isDefault=true for the actual default model (ensures only one default)
      for (const model of parsed) {
        merged.push({
          ...model,
          isDefault: model.id === defaultModelId // Only true for one model
        });
      }
      
      // Add defaults that aren't in stored
      for (const defaultModel of DEFAULT_MODELS) {
        if (!storedMap.has(defaultModel.id)) {
          merged.push({
            ...defaultModel,
            isDefault: defaultModel.id === defaultModelId // Only true for one model
          });
        }
      }
      
      return merged;
    }
  } catch (error) {
    console.error('Error loading OpenRouter models:', error);
  }
  
  // If no stored models, return defaults with isDefault flag set
  // CRITICAL: Only one model should have isDefault=true
  const defaultModelId = getDefaultModelId();
  return DEFAULT_MODELS.map(model => ({
    ...model,
    isDefault: model.id === defaultModelId // Only true for one model
  }));
}

// Save models to localStorage
export function saveOpenRouterModels(models: OpenRouterModel[]): void {
  try {
    // Ensure only one model has isDefault=true before saving
    const defaultModelId = getDefaultModelId();
    const sanitizedModels = models.map(model => ({
      ...model,
      isDefault: model.id === defaultModelId // Only true for the actual default
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizedModels));
  } catch (error) {
    console.error('Error saving OpenRouter models:', error);
    throw error;
  }
}

// Add a new model
export function addOpenRouterModel(model: OpenRouterModel): void {
  const models = getOpenRouterModels();
  // Check if model with same ID already exists
  if (models.some(m => m.id === model.id)) {
    throw new Error(`Model with ID "${model.id}" already exists`);
  }
  models.push(model);
  saveOpenRouterModels(models);
}

// Update an existing model
export function updateOpenRouterModel(modelId: string, updates: Partial<OpenRouterModel>): void {
  const models = getOpenRouterModels();
  const index = models.findIndex(m => m.id === modelId);
  if (index === -1) {
    throw new Error(`Model with ID "${modelId}" not found`);
  }
  models[index] = { ...models[index], ...updates };
  saveOpenRouterModels(models);
}

// Remove a model
export function removeOpenRouterModel(modelId: string): void {
  const models = getOpenRouterModels();
  // Don't allow removing default models, only custom ones
  const isDefault = DEFAULT_MODELS.some(m => m.id === modelId);
  if (isDefault) {
    // Instead of removing, mark as disabled
    const index = models.findIndex(m => m.id === modelId);
    if (index !== -1) {
      models[index].disabled = true;
      saveOpenRouterModels(models);
    }
  } else {
    const filtered = models.filter(m => m.id !== modelId);
    saveOpenRouterModels(filtered);
  }
}

// Get context limit for a model
export function getModelContextLimit(modelId: string): number | undefined {
  const models = getOpenRouterModels();
  const model = models.find(m => m.id === modelId);
  return model?.contextLimit;
}

// Default model storage
const DEFAULT_MODEL_STORAGE_KEY = 'default_ai_model';

// Get the default model ID
export function getDefaultModelId(): string | null {
  try {
    const stored = localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY);
    // If no default set, return the first model in DEFAULT_MODELS (Devstral)
    return stored || DEFAULT_MODELS[0].id;
  } catch (error) {
    console.error('Error loading default model:', error);
    return DEFAULT_MODELS[0].id; // Fallback to Devstral
  }
}

// Set the default model ID
export function setDefaultModelId(modelId: string): void {
  try {
    const models = getOpenRouterModels();
    
    // CRITICAL: Clear isDefault flag from ALL models first (ensures only one default)
    models.forEach(model => {
      if (model.isDefault) {
        updateOpenRouterModel(model.id, { isDefault: false });
      }
    });
    
    // Set new default in storage
    localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, modelId);
    
    // Set isDefault flag on the new default model
    const newModel = models.find(m => m.id === modelId);
    if (newModel) {
      updateOpenRouterModel(modelId, { isDefault: true });
    }
    
    // Trigger update event
    window.dispatchEvent(new CustomEvent('default-model-updated'));
  } catch (error) {
    console.error('Error saving default model:', error);
    throw error;
  }
}

// Clear the default model
export function clearDefaultModelId(): void {
  try {
    localStorage.removeItem(DEFAULT_MODEL_STORAGE_KEY);
    // Clear isDefault flag from all models
    const models = getOpenRouterModels();
    models.forEach(model => {
      if (model.isDefault) {
        updateOpenRouterModel(model.id, { isDefault: false });
      }
    });
    window.dispatchEvent(new CustomEvent('default-model-updated'));
  } catch (error) {
    console.error('Error clearing default model:', error);
  }
}

// Convert to AVAILABLE_MODELS format
export function getAvailableModelsFormat() {
  const models = getOpenRouterModels();
  return models.map(model => {
    // Remove "(Free)" from model name if present
    const cleanName = model.name.replace(/\s*\(Free\)\s*/gi, '');
    const nameWithContext = model.contextLimit >= 1000000 
      ? `${cleanName} (${(model.contextLimit / 1000000).toFixed(1)}M)`
      : model.contextLimit >= 1000
      ? `${cleanName} (${(model.contextLimit / 1000).toFixed(0)}K)`
      : `${cleanName} (${model.contextLimit})`;
    
    return {
      id: model.id,
      name: nameWithContext,
      free: model.free,
      disabled: model.disabled,
    };
  });
}

// Get model context limits map for apiProviders.ts
export function getModelContextLimitsMap(): Record<string, number> {
  const models = getOpenRouterModels();
  const map: Record<string, number> = {};
  for (const model of models) {
    map[model.id] = model.contextLimit;
  }
  return map;
}

