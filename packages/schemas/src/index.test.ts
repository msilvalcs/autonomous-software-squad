import { describe, expect, it } from "vitest";
import {
  ExecutionPolicySchema,
  ProjectCommandSchema,
  ProjectProfileSchema,
  RepositorySourceSchema,
  RunStatusSchema,
  UserStorySchema,
  WorkspaceMetadataSchema
} from "./index.js";

describe("UserStorySchema", () => {
  it("aceita uma story válida", () => {
    const result = UserStorySchema.safeParse({
      id: "US-001",
      title: "Criar tarefa",
      description: "Permitir o cadastro de uma tarefa.",
      priority: 1,
      acceptanceCriteria: ["O título deve ser obrigatório"],
      status: "PENDING"
    });

    expect(result.success).toBe(true);
  });

  it("rejeita prioridade inválida", () => {
    const result = UserStorySchema.safeParse({
      id: "US-001",
      title: "Criar tarefa",
      description: "Permitir o cadastro de uma tarefa.",
      priority: 0,
      acceptanceCriteria: ["O título deve ser obrigatório"],
      status: "PENDING"
    });

    expect(result.success).toBe(false);
  });
});

describe("repository orchestration contracts", () => {
  it("aceita fontes locais e Git sem quebrar os contratos existentes", () => {
    expect(RepositorySourceSchema.safeParse({ type: "local", path: "/tmp/repo" }).success).toBe(true);
    expect(RepositorySourceSchema.safeParse({ type: "git", url: "https://github.com/acme/repo.git", ref: "main" }).success).toBe(true);
  });

  it("rejeita URL Git e comandos sem propósito", () => {
    expect(RepositorySourceSchema.safeParse({ type: "git", url: "file:///tmp/repo" }).success).toBe(false);
    expect(RepositorySourceSchema.safeParse({ type: "git", url: "https://user:password@example.com/repo.git" }).success).toBe(false);
    expect(ProjectCommandSchema.safeParse({ executable: "pytest", args: [] }).success).toBe(false);
  });

  it("aceita somente diretórios relativos e seguros no workspace", () => {
    expect(ProjectCommandSchema.safeParse({ executable: "pytest", args: [], purpose: "test", workingDirectory: "packages/api" }).success).toBe(true);
    for (const workingDirectory of ["/tmp/repo", "\\tmp\\repo", "C:\\repo", "packages/../api", "packages//api"]) {
      expect(ProjectCommandSchema.safeParse({ executable: "pytest", args: [], purpose: "test", workingDirectory }).success).toBe(false);
    }
  });

  it("valida perfil e metadados completos do workspace", () => {
    const result = WorkspaceMetadataSchema.safeParse({
      runId: "run-1",
      path: "/workspace/run-1",
      repository: { source: { type: "local", path: "/repos/app" }, name: "app" },
      profile: {
        languages: ["Python"],
        commands: {
          test: { executable: "pytest", args: [], purpose: "test" }
        }
      },
      createdAt: "2026-08-24T12:00:00.000Z"
    });
    expect(result.success).toBe(true);
    expect(ProjectProfileSchema.parse({ languages: ["Go"], commands: {} }).isMonorepo).toBe(false);
  });

  it("exige que a chave do comando corresponda ao purpose", () => {
    expect(ProjectProfileSchema.safeParse({
      languages: ["Python"],
      commands: { test: { executable: "ruff", args: [], purpose: "lint" } }
    }).success).toBe(false);
    expect(ProjectProfileSchema.safeParse({
      languages: ["Python"],
      commands: { test: { executable: "pytest", args: [], purpose: "test" } }
    }).success).toBe(true);
  });
});
describe("ExecutionPolicySchema", () => {
  it("rejeita política privilegiada", () => {
    const result = ExecutionPolicySchema.safeParse({
      actor: "RUNNER",
      runtime: "docker-container",
      workspaceAccess: "run-write",
      networkAccess: "install-only",
      credentialAccess: "none",
      allowedCommands: ["npm test"],
      privileged: true,
      dockerSocket: false,
      limits: {
        timeoutMs: 120_000,
        cpu: 1,
        memory: "1g",
        pids: 256
      }
    });

    expect(result.success).toBe(false);
  });
});

describe("RunStatusSchema", () => {
  it("aceita todos os estados válidos incluindo CANCELLED", () => {
    const validStatuses = [
      "CREATED",
      "PLANNING",
      "DEVELOPING",
      "TESTING",
      "COMPLETED",
      "BLOCKED",
      "FAILED",
      "CANCELLED"
    ];

    for (const status of validStatuses) {
      const result = RunStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it("rejeita status inválido", () => {
    const result = RunStatusSchema.safeParse("UNKNOWN");
    expect(result.success).toBe(false);
  });
});
