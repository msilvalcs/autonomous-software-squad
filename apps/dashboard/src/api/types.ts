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
}

export interface RunState {
  runId: string;
  briefing: string;
  status: RunStatus;
  currentStoryId: string | null;
  attempt: number;
  maxAttempts: number;
  stories: UserStory[];
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
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