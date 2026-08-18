import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AuditEvent, RunState } from "@squad/schemas";
import { JsonlEventStore } from "./index.js";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<JsonlEventStore> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "squad-event-store-")
  );

  temporaryDirectories.push(directory);
  return new JsonlEventStore(directory);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("JsonlEventStore", () => {
  it("salva e lista eventos na ordem de inserção", async () => {
    const store = await createStore();

    const firstEvent: AuditEvent = {
      eventId: "evt-001",
      runId: "run-001",
      timestamp: new Date().toISOString(),
      actor: "PO",
      action: "PLANNING_STARTED",
      message: "PO iniciou a análise do briefing."
    };

    const secondEvent: AuditEvent = {
      eventId: "evt-002",
      runId: "run-001",
      timestamp: new Date().toISOString(),
      actor: "PO",
      action: "STORIES_CREATED",
      message: "Backlog criado."
    };

    await store.appendEvent(firstEvent);
    await store.appendEvent(secondEvent);

    const events = await store.listEvents("run-001");

    expect(events).toHaveLength(2);
    expect(events[0]?.eventId).toBe("evt-001");
    expect(events[1]?.eventId).toBe("evt-002");
  });

  it("salva e recupera o estado de uma execução", async () => {
    const store = await createStore();
    const now = new Date().toISOString();

    const state: RunState = {
      runId: "run-001",
      briefing: "Criar uma aplicação de tarefas.",
      status: "CREATED",
      currentStoryId: null,
      attempt: 0,
      maxAttempts: 3,
      complexity: "MEDIUM",
      modelAssignments: [],
      stories: [],
      workspacePath: "generated-projects/run-001",
      createdAt: now,
      updatedAt: now
    };

    await store.saveState(state);

    const loadedState = await store.loadState("run-001");

    expect(loadedState).toEqual(state);
  });

  it("rejeita runId que tenta sair do diretório permitido", async () => {
    const store = await createStore();

    await expect(
      store.listEvents("../../outside")
    ).rejects.toThrow("Invalid runId");
  });
});
