import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeProject } from "@squad/project-analyzer";
import {
  LocalRunner,
  WorkspaceManager,
  createRunnerEnvironment
} from "./index.js";

const root = path.resolve(import.meta.dirname, "../../..");
const fixtures = path.join(root, "test-fixtures", "repositories");
const temporary: string[] = [];

function available(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    shell: false,
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

const goAvailable = available("go");
const pythonAvailable = available("python3") && available("pytest");

function requiredCommand(
  commands: Partial<Record<"build" | "test", import("@squad/schemas").ProjectCommand>>,
  purpose: "build" | "test"
) {
  const command = commands[purpose];
  if (!command) throw new Error(`Expected detected ${purpose} command`);
  return command;
}

afterAll(async () => {
  await Promise.all(temporary.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("multi-stack repository integration", () => {
  it("isolates a Node repository and runs its exact detected build and test commands", async () => {
    const generated = await mkdtemp(path.join(tmpdir(), "squad-multistack-"));
    temporary.push(generated);
    const source = path.join(fixtures, "node");
    const manager = new WorkspaceManager({ templateDirectory: source, generatedProjectsDirectory: generated });
    const workspace = await manager.prepareRepositoryWorkspace("node-fixture", { type: "local", path: source });
    const profile = await analyzeProject(workspace);
    expect(profile.languages).toEqual(["JavaScript"]);
    expect(profile.packageManagers).toEqual(["npm"]);
    expect(profile.commands.build).toMatchObject({ executable: "npm", args: ["run", "build"] });
    expect(profile.commands.test).toMatchObject({ executable: "npm", args: ["run", "test"] });
    const runner = new LocalRunner(generated);
    for (const purpose of ["build", "test"] as const) {
      const command = requiredCommand(profile.commands, purpose);
      const approvedCommands = Object.values(profile.commands).filter((value): value is typeof command => Boolean(value));
      const result = await runner.runProjectCommand({ workspace, command, approvedCommands });
      expect(result.exitCode, `${purpose}: ${result.stderr}`).toBe(0);
    }
    await access(path.join(workspace, "build-output.txt"));
    expect((await readFile(path.join(source, "package.json"), "utf8"))).toContain("fixture-node");
    await expect(stat(path.join(source, "build-output.txt"))).rejects.toThrow();
    const environment = createRunnerEnvironment({ OPENAI_API_KEY: "secret", CODEX_HOME: "/secret", PATH: process.env.PATH }, "/tmp/squad-home");
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.CODEX_HOME).toBeUndefined();
  });

  it.skipIf(!goAvailable)("detects and executes Go when the runtime is available", async () => {
    const generated = await mkdtemp(path.join(tmpdir(), "squad-go-"));
    temporary.push(generated);
    const source = path.join(fixtures, "go");
    const manager = new WorkspaceManager({ templateDirectory: source, generatedProjectsDirectory: generated });
    const workspace = await manager.prepareRepositoryWorkspace("go-fixture", { type: "local", path: source });
    const profile = await analyzeProject(workspace);
    expect(profile.languages).toContain("Go");
    const runner = new LocalRunner(generated);
    for (const purpose of ["build", "test"] as const) {
      const command = requiredCommand(profile.commands, purpose);
      const approvedCommands = Object.values(profile.commands).filter((value): value is typeof command => Boolean(value));
      const result = await runner.runProjectCommand({ workspace, command, approvedCommands });
      expect(result.exitCode, `${purpose}: ${result.stderr}`).toBe(0);
    }
  }, 30_000);

  it.skipIf(!pythonAvailable)("detects and executes Python when pytest is available", async () => {
    const generated = await mkdtemp(path.join(tmpdir(), "squad-python-"));
    temporary.push(generated);
    const source = path.join(fixtures, "python");
    const manager = new WorkspaceManager({ templateDirectory: source, generatedProjectsDirectory: generated });
    const workspace = await manager.prepareRepositoryWorkspace("python-fixture", { type: "local", path: source });
    const profile = await analyzeProject(workspace);
    expect(profile.languages).toContain("Python");
    const command = requiredCommand(profile.commands, "test");
    expect(command).toMatchObject({ executable: "pytest", args: [] });
    const approvedCommands = Object.values(profile.commands).filter((value): value is typeof command => Boolean(value));
    const result = await new LocalRunner(generated).runProjectCommand({ workspace, command, approvedCommands });
    expect(result.exitCode, result.stderr).toBe(0);
  }, 30_000);
});
