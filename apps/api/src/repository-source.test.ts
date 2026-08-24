import { describe, expect, it } from "vitest";
import { parseRepositorySource } from "./repository-source.js";

describe("parseRepositorySource", () => {
  it("accepts undefined", () => {
    expect(parseRepositorySource(undefined)).toEqual({
      success: true,
      data: undefined
    });
  });

  it("accepts local", () => {
    expect(parseRepositorySource({
      type: "local",
      path: "/repo"
    }).success).toBe(true);
  });

  it("accepts git", () => {
    expect(parseRepositorySource({
      type: "git",
      url: "https://github.com/a/b.git",
      ref: "main"
    }).success).toBe(true);
  });

  it("rejects credentials in git URL", () => {
    expect(parseRepositorySource({
      type: "git",
      url: "https://user:secret@github.com/a/b.git"
    }).success).toBe(false);
  });
});
