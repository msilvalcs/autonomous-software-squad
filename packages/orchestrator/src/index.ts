import { randomUUID } from "node:crypto";

import type {
  DeveloperAgent,
  ProductOwnerAgent,
  QualityAssuranceAgent
} from "@squad/agents";
import type { JsonlEventStore } from "@squad/event-store";
import type {
  AuditEvent,
  AgentRole,
  ExecutionPolicy,
  ModelAssignment,
  QaResult,
  ReasoningEffort,
  RunState,
  TaskComplexity
} from "@squad/schemas";
import { QaResultSchema } from "@squad/schemas";

import type {
  ExecutionBackend,
  ExecutionEnvironment,
  ExecutionRunner,
  WorkspaceManager
} from "@squad/runner";

export interface OrchestratorDependencies {
  po: ProductOwnerAgent;
  developer: DeveloperAgent;
  qa: QualityAssuranceAgent;
  eventStore: JsonlEventStore;
  runner: ExecutionRunner;
  workspaceManager: Pick<
    WorkspaceManager,
    "prepareWorkspace"
  >;
  routingPolicy?: ModelRoutingPolicy;
  isolationPolicy?: IsolationPolicy;
  storyPublisher?: StoryPublisher;
}

export interface StoryPublisher {
  publish(
    runId: string,
    stories: RunState["stories"]
  ): Promise<Array<{
    storyId: string;
    number: number;
    url: string;
  }>>;
}

export interface ModelRoutingPolicy {
  route(briefing: string): {
    complexity: TaskComplexity;
    reason: string;
    assignments: ModelAssignment[];
  };
}

export interface IsolationDecision {
  complexity: TaskComplexity;
  requiredBackend: ExecutionBackend;
  selectedBackend: ExecutionBackend;
  allowed: boolean;
  reason: string;
}

export interface IsolationPolicy {
  evaluate(
    complexity: TaskComplexity,
    selectedBackend: ExecutionBackend
  ): IsolationDecision;
}

export type IsolationMinimums = Partial<
  Record<TaskComplexity, ExecutionBackend>
>;

const isolationRank: Record<ExecutionBackend, number> = {
  local: 0,
  docker: 1,
  microvm: 2
};

export class MinimumIsolationPolicy implements IsolationPolicy {
  private readonly minimums: Record<
    TaskComplexity,
    ExecutionBackend
  >;

  constructor(minimums: IsolationMinimums = {}) {
    this.minimums = {
      LOW: minimums.LOW ?? "local",
      MEDIUM: minimums.MEDIUM ?? "local",
      HIGH: minimums.HIGH ?? "local"
    };
  }

  evaluate(
    complexity: TaskComplexity,
    selectedBackend: ExecutionBackend
  ): IsolationDecision {
    const requiredBackend = this.minimums[complexity];
    const allowed =
      isolationRank[selectedBackend] >=
      isolationRank[requiredBackend];

    return {
      complexity,
      requiredBackend,
      selectedBackend,
      allowed,
      reason: allowed
        ? `Backend ${selectedBackend} atende ao mínimo ${requiredBackend} para complexidade ${complexity}.`
        : `Backend ${selectedBackend} é inferior ao mínimo ${requiredBackend} para complexidade ${complexity}.`
    };
  }
}

interface RouteConfig {
  provider: string;
  model: string | null;
  reasoningEffort: ReasoningEffort;
}

export type RoutingOverrides = Partial<
  Record<
    TaskComplexity,
    Partial<Record<AgentRole, Partial<RouteConfig>>>
  >
>;

export class DeterministicModelRouter implements ModelRoutingPolicy {
  constructor(
    private readonly overrides: RoutingOverrides = {},
    private readonly defaultProvider = "codex"
  ) { }

  route(briefing: string) {
    const classification = classifyComplexity(briefing);
    const roles: AgentRole[] = ["PO", "DEV", "QA"];

    return {
      complexity: classification.complexity,
      reason: classification.reason,
      assignments: roles.map((agent) => {
        const defaults = defaultRoute(
          classification.complexity,
          agent,
          this.defaultProvider
        );
        const override = this.overrides[classification.complexity]?.[agent];
        const selected = { ...defaults, ...override };

        return {
          agent,
          complexity: classification.complexity,
          ...selected,
          reason: `${classification.reason} Rota ${agent}: ${selected.provider}/${selected.model ?? "default"} com esforço ${selected.reasoningEffort}.`
        };
      })
    };
  }
}

function classifyComplexity(briefing: string): {
  complexity: TaskComplexity;
  reason: string;
} {
  const normalized = briefing.toLowerCase();
  const highRiskSignals = [
    "autenticação",
    "authentication",
    "pagamento",
    "payment",
    "tempo real",
    "real-time",
    "banco de dados",
    "database",
    "integração externa",
    "external integration",
    "multi-tenant",
    "permissões"
  ].filter((signal) => normalized.includes(signal));
  const featureSignals = (
    normalized.match(/\b(deve|permitir|cadastrar|listar|filtrar|integrar|validar)\b/g)
    ?? []
  ).length;
  const score =
    highRiskSignals.length * 3 +
    Math.min(featureSignals, 6) +
    (briefing.length > 1_200 ? 3 : briefing.length > 600 ? 1 : 0);

  if (score >= 9) {
    return {
      complexity: "HIGH",
      reason: `Complexidade alta: score ${score}; sinais críticos: ${highRiskSignals.join(", ") || "escopo extenso"}.`
    };
  }

  if (score <= 2 && briefing.length < 350) {
    return {
      complexity: "LOW",
      reason: `Complexidade baixa: score ${score}; briefing curto e sem sinais críticos.`
    };
  }

  return {
    complexity: "MEDIUM",
    reason: `Complexidade média: score ${score}; múltiplas decisões, sem risco suficiente para rota alta.`
  };
}

function defaultRoute(
  complexity: TaskComplexity,
  agent: AgentRole,
  provider: string
): RouteConfig {
  if (provider === "mock") {
    return { provider, model: null, reasoningEffort: "low" };
  }

  if (complexity === "LOW") {
    return { provider, model: "gpt-5.6-luna", reasoningEffort: "low" };
  }

  if (complexity === "HIGH") {
    return {
      provider,
      model: "gpt-5.6-sol",
      reasoningEffort: agent === "QA" ? "xhigh" : "high"
    };
  }

  return {
    provider,
    model: agent === "DEV" ? "gpt-5.6-luna" : "gpt-5.6-terra",
    reasoningEffort: agent === "QA" ? "high" : "medium"
  };
}

function executionPoliciesFor(
  runner: ExecutionRunner
): ExecutionPolicy[] {
  return [
    {
      actor: "PO",
      runtime: "host-codex",
      workspaceAccess: "repository-read-only",
      networkAccess: "provider-only",
      credentialAccess: "host-session",
      allowedCommands: [],
      privileged: false,
      dockerSocket: false,
      limits: {
        timeoutMs: 300_000,
        cpu: null,
        memory: null,
        pids: null
      }
    },
    {
      actor: "DEV",
      runtime: "host-codex",
      workspaceAccess: "run-write",
      networkAccess: "provider-only",
      credentialAccess: "host-session",
      allowedCommands: [],
      privileged: false,
      dockerSocket: false,
      limits: {
        timeoutMs: 600_000,
        cpu: null,
        memory: null,
        pids: null
      }
    },
    {
      actor: "QA",
      runtime: "host-codex",
      workspaceAccess: "run-read-only",
      networkAccess: "provider-only",
      credentialAccess: "host-session",
      allowedCommands: [],
      privileged: false,
      dockerSocket: false,
      limits: {
        timeoutMs: 300_000,
        cpu: null,
        memory: null,
        pids: null
      }
    },
    {
      actor: "RUNNER",
      runtime: runner.policy.runtime,
      workspaceAccess: runner.policy.workspaceAccess,
      networkAccess: runner.policy.networkAccess,
      credentialAccess: runner.policy.credentialAccess,
      allowedCommands: runner.policy.allowedCommands,
      privileged: runner.policy.privileged,
      dockerSocket: runner.policy.dockerSocket,
      limits: runner.policy.limits
    }
  ];
}

export interface CreateRunInput {
  briefing: string;
  maxAttempts?: number;
}

export function canResumeRun(
  state: RunState,
  events: AuditEvent[]
): boolean {
  if (["COMPLETED", "BLOCKED"].includes(state.status)) {
    return false;
  }

  if (state.status === "CANCELLED") {
    return (
      state.currentStoryId === null ||
      state.attempt < state.maxAttempts
    );
  }

  if (state.status !== "FAILED") {
    return true;
  }

  if (
    state.currentStoryId !== null &&
    state.attempt >= state.maxAttempts
  ) {
    return false;
  }

  const latestFailure = [...events].reverse().find(
    (event) =>
      event.action === "ISOLATION_REQUIREMENT_NOT_MET" ||
      event.action === "IMPLEMENTATION_FAILED" ||
      event.action === "EXECUTION_ENVIRONMENT_CREATION_FAILED" ||
      event.action === "EXECUTION_ENVIRONMENT_CLEANUP_FAILED"
  );

  if (!latestFailure) {
    return false;
  }

  if (latestFailure.action === "IMPLEMENTATION_FAILED") {
    return true;
  }

  return latestFailure.metadata?.retryable === true;
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
    const routing = (
      this.dependencies.routingPolicy ?? new DeterministicModelRouter()
    ).route(input.briefing);
    const isolation = this.isolationDecision(
      routing.complexity
    );

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
      complexity: routing.complexity,
      modelAssignments: routing.assignments,
      executionPolicies: executionPoliciesFor(
        this.dependencies.runner
      ),
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

    await this.recordEvent(state, {
      actor: "ORCHESTRATOR",
      action: "MODEL_ROUTING_DECIDED",
      message: routing.reason,
      metadata: {
        complexity: routing.complexity,
        assignments: routing.assignments
      }
    });

    await this.recordEvent(state, {
      actor: "ORCHESTRATOR",
      action: "EXECUTION_POLICIES_DECIDED",
      message: "Políticas de menor privilégio definidas para PO, Developer, QA e Runner.",
      metadata: {
        policies: state.executionPolicies
      }
    });

    await this.recordEvent(state, {
      actor: "ORCHESTRATOR",
      action: "EXECUTION_BACKEND_DECIDED",
      message: isolation.reason,
      metadata: {
        backend: this.dependencies.runner.backend,
        requiredBackend: isolation.requiredBackend,
        allowed: isolation.allowed,
        reason: isolation.reason,
        policy: this.dependencies.runner.policy
      }
    });

    return state;
  }

  async execute(
    state: RunState,
    signal?: AbortSignal
  ): Promise<RunState> {
    return this.run(state, false, signal);
  }

  async resume(
    state: RunState,
    signal?: AbortSignal
  ): Promise<RunState> {
    const events = await this.dependencies.eventStore.listEvents(
      state.runId
    );

    if (!canResumeRun(state, events)) {
      throw new Error(`Run ${state.runId} cannot be resumed`);
    }

    return this.run(state, true, signal);
  }

  private async run(
    state: RunState,
    resuming: boolean,
    signal?: AbortSignal
  ): Promise<RunState> {
    let environment: ExecutionEnvironment | undefined;
    let currentStage = resuming ? "RESUME" : "PREPARE";

    const checkCancelled = () => {
      if (signal?.aborted) {
        throw new Error("Run was cancelled");
      }
    };

    try {
      checkCancelled();

      const isolation = this.isolationDecision(state.complexity);

      if (!isolation.allowed) {
        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "ISOLATION_REQUIREMENT_NOT_MET",
          message: `${isolation.reason} A execução foi bloqueada sem fallback.`,
          metadata: {
            ...isolation,
            retryable: false
          }
        });
        throw new Error(
          `${isolation.reason} No fallback was applied.`
        );
      }

      const preparationStartedAt = Date.now();

      try {
        environment = await this.dependencies.runner.prepare(
          state.workspacePath
        );
      } catch (error) {
        await this.recordEvent(state, {
          actor: "RUNNER",
          action: "EXECUTION_ENVIRONMENT_CREATION_FAILED",
          message: "Falha ao preparar o ambiente de execução. A run pode ser retomada.",
          metadata: {
            backend: this.dependencies.runner.backend,
            stage: "PREPARE",
            durationMs: Date.now() - preparationStartedAt,
            policy: this.dependencies.runner.policy,
            retryable: true,
            errorType:
              error instanceof Error
                ? error.constructor.name
                : "UnknownError"
          }
        });
        throw error;
      }

      await this.recordEvent(state, {
        actor: "RUNNER",
        action: "EXECUTION_ENVIRONMENT_STARTED",
        message: `Ambiente ${environment.backend} preparado para a execução.`,
        metadata: this.environmentMetadata(environment, "PREPARE", {
          durationMs: Date.now() - preparationStartedAt,
          resumed: resuming
        })
      });

      const previousEvents = resuming
        ? await this.dependencies.eventStore.listEvents(state.runId)
        : [];
      const needsPlanning = !resuming || state.stories.length === 0;
      const needsDependencyInstall =
        !resuming ||
        !previousEvents.some(
          (event) => event.action === "DEPENDENCY_INSTALL_COMPLETED"
        );

      if (resuming) {
        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "RUN_RESUMED",
          message: "Execução retomada a partir do estado persistido.",
          metadata: {
            previousStatus: state.status,
            currentStoryId: state.currentStoryId,
            attempt: state.attempt
          }
        });
      }

      if (needsPlanning) {
        currentStage = "PLANNING";
        checkCancelled();
        await this.changeStatus(state, "PLANNING");
        const planningStartedAt = Date.now();

        await this.recordEvent(state, {
          actor: "PO",
          action: "PLANNING_STARTED",
          message: "PO iniciou a análise do briefing.",
          metadata: {
            stage: "PLANNING",
            executionPolicy: this.policyFor(state, "PO")
          }
        });

        checkCancelled();
        const backlog = await this.dependencies.po.createBacklog(
          state.briefing,
          this.assignmentFor(state, "PO")
        );
        checkCancelled();
        state.stories = backlog.stories;

        await this.recordEvent(state, {
          actor: "PO",
          action: "STORIES_CREATED",
          message: `${state.stories.length} stories foram criadas.`,
          metadata: {
            stage: "PLANNING",
            durationMs: Date.now() - planningStartedAt,
            executionPolicy: this.policyFor(state, "PO"),
            storyIds: state.stories.map((story) => story.id),
            decisions: backlog.decisions
          }
        });

        await this.publishStories(state);
      }

      if (needsDependencyInstall) {
        currentStage = "INSTALL";
        checkCancelled();
        await this.installDependencies(state, environment);
      }

      for (const story of state.stories) {
        if (story.status === "PASSED") {
          continue;
        }

        checkCancelled();

        const resumesCurrentStory =
          resuming && state.currentStoryId === story.id;
        state.currentStoryId = story.id;
        state.attempt = resumesCurrentStory ? state.attempt : 0;

        let previousQaResult = resumesCurrentStory
          ? await this.latestQaResult(state.runId, story.id)
          : null;

        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: resumesCurrentStory
            ? "STORY_RESUMED"
            : "STORY_STARTED",
          message: resumesCurrentStory
            ? `Desenvolvimento da ${story.id} retomado.`
            : `Desenvolvimento da ${story.id} iniciado.`,
          storyId: story.id
        });

        while (state.attempt < state.maxAttempts) {
          checkCancelled();
          state.attempt += 1;
          story.status = "DEVELOPING";
          currentStage = "DEVELOPMENT";
          const implementationStartedAt = Date.now();

          await this.changeStatus(state, "DEVELOPING");

          await this.recordEvent(state, {
            actor: "DEV",
            action: "IMPLEMENTATION_STARTED",
            message: `Developer iniciou a tentativa ${state.attempt}.`,
            storyId: story.id,
            metadata: {
              attempt: state.attempt,
              stage: "DEVELOPMENT",
              executionPolicy: this.policyFor(state, "DEV")
            }
          });

          checkCancelled();
          const implementation =
            await this.dependencies.developer.implement({
              story,
              previousQaResult,
              workspacePath: state.workspacePath,
              assignment: this.assignmentFor(state, "DEV")
            });
          checkCancelled();

          await this.recordEvent(state, {
            actor: "DEV",
            action:
              implementation.status === "IMPLEMENTED"
                ? "IMPLEMENTATION_COMPLETED"
                : "IMPLEMENTATION_FAILED",
            message: implementation.summary,
            storyId: story.id,
            metadata: {
              attempt: state.attempt,
              stage: "DEVELOPMENT",
              durationMs: Date.now() - implementationStartedAt,
              executionPolicy: this.policyFor(state, "DEV"),
              changedFiles: implementation.changedFiles,
              requestedCommands: implementation.commands,
              decisions: implementation.decisions
            }
          });

          if (implementation.status === "FAILED") {
            throw new Error(
              `Developer failed to implement ${story.id}: ${implementation.summary}`
            );
          }

          currentStage = "BUILD";
          checkCancelled();
          const build = await this.dependencies.runner.run({
            workspace: state.workspacePath,
            command: "npm run build",
            timeoutMs: 120_000
          });
          checkCancelled();

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
            metadata: this.environmentMetadata(environment, "BUILD", {
              exitCode: build.exitCode,
              durationMs: build.durationMs,
              timedOut: build.timedOut,
              stdout: build.stdout.slice(-2_000),
              stderr: build.stderr.slice(0, 2_000)
            })
          });

          currentStage = "TEST";
          checkCancelled();
          const tests = await this.dependencies.runner.run({
            workspace: state.workspacePath,
            command: "npm test",
            timeoutMs: 120_000
          });
          checkCancelled();

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
            metadata: this.environmentMetadata(environment, "TEST", {
              exitCode: tests.exitCode,
              durationMs: tests.durationMs,
              timedOut: tests.timedOut,
              stdout: tests.stdout.slice(-4_000),
              stderr: tests.stderr.slice(0, 2_000)
            })
          });

          currentStage = "VALIDATION";
          checkCancelled();
          story.status = "TESTING";
          await this.changeStatus(state, "TESTING");
          const validationStartedAt = Date.now();

          await this.recordEvent(state, {
            actor: "QA",
            action: "VALIDATION_STARTED",
            message: `QA iniciou a validação da ${story.id}.`,
            storyId: story.id,
            metadata: {
              attempt: state.attempt,
              stage: "VALIDATION",
              executionPolicy: this.policyFor(state, "QA")
            }
          });

          checkCancelled();
          const qaResult =
            await this.dependencies.qa.validate({
              story,
              implementation,
              build,
              tests,
              workspacePath: state.workspacePath,
              assignment: this.assignmentFor(state, "QA")
            });
          checkCancelled();

          if (qaResult.status === "PASS") {
            story.status = "PASSED";

            await this.recordEvent(state, {
              actor: "QA",
              action: "STORY_APPROVED",
              message: `${story.id} foi aprovada.`,
              storyId: story.id,
              metadata: {
                attempt: state.attempt,
                stage: "VALIDATION",
                durationMs: Date.now() - validationStartedAt,
                executionPolicy: this.policyFor(state, "QA"),
                summary: qaResult.summary,
                criteria: qaResult.criteria,
                decisions: qaResult.decisions
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
              stage: "VALIDATION",
              durationMs: Date.now() - validationStartedAt,
              executionPolicy: this.policyFor(state, "QA"),
              summary: qaResult.summary,
              criteria: qaResult.criteria,
              requestedChanges: qaResult.requestedChanges,
              decisions: qaResult.decisions
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
      const isCancelled =
        signal?.aborted ||
        (error instanceof Error &&
          (error.message.toLowerCase().includes("cancelled") ||
            error.message.toLowerCase().includes("aborted") ||
            error.name === "AbortError"));

      if (isCancelled) {
        state.status = "CANCELLED";
        state.updatedAt = new Date().toISOString();

        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "RUN_CANCELLED",
          message: "Execução cancelada a pedido do usuário.",
          metadata: {
            stage: currentStage,
            currentStoryId: state.currentStoryId,
            attempt: state.attempt
          }
        });

        await this.dependencies.eventStore.saveState(state);
        return state;
      }

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
    } finally {
      if (environment) {
        const disposalStartedAt = Date.now();

        try {
          await this.dependencies.runner.dispose(state.workspacePath);

          await this.recordEvent(state, {
            actor: "RUNNER",
            action: "EXECUTION_ENVIRONMENT_DISPOSED",
            message: `Ambiente ${environment.backend} removido após a execução.`,
            metadata: this.environmentMetadata(environment, "CLEANUP", {
              durationMs: Date.now() - disposalStartedAt
            })
          });
        } catch (error) {
          state.status = "FAILED";
          await this.persistState(state);

          await this.recordEvent(state, {
            actor: "RUNNER",
            action: "EXECUTION_ENVIRONMENT_CLEANUP_FAILED",
            message: "Falha ao remover o ambiente de execução. A run pode ser retomada.",
            metadata: this.environmentMetadata(environment, "CLEANUP", {
              durationMs: Date.now() - disposalStartedAt,
              retryable: true,
              errorType:
                error instanceof Error
                  ? error.constructor.name
                  : "UnknownError"
            })
          });
        }
      }
    }
  }

  private isolationDecision(
    complexity: TaskComplexity
  ): IsolationDecision {
    return (
      this.dependencies.isolationPolicy ??
      new MinimumIsolationPolicy()
    ).evaluate(
      complexity,
      this.dependencies.runner.backend
    );
  }

  private async latestQaResult(
    runId: string,
    storyId: string
  ): Promise<QaResult | null> {
    const events = await this.dependencies.eventStore.listEvents(runId);
    const rejection = [...events].reverse().find(
      (event) =>
        event.storyId === storyId &&
        event.action === "STORY_REJECTED"
    );

    if (!rejection?.metadata) {
      return null;
    }

    const result = QaResultSchema.safeParse({
      storyId,
      status: "FAIL",
      summary: rejection.metadata.summary,
      criteria: rejection.metadata.criteria,
      requestedChanges: rejection.metadata.requestedChanges,
      decisions: rejection.metadata.decisions
    });

    return result.success ? result.data : null;
  }

  private async publishStories(state: RunState): Promise<void> {
    if (!this.dependencies.storyPublisher) {
      return;
    }

    const published = [];

    for (const story of state.stories) {
      try {
        const [issue] = await this.dependencies.storyPublisher.publish(
          state.runId,
          [story]
        );

        if (!issue) {
          throw new Error("Story publisher returned no issue");
        }

        story.externalIssue = {
          provider: "github",
          number: issue.number,
          url: issue.url
        };
        published.push(issue);

        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "STORY_PUBLISHED",
          message: `${story.id} foi publicada como GitHub Issue #${issue.number}.`,
          storyId: story.id,
          metadata: { issue }
        });
      } catch (error) {
        await this.recordEvent(state, {
          actor: "ORCHESTRATOR",
          action: "STORY_PUBLICATION_FAILED",
          message: `Não foi possível publicar ${story.id} como GitHub Issue.`,
          storyId: story.id,
          metadata: {
            errorType:
              error instanceof Error
                ? error.constructor.name
                : "UnknownError"
          }
        });
      }
    }

    await this.recordEvent(state, {
      actor: "ORCHESTRATOR",
      action: "STORIES_PUBLISHED",
      message: `${published.length} stories foram publicadas como GitHub Issues.`,
      metadata: { issues: published }
    });
  }

  private async installDependencies(
    state: RunState,
    environment: ExecutionEnvironment
  ): Promise<void> {
    await this.recordEvent(state, {
      actor: "RUNNER",
      action: "DEPENDENCY_INSTALL_STARTED",
      message: "Instalação das dependências iniciada.",
      metadata: this.environmentMetadata(environment, "INSTALL")
    });

    const installation = await this.dependencies.runner.run({
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
      metadata: this.environmentMetadata(environment, "INSTALL", {
        exitCode: installation.exitCode,
        durationMs: installation.durationMs,
        timedOut: installation.timedOut,
        stderr: installation.stderr.slice(0, 2_000)
      })
    });

    if (installation.exitCode !== 0 || installation.timedOut) {
      throw new Error("Dependency installation failed");
    }
  }

  private async changeStatus(
    state: RunState,
    status: RunState["status"]
  ): Promise<void> {
    state.status = status;
    await this.persistState(state);
  }

  private assignmentFor(
    state: RunState,
    agent: AgentRole
  ): ModelAssignment | undefined {
    return state.modelAssignments.find(
      (assignment) => assignment.agent === agent
    );
  }

  private policyFor(
    state: RunState,
    actor: "PO" | "DEV" | "QA" | "RUNNER"
  ) {
    return state.executionPolicies.find(
      (policy) => policy.actor === actor
    );
  }

  private environmentMetadata(
    environment: ExecutionEnvironment,
    stage: string,
    additional: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      backend: environment.backend,
      environmentId: environment.environmentId,
      image: environment.image ?? null,
      imageDigest: environment.imageDigest ?? null,
      stage,
      limits: this.dependencies.runner.policy.limits,
      networkAccess:
        this.dependencies.runner.policy.networkAccess,
      ...additional
    };
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
