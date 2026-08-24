import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProjectCommandSchema,
  RepositorySourceSchema,
  type ProjectCommand,
  type ProjectProfile,
  type RepositorySource
} from "@squad/schemas";

export type AllowedCommand =
  | "npm install"
  | "npm test"
  | "npm run test:e2e"
  | "npm run build"
  | "npm run typecheck";

export interface ExecutionRequest {
  workspace: string;
  command: AllowedCommand;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProjectExecutionRequest {
  workspace: string;
  command: ProjectCommand;
  approvedCommands: ProjectCommand[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StructuredExecutionRunner {
  runProjectCommand(request: ProjectExecutionRequest): Promise<ExecutionResult>;
}

export interface ExecutionResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type ExecutionBackend = "local" | "docker" | "microvm";

export interface ExecutionEnvironment {
  backend: ExecutionBackend;
  environmentId: string;
  image?: string;
  imageDigest?: string;
}

export interface RunnerExecutionPolicy {
  runtime: "local-process" | "docker-container" | "microvm";
  workspaceAccess: "run-write";
  networkAccess: "host" | "install-only" | "none";
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
  prepare(
    workspace: string,
    profile?: ProjectProfile
  ): Promise<ExecutionEnvironment>;
  run(request: ExecutionRequest): Promise<ExecutionResult>;
  dispose(workspace: string): Promise<void>;
}

const commandArguments: Record<AllowedCommand, string[]> = {
  "npm install": ["install"],
  "npm test": ["test"],
  "npm run test:e2e": ["run", "test:e2e"],
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
  homeDirectory: string,
  playwrightBrowsersPath?: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...source,
    CI: "true",
    HOME: homeDirectory,
    XDG_CONFIG_HOME: homeDirectory
  };

  if (playwrightBrowsersPath) {
    environment.PLAYWRIGHT_BROWSERS_PATH =
      playwrightBrowsersPath;
  }

  for (const variable of llmCredentialVariables) {
    delete environment[variable];
  }

  return environment;
}

export class LocalRunner implements ExecutionRunner, StructuredExecutionRunner {
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
  private readonly playwrightBrowsersPath: string;

  constructor(baseDirectory: string) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.playwrightBrowsersPath = path.resolve(
      this.baseDirectory,
      "..",
      ".cache",
      "ms-playwright"
    );
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
        env: createRunnerEnvironment(
          process.env,
          runnerHome,
          this.playwrightBrowsersPath
        )
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

  async runProjectCommand(
    request: ProjectExecutionRequest
  ): Promise<ExecutionResult> {
    const workspace = await this.resolveStructuredWorkspace(request.workspace);
    const command = validateApprovedProjectCommand(request, this.policy);
    const workingDirectory = await resolveSafeWorkingDirectory(workspace, command.workingDirectory);
    const timeoutMs = Math.min(request.timeoutMs ?? command.timeoutMs, this.policy.limits.timeoutMs, command.timeoutMs);
    validateTimeout(timeoutMs, this.policy.limits.timeoutMs);
    return runProcess({
      executable: command.executable,
      args: command.args,
      cwd: workingDirectory,
      env: createRunnerEnvironment(process.env, path.join(tmpdir(), "autonomous-squad-runner"), this.playwrightBrowsersPath),
      timeoutMs,
      command: command.executable + (command.args.length ? ` ${command.args.join(" ")}` : ""),
      signal: request.signal
    });
  }

  private async resolveStructuredWorkspace(workspace: string): Promise<string> {
    const resolved = this.resolveWorkspace(workspace);
    return ensureRealWorkspace(this.baseDirectory, resolved);
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
  runtimeImages?: Array<{
    image: string;
    languages: string[];
  }>;
}

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase();
}

export class DockerRunner implements ExecutionRunner, StructuredExecutionRunner {
  readonly backend = "docker" as const;
  private readonly baseDirectory: string;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly cpuLimit: number;
  private readonly memoryLimit: string;
  private readonly pidsLimit: number;
  private readonly installNetwork: string;
  private readonly runtimeImages: Array<{
    image: string;
    languages: Set<string>;
  }>;
  private readonly environments = new Map<string, string>();
  private readonly imageDigests = new Map<string, string>();
  private readonly workspaceImages = new Map<string, string>();
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
    this.runtimeImages = (options.runtimeImages ?? []).map((candidate) => ({
      image: candidate.image,
      languages: new Set(candidate.languages.map(normalizeLanguage))
    }));

    if (!Number.isFinite(this.cpuLimit) || this.cpuLimit <= 0) {
      throw new Error("Docker CPU limit must be greater than zero");
    }

    if (!Number.isInteger(this.pidsLimit) || this.pidsLimit <= 0) {
      throw new Error("Docker PIDs limit must be a positive integer");
    }

    if (this.image.trim() === "" || this.memoryLimit.trim() === "") {
      throw new Error("Docker image and memory limit are required");
    }

    if (this.runtimeImages.some(
      (candidate) => candidate.image.trim() === "" || candidate.languages.size === 0
    )) {
      throw new Error("Docker runtime images require an image and at least one language");
    }
  }

  async prepare(
    workspace: string,
    profile?: ProjectProfile
  ): Promise<ExecutionEnvironment> {
    const resolvedWorkspace = resolveAllowedWorkspace(
      this.baseDirectory,
      workspace
    );
    const existing = this.environments.get(resolvedWorkspace);

    if (existing) {
      return {
        backend: this.backend,
        environmentId: existing,
        image: this.workspaceImages.get(resolvedWorkspace) ?? this.image,
        imageDigest: this.imageDigests.get(resolvedWorkspace)
      };
    }

    const selectedImage = this.selectImage(profile);
    const containerName = createContainerName(resolvedWorkspace);
    const args = [
      "run",
      "--detach",
      ...this.containerSecurityArguments(
        resolvedWorkspace,
        containerName,
        this.installNetwork
      ),
      selectedImage,
      "tail",
      "-f",
      "/dev/null"
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
    this.workspaceImages.set(resolvedWorkspace, selectedImage);
    this.networkConnectedWorkspaces.add(resolvedWorkspace);

    if (imageDigest) {
      this.imageDigests.set(resolvedWorkspace, imageDigest);
    }

    return {
      backend: this.backend,
      environmentId: containerName,
      image: selectedImage,
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
    this.workspaceImages.delete(resolvedWorkspace);
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
      this.workspaceImages.get(workspace) ?? this.image,
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

  async runProjectCommand(
    request: ProjectExecutionRequest
  ): Promise<ExecutionResult> {
    const workspace = await ensureRealWorkspace(
      this.baseDirectory,
      resolveAllowedWorkspace(this.baseDirectory, request.workspace)
    );
    const command = validateApprovedProjectCommand(request, this.policy);
    const workingDirectory = await resolveSafeWorkingDirectory(
      workspace,
      command.workingDirectory
    );
    const timeoutMs = Math.min(
      request.timeoutMs ?? command.timeoutMs,
      this.policy.limits.timeoutMs,
      command.timeoutMs
    );
    validateTimeout(timeoutMs, this.policy.limits.timeoutMs);
    const containerName = createContainerName(workspace);
    const relativeCwd = path.relative(workspace, workingDirectory) || ".";
    const network = command.networkAccess === "install-only" ? this.installNetwork : "none";
    const managedContainer = this.environments.get(workspace);
    if (managedContainer) {
      return this.runStructuredInManagedContainer(
        workspace,
        command,
        relativeCwd,
        timeoutMs,
        managedContainer
      );
    }
    const args = [
      "run",
      "--rm",
      ...this.containerSecurityArguments(workspace, containerName, network),
      "--workdir",
      "/workspace/" + relativeCwd,
      this.workspaceImages.get(workspace) ?? this.image,
      command.executable,
      ...command.args
    ];
    return runDockerProcess({
      dockerBinary: this.dockerBinary,
      args,
      workspace,
      request: { workspace, command: "npm test", timeoutMs },
      onTimeout: () => removeContainer(this.dockerBinary, containerName)
    });
  }

  private selectImage(profile?: ProjectProfile): string {
    if (!profile || profile.languages.length === 0) {
      return this.image;
    }

    const required = new Set(profile.languages.map(normalizeLanguage));
    const defaultLanguages = new Set(["javascript", "typescript"]);
    if ([...required].every((language) => defaultLanguages.has(language))) {
      return this.image;
    }

    const candidate = this.runtimeImages.find((runtime) =>
      [...required].every((language) => runtime.languages.has(language))
    );
    if (candidate) {
      return candidate.image;
    }

    throw new Error(
      `No Docker runtime image configured for detected languages: ${profile.languages.join(", ")}`
    );
  }

  private async runStructuredInManagedContainer(
    workspace: string,
    command: ProjectCommand,
    relativeCwd: string,
    timeoutMs: number,
    containerName: string
  ): Promise<ExecutionResult> {
    const needsNetwork = command.networkAccess === "install-only";
    const hasNetwork = this.networkConnectedWorkspaces.has(workspace);
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
        ["network", "disconnect", this.installNetwork, containerName],
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
          `/workspace/${relativeCwd}`,
          "--env",
          "CI=true",
          "--env",
          "HOME=/tmp",
          containerName,
          command.executable,
          ...command.args
        ],
        workspace,
        request: {
          command: [command.executable, ...command.args].join(" "),
          timeoutMs
        },
        onTimeout: async () => {
          this.environments.delete(workspace);
          this.imageDigests.delete(workspace);
          this.workspaceImages.delete(workspace);
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
          ["network", "disconnect", this.installNetwork, containerName],
          workspace
        );
        this.networkConnectedWorkspaces.delete(workspace);
      }
    }
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
      "--shm-size",
      "268435456",
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
      "--env",
      "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
      "--env",
      "RUN_E2E=true"
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
          "--env",
          "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
          "--env",
          "RUN_E2E=true",
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

export interface FirecrackerReadinessOptions {
  kvmDevice?: string;
  firecrackerBinary?: string;
  jailerBinary?: string;
  kernelImage?: string;
  rootfsImage?: string;
}

export interface FirecrackerReadinessCheck {
  id:
    | "linux-host"
    | "kvm-access"
    | "firecracker-binary"
    | "jailer-binary"
    | "guest-kernel"
    | "guest-rootfs";
  passed: boolean;
  detail: string;
}

export interface FirecrackerReadinessReport {
  ready: boolean;
  checks: FirecrackerReadinessCheck[];
}

export async function assessFirecrackerReadiness(
  options: FirecrackerReadinessOptions = {}
): Promise<FirecrackerReadinessReport> {
  const kvmDevice = options.kvmDevice ?? "/dev/kvm";
  const checks: FirecrackerReadinessCheck[] = [{
    id: "linux-host",
    passed: process.platform === "linux",
    detail:
      process.platform === "linux"
        ? "Host Linux detectado."
        : `Firecracker requer Linux; plataforma atual: ${process.platform}.`
  }];

  checks.push(await pathAccessCheck(
    "kvm-access",
    kvmDevice,
    constants.R_OK | constants.W_OK,
    "Dispositivo KVM com leitura e escrita disponível."
  ));
  checks.push(await requiredAbsolutePathCheck(
    "firecracker-binary",
    options.firecrackerBinary,
    constants.R_OK | constants.X_OK,
    "Binário Firecracker executável e em caminho absoluto."
  ));
  checks.push(await requiredAbsolutePathCheck(
    "jailer-binary",
    options.jailerBinary,
    constants.R_OK | constants.X_OK,
    "Binário Jailer executável e em caminho absoluto."
  ));
  checks.push(await requiredAbsolutePathCheck(
    "guest-kernel",
    options.kernelImage,
    constants.R_OK,
    "Kernel guest legível e em caminho absoluto."
  ));
  checks.push(await requiredAbsolutePathCheck(
    "guest-rootfs",
    options.rootfsImage,
    constants.R_OK,
    "Rootfs guest legível e em caminho absoluto."
  ));

  return {
    ready: checks.every((check) => check.passed),
    checks
  };
}

export interface MicroVmRunnerOptions
  extends FirecrackerReadinessOptions {
  baseDirectory: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
}

/**
 * Gate experimental para Firecracker. Ele valida os pré-requisitos e sempre
 * bloqueia antes da execução até que o adaptador de ciclo de vida seja
 * implementado e homologado. Não existe delegação implícita para Docker/local.
 */
export class MicroVmRunner implements ExecutionRunner {
  readonly backend = "microvm" as const;
  private readonly baseDirectory: string;
  private readonly readinessOptions: FirecrackerReadinessOptions;
  readonly policy: RunnerExecutionPolicy;

  constructor(options: MicroVmRunnerOptions) {
    this.baseDirectory = path.resolve(options.baseDirectory);
    this.readinessOptions = options;
    this.policy = {
      runtime: "microvm",
      workspaceAccess: "run-write",
      networkAccess: "none",
      credentialAccess: "none",
      allowedCommands: [...allowedCommands],
      privileged: false,
      dockerSocket: false,
      limits: {
        timeoutMs: 180_000,
        cpu: options.cpuLimit ?? 1,
        memory: options.memoryLimit ?? "1g",
        pids: options.pidsLimit ?? 256
      }
    };
  }

  async prepare(workspace: string): Promise<ExecutionEnvironment> {
    resolveAllowedWorkspace(this.baseDirectory, workspace);
    const report = await assessFirecrackerReadiness(
      this.readinessOptions
    );

    if (!report.ready) {
      const failures = report.checks
        .filter((check) => !check.passed)
        .map((check) => check.id)
        .join(", ");

      throw new Error(
        `MicroVM readiness check failed: ${failures}. No fallback was applied.`
      );
    }

    throw new Error(
      "MicroVM host is ready, but the Firecracker lifecycle adapter is not homologated. No fallback was applied."
    );
  }

  async run(request: ExecutionRequest): Promise<ExecutionResult> {
    resolveAllowedWorkspace(this.baseDirectory, request.workspace);
    throw new Error(
      "MicroVM execution is unavailable until the Firecracker lifecycle adapter is homologated."
    );
  }

  async dispose(workspace: string): Promise<void> {
    resolveAllowedWorkspace(this.baseDirectory, workspace);
  }
}

export interface CreateExecutionRunnerOptions {
  mode?: string;
  baseDirectory: string;
  docker?: Omit<DockerRunnerOptions, "baseDirectory">;
  microvm?: Omit<MicroVmRunnerOptions, "baseDirectory">;
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

  if (mode === "microvm") {
    return new MicroVmRunner({
      ...options.microvm,
      baseDirectory: options.baseDirectory
    });
  }

  throw new Error(
    `Unsupported execution mode: ${mode}. Expected local, docker or microvm.`
  );
}

async function pathAccessCheck(
  id: FirecrackerReadinessCheck["id"],
  target: string,
  mode: number,
  successDetail: string
): Promise<FirecrackerReadinessCheck> {
  try {
    await access(target, mode);
    return { id, passed: true, detail: successDetail };
  } catch {
    return {
      id,
      passed: false,
      detail: `Caminho indisponível ou sem permissões necessárias: ${target}.`
    };
  }
}

async function requiredAbsolutePathCheck(
  id: FirecrackerReadinessCheck["id"],
  target: string | undefined,
  mode: number,
  successDetail: string
): Promise<FirecrackerReadinessCheck> {
  if (!target || !path.isAbsolute(target)) {
    return {
      id,
      passed: false,
      detail: "Um caminho absoluto confiável deve ser configurado."
    };
  }

  return pathAccessCheck(id, target, mode, successDetail);
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

function validateApprovedProjectCommand(
  request: ProjectExecutionRequest,
  policy: RunnerExecutionPolicy
): ProjectCommand {
  const command = ProjectCommandSchema.parse(request.command);
  const approved = request.approvedCommands.map((value) =>
    ProjectCommandSchema.parse(value)
  );
  if (!approved.some((candidate) =>
    JSON.stringify(command) === JSON.stringify(candidate)
  )) {
    throw new Error("Project command does not match the approved command plan");
  }
  if (
    command.networkAccess === "install-only" &&
    policy.networkAccess === "none"
  ) {
    throw new Error("Project command network access exceeds runner policy");
  }
  return command;
}

async function ensureRealWorkspace(
  baseDirectory: string,
  workspace: string
): Promise<string> {
  const [baseReal, workspaceReal] = await Promise.all([
    realpath(baseDirectory),
    realpath(workspace)
  ]);
  const relative = path.relative(baseReal, workspaceReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace resolves outside the allowed directory");
  }
  return workspaceReal;
}

async function resolveSafeWorkingDirectory(
  workspace: string,
  workingDirectory: string
): Promise<string> {
  if (workingDirectory !== "." && workingDirectory.includes("\\")) {
    throw new Error("Command working directory must use a POSIX relative path");
  }
  const candidate = path.resolve(workspace, workingDirectory);
  const relative = path.relative(workspace, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Command working directory is outside the workspace");
  }
  const entries = [workspace, ...relative.split(path.sep).filter(Boolean)];
  let current = entries[0] as string;
  for (const entry of entries.slice(1)) {
    current = path.join(current, entry);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error("Command working directory cannot traverse a symbolic link");
    }
  }
  const real = await realpath(candidate);
  const realRelative = path.relative(workspace, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Command working directory resolves outside the workspace");
  }
  return real;
}

async function runProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  command: string;
  signal?: AbortSignal;
}): Promise<ExecutionResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      shell: false,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const abort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) {
      abort();
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        resolve({
          command: input.command,
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
  request: {
    workspace?: string;
    command: string;
    timeoutMs: number;
    signal?: AbortSignal;
  };
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
      child.kill("SIGKILL");
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
  private readonly gitBinary: string;
  private readonly cloneTimeoutMs: number;

  constructor(input: {
    templateDirectory: string;
    generatedProjectsDirectory: string;
    approvedSkillsDirectory?: string;
    gitBinary?: string;
    cloneTimeoutMs?: number;
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
    this.gitBinary = input.gitBinary ?? "git";
    const cloneTimeoutMs = input.cloneTimeoutMs ?? 120_000;
    if (!Number.isInteger(cloneTimeoutMs) || cloneTimeoutMs <= 0) {
      throw new Error("cloneTimeoutMs must be a positive integer");
    }
    this.cloneTimeoutMs = cloneTimeoutMs;
  }

  async prepareWorkspace(runId: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error("Invalid runId");
    }

    return this.prepareRepositoryWorkspace(runId, {
      type: "local",
      path: this.templateDirectory
    });
  }

  async prepareRepositoryWorkspace(
    runId: string,
    source: RepositorySource
  ): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error("Invalid runId");
    }
    const parsed = RepositorySourceSchema.safeParse(source);
    if (!parsed.success) {
      throw new Error("Invalid repository source");
    }
    const destination = path.join(this.generatedProjectsDirectory, runId);
    const relative = path.relative(this.generatedProjectsDirectory, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Workspace is outside the generated projects directory");
    }

    await mkdir(this.generatedProjectsDirectory, {
      recursive: true
    });

    await rm(destination, {
      recursive: true,
      force: true
    });

    try {
      if (this.approvedSkillsDirectory) {
        await assertNoSymbolicLinks(this.approvedSkillsDirectory);
      }
      if (parsed.data.type === "local") {
        const sourcePath = path.resolve(parsed.data.path);
        const stat = await lstat(sourcePath).catch(() => {
          throw new Error("Repository source does not exist");
        });
        if (stat.isSymbolicLink()) {
          throw new Error("Repository source cannot contain symbolic links");
        }
        if (!stat.isDirectory()) {
          throw new Error("Repository source must be a directory");
        }
        await assertNoSymbolicLinks(sourcePath);
        await cp(sourcePath, destination, {
          recursive: true,
          filter: shouldCopyPath
        });
      } else {
        await cloneRepository(
          this.gitBinary,
          this.cloneTimeoutMs,
          parsed.data.url,
          destination,
          parsed.data.ref
        );
        await assertNoSymbolicLinks(destination);
      }
      if (this.approvedSkillsDirectory) {
        await cp(
          this.approvedSkillsDirectory,
          path.join(destination, ".agents", "skills"),
          { recursive: true }
        );
      }
      if (parsed.data.type === "local") {
        await initializeGitBaseline(
          this.gitBinary,
          destination,
          this.cloneTimeoutMs
        );
      }
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }

    return destination;
  }
}

export interface WorkspaceChange {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED" | "RENAMED" | "UNTRACKED";
}

export interface WorkspaceChangeSet {
  files: WorkspaceChange[];
  patch: string;
  truncated: boolean;
}

export class GitChangeInspector {
  private readonly baseDirectory: string;

  constructor(
    baseDirectory: string,
    private readonly gitBinary = "git",
    private readonly maxPatchBytes = 200_000
  ) {
    this.baseDirectory = path.resolve(baseDirectory);
  }

  async inspect(workspace: string): Promise<WorkspaceChangeSet> {
    const resolvedWorkspace = await ensureRealWorkspace(
      this.baseDirectory,
      resolveAllowedWorkspace(this.baseDirectory, workspace)
    );
    const statusOutput = await runGitWorkspaceCommand(
      this.gitBinary,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      resolvedWorkspace
    );
    const records = statusOutput.stdout.split("\0").filter(Boolean);
    const files: WorkspaceChange[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] ?? "";
      const porcelainStatus = record.slice(0, 2);
      const filePath = record.slice(3).replaceAll("\\", "/");
      files.push({ path: filePath, status: normalizeGitStatus(porcelainStatus) });
      if (porcelainStatus.includes("R") || porcelainStatus.includes("C")) {
        index += 1;
      }
    }

    let patch = (await runGitWorkspaceCommand(
      this.gitBinary,
      ["diff", "--no-ext-diff", "--binary", "--"],
      resolvedWorkspace
    )).stdout;
    for (const file of files.filter((entry) => entry.status === "UNTRACKED")) {
      const untracked = await runGitWorkspaceCommand(
        this.gitBinary,
        ["diff", "--no-index", "--binary", "--", "/dev/null", file.path],
        resolvedWorkspace,
        [0, 1]
      );
      patch += untracked.stdout;
    }

    const patchBytes = Buffer.from(patch);
    const truncated = patchBytes.length > this.maxPatchBytes;
    return {
      files,
      patch: truncated
        ? patchBytes.subarray(0, this.maxPatchBytes).toString("utf8")
        : patch,
      truncated
    };
  }
}

function normalizeGitStatus(
  status: string
): WorkspaceChange["status"] {
  if (status === "??") return "UNTRACKED";
  if (status.includes("R") || status.includes("C")) return "RENAMED";
  if (status.includes("D")) return "DELETED";
  if (status[1] === "M") return "MODIFIED";
  if (status[0] === "A") return status[1] === "M" ? "MODIFIED" : "ADDED";
  return "MODIFIED";
}

function shouldCopyPath(source: string): boolean {
  return !source
    .split(path.sep)
    .some((segment) => ["node_modules", "dist", ".git"].includes(segment));
}

async function cloneRepository(
  gitBinary: string,
  timeoutMs: number,
  url: string,
  destination: string,
  ref?: string
): Promise<void> {
  const args = ref
    ? ["clone", "--branch", ref, "--", url, destination]
    : ["clone", "--", url, destination];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(gitBinary, args, {
      shell: false,
      stdio: ["ignore", "ignore", "ignore"]
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Git clone timed out"));
    }, timeoutMs);
    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Git clone process failed"));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Git clone failed with exit code ${code ?? "unknown"}`
            )
          );
        }
      }
    });
  });
}

async function initializeGitBaseline(
  gitBinary: string,
  workspace: string,
  timeoutMs: number
): Promise<void> {
  await runGitWorkspaceCommand(
    gitBinary,
    ["init", "--quiet"],
    workspace,
    [0],
    timeoutMs
  );
  await runGitWorkspaceCommand(
    gitBinary,
    ["add", "--all", "--"],
    workspace,
    [0],
    timeoutMs
  );
}

async function runGitWorkspaceCommand(
  gitBinary: string,
  args: string[],
  cwd: string,
  acceptedExitCodes = [0],
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(gitBinary, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Git workspace command timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Git workspace command failed"));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== null && acceptedExitCodes.includes(code)) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Git workspace command failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

async function assertNoSymbolicLinks(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error("Directory cannot contain symbolic links");
    }

    if (entry.isDirectory()) {
      await assertNoSymbolicLinks(path.join(directory, entry.name));
    }
  }
}
