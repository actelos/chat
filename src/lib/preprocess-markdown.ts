import { fnv1a } from "@/lib/hash";

type NodeWithChildren = {
  type?: string;
  value?: string;
  lang?: string | null;
  meta?: string | null;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: NodeWithChildren[];
};

const EXEC_TRUE_PATTERN = /(?:^|\s)exec\s*=\s*(?:"true"|'true'|true)(?:\s|$)/i;

type ExecutableCodeBlock = {
  id: string;
  code: string;
  lang: string | null;
};

function hasExecTrue(node: NodeWithChildren): boolean {
  const info = `${node.lang ?? ""} ${node.meta ?? ""}`.trim();
  return EXEC_TRUE_PATTERN.test(info);
}

function hasExecTrueInfo(info: string): boolean {
  return EXEC_TRUE_PATTERN.test(info);
}

function parseCodeBlockInfo(info: string): { lang: string | null; hasExecTrue: boolean } {
  const trimmed = info.trim();
  const lang = trimmed.length > 0 ? trimmed.split(/\s+/)[0] : null;

  return {
    lang,
    hasExecTrue: hasExecTrueInfo(trimmed),
  };
}

function visit(
  node: NodeWithChildren,
  fn: (node: NodeWithChildren) => void,
): void {
  fn(node);

  if (!node.children?.length) {
    return;
  }

  for (const child of node.children) {
    visit(child, fn);
  }
}

export function preprocessMarkdown() {
  return (tree: NodeWithChildren): void => {
    visit(tree, (node) => {
      if (node.type === "code" && hasExecTrue(node)) {
        const code = node.value ?? "";
        const id = fnv1a(code);

        node.data = {
          ...(node.data ?? {}),
          hProperties: {
            ...(node.data?.hProperties ?? {}),
            "data-exec-id": id,
          },
        };
      }
    });
  };
}

export function extractExecutableCodeBlocks(markdown: string): ExecutableCodeBlock[] {
  const matches = [...markdown.matchAll(/```([^\n`]*)\n([\s\S]*?)\n```/g)];

  return matches
    .map((match) => {
      const info = match[1] ?? "";
      const code = match[2] ?? "";
      const parsed = parseCodeBlockInfo(info);

      if (!parsed.hasExecTrue) {
        return null;
      }

      return {
        id: fnv1a(code),
        code,
        lang: parsed.lang,
      } satisfies ExecutableCodeBlock;
    })
    .filter((block): block is ExecutableCodeBlock => block !== null);
}
