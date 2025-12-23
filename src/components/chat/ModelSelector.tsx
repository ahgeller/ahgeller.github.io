import { DEFAULT_MODEL } from "@/lib/chatApi";
import { getAvailableModelsFormat } from "@/lib/openRouterModels";
import { modelHasApiKey, getProviderForModel } from "@/lib/apiKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  showWhenEmpty?: boolean;
}

const ModelSelector = ({ selectedModel, onSelectModel, showWhenEmpty = true }: ModelSelectorProps) => {
  const currentModel = selectedModel || "";
  const [availableModels, setAvailableModels] = useState(getAvailableModelsFormat());
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);

  // Update when selectedModel prop changes to ensure models list is fresh
  useEffect(() => {
    // Always refresh models when selectedModel changes to ensure the selected model is in the list
    const refreshModels = () => {
      const refreshed = getAvailableModelsFormat();
      setAvailableModels(refreshed);
    };
    
    // Refresh immediately
    refreshModels();
    
    // Also refresh after a short delay to catch any async updates
    const timer = setTimeout(refreshModels, 100);
    
    return () => clearTimeout(timer);
  }, [selectedModel]);

  // Ensure model is in list when selectedModel changes
  useEffect(() => {
    if (currentModel) {
      const modelExists = availableModels.some(m => m.id === currentModel);
      if (!modelExists) {
        // If model doesn't exist, refresh the list
        const refreshed = getAvailableModelsFormat();
        setAvailableModels(refreshed);
      }
    }
  }, [currentModel]);

  // Reload models when they might have changed
  useEffect(() => {
    const handleStorageChange = () => {
      setAvailableModels(getAvailableModelsFormat());
    };
    
    // Listen for storage changes (cross-tab)
    window.addEventListener('storage', handleStorageChange);
    // Listen for custom events (same-tab)
    window.addEventListener('openrouter-models-updated', handleStorageChange);
    window.addEventListener('default-api-provider-updated', handleStorageChange);
    window.addEventListener('default-model-updated', handleStorageChange);
    // Also check periodically (fallback)
    const interval = setInterval(handleStorageChange, 2000);
    
    // Initial load
    handleStorageChange();
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('openrouter-models-updated', handleStorageChange);
      window.removeEventListener('default-api-provider-updated', handleStorageChange);
      window.removeEventListener('default-model-updated', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Filter to only show models that have API keys
  const modelsWithKeys = availableModels.filter(model => {
    const provider = getProviderForModel(model.id);
    if (!provider) return false; // Model not mapped to a provider
    return modelHasApiKey(model.id);
  });

  // If no models available, show message
  if (modelsWithKeys.length === 0) {
    return (
      <div className="py-2 px-4 border-b border-border/50 text-center text-sm text-muted-foreground">
        No models available. Please add API keys in Settings.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 py-2 px-4 border-b border-border/50">
      {availableModels.map((model) => {
        const provider = getProviderForModel(model.id);
        const hasKey = modelHasApiKey(model.id);
        const isDisabled = model.disabled || !hasKey;
        
        const isLoading = loadingModelId === model.id;
        
        const isSelected = currentModel === model.id;
        return (
          <Button
            key={model.id}
            variant={isSelected ? "default" : "outline"}
            size="sm"
            onClick={async () => {
              if (!isDisabled && !isLoading) {
                setLoadingModelId(model.id);
                try {
                  // Brief delay for visual feedback
                  await new Promise(resolve => setTimeout(resolve, 200));
                  onSelectModel(model.id);
                } finally {
                  setLoadingModelId(null);
                }
              }
            }}
            disabled={isDisabled || isLoading}
            className={cn(
              "text-xs",
              isSelected && "bg-primary text-primary-foreground",
              model.free && "border-primary/50",
              (isDisabled || isLoading) && "opacity-50 cursor-not-allowed",
              // Ensure selected model is always visible, even if disabled
              isSelected && !hasKey && "border-2 border-primary"
            )}
            title={
              isDisabled 
                ? (model.disabled ? "Model is currently down" : "API key required")
                : isLoading
                ? "Selecting model..."
                : (provider ? `${provider.name} - ${model.name}` : model.name)
            }
          >
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                <span>Selecting...</span>
              </span>
            ) : (
              <>
                {model.name}
                {!model.free && !isDisabled && (
                  <span className="ml-1 text-[10px] opacity-75">$</span>
                )}
                {model.disabled && (
                  <span className="ml-1 text-[10px] opacity-75">(Down)</span>
                )}
              </>
            )}
          </Button>
        );
      })}
    </div>
  );
};

export default ModelSelector;

