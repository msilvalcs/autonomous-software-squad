import { describe, expect, it } from "vitest";
import { UserStorySchema } from "./index.js";

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
