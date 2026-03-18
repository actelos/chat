import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal } from "lucide-react";

type ChatComposerProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onDeleteAll: () => void;
  isStreaming: boolean;
  models: string[];
  selectedModel: string;
  onModelChange: (value: string) => void;
  customModel: string;
  onCustomModelChange: (value: string) => void;
  canSend: boolean;
  hasMessages: boolean;
};

export function ChatComposer({
  prompt,
  onPromptChange,
  onSubmit,
  onDeleteAll,
  isStreaming,
  models,
  selectedModel,
  onModelChange,
  customModel,
  onCustomModelChange,
  canSend,
  hasMessages,
}: ChatComposerProps) {
  return (
    <section className="shrink-0 border-t border-border bg-background/90 pt-4 backdrop-blur">
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Write your prompt..."
            className="min-h-24"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
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
              onChange={(event) => onModelChange(event.target.value)}
              disabled={isStreaming}
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
            <Input
              value={customModel}
              onChange={(event) => onCustomModelChange(event.target.value)}
              placeholder="Or type any OpenRouter model id..."
              disabled={isStreaming}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onDeleteAll}
              disabled={isStreaming || !hasMessages}
            >
              Delete all
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send"
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
