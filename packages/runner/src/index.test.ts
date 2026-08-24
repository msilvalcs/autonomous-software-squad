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
  assessFirecrackerReadiness,
  createExecutionRunner,
  DockerRunner,
  GitChangeInspector,
  LocalRunner,
  MicroVmRunner,
  WorkspaceManager,
  type AllowedCommand
} from "./index.js";
import type { ProjectCommand } from "@squad/schemas";

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
  const nodeCommand = (
    args: string[],
    workingDirectory = ".",
    timeoutMs = 10_000
  ): ProjectCommand => ({
      executable: process.execPath,
      args,
      purpose: "test",
      workingDirectory,
      networkAccess: "none",
      timeoutMs
    });

  it("executa comando estruturado aprovado em subdiretório", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    await mkdir(path.join(workspace, "subdir"));
    const command = nodeCommand(
      ["-e", "process.stdout.write(process.cwd())"],
      "subdir"
    );
    const result = await new LocalRunner(baseDirectory).runProjectCommand({
      workspace,
      command,
      approvedCommands: [command]
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(path.join(workspace, "subdir"));
  });

  it("rejeita plano vazio e args divergentes", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const command = nodeCommand(["-e", "process.exit(0)"]);
    const runner = new LocalRunner(baseDirectory);
    await expect(runner.runProjectCommand({
      workspace,
      command,
      approvedCommands: []
    })).rejects.toThrow("approved command plan");
    await expect(runner.runProjectCommand({
      workspace,
      command,
      approvedCommands: [nodeCommand(["-e", "process.exit(1)"])]
    })).rejects.toThrow("approved command plan");
  });

  it("rejeita escape e symlink no working directory", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "squad-outside-"));
    temporaryDirectories.push(outside);
    const runner = new LocalRunner(baseDirectory);
    const escape = nodeCommand([], "../outside");
    await expect(runner.runProjectCommand({
      workspace,
      command: escape,
      approvedCommands: [escape]
    })).rejects.toThrow();
    await symlink(outside, path.join(workspace, "link"));
    const linked = nodeCommand([], "link");
    await expect(runner.runProjectCommand({
      workspace,
      command: linked,
      approvedCommands: [linked]
    })).rejects.toThrow("symbolic link");
  });

  it("aplica timeout, abort e remove credenciais", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const runner = new LocalRunner(baseDirectory);
    const slow = nodeCommand(["-e", "setTimeout(() => {}, 5000)"], ".", 50);
    const timed = await runner.runProjectCommand({
      workspace,
      command: slow,
      approvedCommands: [slow]
    });
    expect(timed.timedOut).toBe(true);
    const controller = new AbortController();
    const abortCommand = nodeCommand(["-e", "setTimeout(() => {}, 5000)"]);
    const pending = runner.runProjectCommand({
      workspace,
      command: abortCommand,
      approvedCommands: [abortCommand],
      signal: controller.signal
    });
    controller.abort();
    const aborted = await pending;
    expect(aborted.durationMs).toBeLessThan(2_000);
    const envCommand = nodeCommand([
      "-e",
      "process.stdout.write(process.env.OPENAI_API_KEY ?? 'absent')"
    ]);
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "secret";
    try {
      const envResult = await runner.runProjectCommand({
        workspace,
        command: envCommand,
        approvedCommands: [envCommand]
      });
      expect(envResult.stdout).toContain("absent");
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  }, 15_000);

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

  it("rejeita timeout acima da política", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const runner = new LocalRunner(baseDirectory);

    await expect(
      runner.run({
        workspace,
        command: "npm test",
        timeoutMs: 180_001
      })
    ).rejects.toThrow("timeoutMs cannot exceed 180000");
  });

  it("não repassa credenciais de LLM ao processo local", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const originalApiKey = process.env.OPENAI_API_KEY;

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "generated-test-project",
        version: "1.0.0",
        scripts: {
          build: "node -e \"console.log(process.env.OPENAI_API_KEY ?? 'credential-absent')\""
        }
      }),
      "utf8"
    );

    process.env.OPENAI_API_KEY = "test-secret";

    try {
      const result = await new LocalRunner(baseDirectory).run({
        workspace,
        command: "npm run build",
        timeoutMs: 10_000
      });

      expect(result.stdout).toContain("credential-absent");
      expect(result.stdout).not.toContain("test-secret");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });
});

describe("DockerRunner", () => {
  it("seleciona uma imagem compatível com todas as linguagens detectadas", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const fakeDocker = path.join(baseDirectory, "runtime-docker.mjs");
    const invocationLog = path.join(baseDirectory, "runtime-calls.jsonl");
    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env node",
        "import { appendFileSync } from 'node:fs';",
        "const args = process.argv.slice(2);",
        `appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'inspect') console.log('sha256:python-image');"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeDocker, 0o755);
    const runner = new DockerRunner({
      baseDirectory,
      dockerBinary: fakeDocker,
      image: "squad-node:test",
      runtimeImages: [{
        image: "squad-python:test",
        languages: ["JavaScript", "TypeScript", "Python"]
      }]
    });

    const environment = await runner.prepare(workspace, {
      languages: ["Python"],
      frameworks: [],
      packageManagers: ["pip"],
      isMonorepo: false,
      commands: {},
      detectedFiles: ["pyproject.toml"]
    });
    const pythonCommand: ProjectCommand = {
      executable: "python3",
      args: ["--version"],
      purpose: "test",
      workingDirectory: ".",
      networkAccess: "none",
      timeoutMs: 10_000
    };
    const execution = await runner.runProjectCommand({
      workspace,
      command: pythonCommand,
      approvedCommands: [pythonCommand]
    });
    await runner.dispose(workspace);

    const calls = (await readFile(invocationLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(environment.image).toBe("squad-python:test");
    expect(execution.exitCode).toBe(0);
    expect(calls[0]).toContain("squad-python:test");
    expect(calls[0]?.slice(-3)).toEqual(["tail", "-f", "/dev/null"]);
    expect(calls.some((call) =>
      call[0] === "exec" && call.slice(-2).join(" ") === "python3 --version"
    )).toBe(true);
  });

  it("falha fechado quando nenhuma imagem cobre a stack detectada", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const runner = new DockerRunner({
      baseDirectory,
      image: "squad-node:test"
    });

    await expect(runner.prepare(workspace, {
      languages: ["Go"],
      frameworks: [],
      packageManagers: ["Go modules"],
      isMonorepo: false,
      commands: {},
      detectedFiles: ["go.mod"]
    })).rejects.toThrow(
      "No Docker runtime image configured for detected languages: Go"
    );
  });

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
        "const args = process.argv.slice(2);",
        `appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'inspect') console.log('sha256:test-image');"
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
    expect(environment.imageDigest).toBe("sha256:test-image");
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(5);
    expect(calls[0]?.slice(0, 2)).toEqual([
      "run",
      "--detach"
    ]);
    expect(calls[1]).toEqual([
      "inspect",
      "--format",
      "{{.Image}}",
      containerName
    ]);
    expect(calls[2]).toEqual([
      "network",
      "disconnect",
      "bridge",
      containerName
    ]);
    expect(calls[3]?.[0]).toBe("exec");
    expect(calls[3]).toContain(containerName);
    expect(calls[4]).toEqual([
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
    expect(args).toContain("--shm-size");
    expect(args).toContain(
      "/runner-tmp:rw,exec,nosuid,nodev,size=268435456"
    );
    expect(args).toContain("GOTMPDIR=/runner-tmp");
    expect(args).toContain(
      "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"
    );
    expect(args).toContain("none");
    expect(args).toContain("squad-runner:test");
    expect(args.slice(-3)).toEqual(["npm", "run", "build"]);
    expect(runner.policy).toMatchObject({
      runtime: "docker-container",
      networkAccess: "install-only",
      credentialAccess: "none",
      privileged: false,
      dockerSocket: false,
      limits: {
        cpu: 1,
        memory: "1g",
        pids: 256
      }
    });
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

  it("traduz comando estruturado para argumentos Docker sem shell", async () => {
    const { baseDirectory, workspace } = await createWorkspace();
    const fakeDocker = path.join(baseDirectory, "structured-docker.mjs");
    await mkdir(path.join(workspace, "service"));
    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify(process.argv.slice(2)));"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeDocker, 0o755);
    const command: ProjectCommand = {
      executable: "python",
      args: ["-m", "pytest"],
      purpose: "test",
      workingDirectory: "service",
      networkAccess: "none",
      timeoutMs: 10_000
    };
    const result = await new DockerRunner({
      baseDirectory,
      dockerBinary: fakeDocker,
      image: "multi-stack:test"
    }).runProjectCommand({
      workspace,
      command,
      approvedCommands: [command]
    });
    const args = JSON.parse(result.stdout) as string[];
    const imageIndex = args.indexOf("multi-stack:test");
    const workdirIndex = args.lastIndexOf("--workdir");
    const networkIndex = args.indexOf("--network");

    expect(args[workdirIndex + 1]).toBe("/workspace/service");
    expect(workdirIndex).toBeLessThan(imageIndex);
    expect(args.slice(imageIndex + 1)).toEqual([
      "python",
      "-m",
      "pytest"
    ]);
    expect(args[networkIndex + 1]).toBe("none");
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

  it("seleciona o gate de microVM sem degradar o backend", async () => {
    const { baseDirectory } = await createWorkspace();

    expect(
      createExecutionRunner({
        mode: "microvm",
        baseDirectory
      }).backend
    ).toBe("microvm");
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

describe("Firecracker readiness", () => {
  it("exige KVM, binários e assets guest confiáveis", async () => {
    const { baseDirectory } = await createWorkspace();
    const report = await assessFirecrackerReadiness({
      kvmDevice: path.join(baseDirectory, "missing-kvm")
    });

    expect(report.ready).toBe(false);
    expect(
      report.checks
        .filter((check) => !check.passed)
        .map((check) => check.id)
    ).toEqual(expect.arrayContaining([
      "kvm-access",
      "firecracker-binary",
      "jailer-binary",
      "guest-kernel",
      "guest-rootfs"
    ]));
  });

  it("bloqueia a execução sem fallback quando o host não está pronto", async () => {
    const { baseDirectory, workspace } =
      await createWorkspace();
    const runner = new MicroVmRunner({
      baseDirectory,
      kvmDevice: path.join(baseDirectory, "missing-kvm")
    });

    await expect(runner.prepare(workspace)).rejects.toThrow(
      "No fallback was applied"
    );
    expect(runner.policy).toMatchObject({
      runtime: "microvm",
      networkAccess: "none",
      credentialAccess: "none",
      privileged: false,
      dockerSocket: false
    });
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
    ).rejects.toThrow("Directory cannot contain symbolic links");
  });

  it("materializa um repositório local isolado e exclui artefatos", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    await mkdir(path.join(source, "node_modules"), { recursive: true });
    await mkdir(path.join(source, "dist"), { recursive: true });
    await mkdir(path.join(source, ".git"), { recursive: true });
    await writeFile(path.join(source, "README.md"), "original", "utf8");
    const destination = await new WorkspaceManager({ templateDirectory: source, generatedProjectsDirectory: path.join(root, "generated") }).prepareRepositoryWorkspace("run-001", { type: "local", path: source });
    await writeFile(path.join(destination, "README.md"), "changed", "utf8");
    expect(await readFile(path.join(source, "README.md"), "utf8")).toBe("original");
    await expect(access(path.join(destination, "node_modules"))).rejects.toThrow();
    await expect(access(path.join(destination, "dist"))).rejects.toThrow();
    await access(path.join(destination, ".git"));
    await writeFile(path.join(destination, "added.txt"), "new", "utf8");
    const changeSet = await new GitChangeInspector(
      path.join(root, "generated")
    ).inspect(destination);
    expect(changeSet.files).toEqual(expect.arrayContaining([
      { path: "README.md", status: "MODIFIED" },
      { path: "added.txt", status: "UNTRACKED" }
    ]));
    expect(changeSet.patch).toContain("changed");
    expect(changeSet.patch).toContain("added.txt");
  });

  it("rejeita fonte local ausente, arquivo e symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-"));
    temporaryDirectories.push(root);
    const manager = new WorkspaceManager({ templateDirectory: root, generatedProjectsDirectory: path.join(root, "generated") });
    await expect(manager.prepareRepositoryWorkspace("run", { type: "local", path: path.join(root, "missing") })).rejects.toThrow("does not exist");
    const file = path.join(root, "file");
    await writeFile(file, "x", "utf8");
    await expect(manager.prepareRepositoryWorkspace("run", { type: "local", path: file })).rejects.toThrow("directory");
    const link = path.join(root, "link");
    await symlink(root, link);
    await expect(manager.prepareRepositoryWorkspace("run", { type: "local", path: link })).rejects.toThrow("symbolic links");
    await expect(manager.prepareRepositoryWorkspace("../escape", { type: "local", path: root })).rejects.toThrow("Invalid runId");
    await expect(manager.prepareRepositoryWorkspace("run", { type: "git", url: "file:///unsafe" })).rejects.toThrow("Invalid repository source");
  });

  it("limpa destino e não vaza entrada quando clone falha", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-"));
    temporaryDirectories.push(root);
    const fakeGit = path.join(root, "git");
    await writeFile(fakeGit, "#!/bin/sh\nexit 1\n", "utf8");
    await chmod(fakeGit, 0o755);
    const destination = path.join(root, "generated", "run");
    const error = await new WorkspaceManager({ templateDirectory: root, generatedProjectsDirectory: path.join(root, "generated"), gitBinary: fakeGit, cloneTimeoutMs: 100 }).prepareRepositoryWorkspace("run", { type: "git", url: "https://example.invalid/repo.git" }).catch((value: unknown) => value);
    const errorMessage = error instanceof Error ? error.message : String(error);
    expect(errorMessage).toMatch(/Git clone (failed|process)/);
    expect(errorMessage).not.toContain("secret");
    await expect(access(destination)).rejects.toThrow();
  });

  it("limpa destino quando clone excede timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-"));
    temporaryDirectories.push(root);
    const fakeGit = path.join(root, "git");
    await writeFile(fakeGit, "#!/bin/sh\nsleep 2\n", "utf8");
    await chmod(fakeGit, 0o755);
    const manager = new WorkspaceManager({
      templateDirectory: root,
      generatedProjectsDirectory: path.join(root, "generated"),
      gitBinary: fakeGit,
      cloneTimeoutMs: 50
    });
    await expect(
      manager.prepareRepositoryWorkspace("run", {
        type: "git",
        url: "https://example.invalid/repo.git"
      })
    ).rejects.toThrow("timed out");
    await expect(access(path.join(root, "generated", "run"))).rejects.toThrow();
  });

  it("rejeita symlink produzido pelo clone e limpa destino", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "squad-repository-"));
    temporaryDirectories.push(root);
    const fakeGit = path.join(root, "git");
    const destination = path.join(root, "generated", "run");
    await writeFile(
      fakeGit,
      `#!/bin/sh\nmkdir -p "$4"\nln -s /tmp "$4/unsafe"\n`,
      "utf8"
    );
    await chmod(fakeGit, 0o755);
    const manager = new WorkspaceManager({
      templateDirectory: root,
      generatedProjectsDirectory: path.join(root, "generated"),
      gitBinary: fakeGit
    });
    await expect(
      manager.prepareRepositoryWorkspace("run", {
        type: "git",
        url: "https://example.invalid/repo.git"
      })
    ).rejects.toThrow("Directory cannot contain symbolic links");
    await expect(access(destination)).rejects.toThrow();
  });
});
