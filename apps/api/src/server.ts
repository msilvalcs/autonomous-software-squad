import dotenv from "dotenv";

import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

import cors from "@fastify/cors";
import Fastify, { type FastifyReply } from "fastify";

import {
  CodexDeveloperAgent,
  CodexProductOwnerAgent,
  CodexQualityAssuranceAgent,
  MockDeveloperAgent,
  MockProductOwnerAgent,
  MockQualityAssuranceAgent
} from "@squad/agents";

import { JsonlEventStore } from "@squad/event-store";
import { GitHubIssuesPublisher } from "@squad/github-issues";
import {
  canResumeRun,
  DeterministicModelRouter,
  MinimumIsolationPolicy,
  Orchestrator,
  type RoutingOverrides
} from "@squad/orchestrator";
import {
  createExecutionRunner,
  WorkspaceManager,
  type ExecutionBackend
} from "@squad/runner";

import { CodexClient } from "@squad/codex-client";
import type { AuditEvent, RunState } from "@squad/schemas";

import {
  createArtifactArchive,
  openArtifactFile,
  readPreviewIndex,
  resolveArtifact,
  type ResolvedArtifact
} from "./artifact-service.js";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url))
);

dotenv.config({
  path: path.join(repositoryRoot, ".env")
});

const runsDirectory = path.join(
  repositoryRoot,
  "data",
  "runs"
);

const generatedProjectsDirectory = path.join(
  repositoryRoot,
  "generated-projects"
);

const templateDirectory = path.join(
  repositoryRoot,
  "templates",
  "react-task-app"
);

const eventStore = new JsonlEventStore(runsDirectory);

const workspaceManager = new WorkspaceManager({
  templateDirectory,
  generatedProjectsDirectory,
  approvedSkillsDirectory: path.join(
    repositoryRoot,
    ".agents",
    "skills"
  )
});

const runner = createExecutionRunner({
  mode: process.env.EXECUTION_MODE,
  baseDirectory: generatedProjectsDirectory,
  docker: {
    image:
      process.env.DOCKER_RUNNER_IMAGE ??
      "autonomous-squad-runner:local"
  },
  microvm: {
    firecrackerBinary: process.env.FIRECRACKER_BINARY,
    jailerBinary: process.env.FIRECRACKER_JAILER_BINARY,
    kernelImage: process.env.FIRECRACKER_KERNEL_IMAGE,
    rootfsImage: process.env.FIRECRACKER_ROOTFS_IMAGE
  }
});

const llmProvider = process.env.LLM_PROVIDER ?? "mock";
const routingOverrides = parseRoutingOverrides(
  process.env.MODEL_ROUTING_CONFIG
);
const routingPolicy = new DeterministicModelRouter(
  routingOverrides,
  llmProvider
);
const isolationPolicy = new MinimumIsolationPolicy({
  LOW: parseIsolationBackend(
    process.env.MINIMUM_ISOLATION_LOW,
    "MINIMUM_ISOLATION_LOW"
  ),
  MEDIUM: parseIsolationBackend(
    process.env.MINIMUM_ISOLATION_MEDIUM,
    "MINIMUM_ISOLATION_MEDIUM"
  ),
  HIGH: parseIsolationBackend(
    process.env.MINIMUM_ISOLATION_HIGH,
    "MINIMUM_ISOLATION_HIGH"
  )
});
const githubIssuesPublisher = createGitHubIssuesPublisher();

const [poPersona, developerPersona, qaPersona] = await Promise.all([
  loadPersona("PO.md"),
  loadPersona("DEV.md"),
  loadPersona("QA.md")
]);

const po =
  llmProvider === "codex"
    ? new CodexProductOwnerAgent(
        new CodexClient(),
        repositoryRoot,
        process.env.LLM_MODEL || undefined,
        poPersona
      )
    : new MockProductOwnerAgent();

const developer =
  llmProvider === "codex"
    ? new CodexDeveloperAgent(
        new CodexClient(),
        process.env.LLM_MODEL || undefined,
        developerPersona
      )
    : new MockDeveloperAgent();

const qa =
  llmProvider === "codex"
    ? new CodexQualityAssuranceAgent(
        new CodexClient(),
        process.env.LLM_MODEL || undefined,
        qaPersona
      )
    : new MockQualityAssuranceAgent();

const orchestrator = new Orchestrator({
  po,
  developer,
  qa,
  eventStore,
  runner,
  workspaceManager,
  routingPolicy,
  isolationPolicy,
  storyPublisher: githubIssuesPublisher
});

const app = Fastify({
  logger: true
});

const activeExecutions = new Map<string, Promise<void>>();

const documentationFiles = [
  {
    id: "project-status",
    title: "Estado do projeto e próximos passos",
    category: "Governança",
    path: path.join(repositoryRoot, "docs", "PROJECT_STATUS.md")
  },
  {
    id: "project-agents",
    title: "Regras do projeto",
    category: "Governança",
    path: path.join(repositoryRoot, "AGENTS.md")
  },
  {
    id: "model-routing",
    title: "ADR-001: Roteamento de modelos",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-001-model-routing.md"
    )
  },
  {
    id: "agent-skills",
    title: "ADR-002: Skills dos agentes",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-002-agent-skills.md"
    )
  },
  {
    id: "artifact-delivery",
    title: "ADR-003: Entrega do artefato",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-003-artifact-delivery.md"
    )
  },
  {
    id: "continuous-integration",
    title: "ADR-004: Integração contínua",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-004-continuous-integration.md"
    )
  },
  {
    id: "run-history-and-recovery",
    title: "ADR-005: Histórico e retomada",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-005-run-history-and-recovery.md"
    )
  },
  {
    id: "github-issues",
    title: "ADR-006: GitHub Issues",
    category: "Integrações",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-006-github-issues.md"
    )
  },
  {
    id: "execution-isolation",
    title: "ADR-007: Isolamento de execução",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-007-execution-isolation.md"
    )
  },
  {
    id: "persona-execution-policies",
    title: "ADR-008: Políticas por persona",
    category: "Segurança",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-008-persona-execution-policies.md"
    )
  },
  {
    id: "environment-observability",
    title: "ADR-009: Observabilidade do ambiente",
    category: "Arquitetura",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-009-environment-observability.md"
    )
  },
  {
    id: "high-risk-microvm",
    title: "ADR-010: MicroVM para alto risco",
    category: "Segurança",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-010-high-risk-microvm.md"
    )
  },
  {
    id: "e2e-recovery-actions",
    title: "ADR-011: E2E, retomada e ações por estado",
    category: "Qualidade",
    path: path.join(
      repositoryRoot,
      "docs",
      "decisions",
      "ADR-011-e2e-recovery-actions.md"
    )
  },
  {
    id: "industrial-validation",
    title: "Validação industrial",
    category: "Demonstração",
    path: path.join(
      repositoryRoot,
      "docs",
      "demo",
      "industrial-validation.md"
    )
  },
  ...["PO", "DEV", "QA"].map((persona) => ({
    id: `persona-${persona.toLowerCase()}`,
    title: `Persona: ${persona}`,
    category: "Personas",
    path: path.join(
      repositoryRoot,
      "prompts",
      "personas",
      `${persona}.md`
    )
  })),
  ...([
    ["backlog-decomposition", "Backlog decomposition"],
    ["tdd", "Test-driven development"],
    ["diagnosing-bugs", "Diagnóstico de bugs"],
    ["codebase-design", "Design de código"]
  ] as const).map(([skillId, title]) => ({
    id: `skill-${skillId}`,
    title: `Skill: ${title}`,
    category: "Skills",
    path: path.join(
      repositoryRoot,
      ".agents",
      "skills",
      skillId,
      "SKILL.md"
    )
  })),
  {
    id: "skills-third-party-notices",
    title: "Licenças das skills",
    category: "Skills",
    path: path.join(
      repositoryRoot,
      ".agents",
      "skills",
      "THIRD_PARTY_NOTICES.md"
    )
  }
];

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({
  status: "ok",
  llmProvider,
  llmModel: process.env.LLM_MODEL || null,
  githubIssuesEnabled: githubIssuesPublisher !== undefined,
  timestamp: new Date().toISOString()
}));

app.get("/documentation", async () => {
  return Promise.all(
    documentationFiles.map(async (document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      content: await readFile(document.path, "utf8")
    }))
  );
});

app.post<{
  Body: {
    briefing?: string;
    maxAttempts?: number;
  };
}>("/runs", async (request, reply) => {
  const activeRunId = activeExecutions.keys().next().value;

  if (activeRunId) {
    return reply.status(409).send({
      error: "Another run is already active",
      activeRunId
    });
  }

  const briefing = request.body?.briefing;

  if (typeof briefing !== "string" || briefing.trim() === "") {
    return reply.status(400).send({
      error: "Briefing is required"
    });
  }

  const state = await orchestrator.createRun({
    briefing,
    maxAttempts: request.body.maxAttempts
  });

  startExecution(state, false);

  return reply.status(202).send({
    runId: state.runId,
    status: state.status
  });
});

app.get<{
  Querystring: {
    limit?: string;
  };
}>("/runs", async (request) => {
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 50)
    : 20;
  const states = await eventStore.listStates();

  return Promise.all(
    states.slice(0, limit).map(async (state) => {
      const active = activeExecutions.has(state.runId);
      const events = await eventStore.listEvents(state.runId);

      return {
        runId: state.runId,
        briefing: state.briefing,
        status: state.status,
        complexity: state.complexity,
        storyCount: state.stories.length,
        approvedStoryCount: state.stories.filter(
          (story) => story.status === "PASSED"
        ).length,
        currentStoryId: state.currentStoryId,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        active,
        canResume: !active && canResumeRun(state, events)
      };
    })
  );
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId", async (request, reply) => {
  const state = await eventStore.loadState(
    request.params.runId
  );

  if (!state) {
    return reply.status(404).send({
      error: "Run not found"
    });
  }

  const active = activeExecutions.has(state.runId);
  const events = await eventStore.listEvents(state.runId);

  return {
    ...state,
    active,
    canResume: !active && canResumeRun(state, events)
  };
});

app.post<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/resume", async (request, reply) => {
  const activeRunId = activeExecutions.keys().next().value;

  if (activeRunId) {
    return reply.status(409).send({
      error: "Another run is already active",
      activeRunId
    });
  }

  const state = await eventStore.loadState(request.params.runId);

  if (!state) {
    return reply.status(404).send({ error: "Run not found" });
  }

  const events = await eventStore.listEvents(state.runId);

  if (!canResumeRun(state, events)) {
    return reply.status(409).send({
      error: "Run cannot be resumed from its current status"
    });
  }

  startExecution(state, true);

  return reply.status(202).send({
    runId: state.runId,
    status: state.status
  });
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/events", async (request, reply) => {
  const state = await eventStore.loadState(
    request.params.runId
  );

  if (!state) {
    return reply.status(404).send({
      error: "Run not found"
    });
  }

  return eventStore.listEvents(request.params.runId);
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/artifact", async (request, reply) => {
  const state = await eventStore.loadState(
    request.params.runId
  );

  if (!state) {
    return reply.status(404).send({
      error: "Run not found"
    });
  }

  const events = await eventStore.listEvents(state.runId);
  const completed = state.status === "COMPLETED";
  const artifact = completed
    ? await resolveArtifact(
        generatedProjectsDirectory,
        state.runId,
        state.workspacePath
      )
    : null;

  return {
    runId: state.runId,
    status: state.status,
    available: completed,
    hasPreview: artifact?.hasPreview ?? false,
    previewUrl: artifact?.hasPreview
      ? `/api/runs/${state.runId}/artifact/preview`
      : null,
    downloadUrl: completed
      ? `/api/runs/${state.runId}/artifact/download`
      : null,
    fileCount: artifact?.files.length ?? 0,
    totalBytes:
      artifact?.files.reduce(
        (total, file) => total + file.size,
        0
      ) ?? 0,
    summary: {
      stories: state.stories.length,
      approvedStories: state.stories.filter(
        (story) => story.status === "PASSED"
      ).length,
      events: events.length,
      decisions: events.reduce(
        (total, event) =>
          total +
          (Array.isArray(event.metadata?.decisions)
            ? event.metadata.decisions.length
            : 0),
        0
      ),
      durationMs:
        new Date(state.updatedAt).getTime() -
        new Date(state.createdAt).getTime()
    },
    environmentProvenance: createEnvironmentProvenance(events)
  };
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/artifact/preview", async (request, reply) => {
  const artifact = await getCompletedArtifact(
    request.params.runId,
    reply
  );

  if (!artifact) {
    return reply;
  }

  return reply
    .type("text/html; charset=utf-8")
    .header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    )
    .send(await readPreviewIndex(artifact, "files"));
});

app.get<{
  Params: {
    runId: string;
    "*": string;
  };
}>("/runs/:runId/artifact/files/*", async (request, reply) => {
  const artifact = await getCompletedArtifact(
    request.params.runId,
    reply
  );

  if (!artifact) {
    return reply;
  }

  try {
    const file = await openArtifactFile(
      artifact,
      `dist/${request.params["*"]}`
    );

    return reply
      .type(file.mimeType)
      .header("Content-Length", file.size)
      .send(file.stream);
  } catch {
    return reply.status(404).send({
      error: "Artifact file not found"
    });
  }
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/artifact/download", async (request, reply) => {
  const artifact = await getCompletedArtifact(
    request.params.runId,
    reply
  );

  if (!artifact) {
    return reply;
  }

  const archive = createArtifactArchive(artifact);
  archive.on("error", (error) => reply.raw.destroy(error));
  void archive.finalize();

  return reply
    .type("application/zip")
    .header(
      "Content-Disposition",
      `attachment; filename="${request.params.runId}.zip"`
    )
    .send(archive);
});

app.get<{
  Params: {
    runId: string;
  };
}>("/runs/:runId/stream", async (request, reply) => {
  const { runId } = request.params;
  const initialState = await eventStore.loadState(runId);

  if (!initialState) {
    return reply.status(404).send({
      error: "Run not found"
    });
  }

  reply.hijack();

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  let closed = false;
  const sentEventIds = new Set<string>();

  request.raw.on("close", () => {
    closed = true;
  });

  async function sendPendingEvents(): Promise<void> {
    if (closed) {
      return;
    }

    try {
      const events = await eventStore.listEvents(runId);

      for (const event of events) {
        if (sentEventIds.has(event.eventId)) {
          continue;
        }

        sentEventIds.add(event.eventId);

        reply.raw.write(
          `id: ${event.eventId}\n` +
          `event: audit-event\n` +
          `data: ${JSON.stringify(event)}\n\n`
        );
      }

      const state = await eventStore.loadState(runId);

      const hasFinished =
        state === null ||
        ["COMPLETED", "BLOCKED", "FAILED"].includes(
          state.status
        );

      if (hasFinished) {
        reply.raw.write(
          `event: stream-completed\n` +
          `data: ${JSON.stringify({
            runId,
            status: state?.status ?? "NOT_FOUND"
          })}\n\n`
        );

        reply.raw.end();
        closed = true;
        return;
      }

      setTimeout(() => {
        void sendPendingEvents();
      }, 500);
    } catch (error) {
      app.log.error(error);

      if (!closed) {
        reply.raw.write(
          `event: stream-error\n` +
          `data: ${JSON.stringify({
            message: "Unable to read execution events"
          })}\n\n`
        );

        reply.raw.end();
        closed = true;
      }
    }
  }

  await sendPendingEvents();
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  return reply.status(500).send({
    error: "Internal server error"
  });
});

const port = Number(process.env.PORT ?? 3000);

await app.listen({
  port,
  host: "0.0.0.0"
});

async function loadPersona(fileName: string): Promise<string> {
  return readFile(
    path.join(repositoryRoot, "prompts", "personas", fileName),
    "utf8"
  );
}

function parseRoutingOverrides(
  raw: string | undefined
): RoutingOverrides {
  if (!raw) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("MODEL_ROUTING_CONFIG must be a JSON object");
  }

  return parsed as RoutingOverrides;
}

function parseIsolationBackend(
  raw: string | undefined,
  variable: string
): ExecutionBackend | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw === "local" || raw === "docker" || raw === "microvm") {
    return raw;
  }

  throw new Error(
    `${variable} must be local, docker or microvm`
  );
}

function createEnvironmentProvenance(events: AuditEvent[]) {
  const backendDecision = events.find(
    (event) => event.action === "EXECUTION_BACKEND_DECIDED"
  );
  const environmentStarted = events.find(
    (event) => event.action === "EXECUTION_ENVIRONMENT_STARTED"
  );

  if (!backendDecision && !environmentStarted) {
    return null;
  }

  const metadata = environmentStarted?.metadata ??
    backendDecision?.metadata ?? {};
  const stageEvents = events.filter(
    (event) =>
      typeof event.metadata?.stage === "string" &&
      typeof event.metadata?.durationMs === "number"
  );

  return {
    backend:
      typeof metadata.backend === "string"
        ? metadata.backend
        : null,
    environmentId:
      typeof metadata.environmentId === "string"
        ? metadata.environmentId
        : null,
    image:
      typeof metadata.image === "string"
        ? metadata.image
        : null,
    imageDigest:
      typeof metadata.imageDigest === "string"
        ? metadata.imageDigest
        : null,
    networkAccess:
      typeof metadata.networkAccess === "string"
        ? metadata.networkAccess
        : null,
    limits:
      typeof metadata.limits === "object" && metadata.limits !== null
        ? metadata.limits
        : null,
    reason:
      typeof backendDecision?.metadata?.reason === "string"
        ? backendDecision.metadata.reason
        : null,
    stages: stageEvents.map((event) => ({
      stage: event.metadata?.stage,
      action: event.action,
      durationMs: event.metadata?.durationMs
    }))
  };
}

function createGitHubIssuesPublisher():
  | GitHubIssuesPublisher
  | undefined {
  if (process.env.GITHUB_ISSUES_ENABLED !== "true") {
    return undefined;
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token || !repository) {
    throw new Error(
      "GITHUB_TOKEN and GITHUB_REPOSITORY are required when GitHub Issues are enabled"
    );
  }

  return new GitHubIssuesPublisher({
    token,
    repository
  });
}

function startExecution(
  state: RunState,
  resume: boolean
): void {
  const execution = (
    resume
      ? orchestrator.resume(state)
      : orchestrator.execute(state)
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      app.log.error(error);
    })
    .finally(() => {
      activeExecutions.delete(state.runId);
    });

  activeExecutions.set(state.runId, execution);
}

async function getCompletedArtifact(
  runId: string,
  reply: FastifyReply
): Promise<ResolvedArtifact | null> {
  const state = await eventStore.loadState(runId);

  if (!state) {
    await reply.status(404).send({ error: "Run not found" });
    return null;
  }

  if (state.status !== "COMPLETED") {
    await reply.status(409).send({ error: "Artifact is not ready" });
    return null;
  }

  return resolveArtifact(
    generatedProjectsDirectory,
    state.runId,
    state.workspacePath
  );
}
