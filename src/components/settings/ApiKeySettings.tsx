import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, Palette } from "lucide-react";
import { API_PROVIDERS, getApiKey, setApiKey, removeApiKey, hasApiKey } from "@/lib/apiKeys";
import { themes, getStoredTheme, setStoredTheme, applyTheme, type ColorScheme } from "@/lib/themes";

interface ApiKeySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const ApiKeySettings = ({ isOpen, onClose }: ApiKeySettingsProps) => {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [selectedTheme, setSelectedTheme] = useState<ColorScheme>('dark');

  useEffect(() => {
    if (isOpen) {
      // Load all API keys
      const keys: Record<string, string> = {};
      API_PROVIDERS.forEach(provider => {
        const key = getApiKey(provider.id);
        if (key) {
          keys[provider.id] = key;
        }
      });
      setApiKeys(keys);
      
      // Load current theme
      setSelectedTheme(getStoredTheme());
    }
  }, [isOpen]);

  const handleSave = (providerId: string, key: string) => {
    if (key.trim()) {
      setApiKey(providerId, key.trim());
      setApiKeys(prev => ({ ...prev, [providerId]: key.trim() }));
    } else {
      removeApiKey(providerId);
      setApiKeys(prev => {
        const newKeys = { ...prev };
        delete newKeys[providerId];
        return newKeys;
      });
    }
  };

  const handleClear = (providerId: string) => {
    removeApiKey(providerId);
    setApiKeys(prev => {
      const newKeys = { ...prev };
      delete newKeys[providerId];
      return newKeys;
    });
  };

  const handleThemeChange = (theme: ColorScheme) => {
    setSelectedTheme(theme);
    setStoredTheme(theme);
    applyTheme(theme);
  };

  if (!isOpen) return null;

  const freeProviders = API_PROVIDERS.filter(p => p.category === 'free' && p.id !== 'openrouter');
  const paidProviders = API_PROVIDERS.filter(p => p.category === 'paid');
  const imageProviders = API_PROVIDERS.filter(p => p.category === 'image');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">API Keys</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Add your API keys to use different AI models. Keys are stored locally in your browser. Click on provider names to get your API key.
        </p>
        
        {Object.keys(apiKeys).length === 0 && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              No API keys configured. Add at least one API key to start using the chat. <strong>OpenRouter is recommended</strong> as it provides access to many models including reasoning models. You can close this and come back later.
            </p>
          </div>
        )}

        {/* Primary: OpenRouter */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Primary API (Recommended)</h3>
          <div className="space-y-3">
            {API_PROVIDERS.filter(p => p.id === 'openrouter').map(provider => (
              <div key={provider.id} className="flex items-center gap-3 p-3 border-2 border-primary/50 rounded-lg bg-primary/5">
                <a
                  href={provider.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-2 min-w-[200px] font-semibold"
                >
                  {provider.name}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Input
                  type="password"
                  placeholder="Enter API key"
                  value={apiKeys[provider.id] || ''}
                  onChange={(e) => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                  onBlur={(e) => handleSave(provider.id, e.target.value)}
                  className="flex-1"
                />
                {hasApiKey(provider.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleClear(provider.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Clear
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Free / No Credit Card Needed */}
        {freeProviders.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Other APIs (Optional)</h3>
            <div className="space-y-3">
              {freeProviders.map(provider => (
                <div key={provider.id} className="flex flex-col gap-3 p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    {provider.apiKeyUrl ? (
                      <a
                        href={provider.apiKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-2 min-w-[200px]"
                      >
                        {provider.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <div className="text-primary flex items-center gap-2 min-w-[200px] font-medium">
                        {provider.name}
                      </div>
                    )}
                    <Input
                      type="password"
                      placeholder="Enter API key"
                      value={apiKeys[provider.id] || ''}
                      onChange={(e) => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                      onBlur={(e) => handleSave(provider.id, e.target.value)}
                      className="flex-1"
                    />
                    {hasApiKey(provider.id) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClear(provider.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {provider.id === 'custom' && (
                    <p className="text-xs text-muted-foreground">
                      Use this field for any other provider (enter the provider name and API key you need).
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daily-limit / Partially Free */}
        {paidProviders.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Daily-limit / Partially Free</h3>
            <div className="space-y-3">
              {paidProviders.map(provider => (
                <div key={provider.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                  {provider.apiKeyUrl ? (
                    <a
                      href={provider.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-2 min-w-[200px]"
                    >
                      {provider.name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <div className="text-primary flex items-center gap-2 min-w-[200px] font-medium">
                      {provider.name}
                    </div>
                  )}
                  <Input
                    type="password"
                    placeholder="Enter API key"
                    value={apiKeys[provider.id] || ''}
                    onChange={(e) => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                    onBlur={(e) => handleSave(provider.id, e.target.value)}
                    className="flex-1"
                  />
                  {hasApiKey(provider.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClear(provider.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Image Generation APIs */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Image Generation APIs</h3>
          <div className="space-y-3">
            {imageProviders.map(provider => (
              <div key={provider.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                <a
                  href={provider.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-2 min-w-[200px]"
                >
                  {provider.name}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Input
                  type="password"
                  placeholder="Enter API key"
                  value={apiKeys[provider.id] || ''}
                  onChange={(e) => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                  onBlur={(e) => handleSave(provider.id, e.target.value)}
                  className="flex-1"
                />
                {hasApiKey(provider.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleClear(provider.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Clear
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Color Scheme Selector */}
        <div className="pt-6 border-t border-border">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Color Scheme</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Choose a color scheme for the application interface.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(Object.keys(themes) as ColorScheme[]).map((themeKey) => {
              const theme = themes[themeKey];
              const isSelected = selectedTheme === themeKey;
              return (
                <button
                  key={themeKey}
                  onClick={() => handleThemeChange(themeKey)}
                  className={`
                    p-4 rounded-lg border-2 transition-all text-left
                    ${isSelected 
                      ? 'border-primary bg-primary/10' 
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }
                  `}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ 
                        backgroundColor: `hsl(${theme.colors.primary})`,
                        boxShadow: isSelected ? `0 0 0 2px hsl(${theme.colors.primary})` : 'none'
                      }}
                    />
                    <span className="font-medium text-sm">{theme.name}</span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <div 
                      className="w-full h-2 rounded"
                      style={{ backgroundColor: `hsl(${theme.colors.background})` }}
                    />
                    <div 
                      className="w-full h-2 rounded"
                      style={{ backgroundColor: `hsl(${theme.colors.primary})` }}
                    />
                    <div 
                      className="w-full h-2 rounded"
                      style={{ backgroundColor: `hsl(${theme.colors.secondary})` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeySettings;

