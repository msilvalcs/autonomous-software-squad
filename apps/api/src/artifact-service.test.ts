import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openArtifactFile,
  readPreviewIndex,
  resolveArtifact
} from "./artifact-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("artifact service", () => {
  it("lists source and build files while excluding dependencies", async () => {
    const fixture = await createFixture("run-safe");
    await writeFile(path.join(fixture.workspace, "src", "App.tsx"), "export {};");
    await writeFile(path.join(fixture.workspace, "dist", "index.html"), "<html></html>");
    await mkdir(path.join(fixture.workspace, "node_modules", "package"), { recursive: true });
    await writeFile(path.join(fixture.workspace, "node_modules", "package", "index.js"), "");

    const artifact = await resolveArtifact(
      fixture.generatedRoot,
      "run-safe",
      fixture.workspace
    );

    expect(artifact.hasPreview).toBe(true);
    expect(artifact.files.map((file) => file.path)).toEqual([
      "dist/index.html",
      "src/App.tsx"
    ]);
  });

  it("rejects a workspace that does not belong to the run", async () => {
    const fixture = await createFixture("run-one");

    await expect(
      resolveArtifact(fixture.generatedRoot, "run-two", fixture.workspace)
    ).rejects.toThrow("does not match");
  });

  it("rejects symbolic links", async () => {
    const fixture = await createFixture("run-links");
    const externalFile = path.join(fixture.root, "secret.txt");
    await writeFile(externalFile, "secret");
    await symlink(externalFile, path.join(fixture.workspace, "secret.txt"));

    await expect(
      resolveArtifact(fixture.generatedRoot, "run-links", fixture.workspace)
    ).rejects.toThrow("Symbolic links");
  });

  it("rewrites build asset URLs for the embedded preview", async () => {
    const fixture = await createFixture("run-preview");
    await writeFile(
      path.join(fixture.workspace, "dist", "index.html"),
      '<script src="/assets/app.js"></script>'
    );
    const artifact = await resolveArtifact(
      fixture.generatedRoot,
      "run-preview",
      fixture.workspace
    );

    await expect(
      readPreviewIndex(artifact, "/api/runs/run-preview/artifact/files")
    ).resolves.toContain(
      'src="/api/runs/run-preview/artifact/files/assets/app.js"'
    );
  });

  it("does not open paths outside the artifact manifest", async () => {
    const fixture = await createFixture("run-files");
    await writeFile(path.join(fixture.workspace, "src", "App.tsx"), "export {};");
    const artifact = await resolveArtifact(
      fixture.generatedRoot,
      "run-files",
      fixture.workspace
    );

    await expect(
      openArtifactFile(artifact, "../secret.txt")
    ).rejects.toThrow("Invalid artifact path");
  });
});

async function createFixture(runId: string): Promise<{
  root: string;
  generatedRoot: string;
  workspace: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "squad-artifact-"));
  temporaryDirectories.push(root);
  const generatedRoot = path.join(root, "generated-projects");
  const workspace = path.join(generatedRoot, runId);

  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "dist"), { recursive: true });

  return { root, generatedRoot, workspace };
}
