import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  MockDeveloperAgent,
  MockProductOwnerAgent,
  MockQualityAssuranceAgent
} from "@squad/agents";
import { JsonlEventStore } from "@squad/event-store";
import type { UserStory } from "@squad/schemas";

import {
  DeterministicModelRouter,
  MinimumIsolationPolicy,
  Orchestrator
} from "./index.js";

const temporaryDirectories: string[] = [];

async function createOrchestrator(
  storyPublisher?: {
    publish: (
      runId: string,
      stories: UserStory[]
    ) => Promise<Array<{
      storyId: string;
      number: number;
      url: string;
    }>>;
  },
  options: {
    failDispose?: boolean;
    failPrepareOnce?: boolean;
    minimumIsolationHigh?: "local" | "docker" | "microvm";
  } = {}
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "squad-orchestrator-")
  );

  temporaryDirectories.push(directory);

  const eventStore = new JsonlEventStore(directory);

  const successfulExecution = {
    command: "npm test" as const,
    exitCode: 0,
    stdout: "Command passed",
    stderr: "",
    durationMs: 10,
    timedOut: false
  };
  const executedCommands: string[] = [];
  const lifecycleCalls: string[] = [];
  let preparationAttempts = 0;

  const runner = {
    backend: "local" as const,
    policy: {
      runtime: "local-process" as const,
      workspaceAccess: "run-write" as const,
      networkAccess: "host" as const,
      credentialAccess: "none" as const,
      allowedCommands: [
        "npm install" as const,
        "npm test" as const,
        "npm run build" as const,
        "npm run typecheck" as const
      ],
      privileged: false as const,
      dockerSocket: false as const,
      limits: {
        timeoutMs: 180_000,
        cpu: null,
        memory: null,
        pids: null
      }
    },
    prepare: async (workspace: string) => {
      preparationAttempts += 1;
      lifecycleCalls.push(`prepare:${workspace}`);

      if (
        options.failPrepareOnce &&
        preparationAttempts === 1
      ) {
        throw new Error("prepare failed");
      }

      return {
        backend: "local" as const,
        environmentId: "test-local"
      };
    },
    run: async (input: { command: string }) => {
      executedCommands.push(input.command);
      return successfulExecution;
    },
    dispose: async (workspace: string) => {
      lifecycleCalls.push(`dispose:${workspace}`);

      if (options.failDispose) {
        throw new Error("cleanup failed");
      }
    }
  };

  const workspaceManager = {
    prepareWorkspace: async (runId: string) =>
      path.join(directory, "generated-projects", runId)
  };

  const orchestrator = new Orchestrator({
    po: new MockProductOwnerAgent(),
    developer: new MockDeveloperAgent(),
    qa: new MockQualityAssuranceAgent(),
    eventStore,
    runner,
    workspaceManager,
    isolationPolicy: new MinimumIsolationPolicy({
      HIGH: options.minimumIsolationHigh
    }),
    storyPublisher
  });

  return {
    orchestrator,
    eventStore,
    executedCommands,
    lifecycleCalls
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Orchestrator", () => {
  it("executa PO, Developer e QA até concluir as stories", async () => {
    const { orchestrator, eventStore, lifecycleCalls } =
      await createOrchestrator();

    const initialState = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas.",
      maxAttempts: 3
    });

    const finalState =
      await orchestrator.execute(initialState);

    expect(finalState.complexity).toBe("LOW");
    expect(finalState.modelAssignments).toHaveLength(3);
    expect(finalState.status).toBe("COMPLETED");
    expect(finalState.currentStoryId).toBeNull();

    expect(
      finalState.stories.every(
        (story) => story.status === "PASSED"
      )
    ).toBe(true);

    const events = await eventStore.listEvents(
      finalState.runId
    );

    expect(
      events.some(
        (event) => event.action === "MODEL_ROUTING_DECIDED"
      )
    ).toBe(true);

    expect(initialState.executionPolicies).toHaveLength(4);
    expect(
      events.some(
        (event) =>
          event.action === "EXECUTION_POLICIES_DECIDED"
      )
    ).toBe(true);

    expect(
      events.some(
        (event) =>
          event.action === "EXECUTION_BACKEND_DECIDED" &&
          event.metadata?.backend === "local"
      )
    ).toBe(true);

    expect(
      events.some(
        (event) =>
          event.action === "EXECUTION_ENVIRONMENT_STARTED"
      )
    ).toBe(true);

    const buildEvent = events.find(
      (event) => event.action === "BUILD_COMPLETED"
    );

    expect(buildEvent?.metadata).toMatchObject({
      backend: "local",
      stage: "BUILD",
      durationMs: 10,
      networkAccess: "host"
    });

    expect(
      events.some(
        (event) =>
          event.action === "EXECUTION_ENVIRONMENT_DISPOSED"
      )
    ).toBe(true);

    expect(lifecycleCalls).toHaveLength(2);
    expect(lifecycleCalls[0]).toContain("prepare:");
    expect(lifecycleCalls[1]).toContain("dispose:");

    expect(
      events.some(
        (event) => event.action === "IMPLEMENTATION_COMPLETED"
      )
    ).toBe(true);

    expect(
      events.some(
        (event) => event.action === "STORY_REJECTED"
      )
    ).toBe(true);

    expect(
      events.some(
        (event) => event.action === "STORY_APPROVED"
      )
    ).toBe(true);

    const approval = events.find(
      (event) => event.action === "STORY_APPROVED"
    );

    expect(approval?.metadata?.criteria).toBeInstanceOf(Array);

    expect(
      events.some(
        (event) => event.action === "RUN_COMPLETED"
      )
    ).toBe(true);

    expect(events.at(-1)?.action).toBe(
      "EXECUTION_ENVIRONMENT_DISPOSED"
    );
  });

  it("rejeita um briefing vazio", async () => {
    const { orchestrator } = await createOrchestrator();

    await expect(
      orchestrator.createRun({
        briefing: "   "
      })
    ).rejects.toThrow("Briefing cannot be empty");
  });

  it("registra falha ao limpar o ambiente", async () => {
    const { orchestrator, eventStore } =
      await createOrchestrator(undefined, {
        failDispose: true
      });
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas."
    });

    const finalState = await orchestrator.execute(state);
    const events = await eventStore.listEvents(state.runId);

    expect(finalState.status).toBe("FAILED");
    expect(events.at(-1)?.action).toBe(
      "EXECUTION_ENVIRONMENT_CLEANUP_FAILED"
    );
  });

  it("permite retomar falha de criação do ambiente", async () => {
    const { orchestrator, eventStore } =
      await createOrchestrator(undefined, {
        failPrepareOnce: true
      });
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas."
    });

    const failedState = await orchestrator.execute(state);
    const failedStatus = failedState.status;
    const recoveredState = await orchestrator.resume(failedState);
    const events = await eventStore.listEvents(state.runId);

    expect(failedStatus).toBe("FAILED");
    expect(recoveredState.status).toBe("COMPLETED");
    expect(
      events.some(
        (event) =>
          event.action ===
          "EXECUTION_ENVIRONMENT_CREATION_FAILED" &&
          event.metadata?.retryable === true
      )
    ).toBe(true);
  });

  it("não retoma falha sem evidência de infraestrutura", async () => {
    const { orchestrator } = await createOrchestrator();
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas."
    });
    state.status = "FAILED";

    await expect(orchestrator.resume(state)).rejects.toThrow(
      "cannot be resumed"
    );
  });

  it("bloqueia risco alto quando o backend viola o isolamento mínimo", async () => {
    const { orchestrator, eventStore, lifecycleCalls } =
      await createOrchestrator(undefined, {
        minimumIsolationHigh: "microvm"
      });
    const state = await orchestrator.createRun({
      briefing:
        "Criar autenticação com permissões, pagamento, banco de dados, " +
        "integração externa em tempo real e validar todos os fluxos."
    });

    const finalState = await orchestrator.execute(state);
    const events = await eventStore.listEvents(state.runId);

    expect(state.complexity).toBe("HIGH");
    expect(finalState.status).toBe("FAILED");
    expect(lifecycleCalls).toHaveLength(0);
    expect(
      events.some(
        (event) =>
          event.action === "ISOLATION_REQUIREMENT_NOT_MET" &&
          event.metadata?.requiredBackend === "microvm" &&
          event.metadata?.selectedBackend === "local"
      )
    ).toBe(true);
    expect(events.at(-1)?.message).toContain(
      "No fallback was applied"
    );
  });

  it("retoma uma execução persistida sem repetir stories aprovadas", async () => {
    const { orchestrator, eventStore, executedCommands } =
      await createOrchestrator();
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas.",
      maxAttempts: 3
    });
    const backlog = await new MockProductOwnerAgent().createBacklog(
      state.briefing
    );
    state.stories = backlog.stories;
    state.stories[0]!.status = "PASSED";
    state.stories[1]!.status = "FAILED";
    state.currentStoryId = state.stories[1]!.id;
    state.attempt = 1;
    state.status = "DEVELOPING";
    await eventStore.saveState(state);

    const rejectedStory = state.stories[1]!;
    await eventStore.appendEvent({
      eventId: "evt-rejected",
      runId: state.runId,
      timestamp: new Date().toISOString(),
      actor: "QA",
      action: "STORY_REJECTED",
      message: `${rejectedStory.id} foi rejeitada.`,
      storyId: rejectedStory.id,
      metadata: {
        summary: "Falta evidência.",
        criteria: rejectedStory.acceptanceCriteria.map((criterion) => ({
          criterion,
          passed: false,
          evidence: "Critério ainda não coberto."
        })),
        requestedChanges: ["Adicionar a cobertura ausente."],
        decisions: [{
          decision: "Reprovar a story.",
          rationale: "Falta evidência objetiva.",
          alternativesConsidered: []
        }]
      }
    });

    const finalState = await orchestrator.resume(state);
    const events = await eventStore.listEvents(state.runId);

    expect(finalState.status).toBe("COMPLETED");
    expect(
      events.some((event) => event.action === "RUN_RESUMED")
    ).toBe(true);
    expect(
      events.some((event) => event.action === "STORY_RESUMED")
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.action === "IMPLEMENTATION_COMPLETED" &&
          event.message.includes("corrigida")
      )
    ).toBe(true);
    expect(executedCommands[0]).toBe("npm install");
  });

  it("persiste as issues publicadas e registra a integração", async () => {
    const storyPublisher = {
      publish: async (_runId: string, stories: UserStory[]) =>
        stories.map((story, index) => ({
          storyId: story.id,
          number: index + 10,
          url: `https://github.com/acme/squad/issues/${index + 10}`
        }))
    };
    const { orchestrator, eventStore } =
      await createOrchestrator(storyPublisher);
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas."
    });

    const finalState = await orchestrator.execute(state);
    const events = await eventStore.listEvents(state.runId);

    expect(finalState.stories[0]?.externalIssue).toEqual({
      provider: "github",
      number: 10,
      url: "https://github.com/acme/squad/issues/10"
    });
    expect(
      events.some((event) => event.action === "STORIES_PUBLISHED")
    ).toBe(true);
  });

  it("preserva issues publicadas quando uma story posterior falha", async () => {
    const storyPublisher = {
      publish: async (_runId: string, stories: UserStory[]) => {
        const story = stories[0]!;

        if (story.id === "US-002") {
          throw new Error("GitHub unavailable");
        }

        return [{
          storyId: story.id,
          number: 21,
          url: "https://github.com/acme/squad/issues/21"
        }];
      }
    };
    const { orchestrator, eventStore } =
      await createOrchestrator(storyPublisher);
    const state = await orchestrator.createRun({
      briefing: "Criar uma aplicação para controle de tarefas."
    });

    const finalState = await orchestrator.execute(state);
    const events = await eventStore.listEvents(state.runId);

    expect(finalState.status).toBe("COMPLETED");
    expect(finalState.stories[0]?.externalIssue?.number).toBe(21);
    expect(finalState.stories[1]?.externalIssue).toBeUndefined();
    expect(
      events.some(
        (event) =>
          event.action === "STORY_PUBLICATION_FAILED" &&
          event.storyId === "US-002"
      )
    ).toBe(true);
  });
});

describe("DeterministicModelRouter", () => {
  it("seleciona uma rota de alta capacidade para briefing complexo", () => {
    const router = new DeterministicModelRouter();
    const result = router.route(
      "Criar autenticação com permissões, pagamento, banco de dados, " +
      "integração externa em tempo real e validar todos os fluxos."
    );

    expect(result.complexity).toBe("HIGH");
    expect(
      result.assignments.find((item) => item.agent === "QA")
    ).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh"
    });
  });

  it("aplica override de provider por persona e complexidade", () => {
    const router = new DeterministicModelRouter({
      MEDIUM: {
        PO: {
          provider: "anthropic",
          model: "configured-opus-model",
          reasoningEffort: "medium"
        }
      }
    });
    const result = router.route(
      "Criar aplicação para cadastrar, listar e filtrar equipamentos."
    );

    expect(result.complexity).toBe("MEDIUM");
    expect(
      result.assignments.find((item) => item.agent === "PO")
    ).toMatchObject({
      provider: "anthropic",
      model: "configured-opus-model"
    });
  });
});

describe("MinimumIsolationPolicy", () => {
  it("aceita backend mais forte e nunca reduz o mínimo configurado", () => {
    const policy = new MinimumIsolationPolicy({
      MEDIUM: "docker",
      HIGH: "microvm"
    });

    expect(policy.evaluate("MEDIUM", "microvm").allowed).toBe(true);
    expect(policy.evaluate("HIGH", "docker")).toMatchObject({
      allowed: false,
      requiredBackend: "microvm",
      selectedBackend: "docker"
    });
  });
});
