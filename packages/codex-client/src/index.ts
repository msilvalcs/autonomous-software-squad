import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CodexRequest {
  role: "PO" | "DEV" | "QA";
  prompt: string;
  outputSchema: Record<string, unknown>;
  workingDirectory: string;
  sandbox?: "read-only" | "workspace-write";
  timeoutMs?: number;
  model?: string;
  provider?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
}

export interface CodexResult<T> {
  data: T;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class CodexClient {
  async generate<T>(
    request: CodexRequest
  ): Promise<CodexResult<T>> {
    if (request.prompt.trim() === "") {
      throw new Error("Codex prompt cannot be empty");
    }

    const sandbox = enforcePersonaSandbox(
      request.role,
      request.sandbox
    );

    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "squad-codex-")
    );

    const schemaPath = path.join(
      temporaryDirectory,
      "schema.json"
    );

    const resultPath = path.join(
      temporaryDirectory,
      "result.json"
    );

    await writeFile(
      schemaPath,
      JSON.stringify(request.outputSchema, null, 2),
      "utf8"
    );

    const args = [
      "exec",
      "--sandbox",
      sandbox,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      resultPath
    ];

    if (request.model) {
      args.push("--model", request.model);
    }

    if (request.provider && request.provider !== "codex") {
      args.push(
        "--config",
        `model_provider=${JSON.stringify(request.provider)}`
      );
    }

    if (request.reasoningEffort) {
      args.push(
        "--config",
        `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`
      );
    }

    args.push(request.prompt);

    try {
      const execution = await runCodex({
        args,
        workingDirectory: request.workingDirectory,
        timeoutMs: request.timeoutMs ?? 120_000,
        signal: request.signal
      });

      if (execution.timedOut) {
        throw new Error(
          "Codex execution timed out. Details: " +
          (execution.stderr.slice(0, 2_000) ||
            execution.stdout.slice(0, 2_000) ||
            "No output captured")
        );
      }

      if (execution.exitCode !== 0) {
        throw new Error(
          `Codex failed with exit code ${execution.exitCode}: ` +
          execution.stderr.slice(0, 2_000)
        );
      }

      const resultContents = await readFile(
        resultPath,
        "utf8"
      );

      return {
        data: JSON.parse(resultContents) as T,
        stdout: execution.stdout,
        stderr: execution.stderr,
        durationMs: execution.durationMs
      };
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true
      });
    }
  }
}

const personaSandboxes = {
  PO: "read-only",
  DEV: "workspace-write",
  QA: "read-only"
} as const;

export function enforcePersonaSandbox(
  role: CodexRequest["role"],
  requestedSandbox?: CodexRequest["sandbox"]
): NonNullable<CodexRequest["sandbox"]> {
  const requiredSandbox = personaSandboxes[role];
  const selectedSandbox = requestedSandbox ?? requiredSandbox;

  if (selectedSandbox !== requiredSandbox) {
    throw new Error(
      `${role} cannot use sandbox ${selectedSandbox}; ` +
      `required sandbox is ${requiredSandbox}`
    );
  }

  return selectedSandbox;
}

interface RunCodexInput {
  args: string[];
  workingDirectory: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

async function runCodex(
  input: RunCodexInput
): Promise<ProcessResult> {
  if (input.signal?.aborted) {
    throw new Error("Codex execution was aborted");
  }

  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let sigkillTimer: NodeJS.Timeout | undefined;

    const child = spawn("codex", input.args, {
      cwd: path.resolve(input.workingDirectory),
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill("SIGTERM");
        sigkillTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Process may already have terminated
          }
        }, 1000);
        sigkillTimer.unref?.();
      } catch {
        // Process may already have terminated
      }
      reject(new Error("Codex execution was aborted"));
    };

    if (input.signal) {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timeout);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (input.signal) {
        input.signal.removeEventListener("abort", onAbort);
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      cleanup();

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (exitCode) => {
      cleanup();

      if (!settled) {
        settled = true;

        resolve({
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
