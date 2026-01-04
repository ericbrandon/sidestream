import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

export function ChatContainer() {
  return (
    <div className="flex flex-col h-full">
      <MessageList />
      <ChatInput />
    </div>
  );
}
