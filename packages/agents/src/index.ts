import {
  BacklogSchema,
  DeveloperResultSchema,
  QaResultSchema,
  type Backlog,
  type DeveloperResult,
  type ModelAssignment,
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
  createBacklog(
    briefing: string,
    assignment?: ModelAssignment
  ): Promise<Backlog>;
}

export interface DeveloperInput {
  story: UserStory;
  previousQaResult: QaResult | null;
  workspacePath: string;
  assignment?: ModelAssignment;
}

export interface DeveloperAgent {
  implement(input: DeveloperInput): Promise<DeveloperResult>;
}

export interface QaInput {
  story: UserStory;
  implementation: DeveloperResult;
  build: ExecutionEvidence;
  tests: ExecutionEvidence;
  workspacePath: string;
  assignment?: ModelAssignment;
}

export interface QualityAssuranceAgent {
  validate(input: QaInput): Promise<QaResult>;
}

const backlogOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["stories", "decisions"],
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
    },
    decisions: {
      type: "array",
      items: agentDecisionOutputSchema()
    }
  }
};

const developerOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "storyId",
    "summary",
    "changedFiles",
    "commands",
    "status",
    "decisions"
  ],
  properties: {
    storyId: { type: "string" },
    summary: { type: "string", minLength: 1 },
    changedFiles: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    commands: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "npm install",
          "npm run build",
          "npm test",
          "npm run test:e2e",
          "npm run typecheck"
        ]
      }
    },
    status: {
      type: "string",
      enum: ["IMPLEMENTED", "FAILED"]
    },
    decisions: {
      type: "array",
      items: agentDecisionOutputSchema()
    }
  }
};

const qaOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "storyId",
    "status",
    "summary",
    "criteria",
    "requestedChanges",
    "decisions"
  ],
  properties: {
    storyId: { type: "string" },
    status: {
      type: "string",
      enum: ["PASS", "FAIL"]
    },
    summary: { type: "string", minLength: 1 },
    criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "passed", "evidence"],
        properties: {
          criterion: { type: "string", minLength: 1 },
          passed: { type: "boolean" },
          evidence: { type: "string", minLength: 1 }
        }
      }
    },
    requestedChanges: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    decisions: {
      type: "array",
      items: agentDecisionOutputSchema()
    }
  }
};

function agentDecisionOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "decision",
      "rationale",
      "alternativesConsidered"
    ],
    properties: {
      decision: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
      alternativesConsidered: {
        type: "array",
        items: { type: "string", minLength: 1 }
      }
    }
  };
}

export class CodexProductOwnerAgent
  implements ProductOwnerAgent {
  constructor(
    private readonly client: CodexClient,
    private readonly workingDirectory: string,
    private readonly model?: string,
    private readonly persona = ""
  ) { }

  async createBacklog(
    briefing: string,
    assignment?: ModelAssignment
  ): Promise<Backlog> {
    if (briefing.trim() === "") {
      throw new Error("Briefing cannot be empty");
    }

    const prompt = `
${this.persona}

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
- Documente cada decisão relevante, sua justificativa e alternativas consideradas.

Briefing do cliente:
${briefing}
`.trim();

    const result = await this.client.generate<unknown>({
      role: "PO",
      prompt,
      outputSchema: backlogOutputSchema,
      workingDirectory: this.workingDirectory,
      sandbox: "read-only",
      timeoutMs: 300_000,
      model: assignment?.model ?? this.model,
      provider: assignment?.provider,
      reasoningEffort: assignment?.reasoningEffort
    });

    const backlog = BacklogSchema.parse(result.data);

    return {
      decisions: backlog.decisions,
      stories: backlog.stories
        .sort((first, second) => first.priority - second.priority)
        .map((story, index) => ({
          ...story,
          id: `US-${String(index + 1).padStart(3, "0")}`,
          priority: index + 1,
          status: "PENDING"
        }))
    };
  }
}

export class MockProductOwnerAgent implements ProductOwnerAgent {
  async createBacklog(briefing: string): Promise<Backlog> {
    if (briefing.trim() === "") {
      throw new Error("Briefing cannot be empty");
    }

    return {
      decisions: [{
        decision: "Dividir o briefing em cadastro e listagem.",
        rationale: "Mantém as stories pequenas e verificáveis.",
        alternativesConsidered: ["Uma única story abrangente"]
      }],
      stories: [{
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
      }]
    };
  }
}

export class CodexDeveloperAgent implements DeveloperAgent {
  constructor(
    private readonly client: CodexClient,
    private readonly model?: string,
    private readonly persona = ""
  ) { }

  async implement(input: DeveloperInput): Promise<DeveloperResult> {
    if (input.workspacePath.trim() === "") {
      throw new Error("Developer workspace cannot be empty");
    }

    const prompt = `
${this.persona}

Voce e o Developer de um squad autonomo de software.

Implemente somente a user story informada no projeto existente no seu
diretorio de trabalho. Inspecione o codigo antes de editar e preserve as
funcionalidades existentes.

Regras obrigatorias:
- Trabalhe somente dentro do diretorio de trabalho atual.
- Nunca use caminhos absolutos ou caminhos com "..".
- Nao leia nem altere credenciais, .env ou arquivos fora do projeto.
- Adicione ou atualize testes para o comportamento implementado.
- Nao execute comandos destrutivos.
- Os unicos comandos que podem ser solicitados na resposta sao:
  npm install, npm run build, npm test, npm run test:e2e e npm run typecheck.
- Nao execute npm, Playwright ou outros comandos dependentes do ambiente no
  host. Implemente os arquivos e informe em commands quais validacoes o Runner
  deve executar. Somente o resultado retornado pelo Runner determina se build
  e testes passaram.
- Para criterios visuais ou de interacao, adicione testes reais em e2e e
  solicite npm run test:e2e. Playwright e Chromium sao provisionados no Runner.
- Liste em changedFiles apenas caminhos relativos realmente alterados.
- Se nao for possivel implementar com seguranca, retorne status FAILED e
  explique o motivo no summary.
- Produza somente a estrutura solicitada pelo schema JSON.
- Documente cada decisão técnica, sua justificativa e alternativas consideradas.

User story:
${JSON.stringify(input.story, null, 2)}

Relatorio anterior do QA:
${JSON.stringify(input.previousQaResult, null, 2)}
`.trim();

    const result = await this.client.generate<unknown>({
      role: "DEV",
      prompt,
      outputSchema: developerOutputSchema,
      workingDirectory: input.workspacePath,
      sandbox: "workspace-write",
      timeoutMs: 600_000,
      model: input.assignment?.model ?? this.model,
      provider: input.assignment?.provider,
      reasoningEffort: input.assignment?.reasoningEffort
    });

    const implementation = DeveloperResultSchema.parse(result.data);
    const changedFiles = implementation.changedFiles.map(
      validateRelativeFilePath
    );

    return {
      ...implementation,
      storyId: input.story.id,
      changedFiles
    };
  }
}

function validateRelativeFilePath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");

  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    segments.includes("..")
  ) {
    throw new Error(`Developer returned unsafe path: ${filePath}`);
  }

  const resolved = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");

  if (resolved === "") {
    throw new Error(`Developer returned unsafe path: ${filePath}`);
  }

  return resolved;
}

export class CodexQualityAssuranceAgent
  implements QualityAssuranceAgent {
  constructor(
    private readonly client: CodexClient,
    private readonly model?: string,
    private readonly persona = ""
  ) { }

  async validate(input: QaInput): Promise<QaResult> {
    if (input.workspacePath.trim() === "") {
      throw new Error("QA workspace cannot be empty");
    }

    if (
      input.build.exitCode !== 0 ||
      input.tests.exitCode !== 0 ||
      input.build.timedOut ||
      input.tests.timedOut
    ) {
      return failedAutomationResult(input);
    }

    const prompt = `
${this.persona}

Voce e o Quality Assurance de um squad autonomo de software.

Valide a user story no projeto existente no diretorio de trabalho. Inspecione
o codigo e os testes em modo somente leitura. Nao confie apenas no resumo do
Developer: confirme cada criterio com evidencias concretas do codigo e das
execucoes automatizadas.

Regras obrigatorias:
- Nao altere nenhum arquivo.
- Avalie todos os criterios de aceitacao, exatamente uma vez e na ordem dada.
- Em evidence, cite arquivos, comportamento ou resultado automatizado concreto.
- Retorne PASS somente se todos os criterios estiverem atendidos.
- Se retornar FAIL, inclua correcoes objetivas em requestedChanges.
- Se retornar PASS, requestedChanges deve ser vazio.
- Produza somente a estrutura solicitada pelo schema JSON.
- Documente cada decisão de aprovação ou reprovação, sua justificativa e alternativas consideradas.

User story:
${JSON.stringify(input.story, null, 2)}

Relatorio do Developer:
${JSON.stringify(input.implementation, null, 2)}

Evidencia de build:
${formatEvidence(input.build)}

Evidencia de testes:
${formatEvidence(input.tests)}
`.trim();

    const result = await this.client.generate<unknown>({
      role: "QA",
      prompt,
      outputSchema: qaOutputSchema,
      workingDirectory: input.workspacePath,
      sandbox: "read-only",
      timeoutMs: 300_000,
      model: input.assignment?.model ?? this.model,
      provider: input.assignment?.provider,
      reasoningEffort: input.assignment?.reasoningEffort
    });

    const qaResult = QaResultSchema.parse(result.data);
    validateQaCriteria(input.story, qaResult);

    return {
      ...qaResult,
      storyId: input.story.id
    };
  }
}

function failedAutomationResult(input: QaInput): QaResult {
  const evidence = automationFailureEvidence(input);

  return {
    storyId: input.story.id,
    status: "FAIL",
    summary: "Build ou testes automatizados falharam.",
    criteria: input.story.acceptanceCriteria.map((criterion) => ({
      criterion,
      passed: false,
      evidence
    })),
    requestedChanges: [
      `Corrigir os erros de build e testes automatizados.\n\n${evidence}`
    ],
    decisions: [{
      decision: "Reprovar a story antes da análise semântica.",
      rationale: "Build e testes automatizados são pré-condições obrigatórias.",
      alternativesConsidered: ["Consultar o modelo mesmo com automação quebrada"]
    }]
  };
}

function automationFailureEvidence(input: QaInput): string {
  const failures = [input.build, input.tests].filter(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  if (failures.length === 0) {
    return "Build ou testes automatizados falharam.";
  }

  return failures.map((result) => {
    const output = [result.stderr, result.stdout]
      .filter((value) => value.trim() !== "")
      .join("\n")
      .slice(-4_000);
    const status = result.timedOut
      ? "timeout"
      : `exit code ${result.exitCode ?? "unknown"}`;

    return output === ""
      ? `${result.command} falhou com ${status}.`
      : `${result.command} falhou com ${status}:\n${output}`;
  }).join("\n\n");
}

function formatEvidence(evidence: ExecutionEvidence): string {
  return JSON.stringify({
    command: evidence.command,
    exitCode: evidence.exitCode,
    timedOut: evidence.timedOut,
    durationMs: evidence.durationMs,
    stdout: evidence.stdout.slice(0, 4_000),
    stderr: evidence.stderr.slice(0, 4_000)
  }, null, 2);
}

function validateQaCriteria(
  story: UserStory,
  result: QaResult
): void {
  if (result.criteria.length !== story.acceptanceCriteria.length) {
    throw new Error("QA must evaluate every acceptance criterion exactly once");
  }

  story.acceptanceCriteria.forEach((criterion, index) => {
    if (result.criteria[index]?.criterion !== criterion) {
      throw new Error("QA criteria must match the story acceptance criteria");
    }
  });

  const allPassed = result.criteria.every((criterion) => criterion.passed);

  if ((result.status === "PASS") !== allPassed) {
    throw new Error("QA status is inconsistent with criterion results");
  }

  if (
    (result.status === "PASS" && result.requestedChanges.length > 0) ||
    (result.status === "FAIL" && result.requestedChanges.length === 0)
  ) {
    throw new Error("QA requested changes are inconsistent with status");
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
      status: "IMPLEMENTED",
      decisions: [{
        decision: isCorrection
          ? "Aplicar as mudanças solicitadas pelo QA."
          : "Implementar a story no módulo correspondente.",
        rationale: "O fluxo simulado precisa registrar uma decisão auditável.",
        alternativesConsidered: []
      }]
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
        ],
        decisions: [{
          decision: "Reprovar devido à automação quebrada.",
          rationale: "Não há evidência executável suficiente para aprovação.",
          alternativesConsidered: []
        }]
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
        ],
        decisions: [{
          decision: "Reprovar a primeira tentativa.",
          rationale: "O primeiro critério ainda não possui evidência.",
          alternativesConsidered: ["Aprovar com ressalvas"]
        }]
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
      requestedChanges: [],
      decisions: [{
        decision: "Aprovar a story.",
        rationale: "Todos os critérios possuem evidência positiva.",
        alternativesConsidered: []
      }]
    };
  }
}
