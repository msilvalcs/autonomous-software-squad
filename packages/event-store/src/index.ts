import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  AuditEventSchema,
  RunStateSchema,
  type AuditEvent,
  type RunState
} from "@squad/schemas";

export class JsonlEventStore {
  constructor(private readonly baseDirectory: string) {}

  async appendEvent(event: AuditEvent): Promise<void> {
    const validatedEvent = AuditEventSchema.parse(event);
    const runDirectory = this.getRunDirectory(validatedEvent.runId);

    await mkdir(runDirectory, { recursive: true });

    await appendFile(
      path.join(runDirectory, "events.jsonl"),
      `${JSON.stringify(validatedEvent)}\n`,
      "utf8"
    );
  }

  async listEvents(runId: string): Promise<AuditEvent[]> {
    const filePath = path.join(
      this.getRunDirectory(runId),
      "events.jsonl"
    );

    try {
      const contents = await readFile(filePath, "utf8");

      if (contents.trim() === "") {
        return [];
      }

      return contents
        .trim()
        .split("\n")
        .map((line) => AuditEventSchema.parse(JSON.parse(line)));
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }

  async saveState(state: RunState): Promise<void> {
    const validatedState = RunStateSchema.parse(state);
    const runDirectory = this.getRunDirectory(validatedState.runId);

    await mkdir(runDirectory, { recursive: true });

    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify(validatedState, null, 2),
      "utf8"
    );
  }

  async loadState(runId: string): Promise<RunState | null> {
    const filePath = path.join(
      this.getRunDirectory(runId),
      "state.json"
    );

    try {
      const contents = await readFile(filePath, "utf8");
      return RunStateSchema.parse(JSON.parse(contents));
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async listStates(): Promise<RunState[]> {
    let entries;

    try {
      entries = await readdir(this.baseDirectory, {
        withFileTypes: true
      });
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    const states = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && /^run-[a-zA-Z0-9_-]+$/.test(entry.name)
        )
        .map((entry) => this.loadState(entry.name))
    );

    return states
      .filter((state): state is RunState => state !== null)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
  }

  private getRunDirectory(runId: string): string {
    const safeRunId = validateRunId(runId);
    return path.join(this.baseDirectory, safeRunId);
  }
}

function validateRunId(runId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("Invalid runId");
  }

  return runId;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
