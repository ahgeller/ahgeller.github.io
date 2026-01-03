import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ApiKeySettings from "./ApiKeySettings";
import DatabaseSettings from "./DatabaseSettings";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'api' | 'database';
}

const Settings = ({ isOpen, onClose, defaultTab = 'api' }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState<'api' | 'database'>(defaultTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col ml-auto mr-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Tabs */}
        <div className="border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-xl font-semibold">Settings</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-1 px-6">
            <button
              onClick={() => setActiveTab('api')}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'api'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              API Keys
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'database'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Database
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'api' ? (
            <ApiKeySettings isOpen={true} onClose={onClose} contentOnly={true} />
          ) : (
            <DatabaseSettings isOpen={true} onClose={onClose} contentOnly={true} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
