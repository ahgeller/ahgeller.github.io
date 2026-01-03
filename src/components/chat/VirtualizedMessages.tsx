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
      {messages.map((message, index) => {
        const nextMessage = messages[index + 1];
        const isLastBeforeUserMessage = nextMessage?.role === 'user';

        return (
          <div key={index}>
            <ChatMessage
              message={message}
              sidebarOpen={sidebarOpen}
            />
            {/* Add separator after AI responses when next message is from user */}
            {message.role === 'assistant' && isLastBeforeUserMessage && (
              <div className="border-t-2 border-border/60 my-4"></div>
            )}
          </div>
        );
      })}
      
      {/* Loading indicator */}
      {(isLoading || csvLoadingProgress) && (
        <div className="py-1 mb-1">
          {csvLoadingProgress ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {(csvLoadingProgress as any).message || `Loading value info: ${csvLoadingProgress.file}`}
              </div>
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
      )}
    </div>
  );
}
