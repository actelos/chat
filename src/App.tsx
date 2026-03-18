import useSWR from "swr";
import { streamChat } from "@/lib/chat";
import { extractExecutableCodeBlocks } from "@/lib/preprocess-markdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listStoredMessages,
  createStoredMessage,
  deleteStoredMessagesByIds,
  updateStoredMessageContent,
} from "@/lib/db";
import {
  createProcess,
  listProcesses,
  getProcessArtifacts,
  killProcess,
  MciApiError,
  runProcess,
  type MciProcess,
  type MciProcessArtifacts,
  mciServerUrl,
} from "@/lib/mci";

import { ChatList } from "@/components/app/chat-list";
import { ChatComposer } from "@/components/app/chat-composer";
import { ProcessPanel } from "@/components/app/process-panel";
import { ForceRunDialog } from "@/components/app/force-run-dialog";
import {
  createDefaultRuntime,
  stringifyProcessOutput,
  createDefaultCreateState,
} from "@/components/app/process-helpers";
import type {
  UIMessage,
  CodeBlockGroup,
  ProcessRuntime,
  ForceRunConfirm,
  ProcessCreateState,
} from "@/components/app/types";

const POLL_INTERVAL_MS = 2;

const models = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-3-27b-it:free",
  "deepseek/deepseek-r1:free",
];

function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(models[0]);
  const [customModel, setCustomModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [processRuntimeByPid, setProcessRuntimeByPid] = useState<Record<string, ProcessRuntime>>(
    {},
  );
  const [processCreateStateByRef, setProcessCreateStateByRef] = useState<
    Record<string, ProcessCreateState>
  >({});
  const [processesByRef, setProcessesByRef] = useState<Record<string, MciProcess[]>>({});
  const [forceRunConfirm, setForceRunConfirm] = useState<ForceRunConfirm | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(() => {
    const typedModel = customModel.trim();
    return typedModel.length > 0 ? typedModel : selectedModel;
  }, [customModel, selectedModel]);

  const codeBlockGroups = useMemo<CodeBlockGroup[]>(() => {
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
        ref: block.id,
      }));
    });
  }, [messages]);

  const updateProcessRuntime = useCallback(
    (pid: string, updater: (previous: ProcessRuntime) => ProcessRuntime) => {
      setProcessRuntimeByPid((previous) => {
        const current =
          previous[pid] ??
          createDefaultRuntime({
            pid,
            ref: null,
            state: null,
            status: null,
          });

        return {
          ...previous,
          [pid]: updater(current),
        };
      });
    },
    [],
  );

  const activeRefs = useMemo(() => {
    const unique = new Set(codeBlockGroups.map((group) => group.ref));
    return Array.from(unique).sort();
  }, [codeBlockGroups]);

  const { data: swrProcessesByRef, mutate: mutateProcessesByRef } = useSWR<
    Record<string, MciProcess[] | null>
  >(
    activeRefs.length > 0 ? ["processesByRef", activeRefs] : null,
    async ([, refs]: readonly [string, string[]]) => {
      const results = await Promise.allSettled(
        refs.map((ref) => listProcesses({ ref })),
      );
      return Object.fromEntries(
        results.map((result, index) => [
          refs[index],
          result.status === "fulfilled" ? result.value : null,
        ]),
      ) as Record<string, MciProcess[] | null>;
    },
    {
      refreshInterval: (latest) => {
        if (!latest) return 0;
        const hasActive = Object.values(latest).some((list) =>
          Array.isArray(list) ? list.some((process) => process.state !== "idle") : false,
        );
        return hasActive ? POLL_INTERVAL_MS : 0;
      },
      revalidateOnFocus: true,
    },
  );

  const idlePidsToFetch = useMemo(() => {
    const pids: string[] = [];

    for (const list of Object.values(processesByRef)) {
      for (const process of list) {
        const runtime = processRuntimeByPid[process.pid];
        const state = runtime?.state ?? process.state;
        const artifactsFetched = runtime?.artifactsFetched ?? false;

        if (state === "idle" && !artifactsFetched) {
          pids.push(process.pid);
        }
      }
    }

    return pids;
  }, [processRuntimeByPid, processesByRef]);

  const { data: swrArtifactsByPid, mutate: mutateArtifacts } = useSWR<
    Record<string, MciProcessArtifacts | null>
  >(
    idlePidsToFetch.length > 0 ? ["processArtifacts", idlePidsToFetch] : null,
    async ([, pids]: readonly [string, string[]]) => {
      const results = await Promise.allSettled(
        pids.map(async (pid) => ({ pid, artifacts: await getProcessArtifacts(pid) })),
      );
      return Object.fromEntries(
        results.map((result, index) => [
          pids[index],
          result.status === "fulfilled" ? result.value.artifacts : null,
        ]),
      ) as Record<string, MciProcessArtifacts | null>;
    },
    {
      revalidateOnFocus: false,
    },
  );

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
    const activeRefSet = new Set(activeRefs);

    if (activeRefSet.size === 0) {
      setProcessesByRef({});
      setProcessCreateStateByRef({});
      return;
    }

    if (!swrProcessesByRef) {
      return;
    }

    const resultMap = new Map(Object.entries(swrProcessesByRef));

    setProcessesByRef((previous) => {
      const next: Record<string, MciProcess[]> = {};

      for (const ref of activeRefSet) {
        const list = resultMap.get(ref);
        if (Array.isArray(list)) {
          next[ref] = list;
        } else if (previous[ref]) {
          next[ref] = previous[ref];
        } else {
          next[ref] = [];
        }
      }

      return next;
    });

    setProcessRuntimeByPid((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const list of resultMap.values()) {
        if (!Array.isArray(list)) {
          continue;
        }

        for (const process of list) {
          if (!next[process.pid]) {
            next[process.pid] = createDefaultRuntime({
              pid: process.pid,
              ref: process.ref ?? null,
              state: process.state,
              status: process.status,
            });
            changed = true;
            continue;
          }

          const current = next[process.pid];
          const shouldSync =
            !current.isSignaling &&
            (current.state !== process.state ||
              current.status !== process.status ||
              (process.ref && current.ref !== process.ref));

          if (shouldSync) {
            next[process.pid] = {
              ...current,
              ref: process.ref ?? current.ref,
              state: process.state,
              status: process.status,
            };
            changed = true;
          }
        }
      }

      return changed ? next : previous;
    });

  }, [activeRefs, swrProcessesByRef]);

  useEffect(() => {
    const activeRefSet = new Set(activeRefs);

    setProcessCreateStateByRef((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([ref]) => activeRefSet.has(ref)),
      );
      return next;
    });
  }, [activeRefs]);

  useEffect(() => {
    const activePids = new Set(
      Object.values(processesByRef).flatMap((processList) =>
        processList.map((process) => process.pid),
      ),
    );

    setProcessRuntimeByPid((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([pid]) => activePids.has(pid)),
      );

      return next;
    });

    setForceRunConfirm((previous) => {
      if (!previous) {
        return previous;
      }

      return activePids.has(previous.pid) ? previous : null;
    });
  }, [processesByRef, codeBlockGroups]);

  useEffect(() => {
    if (!swrArtifactsByPid) {
      return;
    }

    setProcessRuntimeByPid((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const [pid, artifacts] of Object.entries(swrArtifactsByPid)) {
        if (!artifacts) {
          continue;
        }

        const current =
          next[pid] ??
          createDefaultRuntime({
            pid,
            ref: null,
            state: "idle",
            status: null,
          });

        next[pid] = {
          ...current,
          stdout: artifacts.stdout,
          stderr: artifacts.stderr,
          output: stringifyProcessOutput(artifacts.output),
          artifactsFetched: true,
          error: null,
        };
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [swrArtifactsByPid]);

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

  function handleProcessClick(group: CodeBlockGroup) {
    const messageElement = document.querySelector<HTMLElement>(
      `[data-message-id="${group.messageId}"]`,
    );

    if (!messageElement) return;

    const processBlocks = messageElement.querySelectorAll<HTMLElement>("[data-exec-block-id]");
    const target = processBlocks[group.blockIndex] ?? processBlocks[0] ?? messageElement;

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

  async function handleCreateProcess(group: CodeBlockGroup) {
    setProcessCreateStateByRef((previous) => ({
      ...previous,
      [group.ref]: {
        ...(previous[group.ref] ?? createDefaultCreateState()),
        isCreating: true,
        error: null,
      },
    }));

    try {
      const created = await createProcess(group.code, group.ref);

      setProcessesByRef((previous) => {
        const current = previous[group.ref] ?? [];
        return {
          ...previous,
          [group.ref]: [
            ...current,
            {
              pid: created.pid,
              state: "queued",
              status: null,
              ref: group.ref,
            },
          ],
        };
      });

      setProcessRuntimeByPid((previous) => ({
        ...previous,
        [created.pid]: {
          pid: created.pid,
          ref: group.ref,
          state: "queued",
          status: null,
          stdout: null,
          stderr: null,
          output: null,
          isSignaling: false,
          artifactsFetched: false,
          error: null,
        },
      }));
      void mutateProcessesByRef();

      setProcessCreateStateByRef((previous) => ({
        ...previous,
        [group.ref]: {
          ...(previous[group.ref] ?? createDefaultCreateState()),
          isCreating: false,
          error: null,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to create process.";

      setProcessCreateStateByRef((previous) => ({
        ...previous,
        [group.ref]: {
          ...(previous[group.ref] ?? createDefaultCreateState()),
          isCreating: false,
          error: message,
        },
      }));
    }
  }

  async function handleRunProcess(pid: string, force: boolean) {
    const runtime = processRuntimeByPid[pid];

    if (!runtime) {
      return;
    }

    updateProcessRuntime(pid, (previous) => ({
      ...previous,
      isSignaling: true,
      error: null,
    }));

    try {
      const nextProcess = await runProcess(runtime.pid, force);

      updateProcessRuntime(pid, (previous) => ({
        ...previous,
        pid: nextProcess.pid,
        ref: nextProcess.ref ?? previous.ref,
        state: nextProcess.state,
        status: nextProcess.status,
        stdout: nextProcess.state === "idle" ? previous.stdout : null,
        stderr: nextProcess.state === "idle" ? previous.stderr : null,
        output: nextProcess.state === "idle" ? previous.output : null,
        isSignaling: false,
        artifactsFetched: false,
        error: null,
      }));

      void mutateProcessesByRef();
      void mutateArtifacts();
    } catch (error) {
      if (
        error instanceof MciApiError &&
        error.status === 400 &&
        /force\s*:\s*true|force/i.test(error.message)
      ) {
        setForceRunConfirm({ pid: runtime.pid });
        updateProcessRuntime(pid, (previous) => ({
          ...previous,
          isSignaling: false,
        }));
        return;
      }

      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to run process.";

      updateProcessRuntime(pid, (previous) => ({
        ...previous,
        isSignaling: false,
        error: message,
      }));
    }
  }

  async function handleKillProcess(pid: string) {
    const runtime = processRuntimeByPid[pid];

    if (!runtime) {
      return;
    }

    updateProcessRuntime(pid, (previous) => ({
      ...previous,
      isSignaling: true,
      error: null,
    }));

    try {
      const nextProcess = await killProcess(runtime.pid);

      updateProcessRuntime(pid, (previous) => ({
        ...previous,
        pid: nextProcess.pid,
        ref: nextProcess.ref ?? previous.ref,
        state: nextProcess.state,
        status: nextProcess.status,
        stdout: nextProcess.state === "idle" ? previous.stdout : null,
        stderr: nextProcess.state === "idle" ? previous.stderr : null,
        output: nextProcess.state === "idle" ? previous.output : null,
        isSignaling: false,
        artifactsFetched: false,
        error: null,
      }));

      void mutateProcessesByRef();
      void mutateArtifacts();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to send kill signal.";

      updateProcessRuntime(pid, (previous) => ({
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

    setForceRunConfirm(null);
    await handleRunProcess(forceRunConfirm.pid, true);
  }

  async function handleSendProcessOutput(pid: string, group: CodeBlockGroup) {
    if (isStreaming) {
      return;
    }

    const runtime = processRuntimeByPid[pid];
    if (!runtime) {
      return;
    }
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
    const promptFromProcess = `Please analyze this process result for code block ${group.id}${pidLabel}.`;

    const processContext = [
      {
        processId: group.id,
        pid: runtime.pid,
        stdout: runtime.stdout,
        stderr: runtime.stderr,
        output: runtime.output,
      },
    ];

    setPrompt(promptFromProcess);
    await handleSubmit(promptFromProcess, processContext);
  }

  const canSend = !isStreaming && prompt.trim().length > 0 && activeModel.length > 0;
  const hasMessages = messages.length > 0;

  return (
    <main className="mx-auto h-dvh max-w-7xl bg-background px-4 py-4 md:px-6 md:py-6">
      <div className="grid h-full gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 flex-col">
          <ChatList
            messages={messages}
            isStreaming={isStreaming}
            onDeleteMessage={handleDeleteMessage}
            messagesEndRef={messagesEndRef}
          />

          <ChatComposer
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={() => {
              void handleSubmit();
            }}
            onDeleteAll={handleDeleteAllMessages}
            isStreaming={isStreaming}
            models={models}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            customModel={customModel}
            onCustomModelChange={setCustomModel}
            canSend={canSend}
            hasMessages={hasMessages}
          />
        </section>

        <ProcessPanel
          codeBlockGroups={codeBlockGroups}
          processesByRef={processesByRef}
          processCreateStateByRef={processCreateStateByRef}
          processRuntimeByPid={processRuntimeByPid}
          isStreaming={isStreaming}
          mciServerUrl={mciServerUrl}
          onProcessClick={handleProcessClick}
          onCreateProcess={(group) => {
            void handleCreateProcess(group);
          }}
          onSendProcessOutput={(pid, group) => {
            void handleSendProcessOutput(pid, group);
          }}
          onRunProcess={(pid) => {
            void handleRunProcess(pid, false);
          }}
          onKillProcess={(pid) => {
            void handleKillProcess(pid);
          }}
        />
      </div>

      <ForceRunDialog
        confirm={forceRunConfirm}
        onCancel={() => setForceRunConfirm(null)}
        onConfirm={() => {
          void handleConfirmForceRun();
        }}
      />
    </main>
  );
}

export default App;
