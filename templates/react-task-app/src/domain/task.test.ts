import { describe, expect, it } from "vitest";
import { createTask } from "./task";

describe("createTask", () => {
  it("cria uma tarefa com status TODO", () => {
    const task = createTask("Estudar agentes");

    expect(task.title).toBe("Estudar agentes");
    expect(task.status).toBe("TODO");
  });

  it("rejeita um título vazio", () => {
    expect(() => createTask("   ")).toThrow(
      "Task title is required"
    );
  });
});