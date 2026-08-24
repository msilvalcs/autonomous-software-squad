import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeProject } from "@squad/project-analyzer";
import type { ProjectCommand } from "@squad/schemas";
import { DockerRunner, WorkspaceManager } from "./index.js";

const runDockerIntegration = process.env.RUN_DOCKER_MULTISTACK === "1"
  ? describe
  : describe.skip;
const root = path.resolve(import.meta.dirname, "../../..");
const fixtures = path.join(root, "test-fixtures", "repositories");
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporary.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function approvedCommands(
  profile: Awaited<ReturnType<typeof analyzeProject>>
): ProjectCommand[] {
  return Object.values(profile.commands).filter(
    (command): command is ProjectCommand => Boolean(command)
  );
}

runDockerIntegration("Docker multi-stack", () => {
  for (const scenario of [
    {
      name: "Python",
      fixture: "python",
      imageEnvironment: "DOCKER_RUNNER_PYTHON_IMAGE",
      purpose: "test" as const
    },
    {
      name: "Go",
      fixture: "go",
      imageEnvironment: "DOCKER_RUNNER_GO_IMAGE",
      purpose: "test" as const
    }
  ]) {
    it(`executa ${scenario.name} na imagem diferencial`, async () => {
      const image = process.env[scenario.imageEnvironment];
      if (!image) {
        throw new Error(`${scenario.imageEnvironment} is required`);
      }
      const generated = await mkdtemp(path.join(tmpdir(), "squad-docker-stack-"));
      temporary.push(generated);
      const source = path.join(fixtures, scenario.fixture);
      const workspace = await new WorkspaceManager({
        templateDirectory: source,
        generatedProjectsDirectory: generated
      }).prepareRepositoryWorkspace(`docker-${scenario.fixture}`, {
        type: "local",
        path: source
      });
      const profile = await analyzeProject(workspace);
      const runner = new DockerRunner({
        baseDirectory: generated,
        runtimeImages: [{
          image,
          languages: ["JavaScript", "TypeScript", scenario.name]
        }]
      });

      const environment = await runner.prepare(workspace, profile);
      try {
        const command = profile.commands[scenario.purpose];
        if (!command) {
          throw new Error(`Expected ${scenario.purpose} command for ${scenario.name}`);
        }
        const result = await runner.runProjectCommand({
          workspace,
          command,
          approvedCommands: approvedCommands(profile)
        });
        expect(environment.image).toBe(image);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.timedOut).toBe(false);
      } finally {
        await runner.dispose(workspace);
      }
    }, 60_000);
  }
});
