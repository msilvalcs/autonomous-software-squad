import { randomUUID } from "node:crypto";

import type {
  DeveloperAgent,
  ProductOwnerAgent,
  QualityAssuranceAgent
} from "@squad/agents";
import type { JsonlEventStore } from "@squad/event-store";
import type {
  AuditEvent,
  QaResult,
  RunState
} from "@squad/schemas";

import type {
  LocalRunner,
  WorkspaceManager
} from "@squad/runner";

export interface OrchestratorDependencies {
  po: ProductOwnerAgent;
  developer: DeveloperAgent;
  qa: QualityAssuranceAgent;
  eventStore: JsonlEventStore;
  runner: Pick<LocalRunner, "run">;
  workspaceManager: Pick<
    WorkspaceManager,
    "prepareWorkspace"
  >;
}

export interface CreateRunInput {
  briefing: string;
  maxAttempts?: number;
}

export class Orchestrator {
  constructor(
    private readonly dependencies: OrchestratorDependencies
  ) { }

  async createRun(input: CreateRunInput): Promise<RunState> {
    if (input.briefing.trim() === "") {
      throw new Error("Briefing cannot be empty");
    }

    const runId = `run-${randomUUID()}`;

    const workspacePath =
      await this.dependencies.workspaceManager.prepareWorkspace(
        runId
      );

    const now = new Date().toISOString();

    const state: RunState = {
      runId,
      briefing: input.briefing,
      status: "CREATED",
      currentStoryId: null,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      stories: [],
      workspacePath,
      createdAt: now,
      updatedAt: now
    };

    await this.dependencies.eventStore.saveState(state);

    await this.recordEvent(state, {
      actor: "CLIENT",
      action: "RUN_CREATED",
      message: "Execução criada a partir do briefing."
    });

    return state;
  }

  async execute(state: RunState): Promise<RunState> {
    try {
      await this.changeStatus(state, "PLANNING");

      await this.recordEvent(state, {
        actor: "PO",
        action: "PLANNING_STARTED",
        message: "PO iniciou a análise do briefing."
      });

      state.stories =
        await this.dependencies.po.createBacklog(state.briefing);

      await this.recordEvent(state, {
        actor: "PO",
        action: "STORIES_CREATED",
        message: `${state.stories.length} stories foram criadas.`,
        metadata: {
          storyIds: state.stories.map((story) => story.id)
        }
      });

      await this.recordEvent(state, {
        actor: "RUNNER",
        action: "DEPENDENCY_INSTALL_STARTED",
        message: "Instalação das dependências iniciada."
      });

      const installation =
        await this.dependencies.runner.run({
          workspace: state.workspacePath,
          command: "npm install",
          timeoutMs: 180_000
        });

      await this.recordEvent(state, {
        actor: "RUNNER",
        action:
          installation.exitCode === 0
            ? "DEPENDENCY_INSTALL_COMPLETED"
            : "DEPENDENCY_INSTALL_FAILED",
        message:
          installation.exitCode === 0
            ? "Dependências instaladas."
            : "Falha ao instalar dependências.",
        metadata: {
          exitCode: installation.exitCode,
          durationMs: installation.durationMs,
          timedOut: installation.timedOut,
          stderr: installation.stderr.slice(0, 2_000)
        }
      });

      if (installation.exitCode !== 0 || installation.timedOut) {
        throw new Error("Dependency installation failed");
      }

      for (const story of state.stories) {
        state.currentStoryId = story.id;
        state.attempt = 0;

        let previousQaResult: QaResult | null = null;

        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "STORY_STARTED",
          message: `Desenvolvimento da ${story.id} iniciado.`,
          storyId: story.id
        });

        while (state.attempt < state.maxAttempts) {
          state.attempt += 1;
          story.status = "DEVELOPING";

          await this.changeStatus(state, "DEVELOPING");

          await this.recordEvent(state, {
            actor: "DEV",
            action: "IMPLEMENTATION_STARTED",
            message: `Developer iniciou a tentativa ${state.attempt}.`,
            storyId: story.id,
            metadata: {
              attempt: state.attempt
            }
          });

          const implementation =
            await this.dependencies.developer.implement({
              story,
              previousQaResult
            });

          const build = await this.dependencies.runner.run({
            workspace: state.workspacePath,
            command: "npm run build",
            timeoutMs: 120_000
          });

          await this.recordEvent(state, {
            actor: "RUNNER",
            action:
              build.exitCode === 0
                ? "BUILD_COMPLETED"
                : "BUILD_FAILED",
            message:
              build.exitCode === 0
                ? "Build concluído."
                : "Build falhou.",
            storyId: story.id,
            metadata: {
              exitCode: build.exitCode,
              durationMs: build.durationMs,
              timedOut: build.timedOut,
              stderr: build.stderr.slice(0, 2_000)
            }
          });

          const tests = await this.dependencies.runner.run({
            workspace: state.workspacePath,
            command: "npm test",
            timeoutMs: 120_000
          });

          await this.recordEvent(state, {
            actor: "RUNNER",
            action:
              tests.exitCode === 0
                ? "TESTS_COMPLETED"
                : "TESTS_FAILED",
            message:
              tests.exitCode === 0
                ? "Testes automatizados aprovados."
                : "Testes automatizados falharam.",
            storyId: story.id,
            metadata: {
              exitCode: tests.exitCode,
              durationMs: tests.durationMs,
              timedOut: tests.timedOut,
              stderr: tests.stderr.slice(0, 2_000)
            }
          });

          story.status = "TESTING";
          await this.changeStatus(state, "TESTING");

          await this.recordEvent(state, {
            actor: "QA",
            action: "VALIDATION_STARTED",
            message: `QA iniciou a validação da ${story.id}.`,
            storyId: story.id,
            metadata: {
              attempt: state.attempt
            }
          });

          const qaResult =
            await this.dependencies.qa.validate({
              story,
              implementation,
              build,
              tests
            });

          if (qaResult.status === "PASS") {
            story.status = "PASSED";

            await this.recordEvent(state, {
              actor: "QA",
              action: "STORY_APPROVED",
              message: `${story.id} foi aprovada.`,
              storyId: story.id,
              metadata: {
                attempt: state.attempt
              }
            });

            break;
          }

          previousQaResult = qaResult;
          story.status = "FAILED";

          await this.recordEvent(state, {
            actor: "QA",
            action: "STORY_REJECTED",
            message: `${story.id} foi rejeitada e retornará ao Developer.`,
            storyId: story.id,
            metadata: {
              attempt: state.attempt,
              requestedChanges: qaResult.requestedChanges
            }
          });
        }

        if (story.status !== "PASSED") {
          story.status = "BLOCKED";
          await this.changeStatus(state, "BLOCKED");

          await this.recordEvent(state, {
            actor: "ORCHESTRATOR",
            action: "MAX_ATTEMPTS_REACHED",
            message: `${story.id} atingiu o limite de tentativas.`,
            storyId: story.id
          });

          state.currentStoryId = null;
          await this.persistState(state);
          return state;
        }
      }

      state.currentStoryId = null;
      await this.changeStatus(state, "COMPLETED");

      await this.recordEvent(state, {
        actor: "ORCHESTRATOR",
        action: "RUN_COMPLETED",
        message: "Todas as stories foram aprovadas."
      });

      await this.persistState(state);
      return state;
    } catch (error) {
      state.status = "FAILED";
      state.updatedAt = new Date().toISOString();

      await this.dependencies.eventStore.saveState(state);

      await this.recordEvent(state, {
        actor: "ORCHESTRATOR",
        action: "RUN_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro desconhecido durante a execução."
      });

      return state;
    }
  }

  private async changeStatus(
    state: RunState,
    status: RunState["status"]
  ): Promise<void> {
    state.status = status;
    await this.persistState(state);
  }

  private async persistState(state: RunState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.dependencies.eventStore.saveState(state);
  }

  private async recordEvent(
    state: RunState,
    input: Omit<
      AuditEvent,
      "eventId" | "runId" | "timestamp"
    >
  ): Promise<void> {
    await this.dependencies.eventStore.appendEvent({
      eventId: `evt-${randomUUID()}`,
      runId: state.runId,
      timestamp: new Date().toISOString(),
      ...input
    });

    await this.persistState(state);
  }
}