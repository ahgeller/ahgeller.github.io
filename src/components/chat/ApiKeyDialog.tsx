import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, ExternalLink } from "lucide-react";

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => void;
  modelName: string;
  pricingUrl: string;
}

const ApiKeyDialog = ({ isOpen, onClose, onSave, modelName, pricingUrl }: ApiKeyDialogProps) => {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSave = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    onSave(apiKey.trim());
    setApiKey("");
    setError("");
    // Don't call onClose here - let the parent handle it after saving
  };

  const handleGetApiKey = () => {
    window.open(pricingUrl, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">API Key Required</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <p className="text-sm text-muted-foreground mb-4">
          {modelName} requires a Google Gemini API key to use. You can get one for free from Google AI Studio.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Enter your Gemini API Key:
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError("");
              }}
              placeholder="AIza..."
              className={error ? "border-red-500" : ""}
            />
            {error && (
              <p className="text-sm text-red-500 mt-1">{error}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleGetApiKey}
              variant="outline"
              className="flex-1"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Get API Key
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              className="flex-1"
            >
              Save
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Your API key is stored locally in your browser and never shared. You can get a free API key from{" "}
            <a 
              href={pricingUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google AI Studio
            </a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyDialog;

