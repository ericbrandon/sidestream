import { MessageList } from './MessageList';

export function ChatContainer() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList />
    </div>
  );
}
