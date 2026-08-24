import type { RunState } from "./api/types";

export interface RunAction {
  kind:
    | "running"
    | "resume"
    | "approve"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled";
  label: string;
  disabled: boolean;
}

export function getRunAction(
  run: RunState | null,
  resuming: boolean,
  approving = false
): RunAction | null {
  if (!run) {
    return null;
  }

  if (run.active || resuming || approving) {
    return {
      kind: "running",
      label: approving
        ? "Aprovando..."
        : resuming
          ? "Retomando..."
          : "Executando...",
      disabled: true
    };
  }

  if (run.status === "COMPLETED") {
    return {
      kind: "completed",
      label: "Ver resultado",
      disabled: false
    };
  }

  if (run.status === "AWAITING_APPROVAL") {
    return {
      kind: "approve",
      label: "Aprovar mudanças",
      disabled: false
    };
  }

  if (run.status === "BLOCKED") {
    return {
      kind: "blocked",
      label: "Limite de tentativas atingido",
      disabled: true
    };
  }

  if (run.status === "CANCELLED") {
    if (run.canResume) {
      return {
        kind: "resume",
        label: "Retomar execução",
        disabled: false
      };
    }

    return {
      kind: "cancelled",
      label: "Execução cancelada",
      disabled: true
    };
  }

  if (run.canResume) {
    return {
      kind: "resume",
      label: "Retomar execução",
      disabled: false
    };
  }

  if (run.status === "FAILED") {
    return {
      kind: "failed",
      label: "Falha não retomável",
      disabled: true
    };
  }

  return null;
}
