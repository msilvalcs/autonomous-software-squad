import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  rm
} from "node:fs/promises";
import path from "node:path";

export type AllowedCommand =
  | "npm install"
  | "npm test"
  | "npm run build"
  | "npm run typecheck";

export interface ExecutionRequest {
  workspace: string;
  command: AllowedCommand;
  timeoutMs: number;
}

export interface ExecutionResult {
  command: AllowedCommand;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type ExecutionBackend = "local" | "docker";

export interface ExecutionRunner {
  readonly backend: ExecutionBackend;
  run(request: ExecutionRequest): Promise<ExecutionResult>;
}

const commandArguments: Record<AllowedCommand, string[]> = {
  "npm install": ["install"],
  "npm test": ["test"],
  "npm run build": ["run", "build"],
  "npm run typecheck": ["run", "typecheck"]
};

export class LocalRunner implements ExecutionRunner {
  readonly backend = "local" as const;
  private readonly baseDirectory: string;

  constructor(baseDirectory: string) {
    this.baseDirectory = path.resolve(baseDirectory);
  }

  async run(
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const workspace = this.resolveWorkspace(request.workspace);
    const args = commandArguments[request.command];

    if (!args) {
      throw new Error("Command is not allowed");
    }

    if (
      !Number.isFinite(request.timeoutMs) ||
      request.timeoutMs <= 0
    ) {
      throw new Error("timeoutMs must be greater than zero");
    }

    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn("npm", args, {
        cwd: workspace,
        shell: false,
        env: {
          ...process.env,
          CI: "true"
        }
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);

        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);

        if (!settled) {
          settled = true;

          resolve({
            command: request.command,
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            timedOut
          });
        }
      });
    });
  }

  private resolveWorkspace(workspace: string): string {
    const resolvedWorkspace = path.resolve(workspace);
    const relativePath = path.relative(
      this.baseDirectory,
      resolvedWorkspace
    );

    const isOutsideBaseDirectory =
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath);

    if (isOutsideBaseDirectory) {
      throw new Error(
        "Workspace is outside the allowed directory"
      );
    }

    return resolvedWorkspace;
  }
}

export interface DockerRunnerOptions {
  baseDirectory: string;
  image?: string;
  dockerBinary?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
  installNetwork?: string;
}

export class DockerRunner implements ExecutionRunner {
  readonly backend = "docker" as const;
  private readonly baseDirectory: string;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly cpuLimit: number;
  private readonly memoryLimit: string;
  private readonly pidsLimit: number;
  private readonly installNetwork: string;

  constructor(options: DockerRunnerOptions) {
    this.baseDirectory = path.resolve(options.baseDirectory);
    this.image = options.image ?? "autonomous-squad-runner:local";
    this.dockerBinary = options.dockerBinary ?? "docker";
    this.cpuLimit = options.cpuLimit ?? 1;
    this.memoryLimit = options.memoryLimit ?? "1g";
    this.pidsLimit = options.pidsLimit ?? 256;
    this.installNetwork = options.installNetwork ?? "bridge";

    if (!Number.isFinite(this.cpuLimit) || this.cpuLimit <= 0) {
      throw new Error("Docker CPU limit must be greater than zero");
    }

    if (!Number.isInteger(this.pidsLimit) || this.pidsLimit <= 0) {
      throw new Error("Docker PIDs limit must be a positive integer");
    }

    if (this.image.trim() === "" || this.memoryLimit.trim() === "") {
      throw new Error("Docker image and memory limit are required");
    }
  }

  async run(
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const workspace = resolveAllowedWorkspace(
      this.baseDirectory,
      request.workspace
    );
    const command = commandArguments[request.command];

    if (!command) {
      throw new Error("Command is not allowed");
    }

    if (
      !Number.isFinite(request.timeoutMs) ||
      request.timeoutMs <= 0
    ) {
      throw new Error("timeoutMs must be greater than zero");
    }

    const containerName = createContainerName(workspace);
    const userId = process.getuid?.() ?? 1000;
    const groupId = process.getgid?.() ?? 1000;
    const network =
      request.command === "npm install"
        ? this.installNetwork
        : "none";

    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${workspace},target=/workspace`,
      "--user",
      `${userId}:${groupId}`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=268435456",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      String(this.pidsLimit),
      "--memory",
      this.memoryLimit,
      "--cpus",
      String(this.cpuLimit),
      "--network",
      network,
      "--env",
      "CI=true",
      "--env",
      "HOME=/tmp",
      "--env",
      "NPM_CONFIG_CACHE=/tmp/.npm",
      this.image,
      "npm",
      ...command
    ];

    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let timeoutCleanup: Promise<void> | undefined;

      const child = spawn(this.dockerBinary, args, {
        cwd: workspace,
        shell: false,
        env: {
          ...process.env,
          CI: "true"
        }
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        timeoutCleanup = removeContainer(
          this.dockerBinary,
          containerName
        );
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);

        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.on("close", async (exitCode) => {
        clearTimeout(timeout);

        if (!settled) {
          settled = true;
          await timeoutCleanup;

          resolve({
            command: request.command,
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            timedOut
          });
        }
      });
    });
  }
}

export interface CreateExecutionRunnerOptions {
  mode?: string;
  baseDirectory: string;
  docker?: Omit<DockerRunnerOptions, "baseDirectory">;
}

export function createExecutionRunner(
  options: CreateExecutionRunnerOptions
): ExecutionRunner {
  const mode = options.mode ?? "local";

  if (mode === "local") {
    return new LocalRunner(options.baseDirectory);
  }

  if (mode === "docker") {
    return new DockerRunner({
      ...options.docker,
      baseDirectory: options.baseDirectory
    });
  }

  throw new Error(
    `Unsupported execution mode: ${mode}. Expected local or docker.`
  );
}

function resolveAllowedWorkspace(
  baseDirectory: string,
  workspace: string
): string {
  const resolvedWorkspace = path.resolve(workspace);
  const relativePath = path.relative(baseDirectory, resolvedWorkspace);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Workspace is outside the allowed directory");
  }

  return resolvedWorkspace;
}

function createContainerName(workspace: string): string {
  const workspaceName = path.basename(workspace)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 40);

  return `squad-${workspaceName}-${randomUUID().slice(0, 8)}`;
}

async function removeContainer(
  dockerBinary: string,
  containerName: string
): Promise<void> {
  await new Promise<void>((resolve) => {
    const cleanup = spawn(
      dockerBinary,
      ["rm", "--force", containerName],
      {
        shell: false,
        stdio: "ignore"
      }
    );

    cleanup.on("error", () => resolve());
    cleanup.on("close", () => resolve());
  });
}

export class WorkspaceManager {
  private readonly templateDirectory: string;
  private readonly generatedProjectsDirectory: string;
  private readonly approvedSkillsDirectory?: string;

  constructor(input: {
    templateDirectory: string;
    generatedProjectsDirectory: string;
    approvedSkillsDirectory?: string;
  }) {
    this.templateDirectory = path.resolve(
      input.templateDirectory
    );

    this.generatedProjectsDirectory = path.resolve(
      input.generatedProjectsDirectory
    );

    this.approvedSkillsDirectory = input.approvedSkillsDirectory
      ? path.resolve(input.approvedSkillsDirectory)
      : undefined;
  }

  async prepareWorkspace(runId: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error("Invalid runId");
    }

    if (this.approvedSkillsDirectory) {
      await assertNoSymbolicLinks(this.approvedSkillsDirectory);
    }

    const destination = path.join(
      this.generatedProjectsDirectory,
      runId
    );

    await mkdir(this.generatedProjectsDirectory, {
      recursive: true
    });

    await rm(destination, {
      recursive: true,
      force: true
    });

    await cp(this.templateDirectory, destination, {
      recursive: true,
      filter: (source) => {
        const segments = source.split(path.sep);

        return !segments.some((segment) =>
          ["node_modules", "dist", ".git"].includes(segment)
        );
      }
    });

    if (this.approvedSkillsDirectory) {
      await cp(
        this.approvedSkillsDirectory,
        path.join(destination, ".agents", "skills"),
        { recursive: true }
      );
    }

    return destination;
  }
}

async function assertNoSymbolicLinks(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error("Approved skills cannot contain symbolic links");
    }

    if (entry.isDirectory()) {
      await assertNoSymbolicLinks(path.join(directory, entry.name));
    }
  }
}
