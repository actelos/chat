import type { ComponentPropsWithoutRef } from "react";

type MarkdownCodeNode = {
  properties?: Record<string, unknown>;
};

type CodeBlockProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  node?: MarkdownCodeNode;
};

function CodeBlock({ inline, className, children, node, ...props }: CodeBlockProps) {
  const rawCode = String(children);
  const code = rawCode.trimEnd();
  const lang = (className ?? "").replace("language-", "");

  const propExecId = (props as Record<string, unknown>)["data-exec-id"];
  const nodeExecId = node?.properties?.["data-exec-id"];
  const rawExecId = typeof propExecId === "string" ? propExecId : nodeExecId;
  const execId = typeof rawExecId === "string" ? rawExecId : null;

  const isInlineCode =
    inline === true || (!className && !execId && !rawCode.includes("\n"));

  if (isInlineCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  if (execId) {
    return (
      <div data-exec-block-id={execId} data-lang={lang || undefined}>
        <pre>
          <code className={className}>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <pre>
      <code className={className}>{code}</code>
    </pre>
  );
}

export { CodeBlock };
