import type { MciProcessState, MciProcessStatus } from "@/lib/mci";
import type { ProcessBorderTone, ProcessCreateState, ProcessRuntime } from "./types";

export function stringifyProcessOutput(value: unknown): string | null {
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

export function createDefaultRuntime({
  pid,
  ref = null,
  state = null,
  status = null,
}: {
  pid: number;
  ref?: string | null;
  state?: MciProcessState | null;
  status?: MciProcessStatus;
}): ProcessRuntime {
  return {
    pid,
    ref,
    state,
    status,
    stdout: null,
    stderr: null,
    output: null,
    isSignaling: false,
    artifactsFetched: false,
    error: null,
  };
}

export function createDefaultCreateState(): ProcessCreateState {
  return {
    isCreating: false,
    error: null,
  };
}

export function getProcessBorderTone(
  state: MciProcessState | null,
  status: MciProcessStatus,
): ProcessBorderTone {
  if (status === "failed") {
    return { color: "var(--destructive)", animated: false };
  }

  if (status === "timeout") {
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
