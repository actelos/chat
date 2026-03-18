import type { CSSProperties } from "react";
import { ArrowUpRight, Play, RotateCw, SendHorizontal, Square, Trash2 } from "lucide-react";
import type { MciProcess } from "@/lib/mci";
import { Button } from "@/components/ui/button";
import {
  createDefaultCreateState,
  createDefaultRuntime,
  getProcessBorderTone,
} from "./process-helpers";
import type { CodeBlockGroup, ProcessCreateState, ProcessRuntime } from "./types";

type ProcessPanelProps = {
  codeBlockGroups: CodeBlockGroup[];
  processesByRef: Record<string, MciProcess[]>;
  processCreateStateByRef: Record<string, ProcessCreateState>;
  processRuntimeByPid: Record<number, ProcessRuntime>;
  isStreaming: boolean;
  mciServerUrl: string;
  onProcessClick: (group: CodeBlockGroup) => void;
  onCreateProcess: (group: CodeBlockGroup) => void;
  onSendProcessOutput: (pid: number, group: CodeBlockGroup) => void;
  onRunProcess: (pid: number) => void;
  onKillProcess: (pid: number) => void;
  onDeleteProcess: (pid: number) => void;
};

export function ProcessPanel({
  codeBlockGroups,
  processesByRef,
  processCreateStateByRef,
  processRuntimeByPid,
  isStreaming,
  mciServerUrl,
  onProcessClick,
  onCreateProcess,
  onSendProcessOutput,
  onRunProcess,
  onKillProcess,
  onDeleteProcess,
}: ProcessPanelProps) {
  const processCount = Object.values(processesByRef).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <aside className="hidden min-h-0 lg:flex">
      <div className="flex h-full w-full flex-col border border-border bg-card p-3">
        <p className="text-sm font-medium text-foreground">Processes ({processCount})</p>
        <p className="mt-1 text-[11px] text-muted-foreground">MCI server: {mciServerUrl}</p>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {codeBlockGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No executable code blocks yet.</p>
          ) : (
            codeBlockGroups.map((group) => {
              const groupProcesses = processesByRef[group.ref] ?? [];
              const createState =
                processCreateStateByRef[group.ref] ?? createDefaultCreateState();

              return (
                <div key={group.key} className="border border-border bg-background p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-xs font-medium text-foreground">{group.id}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {group.lang ?? "plain"}
                      </p>
                    </div>
                    <div className="flex items-center">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => onProcessClick(group)}
                        aria-label="Jump to code block"
                        title="Jump to code block"
                      >
                        <ArrowUpRight />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => onCreateProcess(group)}
                        disabled={createState.isCreating}
                        aria-label="Create process"
                        title="Create process"
                      >
                        <Play className="size-3" />
                      </Button>
                    </div>
                  </div>

                  {groupProcesses.length === 0 ? (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      No processes yet.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {groupProcesses.map((process) => {
                        const runtime =
                          processRuntimeByPid[process.pid] ??
                          createDefaultRuntime({
                            pid: process.pid,
                            ref: process.ref ?? group.ref,
                            state: process.state,
                            status: process.status,
                          });
                        const isBusy = runtime.isSignaling;
                        const hasProcessOutput = Boolean(
                          runtime.stdout?.trim() ||
                            runtime.stderr?.trim() ||
                            runtime.output?.trim(),
                        );
                        const processBorderTone = getProcessBorderTone(
                          runtime.state,
                          runtime.status,
                        );
                        const processCardStyle = processBorderTone.color
                          ? ({
                              "--process-border-color": processBorderTone.color,
                            } as CSSProperties)
                          : undefined;

                        return (
                          <div
                            key={process.pid}
                            className={`border border-border bg-background p-2 process-card-border ${
                              processBorderTone.animated ? "process-card-border-animated" : ""
                            }`}
                            style={processCardStyle}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-[10px] text-muted-foreground">
                                  PID: {process.pid}
                                </p>
                              </div>
                              <div className="flex items-center">
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => onSendProcessOutput(process.pid, group)}
                                  disabled={isStreaming || !hasProcessOutput}
                                  aria-label="Send process output as prompt"
                                  title="Send process output as prompt"
                                >
                                  <SendHorizontal className="size-3" />
                                </Button>
                                {runtime.state === "idle" ? (
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => onRunProcess(process.pid)}
                                    disabled={isBusy}
                                    aria-label="Run process"
                                    title="Run process"
                                  >
                                    <RotateCw className="size-3" />
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="destructive"
                                    onClick={() => onKillProcess(process.pid)}
                                    disabled={isBusy}
                                    aria-label="Kill process"
                                    title="Kill process"
                                  >
                                    <Square className="size-3" />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => onDeleteProcess(process.pid)}
                                  disabled={isBusy}
                                  aria-label="Delete process"
                                  title="Delete process"
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </div>
                            </div>

                            {runtime.error ? (
                              <p className="mt-1 text-[10px] text-destructive">{runtime.error}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {createState.error ? (
                    <p className="mt-2 text-[10px] text-destructive">{createState.error}</p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
