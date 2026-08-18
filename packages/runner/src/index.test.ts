import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutionRunner,
  DockerRunner,
  LocalRunner,
  WorkspaceManager,
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

describe("DockerRunner", () => {
  it("reutiliza um container durante o ciclo de vida da run", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const fakeDocker = path.join(baseDirectory, "managed-docker.mjs");
    const invocationLog = path.join(baseDirectory, "docker-calls.jsonl");

    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env node",
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeDocker, 0o755);

    const runner = new DockerRunner({
      baseDirectory,
      dockerBinary: fakeDocker,
      image: "squad-runner:test"
    });

    const environment = await runner.prepare(workspace);
    const result = await runner.run({
      workspace,
      command: "npm run build",
      timeoutMs: 10_000
    });
    await runner.dispose(workspace);

    const calls = (await readFile(invocationLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const nameIndex = calls[0]?.indexOf("--name") ?? -1;
    const containerName = calls[0]?.[nameIndex + 1];

    expect(environment.environmentId).toBe(containerName);
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls[0]?.slice(0, 2)).toEqual([
      "run",
      "--detach"
    ]);
    expect(calls[1]).toEqual([
      "network",
      "disconnect",
      "bridge",
      containerName
    ]);
    expect(calls[2]?.[0]).toBe("exec");
    expect(calls[2]).toContain(containerName);
    expect(calls[3]).toEqual([
      "rm",
      "--force",
      containerName
    ]);
  });

  it("monta uma execução isolada com limites explícitos", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const fakeDocker = path.join(baseDirectory, "fake-docker.mjs");

    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify(process.argv.slice(2)));"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeDocker, 0o755);

    const runner = new DockerRunner({
      baseDirectory,
      dockerBinary: fakeDocker,
      image: "squad-runner:test"
    });

    const result = await runner.run({
      workspace,
      command: "npm run build",
      timeoutMs: 10_000
    });
    const args = JSON.parse(result.stdout) as string[];

    expect(result.exitCode).toBe(0);
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("ALL");
    expect(args).toContain("--memory");
    expect(args).toContain("--cpus");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("none");
    expect(args).toContain("squad-runner:test");
    expect(args.slice(-3)).toEqual(["npm", "run", "build"]);
  });

  it("libera rede somente para instalação de dependências", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const fakeDocker = path.join(baseDirectory, "fake-docker.mjs");

    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify(process.argv.slice(2)));"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeDocker, 0o755);

    const runner = new DockerRunner({
      baseDirectory,
      dockerBinary: fakeDocker,
      installNetwork: "registry-egress"
    });

    const result = await runner.run({
      workspace,
      command: "npm install",
      timeoutMs: 10_000
    });
    const args = JSON.parse(result.stdout) as string[];
    const networkIndex = args.indexOf("--network");

    expect(args[networkIndex + 1]).toBe("registry-egress");
  });

  it("rejeita workspace fora da pasta permitida", async () => {
    const { baseDirectory } = await createWorkspace();
    const runner = new DockerRunner({ baseDirectory });

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
});

describe("createExecutionRunner", () => {
  it("seleciona LocalRunner por padrão", async () => {
    const { baseDirectory } = await createWorkspace();

    expect(
      createExecutionRunner({ baseDirectory }).backend
    ).toBe("local");
  });

  it("seleciona DockerRunner explicitamente", async () => {
    const { baseDirectory } = await createWorkspace();

    expect(
      createExecutionRunner({
        mode: "docker",
        baseDirectory
      }).backend
    ).toBe("docker");
  });

  it("falha para modo desconhecido sem fallback silencioso", async () => {
    const { baseDirectory } = await createWorkspace();

    expect(() =>
      createExecutionRunner({
        mode: "virtual-machine",
        baseDirectory
      })
    ).toThrow("Unsupported execution mode");
  });
});

describe("WorkspaceManager", () => {
  it("copia o template sem node_modules e dist", async () => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "squad-workspace-")
    );

    temporaryDirectories.push(rootDirectory);

    const templateDirectory = path.join(
      rootDirectory,
      "template"
    );

    const generatedDirectory = path.join(
      rootDirectory,
      "generated"
    );
    const approvedSkillsDirectory = path.join(
      rootDirectory,
      "approved-skills"
    );

    await mkdir(
      path.join(templateDirectory, "src"),
      { recursive: true }
    );

    await mkdir(
      path.join(templateDirectory, "node_modules"),
      { recursive: true }
    );

    await mkdir(
      path.join(templateDirectory, "dist"),
      { recursive: true }
    );
    await mkdir(
      path.join(approvedSkillsDirectory, "tdd"),
      { recursive: true }
    );

    await writeFile(
      path.join(templateDirectory, "src", "app.ts"),
      "export const app = true;",
      "utf8"
    );

    await writeFile(
      path.join(templateDirectory, "node_modules", "ignored.js"),
      "ignored",
      "utf8"
    );

    await writeFile(
      path.join(templateDirectory, "dist", "ignored.js"),
      "ignored",
      "utf8"
    );
    await writeFile(
      path.join(approvedSkillsDirectory, "tdd", "SKILL.md"),
      "---\nname: tdd\ndescription: Test first.\n---",
      "utf8"
    );

    const manager = new WorkspaceManager({
      templateDirectory,
      generatedProjectsDirectory: generatedDirectory,
      approvedSkillsDirectory
    });

    const workspace = await manager.prepareWorkspace(
      "run-001"
    );

    const copiedSource = await readFile(
      path.join(workspace, "src", "app.ts"),
      "utf8"
    );

    expect(copiedSource).toContain("app = true");

    await expect(
      readFile(
        path.join(
          workspace,
          ".agents",
          "skills",
          "tdd",
          "SKILL.md"
        ),
        "utf8"
      )
    ).resolves.toContain("name: tdd");

    await expect(
      access(path.join(workspace, "node_modules"))
    ).rejects.toThrow();

    await expect(
      access(path.join(workspace, "dist"))
    ).rejects.toThrow();
  });

  it("rejeita runId inseguro", async () => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "squad-workspace-")
    );

    temporaryDirectories.push(rootDirectory);

    const manager = new WorkspaceManager({
      templateDirectory: path.join(
        rootDirectory,
        "template"
      ),
      generatedProjectsDirectory: path.join(
        rootDirectory,
        "generated"
      )
    });

    await expect(
      manager.prepareWorkspace("../../outside")
    ).rejects.toThrow("Invalid runId");
  });

  it("rejeita links simbólicos nas skills aprovadas", async () => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "squad-workspace-")
    );

    temporaryDirectories.push(rootDirectory);

    const templateDirectory = path.join(rootDirectory, "template");
    const approvedSkillsDirectory = path.join(rootDirectory, "skills");
    const outsideFile = path.join(rootDirectory, "outside.md");
    await mkdir(templateDirectory);
    await mkdir(approvedSkillsDirectory);
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(
      outsideFile,
      path.join(approvedSkillsDirectory, "unsafe.md")
    );

    const manager = new WorkspaceManager({
      templateDirectory,
      generatedProjectsDirectory: path.join(rootDirectory, "generated"),
      approvedSkillsDirectory
    });

    await expect(
      manager.prepareWorkspace("run-001")
    ).rejects.toThrow("cannot contain symbolic links");
  });
});
