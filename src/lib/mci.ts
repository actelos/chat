const DEFAULT_MCI_SERVER_URL = "http://localhost:7687";

const resolvedServerUrl =
  typeof import.meta.env.VITE_MCI_SERVER_URL === "string" &&
  import.meta.env.VITE_MCI_SERVER_URL.trim().length > 0
    ? import.meta.env.VITE_MCI_SERVER_URL.trim()
    : DEFAULT_MCI_SERVER_URL;

export const mciServerUrl = resolvedServerUrl.replace(/\/+$/, "");

const MCI_TIMEOUT_MS = 15_000;

export type MciProcessState = "queued" | "running" | "idle";
export type MciProcessStatus = "success" | "failed" | "canceled" | null;

export type MciProcess = {
  pid: string;
  state: MciProcessState;
  status: MciProcessStatus;
  ref?: string;
};

export type MciProcessArtifacts = {
  stdout: string | null;
  stderr: string | null;
  output: unknown | null;
};

export class MciApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MciApiError";
    this.status = status;
  }
}

function buildMciUrl(path: string): string {
  return `${mciServerUrl}${path}`;
}

function withTimeout(init?: RequestInit): { init: RequestInit; cleanup: () => void } {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), MCI_TIMEOUT_MS);
  const cleanup = () => globalThis.clearTimeout(timer);

  if (init?.signal) {
    init.signal.addEventListener(
      "abort",
      () => {
        controller.abort();
      },
      { once: true },
    );
  }

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    cleanup,
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();

  if (!raw) {
    return `MCI request failed (${response.status})`;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: unknown };

    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    return raw;
  }

  return raw;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { init: requestInit, cleanup } = withTimeout(init);

  try {
    const response = await fetch(buildMciUrl(path), requestInit);

    if (!response.ok) {
      const message = await parseErrorMessage(response);
      throw new MciApiError(message, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("MCI request timed out.");
    }

    throw error;
  } finally {
    cleanup();
  }
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const { init: requestInit, cleanup } = withTimeout(init);

  try {
    const response = await fetch(buildMciUrl(path), requestInit);

    if (!response.ok) {
      const message = await parseErrorMessage(response);
      throw new MciApiError(message, response.status);
    }

    return response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("MCI request timed out.");
    }

    throw error;
  } finally {
    cleanup();
  }
}

export async function createProcess(code: string, ref?: string): Promise<{ pid: string }> {
  return requestJson<{ pid: string }>("/processes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ref ? { code, ref } : { code }),
  });
}

export async function listProcesses(params?: {
  ref?: string;
  state?: MciProcessState;
  status?: MciProcessStatus;
}): Promise<MciProcess[]> {
  const search = new URLSearchParams();

  if (params?.ref) {
    search.set("ref", params.ref);
  }

  if (params?.state) {
    search.set("state", params.state);
  }

  if (typeof params?.status === "string") {
    search.set("status", params.status);
  }

  const suffix = search.toString();
  const path = suffix.length > 0 ? `/processes?${suffix}` : "/processes";

  const payload = await requestJson<unknown>(path);

  if (Array.isArray(payload)) {
    return payload as MciProcess[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as { processes?: unknown };
    if (Array.isArray(record.processes)) {
      return record.processes as MciProcess[];
    }
  }

  return [];
}

export async function getProcess(pid: string): Promise<MciProcess> {
  return requestJson<MciProcess>(`/processes/${encodeURIComponent(pid)}`);
}

export async function getProcessOutput(pid: string): Promise<unknown | null> {
  const parsed = await requestJson<{ output?: unknown }>(
    `/processes/${encodeURIComponent(pid)}/output`,
  );

  return parsed.output ?? null;
}

export async function getProcessStdout(pid: string): Promise<string | null> {
  const stdout = await requestText(`/processes/${encodeURIComponent(pid)}/stdout`);
  return stdout.length > 0 ? stdout : null;
}

export async function getProcessStderr(pid: string): Promise<string | null> {
  const stderr = await requestText(`/processes/${encodeURIComponent(pid)}/stderr`);
  return stderr.length > 0 ? stderr : null;
}

export async function getProcessArtifacts(pid: string): Promise<MciProcessArtifacts> {
  const [output, stdout, stderr] = await Promise.all([
    getProcessOutput(pid),
    getProcessStdout(pid),
    getProcessStderr(pid),
  ]);

  return {
    output,
    stdout,
    stderr,
  };
}

export async function killProcess(pid: string): Promise<MciProcess> {
  return requestJson<MciProcess>(`/processes/${encodeURIComponent(pid)}/signals/kill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

export async function runProcess(pid: string, force = false): Promise<MciProcess> {
  return requestJson<MciProcess>(`/processes/${encodeURIComponent(pid)}/signals/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force }),
  });
}
