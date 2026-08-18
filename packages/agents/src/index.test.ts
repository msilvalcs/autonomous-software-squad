import { describe, expect, it } from "vitest";
import { enforcePersonaSandbox } from "@squad/codex-client";

import {
  CodexDeveloperAgent,
  CodexQualityAssuranceAgent,
  MockDeveloperAgent,
  MockProductOwnerAgent,
  MockQualityAssuranceAgent
} from "./index.js";

const successfulBuild = {
  command: "npm run build",
  exitCode: 0,
  stdout: "Build passed",
  stderr: "",
  durationMs: 100,
  timedOut: false
};

const successfulTests = {
  command: "npm test",
  exitCode: 0,
  stdout: "Tests passed",
  stderr: "",
  durationMs: 100,
  timedOut: false
};

const workspacePath = "/tmp/generated-projects/run-001";

describe("agentes simulados", () => {
  it("o PO transforma o briefing em stories", async () => {
    const po = new MockProductOwnerAgent();

    const backlog = await po.createBacklog(
      "Criar uma aplicação de tarefas."
    );

    expect(backlog.stories).toHaveLength(2);
    expect(backlog.stories[0]?.id).toBe("US-001");
    expect(backlog.decisions).not.toHaveLength(0);
  });

  it("o PO rejeita briefing vazio", async () => {
    const po = new MockProductOwnerAgent();

    await expect(po.createBacklog("   ")).rejects.toThrow(
      "Briefing cannot be empty"
    );
  });

  it("o Developer diferencia implementação e correção", async () => {
    const po = new MockProductOwnerAgent();
    const developer = new MockDeveloperAgent();
    const story = (await po.createBacklog("Aplicação")).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const initialResult = await developer.implement({
      story,
      previousQaResult: null,
      workspacePath
    });

    expect(initialResult.summary).toContain("inicial");
  });

  it("o QA falha na primeira tentativa e aprova a segunda", async () => {
    const po = new MockProductOwnerAgent();
    const developer = new MockDeveloperAgent();
    const qa = new MockQualityAssuranceAgent();
    const story = (await po.createBacklog("Aplicação")).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const implementation = await developer.implement({
      story,
      previousQaResult: null,
      workspacePath
    });

    const firstResult = await qa.validate({
      story,
      implementation,
      build: successfulBuild,
      tests: successfulTests,
      workspacePath
    });

    const secondResult = await qa.validate({
      story,
      implementation,
      build: successfulBuild,
      tests: successfulTests,
      workspacePath
    });

    expect(firstResult.status).toBe("FAIL");
    expect(secondResult.status).toBe("PASS");
  });
  it("o QA reprova quando o build falha", async () => {
    const po = new MockProductOwnerAgent();
    const developer = new MockDeveloperAgent();
    const qa = new MockQualityAssuranceAgent();
    const story = (await po.createBacklog("Aplicação")).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const implementation = await developer.implement({
      story,
      previousQaResult: null,
      workspacePath
    });

    const result = await qa.validate({
      story,
      implementation,
      build: {
        ...successfulBuild,
        exitCode: 1,
        stderr: "TypeScript compilation failed"
      },
      tests: successfulTests,
      workspacePath
    });

    expect(result.status).toBe("FAIL");
    expect(result.summary).toContain("Build");
    expect(result.requestedChanges).toContain(
      "Corrigir os erros de build e testes automatizados."
    );
  });

  it("o Developer Codex usa escrita restrita ao workspace", async () => {
    const requests: unknown[] = [];
    const client = {
      generate: async (request: unknown) => {
        requests.push(request);
        return {
          data: {
            storyId: "valor-incorreto",
            summary: "Formulario implementado.",
            changedFiles: ["src/App.tsx", "src/domain/task.ts"],
            commands: ["npm run build", "npm test"],
            status: "IMPLEMENTED",
            decisions: [{
              decision: "Implementar no formulário existente.",
              rationale: "É o menor caminho coerente com a story.",
              alternativesConsidered: []
            }]
          },
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const story = (await new MockProductOwnerAgent().createBacklog(
      "Aplicacao"
    )).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const developer = new CodexDeveloperAgent(client as never);
    const result = await developer.implement({
      story,
      previousQaResult: null,
      workspacePath
    });

    expect(result.storyId).toBe(story.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      role: "DEV",
      workingDirectory: workspacePath,
      sandbox: "workspace-write"
    });
  });

  it("bloqueia escalada de sandbox entre personas", () => {
    expect(() =>
      enforcePersonaSandbox("QA", "workspace-write")
    ).toThrow("QA cannot use sandbox workspace-write");

    expect(() =>
      enforcePersonaSandbox("PO", "workspace-write")
    ).toThrow("PO cannot use sandbox workspace-write");

    expect(() =>
      enforcePersonaSandbox("DEV", "read-only")
    ).toThrow("DEV cannot use sandbox read-only");
  });

  it("o Developer Codex rejeita caminhos fora do workspace", async () => {
    const client = {
      generate: async () => ({
        data: {
          storyId: "US-001",
          summary: "Implementacao concluida.",
          changedFiles: ["../../outside.ts"],
          commands: ["npm test"],
          status: "IMPLEMENTED",
          decisions: [{
            decision: "Alterar arquivo externo.",
            rationale: "Fixture para validar segurança.",
            alternativesConsidered: []
          }]
        },
        stdout: "",
        stderr: "",
        durationMs: 1
      })
    };
    const story = (await new MockProductOwnerAgent().createBacklog(
      "Aplicacao"
    )).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const developer = new CodexDeveloperAgent(client as never);

    await expect(developer.implement({
      story,
      previousQaResult: null,
      workspacePath
    })).rejects.toThrow("unsafe path");
  });

  it("o QA Codex inspeciona o workspace em modo somente leitura", async () => {
    const requests: unknown[] = [];
    const client = {
      generate: async (request: unknown) => {
        requests.push(request);
        return {
          data: {
            storyId: "valor-incorreto",
            status: "PASS",
            summary: "Todos os criterios foram verificados.",
            criteria: [
              {
                criterion: "O título da tarefa deve ser obrigatório",
                passed: true,
                evidence: "Validacao presente em src/App.tsx."
              },
              {
                criterion: "A tarefa deve iniciar com status TODO",
                passed: true,
                evidence: "Estado inicial confirmado em src/App.tsx."
              }
            ],
            requestedChanges: [],
            decisions: [{
              decision: "Aprovar a story.",
              rationale: "Todos os critérios possuem evidência.",
              alternativesConsidered: []
            }]
          },
          stdout: "",
          stderr: "",
          durationMs: 1
        };
      }
    };
    const story = (await new MockProductOwnerAgent().createBacklog(
      "Aplicacao"
    )).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const qa = new CodexQualityAssuranceAgent(client as never);
    const result = await qa.validate({
      story,
      implementation: {
        storyId: story.id,
        summary: "Implementado.",
        changedFiles: ["src/App.tsx"],
        commands: ["npm run build", "npm test"],
        status: "IMPLEMENTED",
        decisions: []
      },
      build: successfulBuild,
      tests: successfulTests,
      workspacePath
    });

    expect(result.storyId).toBe(story.id);
    expect(result.status).toBe("PASS");
    expect(requests[0]).toMatchObject({
      role: "QA",
      workingDirectory: workspacePath,
      sandbox: "read-only"
    });
  });

  it("o QA Codex falha deterministicamente quando o build falha", async () => {
    let called = false;
    const client = {
      generate: async () => {
        called = true;
        throw new Error("should not be called");
      }
    };
    const story = (await new MockProductOwnerAgent().createBacklog(
      "Aplicacao"
    )).stories[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const qa = new CodexQualityAssuranceAgent(client as never);
    const result = await qa.validate({
      story,
      implementation: {
        storyId: story.id,
        summary: "Implementado.",
        changedFiles: ["src/App.tsx"],
        commands: ["npm run build"],
        status: "IMPLEMENTED",
        decisions: []
      },
      build: {
        ...successfulBuild,
        exitCode: 1,
        stderr: "Build failed"
      },
      tests: successfulTests,
      workspacePath
    });

    expect(result.status).toBe("FAIL");
    expect(called).toBe(false);
  });
});
