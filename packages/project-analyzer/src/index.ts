import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  ProjectProfileSchema,
  type ProjectCommand,
  type ProjectProfile
} from "@squad/schemas";

const MAX_DEPTH = 8;
const MAX_FILES = 2_000;
const MAX_FILE_SIZE = 512 * 1_024;
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const evidenceNames = new Set([
  "Cargo.toml", "build.gradle", "build.gradle.kts", "go.mod", "gradlew",
  "package-lock.json", "package.json", "pnpm-lock.yaml",
  "pnpm-workspace.yaml", "pom.xml", "pyproject.toml",
  "requirements.txt", "tsconfig.json", "uv.lock", "yarn.lock"
]);

interface FileEvidence {
  name: string;
  relativePath: string;
  rootFile: boolean;
  text?: string;
}

interface MutableProfile {
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  isMonorepo: boolean;
  commands: Partial<Record<ProjectCommand["purpose"], ProjectCommand>>;
  detectedFiles: string[];
}

function command(
  purpose: ProjectCommand["purpose"],
  executable: string,
  args: string[] = []
): ProjectCommand {
  return {
    executable,
    args,
    purpose,
    workingDirectory: ".",
    networkAccess: purpose === "install" ? "install-only" : "none",
    timeoutMs: 120_000
  };
}

function setCommand(profile: MutableProfile, value: ProjectCommand): void {
  profile.commands[value.purpose] ??= value;
}

function isEvidenceFile(name: string): boolean {
  return evidenceNames.has(name) || name.endsWith(".csproj") || name.endsWith(".sln");
}

async function collectEvidence(root: string): Promise<FileEvidence[]> {
  const evidence: FileEvidence[] = [];
  let visitedFiles = 0;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visitedFiles >= MAX_FILES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (visitedFiles >= MAX_FILES) return;
      if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const stats = await lstat(fullPath);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!stats.isFile()) continue;
      visitedFiles += 1;
      if (!isEvidenceFile(entry.name)) continue;

      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      const file: FileEvidence = {
        name: entry.name,
        relativePath,
        rootFile: !relativePath.includes("/")
      };
      if (stats.size <= MAX_FILE_SIZE) {
        file.text = await readFile(fullPath, "utf8");
      }
      evidence.push(file);
    }
  }

  await visit(root, 0);
  return evidence;
}

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function detectNode(files: Map<string, FileEvidence>, profile: MutableProfile): void {
  const packageJson = parseObject(files.get("package.json")?.text);
  if (!packageJson) return;

  profile.languages.push(files.has("tsconfig.json") ? "TypeScript" : "JavaScript");
  const declared = typeof packageJson.packageManager === "string"
    ? packageJson.packageManager.split("@")[0]
    : undefined;
  const manager = declared === "npm" || declared === "pnpm" || declared === "yarn"
    ? declared
    : files.has("pnpm-lock.yaml") ? "pnpm" : files.has("yarn.lock") ? "yarn" : "npm";
  profile.packageManagers.push(manager);
  setCommand(profile, command("install", manager, ["install"]));

  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  for (const purpose of ["lint", "typecheck", "test", "build", "start"] as const) {
    if (typeof scripts[purpose] === "string") {
      setCommand(
        profile,
        command(purpose, manager, manager === "npm" ? ["run", purpose] : [purpose])
      );
    }
  }

  const dependencies = {
    ...(isRecord(packageJson.dependencies) ? packageJson.dependencies : {}),
    ...(isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {})
  };
  const frameworks = ["@angular/core", "@nestjs/core", "express", "next", "react", "vue"];
  profile.frameworks.push(...frameworks.filter((item) => item in dependencies));
  profile.isMonorepo ||= packageJson.workspaces !== undefined;
}

function detectOtherStacks(files: Map<string, FileEvidence>, profile: MutableProfile): void {
  const pythonFiles = [files.get("pyproject.toml"), files.get("requirements.txt")]
    .filter((file): file is FileEvidence => Boolean(file));
  if (pythonFiles.length > 0) {
    const contents = pythonFiles.map((file) => file.text ?? "").join("\n");
    profile.languages.push("Python");
    const manager = /\[tool\.poetry\]/.test(contents)
      ? "poetry" : files.has("uv.lock") ? "uv" : "pip";
    profile.packageManagers.push(manager);
    if (/\bpytest\b/i.test(contents)) setCommand(profile, command("test", "pytest"));
    if (/\bruff\b/i.test(contents)) {
      setCommand(profile, command("lint", "ruff", ["check", "."]));
    }
    if (files.has("requirements.txt")) {
      setCommand(profile, command("install", "python", [
        "-m", "pip", "install", "-r", "requirements.txt"
      ]));
    }
  }

  if (files.has("go.mod")) {
    profile.languages.push("Go");
    profile.packageManagers.push("go");
    setCommand(profile, command("test", "go", ["test", "./..."]));
    setCommand(profile, command("build", "go", ["build", "./..."]));
  }
  if (files.has("pom.xml")) {
    profile.languages.push("Java");
    profile.packageManagers.push("maven");
    setCommand(profile, command("test", "mvn", ["test"]));
    setCommand(profile, command("build", "mvn", ["package"]));
  }
  if (files.has("build.gradle") || files.has("build.gradle.kts")) {
    profile.languages.push(files.has("build.gradle.kts") ? "Kotlin" : "Java");
    profile.packageManagers.push("gradle");
    const executable = files.has("gradlew") ? "./gradlew" : "gradle";
    setCommand(profile, command("test", executable, ["test"]));
    setCommand(profile, command("build", executable, ["build"]));
  }
  if ([...files.keys()].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) {
    profile.languages.push("C#");
    profile.packageManagers.push("dotnet");
    setCommand(profile, command("test", "dotnet", ["test"]));
    setCommand(profile, command("build", "dotnet", ["build"]));
  }
  if (files.has("Cargo.toml")) {
    profile.languages.push("Rust");
    profile.packageManagers.push("cargo");
    setCommand(profile, command("test", "cargo", ["test"]));
    setCommand(profile, command("build", "cargo", ["build"]));
  }
}

export async function analyzeProject(rootPath: string): Promise<ProjectProfile> {
  const rootStats = await lstat(rootPath).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Project root must be an existing directory");
  }
  const root = await realpath(rootPath);
  const evidence = await collectEvidence(root);
  const rootFiles = new Map(
    evidence.filter((file) => file.rootFile).map((file) => [file.name, file])
  );
  const profile: MutableProfile = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    isMonorepo: evidence.some((file) => !file.rootFile) || rootFiles.has("pnpm-workspace.yaml"),
    commands: {},
    detectedFiles: evidence.map((file) => file.relativePath).sort()
  };

  detectNode(rootFiles, profile);
  detectOtherStacks(rootFiles, profile);
  return ProjectProfileSchema.parse({
    ...profile,
    languages: [...new Set(profile.languages)],
    frameworks: [...new Set(profile.frameworks)],
    packageManagers: [...new Set(profile.packageManagers)]
  });
}

export class ProjectAnalyzer {
  analyzeProject(rootPath: string): Promise<ProjectProfile> {
    return analyzeProject(rootPath);
  }
}
