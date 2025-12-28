import ChatMessage from './ChatMessage';
import { Message } from '@/types/chat';

interface VirtualizedMessagesProps {
  messages: Message[];
  parentRef: React.RefObject<HTMLDivElement>;
  isLoading?: boolean;
  csvLoadingProgress?: any;
  sidebarOpen?: boolean;
}

export function VirtualizedMessages({ 
  messages, 
  // parentRef is kept in interface for backward compatibility but not used after virtualization removal
  isLoading,
  csvLoadingProgress,
  sidebarOpen 
}: VirtualizedMessagesProps) {
  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Render all messages normally - no virtualization */}
      {messages.map((message, index) => (
        <div key={index} className="pb-4">
          <ChatMessage 
            message={message}
            sidebarOpen={sidebarOpen}
          />
        </div>
      ))}
      
      {/* Loading indicator - show when isLoading is true and last message is from assistant */}
      {(isLoading || csvLoadingProgress) && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && (
        <div className="flex gap-3 pb-4">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold flex-shrink-0">
            {csvLoadingProgress ? '📊' : 'AI'}
          </div>
          <div className="flex-1 bg-chat-assistant rounded-lg p-4">
            {csvLoadingProgress ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Loading CSV data: {csvLoadingProgress.file}</div>
                {(csvLoadingProgress as any).error ? (
                  <div className="text-xs text-red-500">
                    {(csvLoadingProgress as any).error}
                  </div>
                ) : (
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${csvLoadingProgress.percent}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
