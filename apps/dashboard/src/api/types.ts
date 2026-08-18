export type RunStatus =
  | "CREATED"
  | "PLANNING"
  | "DEVELOPING"
  | "TESTING"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED";

export type StoryStatus =
  | "PENDING"
  | "DEVELOPING"
  | "TESTING"
  | "PASSED"
  | "FAILED"
  | "BLOCKED";

export interface UserStory {
  id: string;
  title: string;
  description: string;
  priority: number;
  acceptanceCriteria: string[];
  status: StoryStatus;
  externalIssue?: {
    provider: "github";
    number: number;
    url: string;
  };
}

export interface RunState {
  runId: string;
  briefing: string;
  status: RunStatus;
  currentStoryId: string | null;
  attempt: number;
  maxAttempts: number;
  complexity: "LOW" | "MEDIUM" | "HIGH";
  modelAssignments: ModelAssignment[];
  executionPolicies: ExecutionPolicy[];
  stories: UserStory[];
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPolicy {
  actor: "PO" | "DEV" | "QA" | "RUNNER";
  runtime: "host-codex" | "local-process" | "docker-container";
  workspaceAccess:
    | "repository-read-only"
    | "run-read-only"
    | "run-write";
  networkAccess:
    | "provider-only"
    | "host"
    | "install-only"
    | "none";
  credentialAccess: "host-session" | "runtime-secret" | "none";
  allowedCommands: string[];
  privileged: false;
  dockerSocket: false;
  limits: {
    timeoutMs: number;
    cpu: number | null;
    memory: string | null;
    pids: number | null;
  };
}

export interface ModelAssignment {
  agent: "PO" | "DEV" | "QA";
  provider: string;
  model: string | null;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  complexity: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

export interface AuditEvent {
  eventId: string;
  runId: string;
  timestamp: string;
  actor:
    | "CLIENT"
    | "ORCHESTRATOR"
    | "PO"
    | "DEV"
    | "QA"
    | "RUNNER";
  action: string;
  message: string;
  storyId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
}

export interface SquadConfiguration {
  llmProvider: string;
  llmModel: string | null;
  githubIssuesEnabled: boolean;
}

export interface ProjectDocument {
  id: string;
  title: string;
  category: string;
  content: string;
}

export interface ArtifactManifest {
  runId: string;
  status: RunStatus;
  available: boolean;
  hasPreview: boolean;
  previewUrl: string | null;
  downloadUrl: string | null;
  fileCount: number;
  totalBytes: number;
  summary: {
    stories: number;
    approvedStories: number;
    events: number;
    decisions: number;
    durationMs: number;
  };
}

export interface RunSummary {
  runId: string;
  briefing: string;
  status: RunStatus;
  complexity: "LOW" | "MEDIUM" | "HIGH";
  storyCount: number;
  approvedStoryCount: number;
  currentStoryId: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}
