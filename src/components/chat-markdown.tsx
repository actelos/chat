import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";
import { preprocessMarkdown } from "@/lib/preprocess-markdown";

import { CodeBlock } from "@/components/code-block";

type ChatMarkdownProps = {
  content: string;
};

function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted prose-pre:text-foreground prose-a:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, preprocessMarkdown]}
        components={{
          a: ({ node, ...props }) => {
            void node;
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
          code: (props) => <CodeBlock {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export { ChatMarkdown };
