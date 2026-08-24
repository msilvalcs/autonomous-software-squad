import type { RepositorySource } from "./types";

export type RepositoryMode = "template" | "local" | "git";

export interface CreateRunRequest {
  briefing: string;
  repositorySource?: RepositorySource;
  maxAttempts: number;
}

export function validateRepositoryFields(
  mode: RepositoryMode,
  localPath: string,
  gitUrl: string
): string | null {
  if (mode === "local" && localPath.trim() === "") {
    return "Informe o caminho local do repositório.";
  }
  if (mode === "git" && gitUrl.trim() === "") {
    return "Informe a URL Git do repositório.";
  }
  return null;
}

export function buildCreateRunRequest(
  briefing: string,
  mode: RepositoryMode,
  localPath: string,
  gitUrl: string,
  gitRef: string
): CreateRunRequest {
  const repositorySource = mode === "local"
    ? { type: "local" as const, path: localPath.trim() }
    : mode === "git"
      ? {
          type: "git" as const,
          url: gitUrl.trim(),
          ...(gitRef.trim() ? { ref: gitRef.trim() } : {})
        }
      : undefined;
  return { briefing, repositorySource, maxAttempts: 3 };
}
