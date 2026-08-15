import "dotenv/config";

import { fileURLToPath } from "node:url";
import path from "node:path";

import cors from "@fastify/cors";
import Fastify from "fastify";

import {
  MockDeveloperAgent,
  MockProductOwnerAgent,
  MockQualityAssuranceAgent
} from "@squad/agents";
import { JsonlEventStore } from "@squad/event-store";
import { Orchestrator } from "@squad/orchestrator";
import {
  LocalRunner,
  WorkspaceManager
} from "@squad/runner";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url))
);

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

const orchestrator = new Orchestrator({
  po: new MockProductOwnerAgent(),
  developer: new MockDeveloperAgent(),
  qa: new MockQualityAssuranceAgent(),
  eventStore,
  runner,
  workspaceManager
});

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({
  status: "ok",
  timestamp: new Date().toISOString()
}));

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

  return {
    runId: state.runId,
    status: state.status,
    workspacePath: state.workspacePath,
    available: state.status === "COMPLETED"
  };
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