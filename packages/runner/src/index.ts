import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
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

export interface ExecutionEnvironment {
  backend: ExecutionBackend;
  environmentId: string;
  image?: string;
  imageDigest?: string;
}

export interface RunnerExecutionPolicy {
  runtime: "local-process" | "docker-container";
  workspaceAccess: "run-write";
  networkAccess: "host" | "install-only";
  credentialAccess: "none";
  allowedCommands: AllowedCommand[];
  privileged: false;
  dockerSocket: false;
  limits: {
    timeoutMs: number;
    cpu: number | null;
    memory: string | null;
    pids: number | null;
  };
}

export interface ExecutionRunner {
  readonly backend: ExecutionBackend;
  readonly policy: RunnerExecutionPolicy;
  prepare(workspace: string): Promise<ExecutionEnvironment>;
  run(request: ExecutionRequest): Promise<ExecutionResult>;
  dispose(workspace: string): Promise<void>;
}

const commandArguments: Record<AllowedCommand, string[]> = {
  "npm install": ["install"],
  "npm test": ["test"],
  "npm run build": ["run", "build"],
  "npm run typecheck": ["run", "typecheck"]
};

const allowedCommands = Object.keys(
  commandArguments
) as AllowedCommand[];

const llmCredentialVariables = [
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_HOME",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY"
] as const;

export function createRunnerEnvironment(
  source: NodeJS.ProcessEnv,
  homeDirectory: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...source,
    CI: "true",
    HOME: homeDirectory,
    XDG_CONFIG_HOME: homeDirectory
  };

  for (const variable of llmCredentialVariables) {
    delete environment[variable];
  }

  return environment;
}

export class LocalRunner implements ExecutionRunner {
  readonly backend = "local" as const;
  readonly policy: RunnerExecutionPolicy = {
    runtime: "local-process",
    workspaceAccess: "run-write",
    networkAccess: "host",
    credentialAccess: "none",
    allowedCommands: [...allowedCommands],
    privileged: false,
    dockerSocket: false,
    limits: {
      timeoutMs: 180_000,
      cpu: null,
      memory: null,
      pids: null
    }
  };
  private readonly baseDirectory: string;

  constructor(baseDirectory: string) {
    this.baseDirectory = path.resolve(baseDirectory);
  }

  async prepare(workspace: string): Promise<ExecutionEnvironment> {
    const resolvedWorkspace = this.resolveWorkspace(workspace);

    return {
      backend: this.backend,
      environmentId: `local-${path.basename(resolvedWorkspace)}`
    };
  }

  async dispose(workspace: string): Promise<void> {
    this.resolveWorkspace(workspace);
  }

  async run(
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const workspace = this.resolveWorkspace(request.workspace);
    const args = commandArguments[request.command];

    if (!args) {
      throw new Error("Command is not allowed");
    }

    validateTimeout(
      request.timeoutMs,
      this.policy.limits.timeoutMs
    );

    const startedAt = Date.now();
    const runnerHome = path.join(
      tmpdir(),
      "autonomous-squad-runner"
    );
    await mkdir(runnerHome, { recursive: true });

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn("npm", args, {
        cwd: workspace,
        shell: false,
        env: createRunnerEnvironment(process.env, runnerHome)
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
  private readonly environments = new Map<string, string>();
  private readonly imageDigests = new Map<string, string>();
  private readonly networkConnectedWorkspaces = new Set<string>();

  get policy(): RunnerExecutionPolicy {
    return {
      runtime: "docker-container",
      workspaceAccess: "run-write",
      networkAccess: "install-only",
      credentialAccess: "none",
      allowedCommands: [...allowedCommands],
      privileged: false,
      dockerSocket: false,
      limits: {
        timeoutMs: 180_000,
        cpu: this.cpuLimit,
        memory: this.memoryLimit,
        pids: this.pidsLimit
      }
    };
  }

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

  async prepare(workspace: string): Promise<ExecutionEnvironment> {
    const resolvedWorkspace = resolveAllowedWorkspace(
      this.baseDirectory,
      workspace
    );
    const existing = this.environments.get(resolvedWorkspace);

    if (existing) {
      return {
        backend: this.backend,
        environmentId: existing,
        image: this.image,
        imageDigest: this.imageDigests.get(resolvedWorkspace)
      };
    }

    const containerName = createContainerName(resolvedWorkspace);
    const args = [
      "run",
      "--detach",
      ...this.containerSecurityArguments(
        resolvedWorkspace,
        containerName,
        this.installNetwork
      ),
      this.image,
      "node",
      "-e",
      "setInterval(() => {}, 2147483647)"
    ];

    let imageDigest: string | undefined;

    try {
      await runControlCommand(
        this.dockerBinary,
        args,
        resolvedWorkspace
      );
      imageDigest = (
        await runControlCommand(
          this.dockerBinary,
          ["inspect", "--format", "{{.Image}}", containerName],
          resolvedWorkspace
        )
      ).trim() || undefined;
    } catch (error) {
      await removeContainer(
        this.dockerBinary,
        containerName
      );
      throw error;
    }

    this.environments.set(resolvedWorkspace, containerName);
    this.networkConnectedWorkspaces.add(resolvedWorkspace);

    if (imageDigest) {
      this.imageDigests.set(resolvedWorkspace, imageDigest);
    }

    return {
      backend: this.backend,
      environmentId: containerName,
      image: this.image,
      imageDigest
    };
  }

  async dispose(workspace: string): Promise<void> {
    const resolvedWorkspace = resolveAllowedWorkspace(
      this.baseDirectory,
      workspace
    );
    const containerName = this.environments.get(resolvedWorkspace);

    if (!containerName) {
      return;
    }

    await removeContainer(this.dockerBinary, containerName, true);
    this.environments.delete(resolvedWorkspace);
    this.imageDigests.delete(resolvedWorkspace);
    this.networkConnectedWorkspaces.delete(resolvedWorkspace);
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

    validateTimeout(
      request.timeoutMs,
      this.policy.limits.timeoutMs
    );

    const managedContainer = this.environments.get(workspace);

    if (managedContainer) {
      return this.runInManagedContainer(
        request,
        workspace,
        command,
        managedContainer
      );
    }

    const containerName = createContainerName(workspace);
    const network =
      request.command === "npm install"
        ? this.installNetwork
        : "none";

    const args = [
      "run",
      "--rm",
      ...this.containerSecurityArguments(
        workspace,
        containerName,
        network
      ),
      this.image,
      "npm",
      ...command
    ];

    return runDockerProcess({
      dockerBinary: this.dockerBinary,
      args,
      workspace,
      request,
      onTimeout: () =>
        removeContainer(this.dockerBinary, containerName)
    });
  }

  private containerSecurityArguments(
    workspace: string,
    containerName: string,
    network: string
  ): string[] {
    const userId = process.getuid?.() ?? 1000;
    const groupId = process.getgid?.() ?? 1000;

    return [
      "--name",
      containerName,
      "--label",
      `com.autonomous-squad.workspace=${path.basename(workspace)}`,
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
      "NPM_CONFIG_CACHE=/tmp/.npm"
    ];
  }

  private async runInManagedContainer(
    request: ExecutionRequest,
    workspace: string,
    command: string[],
    containerName: string
  ): Promise<ExecutionResult> {
    const needsNetwork = request.command === "npm install";
    const hasNetwork =
      this.networkConnectedWorkspaces.has(workspace);

    if (needsNetwork && !hasNetwork) {
      await runControlCommand(
        this.dockerBinary,
        ["network", "connect", this.installNetwork, containerName],
        workspace
      );
      this.networkConnectedWorkspaces.add(workspace);
    }

    if (!needsNetwork && hasNetwork) {
      await runControlCommand(
        this.dockerBinary,
        [
          "network",
          "disconnect",
          this.installNetwork,
          containerName
        ],
        workspace
      );
      this.networkConnectedWorkspaces.delete(workspace);
    }

    try {
      const userId = process.getuid?.() ?? 1000;
      const groupId = process.getgid?.() ?? 1000;

      return await runDockerProcess({
        dockerBinary: this.dockerBinary,
        args: [
          "exec",
          "--user",
          `${userId}:${groupId}`,
          "--workdir",
          "/workspace",
          "--env",
          "CI=true",
          "--env",
          "HOME=/tmp",
          "--env",
          "NPM_CONFIG_CACHE=/tmp/.npm",
          containerName,
          "npm",
          ...command
        ],
        workspace,
        request,
        onTimeout: async () => {
          this.environments.delete(workspace);
          this.imageDigests.delete(workspace);
          this.networkConnectedWorkspaces.delete(workspace);
          await removeContainer(this.dockerBinary, containerName);
        }
      });
    } finally {
      if (
        needsNetwork &&
        this.environments.has(workspace) &&
        this.networkConnectedWorkspaces.has(workspace)
      ) {
        await runControlCommand(
          this.dockerBinary,
          [
            "network",
            "disconnect",
            this.installNetwork,
            containerName
          ],
          workspace
        );
        this.networkConnectedWorkspaces.delete(workspace);
      }
    }
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

function validateTimeout(
  timeoutMs: number,
  maximumTimeoutMs: number
): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be greater than zero");
  }

  if (timeoutMs > maximumTimeoutMs) {
    throw new Error(
      `timeoutMs cannot exceed ${maximumTimeoutMs}`
    );
  }
}

function createContainerName(workspace: string): string {
  const workspaceName = path.basename(workspace)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 40);

  return `squad-${workspaceName}-${randomUUID().slice(0, 8)}`;
}

interface RunDockerProcessInput {
  dockerBinary: string;
  args: string[];
  workspace: string;
  request: ExecutionRequest;
  onTimeout: () => Promise<void>;
}

async function runDockerProcess(
  input: RunDockerProcessInput
): Promise<ExecutionResult> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutCleanup: Promise<void> | undefined;

    const child = spawn(input.dockerBinary, input.args, {
      cwd: input.workspace,
      shell: false,
      env: {
        ...process.env,
        CI: "true"
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutCleanup = input.onTimeout();
      child.kill("SIGTERM");
    }, input.request.timeoutMs);

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
          command: input.request.command,
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

async function runControlCommand(
  dockerBinary: string,
  args: string[],
  workspace: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(dockerBinary, args, {
      cwd: workspace,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Docker control command failed with exit code ${exitCode}: ${stderr.slice(0, 2_000)}`
          )
        );
      }
    });
  });
}

async function removeContainer(
  dockerBinary: string,
  containerName: string,
  strict = false
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const cleanup = spawn(
      dockerBinary,
      ["rm", "--force", containerName],
      {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"]
      }
    );

    cleanup.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    cleanup.on("error", (error) => {
      if (strict) {
        reject(error);
      } else {
        resolve();
      }
    });
    cleanup.on("close", (exitCode) => {
      if (strict && exitCode !== 0) {
        reject(
          new Error(
            `Docker container cleanup failed with exit code ${exitCode}: ${stderr.slice(0, 2_000)}`
          )
        );
      } else {
        resolve();
      }
    });
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
