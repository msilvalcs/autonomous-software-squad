import { type Archiver, ZipArchive } from "archiver";
import { createReadStream, type ReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface ArtifactFile {
  path: string;
  size: number;
}

export interface ResolvedArtifact {
  workspacePath: string;
  files: ArtifactFile[];
  hasPreview: boolean;
}

const ignoredDirectoryNames = new Set([".git", "node_modules"]);

export async function resolveArtifact(
  generatedProjectsDirectory: string,
  runId: string,
  workspacePath: string
): Promise<ResolvedArtifact> {
  const generatedRoot = await realpath(generatedProjectsDirectory);
  const expectedWorkspace = path.join(generatedRoot, runId);
  const resolvedWorkspace = await realpath(workspacePath);

  if (resolvedWorkspace !== expectedWorkspace) {
    throw new Error("Artifact workspace does not match the requested run");
  }

  const files = await listArtifactFiles(resolvedWorkspace);

  return {
    workspacePath: resolvedWorkspace,
    files,
    hasPreview: files.some((file) => file.path === "dist/index.html")
  };
}

export async function openArtifactFile(
  artifact: ResolvedArtifact,
  relativePath: string
): Promise<{ stream: ReadStream; size: number; mimeType: string }> {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (!artifact.files.some((file) => file.path === normalizedPath)) {
    throw new Error("Artifact file not found");
  }

  const absolutePath = path.join(
    artifact.workspacePath,
    ...normalizedPath.split("/")
  );
  const fileStats = await stat(absolutePath);

  return {
    stream: createReadStream(absolutePath),
    size: fileStats.size,
    mimeType: getMimeType(absolutePath)
  };
}

export async function readPreviewIndex(
  artifact: ResolvedArtifact,
  publicBasePath: string
): Promise<string> {
  if (!artifact.hasPreview) {
    throw new Error("Artifact preview is not available");
  }

  const indexPath = path.join(artifact.workspacePath, "dist", "index.html");
  const indexHtml = await readFile(indexPath, "utf8");

  return indexHtml.replaceAll("/assets/", `${publicBasePath}/assets/`);
}

export function createArtifactArchive(
  artifact: ResolvedArtifact
): Archiver {
  const archive = new ZipArchive({ zlib: { level: 9 } });

  for (const file of artifact.files) {
    archive.file(
      path.join(artifact.workspacePath, ...file.path.split("/")),
      { name: file.path }
    );
  }

  return archive;
}

async function listArtifactFiles(
  workspacePath: string
): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [];

  async function visit(directoryPath: string, relativeDirectory: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const fileStats = await lstat(absolutePath);

      if (fileStats.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed in artifacts");
      }

      if (fileStats.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (fileStats.isFile()) {
        files.push({ path: relativePath, size: fileStats.size });
      }
    }
  }

  await visit(workspacePath, "");

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeRelativePath(relativePath: string): string {
  const decodedPath = decodeURIComponent(relativePath).replaceAll("\\", "/");
  const segments = decodedPath.split("/");

  if (
    decodedPath === "" ||
    decodedPath.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error("Invalid artifact path");
  }

  return segments.join("/");
}

function getMimeType(filePath: string): string {
  const mimeTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };

  return mimeTypes[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
}
