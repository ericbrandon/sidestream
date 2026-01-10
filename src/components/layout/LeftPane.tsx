import { ChatContainer } from '../chat/ChatContainer';
import { ChatInput } from '../chat/ChatInput';

export function LeftPane() {
  return (
    <div className="flex flex-col h-full">
      {/* Messages - separate React subtree */}
      <ChatContainer />
      {/* Input - completely isolated from message rendering */}
      <ChatInput />
    </div>
  );
}
