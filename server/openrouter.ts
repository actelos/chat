import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type OpenRouterChatProxyPluginOptions = {
  apiKey: string | undefined;
};

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT =
  "You are a concise, practical coding assistant. Prefer clear steps and short examples. If unsure, say so and suggest a safe next step.";

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeMessage = value as Partial<ChatMessage>;
  const isAllowedRole =
    maybeMessage.role === "user" || maybeMessage.role === "assistant";

  return isAllowedRole && typeof maybeMessage.content === "string";
}

function json(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

function parseUpstreamError(errorText: string): string {
  if (!errorText) {
    return "No error details from upstream.";
  }

  try {
    const parsed = JSON.parse(errorText) as {
      error?: {
        message?: string;
        metadata?: {
          raw?: string;
        };
      };
    };

    const message = parsed.error?.message;
    const raw = parsed.error?.metadata?.raw;

    if (typeof raw === "string" && raw.length > 0) {
      return raw;
    }

    if (typeof message === "string" && message.length > 0) {
      return message;
    }

    return errorText;
  } catch {
    return errorText;
  }
}

async function handleChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }

  if (!apiKey) {
    json(res, 500, {
      error: "Missing OPENROUTER_API_KEY in server environment.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);

    const payload = body as {
      model?: unknown;
      messages?: unknown;
    };

    if (
      typeof payload.model !== "string" ||
      payload.model.trim().length === 0
    ) {
      json(res, 400, { error: "Invalid model selection." });
      return;
    }

    const model = payload.model.trim();

    const clientMessages = Array.isArray(payload.messages)
      ? payload.messages.filter(isChatMessage)
      : [];

    const upstream = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...clientMessages,
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text();
      const parsedError = parseUpstreamError(errorText);
      console.error(
        "[openrouter] upstream error",
        model,
        upstream.status,
        parsedError,
      );

      json(res, upstream.status || 500, {
        error: "OpenRouter request failed.",
        details: parsedError,
      });
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-OpenRouter-Model", model);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice(5).trim();

        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
              };
            }>;
          };

          const token = parsed.choices?.[0]?.delta?.content;

          if (typeof token === "string" && token.length > 0) {
            res.write(token);
          }
        } catch {
          // Ignore non-JSON stream frames.
        }
      }
    }

    res.end();
  } catch (error) {
    console.error("[openrouter] proxy error", error);
    json(res, 500, {
      error: "Invalid request body or upstream stream failure.",
    });
  }
}

function attachChatMiddleware(
  middlewares: {
    use: (
      path: string,
      handler: (req: IncomingMessage, res: ServerResponse) => void,
    ) => void;
  },
  apiKey: string | undefined,
) {
  middlewares.use("/api/chat", (req, res) => {
    void handleChatRequest(req, res, apiKey);
  });
}

export default function openrouter({
  apiKey,
}: OpenRouterChatProxyPluginOptions): Plugin {
  return {
    name: "openrouter-chat-proxy",
    configureServer(server: ViteDevServer) {
      attachChatMiddleware(server.middlewares, apiKey);
    },
    configurePreviewServer(server: PreviewServer) {
      attachChatMiddleware(server.middlewares, apiKey);
    },
  };
}
