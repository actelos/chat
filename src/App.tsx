import { useEffect, useMemo, useRef, useState } from "react";
import { SendHorizontal, Trash2 } from "lucide-react";
import { streamChat, type ChatMessage } from "@/lib/chat";
import {
  listStoredMessages,
  createStoredMessage,
  deleteStoredMessagesByIds,
  updateStoredMessageContent,
} from "@/lib/db";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat-markdown";
import { extractExecutableCodeBlocks } from "@/lib/preprocess-markdown";

type UIMessage = ChatMessage & {
  id: string;
};

type UIProcess = {
  key: string;
  id: string;
  code: string;
  lang: string | null;
  messageId: string;
  blockIndex: number;
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeModel = useMemo(() => {
    const typedModel = customModel.trim();
    return typedModel.length > 0 ? typedModel : selectedModel;
  }, [customModel, selectedModel]);

  const processes = useMemo<UIProcess[]>(() => {
    return messages.flatMap((message) => {
      if (message.role !== "assistant") {
        return [];
      }

      const blocks = extractExecutableCodeBlocks(message.content);

      return blocks.map((block, blockIndex) => ({
        key: `${message.id}:${blockIndex}:${block.id}`,
        id: block.id,
        code: block.code,
        lang: block.lang,
        messageId: message.id,
        blockIndex,
      }));
    });
  }, [messages]);

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

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [messages]);

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

  function handleProcessClick(process: UIProcess) {
    const messageElement = document.querySelector<HTMLElement>(
      `[data-message-id="${process.messageId}"]`,
    );

    if (!messageElement) return;

    const processBlocks = messageElement.querySelectorAll<HTMLElement>("[data-exec-block-id]");
    const target = processBlocks[process.blockIndex] ?? processBlocks[0] ?? messageElement;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");

    window.setTimeout(() => {
      target.classList.remove(
        "ring-2",
        "ring-primary",
        "ring-offset-2",
        "ring-offset-background",
      );
    }, 600);
  }

  return (
    <main className="mx-auto h-dvh max-w-7xl bg-background px-4 py-4 md:px-6 md:py-6">
      <div className="grid h-full gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
            {messages.map((message) =>
              message.role === "user" ? (
                <article key={message.id} className="group ml-auto flex max-w-[85%] flex-col items-end">
                  <div className="w-fit border border-border bg-secondary px-3 py-2">
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                  <button
                    type="button"
                    className="mt-1 flex size-6 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={() => handleDeleteMessage(message.id)}
                    disabled={isStreaming}
                    aria-label="Delete message"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </article>
              ) : (
                <article key={message.id} className="w-full" data-message-id={message.id}>
                  <ChatMarkdown content={message.content || (isStreaming ? "…" : "")} />
                </article>
              ),
            )}
            <div ref={messagesEndRef} />
          </div>

          <section className="shrink-0 border-t border-border bg-background/90 pt-4 backdrop-blur">
            <div className="flex flex-col gap-2">
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
        </section>

        <aside className="hidden min-h-0 lg:flex">
          <div className="flex h-full w-full flex-col border border-border bg-card p-3">
            <p className="text-sm font-medium text-foreground">Processes ({processes.length})</p>
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
              {processes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No executable code blocks yet.</p>
              ) : (
                processes.map((process) => (
                  <Button
                    key={process.key}
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start border border-border px-2 py-2 text-left"
                    onClick={() => handleProcessClick(process)}
                  >
                    <div className="w-full overflow-hidden">
                      <p className="truncate text-xs font-medium text-foreground">{process.id}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {(process.lang ?? "text") + " • " + process.code.replace(/\s+/g, " ").slice(0, 80)}
                      </p>
                    </div>
                  </Button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;
