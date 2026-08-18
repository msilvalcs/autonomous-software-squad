import type { RunState } from "./api/types";

export interface RunAction {
  kind:
    | "running"
    | "resume"
    | "completed"
    | "blocked"
    | "failed";
  label: string;
  disabled: boolean;
}

export function getRunAction(
  run: RunState | null,
  resuming: boolean
): RunAction | null {
  if (!run) {
    return null;
  }

  if (run.active || resuming) {
    return {
      kind: "running",
      label: resuming ? "Retomando..." : "Executando...",
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

  if (run.status === "BLOCKED") {
    return {
      kind: "blocked",
      label: "Limite de tentativas atingido",
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
