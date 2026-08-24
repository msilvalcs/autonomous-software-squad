import {
  RepositorySourceSchema,
  type RepositorySource
} from "@squad/schemas";

export type RepositorySourceResult =
  | { success: true; data: RepositorySource | undefined }
  | { success: false; error: string; details: string[] };

export function parseRepositorySource(
  value: unknown
): RepositorySourceResult {
  if (value === undefined) {
    return { success: true, data: undefined };
  }
  const result = RepositorySourceSchema.safeParse(value);
  if (result.success) {
    return result;
  }
  return {
    success: false,
    error: "Invalid repository source",
    details: result.error.issues.map(
      (issue) =>
        `${issue.path.join(".") || "repositorySource"}: ${issue.message}`
    )
  };
}
