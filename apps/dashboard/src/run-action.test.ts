import { describe, expect, it } from "vitest";

import type { RunState } from "./api/types";
import { getRunAction } from "./run-action";

function runState(
  overrides: Partial<RunState>
): RunState {
  return {
    runId: "run-001",
    briefing: "Briefing",
    status: "CREATED",
    currentStoryId: null,
    attempt: 0,
    maxAttempts: 3,
    complexity: "LOW",
    modelAssignments: [],
    executionPolicies: [],
    stories: [],
    workspacePath: "/tmp/run-001",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    active: false,
    canResume: true,
    ...overrides
  };
}

describe("getRunAction", () => {
  it("mostra carregamento durante uma execução ativa", () => {
    expect(getRunAction(runState({ active: true }), false)).toMatchObject({
      kind: "running",
      label: "Executando...",
      disabled: true
    });
  });

  it("oferece retomada para uma falha retomável", () => {
    expect(getRunAction(runState({
      status: "FAILED",
      canResume: true
    }), false)).toMatchObject({
      kind: "resume",
      label: "Retomar execução",
      disabled: false
    });
  });

  it("troca a ação por resultado após a conclusão", () => {
    expect(getRunAction(runState({
      status: "COMPLETED",
      canResume: false
    }), false)).toMatchObject({
      kind: "completed",
      label: "Ver resultado",
      disabled: false
    });
  });

  it("desabilita a ação quando o limite de tentativas foi atingido", () => {
    expect(getRunAction(runState({
      status: "BLOCKED",
      canResume: false
    }), false)).toMatchObject({
      kind: "blocked",
      disabled: true
    });
  });

  it("não oferece retomada para uma falha não retomável", () => {
    expect(getRunAction(runState({
      status: "FAILED",
      canResume: false
    }), false)).toMatchObject({
      kind: "failed",
      disabled: true
    });
  });

  it("não inventa uma ação quando a API nega retomabilidade", () => {
    expect(getRunAction(runState({
      status: "CREATED",
      canResume: false
    }), false)).toBeNull();
  });
});
