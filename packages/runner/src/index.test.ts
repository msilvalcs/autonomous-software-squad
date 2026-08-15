import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  LocalRunner,
  type AllowedCommand
} from "./index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const baseDirectory = await mkdtemp(
    path.join(tmpdir(), "squad-runner-")
  );

  temporaryDirectories.push(baseDirectory);

  const workspace = path.join(baseDirectory, "run-001");
  await mkdir(workspace);

  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({
      name: "generated-test-project",
      version: "1.0.0",
      scripts: {
        build: "node -e \"console.log('build passed')\"",
        test: "node -e \"console.log('tests passed')\"",
        slow: "node -e \"setTimeout(() => {}, 5000)\""
      }
    }),
    "utf8"
  );

  return {
    baseDirectory,
    workspace
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("LocalRunner", () => {
  it("executa um comando permitido", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();

    const runner = new LocalRunner(baseDirectory);

    const result = await runner.run({
      workspace,
      command: "npm run build",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("build passed");
    expect(result.timedOut).toBe(false);
  });

  it("rejeita workspace fora da pasta permitida", async () => {
    const { baseDirectory } = await createWorkspace();
    const runner = new LocalRunner(baseDirectory);

    await expect(
      runner.run({
        workspace: path.join(baseDirectory, "..", "outside"),
        command: "npm test",
        timeoutMs: 10_000
      })
    ).rejects.toThrow(
      "Workspace is outside the allowed directory"
    );
  });

  it("rejeita comando fora da allowlist", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();

    const runner = new LocalRunner(baseDirectory);

    await expect(
      runner.run({
        workspace,
        command: "rm -rf /" as AllowedCommand,
        timeoutMs: 10_000
      })
    ).rejects.toThrow("Command is not allowed");
  });

  it("rejeita timeout inválido", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();

    const runner = new LocalRunner(baseDirectory);

    await expect(
      runner.run({
        workspace,
        command: "npm test",
        timeoutMs: 0
      })
    ).rejects.toThrow(
      "timeoutMs must be greater than zero"
    );
  });
});