import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/chatApi";
import { modelHasApiKey, getProviderForModel } from "@/lib/apiKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  showWhenEmpty?: boolean;
}

const ModelSelector = ({ selectedModel, onSelectModel, showWhenEmpty = true }: ModelSelectorProps) => {
  const currentModel = selectedModel || DEFAULT_MODEL;

  // Filter to only show models that have API keys
  const availableModels = AVAILABLE_MODELS.filter(model => {
    const provider = getProviderForModel(model.id);
    if (!provider) return false; // Model not mapped to a provider
    return modelHasApiKey(model.id);
  });

  // If no models available, show message
  if (availableModels.length === 0) {
    return (
      <div className="p-4 border-b border-border/50 text-center text-sm text-muted-foreground">
        No models available. Please add API keys in Settings.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 p-4 border-b border-border/50">
      {availableModels.map((model) => {
        const provider = getProviderForModel(model.id);
        const hasKey = modelHasApiKey(model.id);
        
        return (
          <Button
            key={model.id}
            variant={currentModel === model.id ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectModel(model.id)}
            className={cn(
              "text-xs",
              currentModel === model.id && "bg-primary text-primary-foreground",
              model.free && "border-primary/50"
            )}
            title={provider ? `${provider.name} - ${model.name}` : model.name}
          >
            {model.name}
            {model.free && (
              <span className="ml-1 text-[10px] opacity-75">(Free)</span>
            )}
          </Button>
        );
      })}
    </div>
  );
};

export default ModelSelector;

