import { useMemo, useState } from "react";
import { FEATURED_MODELS } from "@/lib/models";

import { SendHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { streamChat, type ChatMessage } from "@/lib/chat";
import { ChatMarkdown } from "@/components/chat-markdown";

type UIMessage = ChatMessage & {
  id: string;
};

function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(FEATURED_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);
  const activeModel = useMemo(() => {
    const typedModel = customModel.trim();

    return typedModel.length > 0 ? typedModel : selectedModel;
  }, [customModel, selectedModel]);

  async function handleSubmit() {
    const content = prompt.trim();

    if (!content || isStreaming) {
      return;
    }

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

    try {
      await streamChat({
        model: activeModel,
        messages: nextMessages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
        onToken: (token) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: message.content + token,
                  }
                : message,
            ),
          );
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
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-4xl bg-background px-4 pb-44 pt-6 md:px-6 md:pt-10">
      <section className="space-y-4">
        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto w-fit max-w-[85%] border border-border bg-secondary px-3 py-2"
                : "w-full"
            }
          >
            {message.role === "assistant" ? (
              <ChatMarkdown content={message.content || (isStreaming ? "…" : "")} />
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </article>
        ))}
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
                {FEATURED_MODELS.map((model) => (
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
      </section>
    </main>
  );
}

export default App;
