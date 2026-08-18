import { spawn } from "node:child_process";
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

const commandArguments: Record<AllowedCommand, string[]> = {
  "npm install": ["install"],
  "npm test": ["test"],
  "npm run build": ["run", "build"],
  "npm run typecheck": ["run", "typecheck"]
};

export class LocalRunner {
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
