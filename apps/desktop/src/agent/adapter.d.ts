export type ApprovalMode = 'ask' | 'read-only';

export interface AgentTaskRequest {
  projectRoot: string;
  prompt: string;
  approvalMode: ApprovalMode;
  model: AgentModelConfiguration;
}

export type AgentModelConfiguration =
  | {
      provider: '3aik-cloud';
      /** Backend origin only. The model client appends /api/agent. */
      agentBaseUrl: string;
      deviceId: string;
    }
  | {
      provider: 'openai-compatible';
      /** Loopback or private-network OpenAI-compatible /v1 endpoint. */
      localBaseUrl: string;
      localModel: string;
      localApiKey?: string;
      deviceId: string;
    };

export interface AgentTaskHandle {
  taskId: string;
}

export interface AgentEvent {
  taskId: string;
  type:
    | 'task.started'
    | 'activity'
    | 'approval.requested'
    | 'approval.resolved'
    | 'diff.preview'
    | 'task.completed'
    | 'task.cancelled'
    | 'task.failed';
  at: string;
  /** True when one or more rendered diff/file previews are intentionally partial. */
  previewTruncated?: boolean;
  /** User-facing warning that must be displayed before approval. */
  previewWarning?: string | null;
  [key: string]: unknown;
}

export interface AgentAdapter {
  startTask(request: AgentTaskRequest): Promise<AgentTaskHandle>;
  resolveApproval(approvalId: string, approved: boolean): Promise<boolean>;
  cancelTask(taskId: string): Promise<boolean>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  dispose(): Promise<void>;
}

/**
 * Contract implemented by the shared Worker backend. A future adapter may call
 * POST `${agentBaseUrl}/api/agent`; requested tools must always be executed by
 * the trusted main-process tool host, never by the renderer.
 */
export interface WorkerAgentRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  systemPrompt?: string;
  maxTokens?: number;
}

export type WorkerAgentResponse =
  | {
      type: 'tool_calls';
      calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      model: string;
    }
  | { type: 'message'; content: string; model: string };
