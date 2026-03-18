import type { RefObject } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Trash2 } from "lucide-react";
import type { UIMessage } from "./types";

type ChatListProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  onDeleteMessage: (id: string) => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
};

export function ChatList({
  messages,
  isStreaming,
  onDeleteMessage,
  messagesEndRef,
}: ChatListProps) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
      {messages.map((message) =>
        message.role === "user" ? (
          <article
            key={message.id}
            className="group ml-auto flex max-w-[85%] flex-col items-end"
          >
            <div className="w-fit border border-border bg-secondary px-3 py-2">
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
            <button
              type="button"
              className="mt-1 flex size-6 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              onClick={() => onDeleteMessage(message.id)}
              disabled={isStreaming}
              aria-label="Delete message"
            >
              <Trash2 className="size-4" />
            </button>
          </article>
        ) : (
          <article key={message.id} className="w-full" data-message-id={message.id}>
            <ChatMarkdown content={message.content || (isStreaming ? "..." : "")} />
          </article>
        ),
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
