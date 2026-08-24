import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { analyzeProject } from "./index.js";

const temporaryDirectories: string[] = [];

async function createProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "project-analyzer-"));
  temporaryDirectories.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("analyzeProject", () => {
  it("detecta Node, TypeScript, framework, scripts e package manager", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: { test: "vitest", build: "tsc", lint: "eslint ." },
        dependencies: { react: "latest" }
      }),
      "tsconfig.json": "{}"
    });
    const profile = await analyzeProject(root);

    expect(profile.languages).toEqual(["TypeScript"]);
    expect(profile.frameworks).toEqual(["react"]);
    expect(profile.packageManagers).toEqual(["pnpm"]);
    expect(profile.commands.install?.networkAccess).toBe("install-only");
    expect(profile.commands.test?.args).toEqual(["test"]);
  });

  it("usa npm com package manager desconhecido e argumentos npm seguros", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        packageManager: "custom@1",
        scripts: { test: "ignored free text" }
      })
    });
    const profile = await analyzeProject(root);

    expect(profile.packageManagers).toEqual(["npm"]);
    expect(profile.commands.test).toMatchObject({
      executable: "npm",
      args: ["run", "test"]
    });
  });

  it("detecta Python somente com comandos evidenciados", async () => {
    const profile = await analyzeProject(await createProject({
      "pyproject.toml": "[tool.poetry]\n[tool.pytest.ini_options]\n[tool.ruff]"
    }));

    expect(profile.languages).toEqual(["Python"]);
    expect(profile.packageManagers).toEqual(["poetry"]);
    expect(profile.commands.test?.executable).toBe("pytest");
    expect(profile.commands.lint?.executable).toBe("ruff");
  });

  it("não inventa pytest apenas por existir requirements.txt", async () => {
    const profile = await analyzeProject(await createProject({
      "requirements.txt": "fastapi==1.0.0"
    }));

    expect(profile.languages).toEqual(["Python"]);
    expect(profile.commands.test).toBeUndefined();
    expect(profile.commands.install?.args).toContain("requirements.txt");
  });

  it.each([
    ["Go", { "go.mod": "module example.com/app" }, "go"],
    ["Java", { "pom.xml": "<project />" }, "mvn"],
    ["C#", { "app.csproj": "<Project />" }, "dotnet"],
    ["Rust", { "Cargo.toml": "[package]" }, "cargo"]
  ])("detecta stack %s", async (language, files, executable) => {
    const profile = await analyzeProject(await createProject(files));

    expect(profile.languages).toContain(language);
    expect(profile.commands.build?.executable).toBe(executable);
    expect(profile.commands.test?.purpose).toBe("test");
  });

  it("prefere Gradle wrapper somente quando presente", async () => {
    const withoutWrapper = await analyzeProject(await createProject({
      "build.gradle": "plugins {}"
    }));
    const withWrapper = await analyzeProject(await createProject({
      "build.gradle.kts": "plugins {}",
      "gradlew": "wrapper"
    }));

    expect(withoutWrapper.commands.build?.executable).toBe("gradle");
    expect(withWrapper.commands.build?.executable).toBe("./gradlew");
    expect(withWrapper.languages).toContain("Kotlin");
  });

  it("marca monorepo sem usar manifestos filhos para comandos", async () => {
    const profile = await analyzeProject(await createProject({
      "package.json": JSON.stringify({ scripts: { test: "root-test" } }),
      "packages/api/package.json": JSON.stringify({
        scripts: { build: "child-build" }
      })
    }));

    expect(profile.isMonorepo).toBe(true);
    expect(profile.commands.test?.args).toEqual(["run", "test"]);
    expect(profile.commands.build).toBeUndefined();
    expect(profile.detectedFiles).toContain("packages/api/package.json");
  });

  it("retorna perfil vazio para projeto desconhecido ou manifest inválido", async () => {
    const unknown = await analyzeProject(await createProject({ "README.md": "unknown" }));
    const invalid = await analyzeProject(await createProject({ "package.json": "{" }));

    expect(unknown.languages).toEqual([]);
    expect(unknown.commands).toEqual({});
    expect(invalid.languages).toEqual([]);
    expect(invalid.detectedFiles).toEqual(["package.json"]);
  });

  it("ignora diretórios e links simbólicos", async () => {
    const root = await createProject({
      "node_modules/package.json": JSON.stringify({ scripts: { test: "x" } })
    });
    const outside = await createProject({
      "package.json": JSON.stringify({ scripts: { test: "outside" } })
    });
    await symlink(outside, path.join(root, "linked-project"));

    const profile = await analyzeProject(root);

    expect(profile.languages).toEqual([]);
    expect(profile.detectedFiles).toEqual([]);
  });

  it("rejeita raiz ausente, arquivo e link simbólico", async () => {
    const root = await createProject({ "file.txt": "content" });
    const linkedRoot = `${root}-link`;
    await symlink(root, linkedRoot);
    temporaryDirectories.push(linkedRoot);

    await expect(analyzeProject(path.join(root, "missing"))).rejects.toThrow("existing directory");
    await expect(analyzeProject(path.join(root, "file.txt"))).rejects.toThrow("existing directory");
    await expect(analyzeProject(linkedRoot)).rejects.toThrow("existing directory");
  });
});
