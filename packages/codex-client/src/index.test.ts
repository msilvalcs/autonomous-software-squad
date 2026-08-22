import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexClient, enforcePersonaSandbox } from "./index.js";

const temporaryDirectories: string[] = [];
let originalPath: string | undefined;

beforeEach(() => {
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("enforcePersonaSandbox", () => {
  it("permite sandbox correto para cada persona", () => {
    expect(enforcePersonaSandbox("PO")).toBe("read-only");
    expect(enforcePersonaSandbox("DEV")).toBe("workspace-write");
    expect(enforcePersonaSandbox("QA")).toBe("read-only");
  });

  it("permite sandbox especificado explicitamente se coincidir com o requerido", () => {
    expect(enforcePersonaSandbox("PO", "read-only")).toBe("read-only");
    expect(enforcePersonaSandbox("DEV", "workspace-write")).toBe("workspace-write");
    expect(enforcePersonaSandbox("QA", "read-only")).toBe("read-only");
  });

  it("rejeita escalada de sandbox incorreta para a persona", () => {
    expect(() => enforcePersonaSandbox("PO", "workspace-write")).toThrow(
      "PO cannot use sandbox workspace-write; required sandbox is read-only"
    );
    expect(() => enforcePersonaSandbox("QA", "workspace-write")).toThrow(
      "QA cannot use sandbox workspace-write; required sandbox is read-only"
    );
    expect(() => enforcePersonaSandbox("DEV", "read-only")).toThrow(
      "DEV cannot use sandbox read-only; required sandbox is workspace-write"
    );
  });
});

describe("CodexClient", () => {
  it("rejeita prompt vazio", async () => {
    const client = new CodexClient();
    await expect(
      client.generate({
        role: "PO",
        prompt: "   ",
        outputSchema: { type: "object" },
        workingDirectory: "/tmp"
      })
    ).rejects.toThrow("Codex prompt cannot be empty");
  });

  it("rejeita imediatamente se o signal já estiver abortado", async () => {
    const client = new CodexClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.generate({
        role: "PO",
        prompt: "Teste de cancelamento imediato",
        outputSchema: { type: "object" },
        workingDirectory: "/tmp",
        signal: controller.signal
      })
    ).rejects.toThrow("Codex execution was aborted");
  });

  it("cancela a execução ativa quando o signal é abortado", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-test-"));
    temporaryDirectories.push(tempDir);

    const binDir = path.join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const fakeCodex = path.join(binDir, "codex");
    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "setInterval(() => {}, 1000);"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeCodex, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const client = new CodexClient();
    const controller = new AbortController();

    const generatePromise = client.generate({
      role: "PO",
      prompt: "Tarefa longa",
      outputSchema: { type: "object" },
      workingDirectory: tempDir,
      signal: controller.signal,
      timeoutMs: 30_000
    });

    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(generatePromise).rejects.toThrow(
      "Codex execution was aborted"
    );
  });

  it("executa com sucesso com saída estruturada", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-test-"));
    temporaryDirectories.push(tempDir);

    const binDir = path.join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const fakeCodex = path.join(binDir, "codex");
    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "import { writeFileSync } from 'node:fs';",
        "const args = process.argv.slice(2);",
        "const outIndex = args.indexOf('--output-last-message');",
        "if (outIndex !== -1 && args[outIndex + 1]) {",
        "  writeFileSync(args[outIndex + 1], JSON.stringify({ success: true, count: 42 }));",
        "}",
        "process.exit(0);"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeCodex, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const client = new CodexClient();
    const result = await client.generate<{ success: boolean; count: number }>({
      role: "DEV",
      prompt: "Implementar feature",
      outputSchema: { type: "object" },
      workingDirectory: tempDir
    });

    expect(result.data).toEqual({ success: true, count: 42 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("trata timeout de execução do Codex", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-test-"));
    temporaryDirectories.push(tempDir);

    const binDir = path.join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const fakeCodex = path.join(binDir, "codex");
    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "setInterval(() => {}, 1000);"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeCodex, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const client = new CodexClient();
    await expect(
      client.generate({
        role: "QA",
        prompt: "Validar aplicação",
        outputSchema: { type: "object" },
        workingDirectory: tempDir,
        timeoutMs: 100
      })
    ).rejects.toThrow("Codex execution timed out");
  });

  it("trata erro quando o processo do Codex falha com exit code diferente de 0", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-test-"));
    temporaryDirectories.push(tempDir);

    const binDir = path.join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const fakeCodex = path.join(binDir, "codex");
    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "process.stderr.write('Something went wrong');",
        "process.exit(1);"
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeCodex, 0o755);

    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const client = new CodexClient();
    await expect(
      client.generate({
        role: "PO",
        prompt: "Criar backlog",
        outputSchema: { type: "object" },
        workingDirectory: tempDir
      })
    ).rejects.toThrow("Codex failed with exit code 1: Something went wrong");
  });
});
