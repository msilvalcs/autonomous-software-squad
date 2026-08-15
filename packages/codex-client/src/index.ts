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
  prompt: string;
  outputSchema: Record<string, unknown>;
  workingDirectory: string;
  sandbox?: "read-only" | "workspace-write";
  timeoutMs?: number;
  model?: string;
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
      request.sandbox ?? "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      resultPath
    ];

    if (request.model) {
      args.push("--model", request.model);
    }

    args.push(request.prompt);

    try {
      const execution = await runCodex({
        args,
        workingDirectory: request.workingDirectory,
        timeoutMs: request.timeoutMs ?? 120_000
      });

      if (execution.timedOut) {
        throw new Error("Codex execution timed out");
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

interface RunCodexInput {
  args: string[];
  workingDirectory: string;
  timeoutMs: number;
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
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn("codex", input.args, {
      cwd: path.resolve(input.workingDirectory),
      shell: false,
      env: process.env
    });

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