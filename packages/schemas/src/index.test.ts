import { describe, expect, it } from "vitest";
import {
  ExecutionPolicySchema,
  UserStorySchema
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
