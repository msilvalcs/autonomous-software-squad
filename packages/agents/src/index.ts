import {
  BacklogSchema,
  type DeveloperResult,
  type QaResult,
  type UserStory
} from "@squad/schemas";
import type { CodexClient } from "@squad/codex-client";

export interface ExecutionEvidence {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

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
  build: ExecutionEvidence;
  tests: ExecutionEvidence;
}

export interface QualityAssuranceAgent {
  validate(input: QaInput): Promise<QaResult>;
}

const backlogOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["stories"],
  properties: {
    stories: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "description",
          "priority",
          "acceptanceCriteria",
          "status"
        ],
        properties: {
          id: {
            type: "string"
          },
          title: {
            type: "string"
          },
          description: {
            type: "string"
          },
          priority: {
            type: "integer",
            minimum: 1
          },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            items: {
              type: "string"
            }
          },
          status: {
            type: "string",
            enum: ["PENDING"]
          }
        }
      }
    }
  }
};

export class CodexProductOwnerAgent
  implements ProductOwnerAgent {
  constructor(
    private readonly client: CodexClient,
    private readonly workingDirectory: string,
    private readonly model?: string
  ) { }

  async createBacklog(
    briefing: string
  ): Promise<UserStory[]> {
    if (briefing.trim() === "") {
      throw new Error("Briefing cannot be empty");
    }

    const prompt = `
Você é o Product Owner de um squad autônomo de software.

Transforme o briefing do cliente em um backlog pequeno e executável.

Regras:
- Crie entre 1 e 6 user stories.
- Use IDs sequenciais: US-001, US-002 e assim por diante.
- Cada story deve ser pequena e independente.
- A prioridade deve começar em 1.
- Todos os critérios de aceitação devem ser objetivos e verificáveis.
- O status inicial de todas as stories deve ser PENDING.
- Não inclua funcionalidades fora do briefing.
- Produza somente a estrutura solicitada pelo schema JSON.

Briefing do cliente:
${briefing}
`.trim();

    const result = await this.client.generate<unknown>({
      prompt,
      outputSchema: backlogOutputSchema,
      workingDirectory: this.workingDirectory,
      sandbox: "read-only",
      timeoutMs: 300_000,
      model: this.model
    });

    const backlog = BacklogSchema.parse(result.data);

    return backlog.stories
      .sort((first, second) =>
        first.priority - second.priority
      )
      .map((story, index) => ({
        ...story,
        id: `US-${String(index + 1).padStart(3, "0")}`,
        priority: index + 1,
        status: "PENDING"
      }));
  }
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
  implements QualityAssuranceAgent {
  private attempts = new Map<string, number>();

  async validate(input: QaInput): Promise<QaResult> {
    if (
      input.build.exitCode !== 0 ||
      input.tests.exitCode !== 0 ||
      input.build.timedOut ||
      input.tests.timedOut
    ) {
      return {
        storyId: input.story.id,
        status: "FAIL",
        summary: "Build ou testes automatizados falharam.",
        criteria: input.story.acceptanceCriteria.map(
          (criterion) => ({
            criterion,
            passed: false,
            evidence: [
              input.build.stderr,
              input.tests.stderr
            ]
              .filter(Boolean)
              .join("\n") || "Execução automatizada falhou."
          })
        ),
        requestedChanges: [
          "Corrigir os erros de build e testes automatizados."
        ]
      };
    }
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
