export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ProcessPromptContext = {
  processId: string;
  pid: number | null;
  stdout: string | null;
  stderr: string | null;
  output: string | null;
};

export type StreamChatInput = {
  model: string;
  messages: ChatMessage[];
  processContext?: ProcessPromptContext[];
  onToken: (token: string) => void;
};

export async function streamChat({
  model,
  messages,
  processContext,
  onToken,
}: StreamChatInput) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, processContext }),
  });

  if (!response.ok) {
    const raw = await response.text();

    let message = `Request failed (${response.status})`;

    try {
      const parsed = JSON.parse(raw) as {
        error?: unknown;
        details?: unknown;
      };

      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        message = parsed.error;
      }

      if (typeof parsed.details === "string" && parsed.details.length > 0) {
        message = `${message}: ${parsed.details}`;
      }
    } catch {
      if (raw) {
        message = raw;
      }
    }

    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("No response body available for streaming.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const chunk = decoder.decode(value, { stream: true });

    if (chunk) {
      onToken(chunk);
    }
  }
}
