import { z } from "zod";

export const TaskComplexitySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH"
]);

export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;

export const AgentRoleSchema = z.enum(["PO", "DEV", "QA"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ReasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const AgentDecisionSchema = z.object({
  decision: z.string().min(1),
  rationale: z.string().min(1),
  alternativesConsidered: z.array(z.string().min(1)).default([])
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const ModelAssignmentSchema = z.object({
  agent: AgentRoleSchema,
  provider: z.string().min(1),
  model: z.string().min(1).nullable(),
  reasoningEffort: ReasoningEffortSchema,
  complexity: TaskComplexitySchema,
  reason: z.string().min(1)
});

export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

export const StoryStatusSchema = z.enum([
  "PENDING",
  "DEVELOPING",
  "TESTING",
  "PASSED",
  "FAILED",
  "BLOCKED"
]);

export const UserStorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().positive(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  status: StoryStatusSchema,
  externalIssue: z.object({
    provider: z.literal("github"),
    number: z.number().int().positive(),
    url: z.url()
  }).optional()
});

export type UserStory = z.infer<typeof UserStorySchema>;

export const BacklogSchema = z.object({
  stories: z.array(UserStorySchema).min(1).max(6),
  decisions: z.array(AgentDecisionSchema).default([])
});

export type Backlog = z.infer<typeof BacklogSchema>;

export const DeveloperResultSchema = z.object({
  storyId: z.string().min(1),
  summary: z.string().min(1),
  changedFiles: z.array(z.string()),
  commands: z.array(z.string()),
  status: z.enum(["IMPLEMENTED", "FAILED"]),
  decisions: z.array(AgentDecisionSchema).default([])
});

export type DeveloperResult = z.infer<typeof DeveloperResultSchema>;

export const QaCriterionSchema = z.object({
  criterion: z.string().min(1),
  passed: z.boolean(),
  evidence: z.string().min(1)
});

export const QaResultSchema = z.object({
  storyId: z.string().min(1),
  status: z.enum(["PASS", "FAIL"]),
  summary: z.string().min(1),
  criteria: z.array(QaCriterionSchema),
  requestedChanges: z.array(z.string()),
  decisions: z.array(AgentDecisionSchema).default([])
});

export type QaResult = z.infer<typeof QaResultSchema>;

export const RunStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "DEVELOPING",
  "TESTING",
  "COMPLETED",
  "BLOCKED",
  "FAILED"
]);

export const RunStateSchema = z.object({
  runId: z.string().min(1),
  briefing: z.string().min(1),
  status: RunStatusSchema,
  currentStoryId: z.string().nullable(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  complexity: TaskComplexitySchema.default("MEDIUM"),
  modelAssignments: z.array(ModelAssignmentSchema).default([]),
  stories: z.array(UserStorySchema),
  workspacePath: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type RunState = z.infer<typeof RunStateSchema>;

export const AuditEventSchema = z.object({
  eventId: z.string().min(1),
  runId: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: z.enum([
    "CLIENT",
    "ORCHESTRATOR",
    "PO",
    "DEV",
    "QA",
    "RUNNER"
  ]),
  action: z.string().min(1),
  message: z.string().min(1),
  storyId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
