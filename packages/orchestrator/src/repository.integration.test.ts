import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockDeveloperAgent, MockProductOwnerAgent, MockQualityAssuranceAgent } from "@squad/agents";
import { JsonlEventStore } from "@squad/event-store";
import { analyzeProject } from "@squad/project-analyzer";
import { GitChangeInspector, LocalRunner, WorkspaceManager } from "@squad/runner";
import { Orchestrator } from "./index.js";

const temporary: string[] = [];
const fixture = path.resolve(import.meta.dirname, "../../../test-fixtures/repositories/node");

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("repository orchestration E2E", () => {
  it("completes a real Node repository with real workspace, analyzer and structured runner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-e2e-"));
    temporary.push(root);
    const generated = path.join(root, "generated");
    const manager = new WorkspaceManager({ templateDirectory: fixture, generatedProjectsDirectory: generated });
    const runner = new LocalRunner(generated);
    const eventStore = new JsonlEventStore(path.join(root, "events"));
    const orchestrator = new Orchestrator({
      po: new MockProductOwnerAgent(),
      developer: new MockDeveloperAgent(),
      qa: new MockQualityAssuranceAgent(),
      eventStore,
      runner,
      workspaceManager: manager,
      projectAnalyzer: { analyzeProject },
      changeInspector: new GitChangeInspector(generated)
    });

    const state = await orchestrator.createRun({
      briefing: "Validar o projeto Node existente.",
      repositorySource: { type: "local", path: fixture }
    });
    const finalState = await orchestrator.execute(state);
    const events = await eventStore.listEvents(state.runId);

    expect(finalState.status).toBe("AWAITING_APPROVAL");
    expect(finalState.profile?.languages).toEqual(["JavaScript"]);
    expect(finalState.profile?.commands.build?.args).toEqual(["run", "build"]);
    expect(finalState.profile?.commands.test?.args).toEqual(["run", "test"]);
    expect(events.some((event) => event.action === "REPOSITORY_ANALYZED")).toBe(true);
    expect(events.some((event) => event.action === "BUILD_COMPLETED")).toBe(true);
    expect(events.some((event) => event.action === "TESTS_COMPLETED")).toBe(true);
    expect(events.some((event) => event.action === "CHANGESET_CREATED")).toBe(true);
    expect(finalState.changeSet?.files.some(
      (file) => file.path === "build-output.txt"
    )).toBe(true);
    const approvedState = await orchestrator.approve(finalState);
    expect(approvedState.status).toBe("COMPLETED");
    await access(path.join(finalState.workspacePath, "build-output.txt"));
    expect(await readFile(path.join(fixture, "package.json"), "utf8")).toContain("fixture-node");
    await expect(readFile(path.join(fixture, "build-output.txt"))).rejects.toThrow();
  }, 60_000);
});
