import { useEffect, useMemo, useState } from "react";
import { SendHorizontal, Trash2 } from "lucide-react";

import {
  clearStoredMessages,
  createStoredMessage,
  deleteStoredMessagesByIds,
  listStoredMessages,
  updateStoredMessageContent,
} from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { streamChat, type ChatMessage } from "@/lib/chat";
import { ChatMarkdown } from "@/components/chat-markdown";

type UIMessage = ChatMessage & {
  id: string;
};

const models = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-3-27b-it:free",
  "deepseek/deepseek-r1:free"
];

function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(models[0]);
  const [customModel, setCustomModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const activeModel = useMemo(() => {
    const typedModel = customModel.trim();
    return typedModel.length > 0 ? typedModel : selectedModel;
  }, [customModel, selectedModel]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const stored = await listStoredMessages();

      if (disposed) return;

      setMessages(
        stored.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      );
    })();

    return () => {
      disposed = true;
    };
  }, []);

  async function handleSubmit() {
    const content = prompt.trim();

    if (!content || isStreaming) {
      return;
    }

    const now = Date.now();

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };

    const assistantMessageId = crypto.randomUUID();
    const nextMessages = [...messages, userMessage];

    setPrompt("");
    setIsStreaming(true);
    setMessages([
      ...nextMessages,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
      },
    ]);

    void createStoredMessage({ ...userMessage, createdAt: now });
    void createStoredMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: now + 1,
    });

    try {
      await streamChat({
        model: activeModel,
        messages: nextMessages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
        onToken: (token) => {
          setMessages((previous) => {
            let nextAssistantContent = "";

            const next = previous.map((message) => {
              if (message.id !== assistantMessageId) return message;

              nextAssistantContent = message.content + token;
              return {
                ...message,
                content: nextAssistantContent,
              };
            });

            if (nextAssistantContent) {
              void updateStoredMessageContent(assistantMessageId, nextAssistantContent);
            }

            return next;
          });
        },
      });
    } catch (error) {
      const failureMessage =
        error instanceof Error && error.message
          ? error.message
          : "Failed to get a response. Please verify your API key and selected model.";

      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: `Error: ${failureMessage}`,
              }
            : message,
        ),
      );
      void updateStoredMessageContent(assistantMessageId, `Error: ${failureMessage}`);
    } finally {
      setIsStreaming(false);
    }
  }

  function handleDeleteMessage(id: string) {
    if (isStreaming) return;

    const startIndex = messages.findIndex((message) => message.id === id);
    if (startIndex < 0) return;
    if (messages[startIndex]?.role !== "user") return;

    const idsToDelete = messages.slice(startIndex).map((message) => message.id);
    setMessages((previous) => previous.slice(0, startIndex));
    void deleteStoredMessagesByIds(idsToDelete);
  }

  function handleDeleteAllMessages() {
    if (isStreaming) return;

    const rootUserIndex = messages.findIndex((message) => message.role === "user");
    if (rootUserIndex < 0) return;

    const idsToDelete = messages.slice(rootUserIndex).map((message) => message.id);
    setMessages((previous) => previous.slice(0, rootUserIndex));
    void deleteStoredMessagesByIds(idsToDelete);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-4xl bg-background px-4 pb-44 pt-6 md:px-6 md:pt-10">
      <section className="space-y-4">
        {messages.map((message) =>
          message.role === "user" ? (
            <article key={message.id} className="group ml-auto flex max-w-[85%] flex-col items-end">
              <div className="w-fit border border-border bg-secondary px-3 py-2">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>

              <button
                type="button"
                className="mt-1 flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                onClick={() => handleDeleteMessage(message.id)}
                disabled={isStreaming}
                aria-label="Delete message"
              >
                <Trash2 className="size-4" />
              </button>
            </article>
          ) : (
            <article key={message.id} className="w-full">
              <ChatMarkdown content={message.content || (isStreaming ? "…" : "")} />
            </article>
          ),
        )}
      </section>

      <section className="fixed inset-x-0 bottom-0 bg-background/95 px-4 py-4 backdrop-blur md:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Write your prompt..."
              className="min-h-24"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              disabled={isStreaming}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 flex-col gap-2 md:flex-row">
              <Select
                id="model"
                className="max-w-sm"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={isStreaming}
              >
                {
                  models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
              <Input
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder="Or type any OpenRouter model id..."
                disabled={isStreaming}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDeleteAllMessages}
                disabled={isStreaming || messages.length === 0}
              >
                Delete all
              </Button>

              <Button
                type="button"
                size="icon"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={isStreaming || prompt.trim().length === 0 || activeModel.length === 0}
                aria-label="Send"
              >
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
