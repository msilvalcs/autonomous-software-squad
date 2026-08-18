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

import {
  DeterministicModelRouter,
  Orchestrator
} from "./index.js";

const temporaryDirectories: string[] = [];

async function createOrchestrator() {
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

  const runner = {
    run: async () => successfulExecution
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
    workspaceManager
  });

  return {
    orchestrator,
    eventStore
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
    const { orchestrator, eventStore } =
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
      events.at(-1)?.action
    ).toBe("RUN_COMPLETED");
  });

  it("rejeita um briefing vazio", async () => {
    const { orchestrator } = await createOrchestrator();

    await expect(
      orchestrator.createRun({
        briefing: "   "
      })
    ).rejects.toThrow("Briefing cannot be empty");
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
