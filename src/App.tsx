import { streamChat, type ChatMessage } from "@/lib/chat";
import { useEffect, useMemo, useRef, useState } from "react";
import { extractExecutableCodeBlocks } from "@/lib/preprocess-markdown";
import {
  listStoredMessages,
  createStoredMessage,
  deleteStoredMessagesByIds,
  updateStoredMessageContent,
} from "@/lib/db";
import {
  createProcess,
  getProcessArtifacts,
  getProcess,
  killProcess,
  MciApiError,
  runProcess,
  type MciProcessState,
  type MciProcessStatus,
  mciServerUrl,
} from "@/lib/mci";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ArrowUpRight, Play, RotateCw, SendHorizontal, Square, Trash2 } from "lucide-react";

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

type ProcessRuntime = {
  pid: string | null;
  state: MciProcessState | null;
  status: MciProcessStatus;
  stdout: string | null;
  stderr: string | null;
  output: string | null;
  isCreating: boolean;
  isSignaling: boolean;
  error: string | null;
};

type ForceRunConfirm = {
  processKey: string;
  pid: string;
};

type ProcessBorderTone = {
  color: string | null;
  animated: boolean;
};

const POLL_INTERVAL_MS = 2;

function stringifyProcessOutput(value: unknown): string | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createDefaultRuntime(): ProcessRuntime {
  return {
    pid: null,
    state: null,
    status: null,
    stdout: null,
    stderr: null,
    output: null,
    isCreating: false,
    isSignaling: false,
    error: null,
  };
}

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
  const [processRuntimeByKey, setProcessRuntimeByKey] = useState<
    Record<string, ProcessRuntime>
  >({});
  const [forceRunConfirm, setForceRunConfirm] = useState<ForceRunConfirm | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pollTimersRef = useRef<Record<string, number>>({});
  const pollInFlightRef = useRef<Record<string, boolean>>({});

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

  useEffect(() => {
    return () => {
      for (const timer of Object.values(pollTimersRef.current)) {
        window.clearInterval(timer);
      }

      pollTimersRef.current = {};
      pollInFlightRef.current = {};
    };
  }, []);

  useEffect(() => {
    const activeKeys = new Set(processes.map((process) => process.key));

    for (const [processKey, timer] of Object.entries(pollTimersRef.current)) {
      if (activeKeys.has(processKey)) {
        continue;
      }

      window.clearInterval(timer);
      delete pollTimersRef.current[processKey];
      delete pollInFlightRef.current[processKey];
    }

    setProcessRuntimeByKey((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([processKey]) => activeKeys.has(processKey)),
      );

      return next;
    });

    setForceRunConfirm((previous) => {
      if (!previous) {
        return previous;
      }

      return activeKeys.has(previous.processKey) ? previous : null;
    });
  }, [processes]);

  function updateProcessRuntime(
    processKey: string,
    updater: (previous: ProcessRuntime) => ProcessRuntime,
  ) {
    setProcessRuntimeByKey((previous) => {
      const current = previous[processKey] ?? createDefaultRuntime();
      return {
        ...previous,
        [processKey]: updater(current),
      };
    });
  }

  function stopPolling(processKey: string) {
    const timer = pollTimersRef.current[processKey];

    if (typeof timer !== "number") {
      return;
    }

    window.clearInterval(timer);
    delete pollTimersRef.current[processKey];
    delete pollInFlightRef.current[processKey];
  }

  function startPolling(processKey: string, pid: string) {
    stopPolling(processKey);

    const poll = async () => {
      if (pollInFlightRef.current[processKey]) {
        return;
      }

      pollInFlightRef.current[processKey] = true;

      try {
        const nextProcess = await getProcess(pid);

        updateProcessRuntime(processKey, (previous) => ({
          ...previous,
          pid,
          state: nextProcess.state,
          status: nextProcess.status,
          error: null,
        }));

        if (nextProcess.state === "idle") {
          stopPolling(processKey);
          void fetchAndStoreProcessArtifacts(processKey, pid);
        }
      } catch (error) {
        stopPolling(processKey);

        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to poll process state.";

        updateProcessRuntime(processKey, (previous) => ({
          ...previous,
          error: message,
        }));
      } finally {
        pollInFlightRef.current[processKey] = false;
      }
    };

    void poll();

    pollTimersRef.current[processKey] = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }

  async function fetchAndStoreProcessArtifacts(processKey: string, pid: string) {
    try {
      const artifacts = await getProcessArtifacts(pid);

      updateProcessRuntime(processKey, (previous) => ({
        ...previous,
        stdout: artifacts.stdout,
        stderr: artifacts.stderr,
        output: stringifyProcessOutput(artifacts.output),
      }));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to fetch process outputs.";

      updateProcessRuntime(processKey, (previous) => ({
        ...previous,
        error: message,
      }));
    }
  }

  async function handleSubmit(
    overridePrompt?: string,
    processContext?: Array<{
      processId: string;
      pid: string | null;
      stdout: string | null;
      stderr: string | null;
      output: string | null;
    }>,
  ) {
    const content = (overridePrompt ?? prompt).trim();

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
        processContext,
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

  async function handleCreateProcess(process: UIProcess) {
    updateProcessRuntime(process.key, (previous) => ({
      ...previous,
      isCreating: true,
      error: null,
    }));

    try {
      const created = await createProcess(process.code);

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        pid: created.pid,
        state: "queued",
        status: null,
        stdout: null,
        stderr: null,
        output: null,
        isCreating: false,
        error: null,
      }));

      startPolling(process.key, created.pid);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to create process.";

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        isCreating: false,
        error: message,
      }));
    }
  }

  async function handleRunProcess(process: UIProcess, force: boolean) {
    const runtime = processRuntimeByKey[process.key] ?? createDefaultRuntime();

    if (!runtime.pid) {
      return;
    }

    updateProcessRuntime(process.key, (previous) => ({
      ...previous,
      isSignaling: true,
      error: null,
    }));

    try {
      const nextProcess = await runProcess(runtime.pid, force);

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        pid: nextProcess.pid,
        state: nextProcess.state,
        status: nextProcess.status,
        stdout: nextProcess.state === "idle" ? previous.stdout : null,
        stderr: nextProcess.state === "idle" ? previous.stderr : null,
        output: nextProcess.state === "idle" ? previous.output : null,
        isSignaling: false,
        error: null,
      }));

      if (nextProcess.state === "idle") {
        stopPolling(process.key);
        void fetchAndStoreProcessArtifacts(process.key, nextProcess.pid);
      } else {
        startPolling(process.key, nextProcess.pid);
      }
    } catch (error) {
      if (
        error instanceof MciApiError &&
        error.status === 400 &&
        /force\s*:\s*true|force/i.test(error.message)
      ) {
        setForceRunConfirm({ processKey: process.key, pid: runtime.pid });
        updateProcessRuntime(process.key, (previous) => ({
          ...previous,
          isSignaling: false,
        }));
        return;
      }

      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to run process.";

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        isSignaling: false,
        error: message,
      }));
    }
  }

  async function handleKillProcess(process: UIProcess) {
    const runtime = processRuntimeByKey[process.key] ?? createDefaultRuntime();

    if (!runtime.pid) {
      return;
    }

    updateProcessRuntime(process.key, (previous) => ({
      ...previous,
      isSignaling: true,
      error: null,
    }));

    try {
      const nextProcess = await killProcess(runtime.pid);

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        pid: nextProcess.pid,
        state: nextProcess.state,
        status: nextProcess.status,
        stdout: nextProcess.state === "idle" ? previous.stdout : null,
        stderr: nextProcess.state === "idle" ? previous.stderr : null,
        output: nextProcess.state === "idle" ? previous.output : null,
        isSignaling: false,
        error: null,
      }));

      stopPolling(process.key);

      if (nextProcess.state === "idle") {
        void fetchAndStoreProcessArtifacts(process.key, nextProcess.pid);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to send kill signal.";

      updateProcessRuntime(process.key, (previous) => ({
        ...previous,
        isSignaling: false,
        error: message,
      }));
    }
  }

  async function handleConfirmForceRun() {
    if (!forceRunConfirm) {
      return;
    }

    const process = processes.find((item) => item.key === forceRunConfirm.processKey);

    setForceRunConfirm(null);

    if (!process) {
      return;
    }

    await handleRunProcess(process, true);
  }

  async function handleSendProcessOutput(process: UIProcess) {
    if (isStreaming) {
      return;
    }

    const runtime = processRuntimeByKey[process.key] ?? createDefaultRuntime();
    const sections: string[] = [];

    if (runtime.stdout?.trim()) {
      sections.push(`stdout:\n${runtime.stdout.trim()}`);
    }

    if (runtime.stderr?.trim()) {
      sections.push(`stderr:\n${runtime.stderr.trim()}`);
    }

    if (runtime.output?.trim()) {
      sections.push(`output:\n${runtime.output.trim()}`);
    }

    if (sections.length === 0) {
      return;
    }

    const pidLabel = runtime.pid ? ` (pid: ${runtime.pid})` : "";
    const promptFromProcess = `Please analyze this process result for code block ${process.id}${pidLabel}.`;

    const processContext = [
      {
        processId: process.id,
        pid: runtime.pid,
        stdout: runtime.stdout,
        stderr: runtime.stderr,
        output: runtime.output,
      },
    ];

    setPrompt(promptFromProcess);
    await handleSubmit(promptFromProcess, processContext);
  }

  function getProcessBorderTone(
    state: MciProcessState | null,
    status: MciProcessStatus,
  ): ProcessBorderTone {
    if (status === "failed") {
      return { color: "var(--destructive)", animated: false };
    }

    if (status === "success") {
      return { color: "oklch(0.768 0.148 163.223)", animated: false };
    }

    if (status === "canceled") {
      return { color: "var(--muted-foreground)", animated: false };
    }

    if (state === "running") {
      return { color: "oklch(0.707 0.165 254.624)", animated: true };
    }

    if (state === "queued") {
      return { color: "oklch(0.829 0.161 83.813)", animated: true };
    }

    if (state === "idle") {
      return { color: "oklch(0.768 0.148 163.223)", animated: false };
    }

    return { color: null, animated: false };
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
            <p className="mt-1 text-[11px] text-muted-foreground">MCI server: {mciServerUrl}</p>
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
              {processes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No executable code blocks yet.</p>
              ) : (
                processes.map((process) => {
                  const runtime = processRuntimeByKey[process.key] ?? createDefaultRuntime();
                  const isBusy = runtime.isCreating || runtime.isSignaling;
                  const hasProcessOutput = Boolean(
                    runtime.stdout?.trim() || runtime.stderr?.trim() || runtime.output?.trim(),
                  );
                  const processBorderTone = getProcessBorderTone(runtime.state, runtime.status);
                  const processCardStyle = processBorderTone.color
                    ? ({
                        "--process-border-color": processBorderTone.color,
                      } as React.CSSProperties)
                    : undefined;

                  return (
                    <div
                      key={process.key}
                      className={`border border-border bg-background p-2 process-card-border ${
                        processBorderTone.animated ? "process-card-border-animated" : ""
                      }`}
                      style={processCardStyle}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-medium text-foreground">{process.id}</p>
                          {runtime.pid ? (
                            <p className="truncate text-[10px] text-muted-foreground">PID: {runtime.pid}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              void handleSendProcessOutput(process);
                            }}
                            disabled={isStreaming || !hasProcessOutput}
                            aria-label="Send process output as prompt"
                            title="Send process output as prompt"
                          >
                            <SendHorizontal className="size-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleProcessClick(process)}
                            aria-label="Jump to code block"
                          >
                            <ArrowUpRight />
                          </Button>
                          {!runtime.pid ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => { void handleCreateProcess(process); }}
                              disabled={isBusy}
                            >
                              <Play className="size-3" />
                            </Button>
                          ) : runtime.state === "idle" ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                void handleRunProcess(process, false);
                              }}
                              disabled={isBusy}
                            >
                              <RotateCw className="size-3" />
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="destructive"
                              onClick={() => {
                                void handleKillProcess(process);
                              }}
                              disabled={isBusy}
                            >
                              <Square className="size-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {runtime.error ? (
                        <p className="mt-1 text-[10px] text-destructive">{runtime.error}</p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {forceRunConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm border border-border bg-card p-4 shadow-xl">
            <p className="text-sm font-medium text-foreground">Force run required</p>
            <p className="mt-2 text-xs text-muted-foreground">
              This process already has output. Running with force will overwrite it.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setForceRunConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void handleConfirmForceRun();
                }}
              >
                Force run
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
