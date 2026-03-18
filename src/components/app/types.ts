import type { ChatMessage } from "@/lib/chat";
import type { MciProcessState, MciProcessStatus } from "@/lib/mci";

export type UIMessage = ChatMessage & {
  id: string;
};

export type CodeBlockGroup = {
  key: string;
  id: string;
  code: string;
  lang: string | null;
  messageId: string;
  blockIndex: number;
  ref: string;
};

export type ProcessRuntime = {
  pid: number;
  ref: string | null;
  state: MciProcessState | null;
  status: MciProcessStatus;
  stdout: string | null;
  stderr: string | null;
  output: string | null;
  isSignaling: boolean;
  artifactsFetched: boolean;
  error: string | null;
};

export type ProcessCreateState = {
  isCreating: boolean;
  error: string | null;
};

export type ForceRunConfirm = {
  pid: number;
};

export type ProcessBorderTone = {
  color: string | null;
  animated: boolean;
};
