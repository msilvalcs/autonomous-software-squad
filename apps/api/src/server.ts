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
import {
  DeterministicModelRouter,
  Orchestrator,
  type RoutingOverrides
} from "@squad/orchestrator";
import {
  LocalRunner,
  WorkspaceManager
} from "@squad/runner";

import { CodexClient } from "@squad/codex-client";

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
  generatedProjectsDirectory
});

const runner = new LocalRunner(
  generatedProjectsDirectory
);

const llmProvider = process.env.LLM_PROVIDER ?? "mock";
const routingOverrides = parseRoutingOverrides(
  process.env.MODEL_ROUTING_CONFIG
);
const routingPolicy = new DeterministicModelRouter(
  routingOverrides,
  llmProvider
);

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
  routingPolicy
});

const app = Fastify({
  logger: true
});

const documentationFiles = [
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
  }))
];

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({
  status: "ok",
  llmProvider,
  llmModel: process.env.LLM_MODEL || null,
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

  void orchestrator.execute(state);

  return reply.status(202).send({
    runId: state.runId,
    status: state.status
  });
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

  return state;
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
    }
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

  const publicBasePath =
    `/api/runs/${request.params.runId}/artifact/files`;

  return reply
    .type("text/html; charset=utf-8")
    .header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    )
    .send(await readPreviewIndex(artifact, publicBasePath));
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
