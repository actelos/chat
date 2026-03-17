const DEFAULT_MCI_SERVER_URL = "http://localhost:7687";

const resolvedServerUrl =
  typeof import.meta.env.VITE_MCI_SERVER_URL === "string" &&
  import.meta.env.VITE_MCI_SERVER_URL.trim().length > 0
    ? import.meta.env.VITE_MCI_SERVER_URL.trim()
    : DEFAULT_MCI_SERVER_URL;

export const mciServerUrl = resolvedServerUrl.replace(/\/+$/, "");

export type MciProcessState = "queued" | "running" | "idle";
export type MciProcessStatus = "success" | "failed" | "canceled" | null;

export type MciProcess = {
  pid: string;
  state: MciProcessState;
  status: MciProcessStatus;
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
  const response = await fetch(buildMciUrl(path), init);

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new MciApiError(message, response.status);
  }

  return (await response.json()) as T;
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(buildMciUrl(path), init);

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new MciApiError(message, response.status);
  }

  return response.text();
}

export async function createProcess(code: string): Promise<{ pid: string }> {
  return requestJson<{ pid: string }>("/processes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
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
