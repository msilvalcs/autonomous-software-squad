import { z } from "zod";

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
  status: StoryStatusSchema
});

export type UserStory = z.infer<typeof UserStorySchema>;

export const BacklogSchema = z.object({
  stories: z.array(UserStorySchema).min(1).max(6)
});

export type Backlog = z.infer<typeof BacklogSchema>;

export const DeveloperResultSchema = z.object({
  storyId: z.string().min(1),
  summary: z.string().min(1),
  changedFiles: z.array(z.string()),
  commands: z.array(z.string()),
  status: z.enum(["IMPLEMENTED", "FAILED"])
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
  requestedChanges: z.array(z.string())
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
