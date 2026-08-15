import type {
  DeveloperResult,
  QaResult,
  UserStory
} from "@squad/schemas";

export interface ProductOwnerAgent {
  createBacklog(briefing: string): Promise<UserStory[]>;
}

export interface DeveloperInput {
  story: UserStory;
  previousQaResult: QaResult | null;
}

export interface DeveloperAgent {
  implement(input: DeveloperInput): Promise<DeveloperResult>;
}

export interface QaInput {
  story: UserStory;
  implementation: DeveloperResult;
}

export interface QualityAssuranceAgent {
  validate(input: QaInput): Promise<QaResult>;
}

export class MockProductOwnerAgent implements ProductOwnerAgent {
  async createBacklog(briefing: string): Promise<UserStory[]> {
    if (briefing.trim() === "") {
      throw new Error("Briefing cannot be empty");
    }

    return [
      {
        id: "US-001",
        title: "Criar tarefa",
        description: "Permitir que o usuário crie uma tarefa.",
        priority: 1,
        acceptanceCriteria: [
          "O título da tarefa deve ser obrigatório",
          "A tarefa deve iniciar com status TODO"
        ],
        status: "PENDING"
      },
      {
        id: "US-002",
        title: "Listar tarefas",
        description: "Exibir todas as tarefas cadastradas.",
        priority: 2,
        acceptanceCriteria: [
          "As tarefas devem ser exibidas em uma lista"
        ],
        status: "PENDING"
      }
    ];
  }
}

export class MockDeveloperAgent implements DeveloperAgent {
  async implement(
    input: DeveloperInput
  ): Promise<DeveloperResult> {
    const isCorrection = input.previousQaResult !== null;

    return {
      storyId: input.story.id,
      summary: isCorrection
        ? "Implementação corrigida com base no relatório do QA."
        : "Implementação inicial concluída.",
      changedFiles: [
        `src/features/${input.story.id.toLowerCase()}.ts`
      ],
      commands: ["npm run build", "npm test"],
      status: "IMPLEMENTED"
    };
  }
}

export class MockQualityAssuranceAgent
  implements QualityAssuranceAgent
{
  private attempts = new Map<string, number>();

  async validate(input: QaInput): Promise<QaResult> {
    const currentAttempt =
      (this.attempts.get(input.story.id) ?? 0) + 1;

    this.attempts.set(input.story.id, currentAttempt);

    if (currentAttempt === 1) {
      return {
        storyId: input.story.id,
        status: "FAIL",
        summary: "Um critério ainda não foi atendido.",
        criteria: input.story.acceptanceCriteria.map(
          (criterion, index) => ({
            criterion,
            passed: index !== 0,
            evidence:
              index === 0
                ? "Validação ausente na primeira implementação."
                : "Critério verificado pelo QA simulado."
          })
        ),
        requestedChanges: [
          "Adicionar a validação solicitada no primeiro critério."
        ]
      };
    }

    return {
      storyId: input.story.id,
      status: "PASS",
      summary: "Todos os critérios foram atendidos.",
      criteria: input.story.acceptanceCriteria.map(
        (criterion) => ({
          criterion,
          passed: true,
          evidence: "Critério verificado após a correção."
        })
      ),
      requestedChanges: []
    };
  }
}
