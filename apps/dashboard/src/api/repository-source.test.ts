import { describe, expect, it } from "vitest";
import { buildCreateRunRequest, validateRepositoryFields } from "./repository-source";

describe("repository source request", () => {
  it("builds template request", () => expect(buildCreateRunRequest("x", "template", "", "", "")).toEqual({ briefing: "x", repositorySource: undefined, maxAttempts: 3 }));
  it("builds local request", () => expect(buildCreateRunRequest("x", "local", " /repo ", "", "").repositorySource).toEqual({ type: "local", path: "/repo" }));
  it("builds git request with ref", () => expect(buildCreateRunRequest("x", "git", "", " https://github.com/a/b.git ", "main").repositorySource).toEqual({ type: "git", url: "https://github.com/a/b.git", ref: "main" }));
  it("reports required fields", () => { expect(validateRepositoryFields("local", "", "")).toContain("caminho"); expect(validateRepositoryFields("git", "", "")).toContain("URL"); expect(validateRepositoryFields("template", "", "")).toBeNull(); });
});