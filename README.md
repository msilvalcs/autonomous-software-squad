# Autonomous Software Squad

Sistema multiagente que transforma um briefing de cliente em backlog, implementação, validação e aplicação web, mantendo a comunicação entre os agentes visível e auditável.

O projeto foi concebido para a **Trilha B — Squad Autônomo de Agentes** do Hackathon Reply. O objetivo não é apresentar apenas três chats independentes, mas um fluxo coordenado no qual Product Owner, Developer e Quality Assurance possuem responsabilidades específicas e são controlados por uma máquina de estados.

## Estado atual

| Componente | Estado | Implementação atual |
|---|---|---|
| Dashboard | Funcional | React, TypeScript e SSE |
| API | Funcional | Fastify |
| Orquestrador | Funcional | Máquina de estados determinística |
| Product Owner | Integrado com IA | Codex CLI autenticado pelo ChatGPT |
| Developer | Integrado com IA | Codex CLI com escrita restrita ao workspace da execução |
| QA | Integrado com IA | Codex CLI em modo somente leitura e evidências por critério |
| Build e testes | Reais | Executados pelo Local Runner |
| Auditoria | Funcional | `state.json` e `events.jsonl` |
| Roteamento de modelos | Funcional | Complexidade, provider, modelo e reasoning por persona |
| Workspace isolado | Funcional | Uma cópia do template por execução |
| Entrega do artefato | Funcional | Preview isolado, resumo e download ZIP |
| Integração contínua | Funcional | Typecheck, testes e build no GitHub Actions |
| Docker Runner | Planejado | Diferencial posterior ao MVP |

> PO, Developer e QA podem operar com Codex. O Developer altera somente a cópia isolada da aplicação, enquanto o QA inspeciona o resultado em modo somente leitura. Os mocks permanecem intencionalmente disponíveis como fallback de demonstração.

## Fluxo principal

```mermaid
flowchart TD
    B["Briefing do cliente"] --> API["API Fastify"]
    API --> O["Orchestrator"]
    O --> PO["PO Agent"]
    PO --> S["User stories"]
    S --> DEV["Developer Agent"]
    DEV --> R["Local Runner"]
    R --> QA["QA Agent"]
    QA -->|FAIL| DEV
    QA -->|PASS| N["Próxima story"]
    N --> D["Execução concluída"]
    O --> E["Event Store"]
    E --> UI["Dashboard em tempo real"]
```

## Agentes

Cada agente carrega sua persona versionada em `prompts/personas`. As saídas
incluem uma lista estruturada de decisões com justificativa e alternativas
consideradas. O Orquestrador persiste essas decisões na auditoria.

### Product Owner

- interpreta o briefing;
- cria de uma a seis user stories;
- ordena as stories por prioridade;
- define critérios de aceitação objetivos;
- devolve JSON validado por schema;
- não altera arquivos do projeto.

### Developer

- recebe uma story e seus critérios;
- recebe o último relatório do QA quando há reprovação;
- implementa ou corrige a funcionalidade no workspace da execução;
- informa arquivos alterados e comandos necessários.

Quando `LLM_PROVIDER=codex`, esse agente usa o Codex com sandbox
`workspace-write`, limitado à cópia da execução. Sua saída é validada por
schema e caminhos absolutos ou contendo `..` são rejeitados. O resumo, os
arquivos alterados e os comandos solicitados ficam registrados na auditoria.

### Quality Assurance

- recebe a story e o resultado do Developer;
- analisa evidências reais de build e testes;
- verifica os critérios de aceitação;
- retorna `PASS` ou `FAIL`;
- informa as correções necessárias.

Quando `LLM_PROVIDER=codex`, o QA inspeciona o workspace em sandbox
`read-only` e devolve uma evidência para cada critério de aceitação. Build ou
testes quebrados causam reprovação determinística sem consultar o modelo. O
resultado só pode ser `PASS` quando todos os critérios passam, e o relatório
completo fica registrado na auditoria.

## Máquina de estados

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PLANNING
    PLANNING --> DEVELOPING
    DEVELOPING --> TESTING
    TESTING --> DEVELOPING: FAIL e tentativas restantes
    TESTING --> COMPLETED: todas aprovadas
    TESTING --> BLOCKED: limite atingido
    PLANNING --> FAILED: erro inesperado
    DEVELOPING --> FAILED: erro inesperado
    COMPLETED --> [*]
```

O orquestrador, e não outro modelo de linguagem, decide as transições mecânicas. Isso torna o fluxo previsível, testável e auditável.

## Roteamento por complexidade

Antes do planejamento, o Orquestrador classifica o briefing como `LOW`,
`MEDIUM` ou `HIGH` usando sinais determinísticos e auditáveis. Em seguida,
seleciona provider, modelo e reasoning effort para PO, Developer e QA.

Defaults com o provider Codex:

| Complexidade | PO | Developer | QA |
|---|---|---|---|
| LOW | Luna, low | Luna, low | Luna, low |
| MEDIUM | Terra, medium | Luna, medium | Terra, high |
| HIGH | Sol, high | Sol, high | Sol, xhigh |

O evento `MODEL_ROUTING_DECIDED` registra a classificação, todas as rotas e a
justificativa. Consulte `docs/decisions/ADR-001-model-routing.md`.

## Arquitetura do repositório

```text
autonomous-software-squad/
├── apps/
│   ├── api/                 # API Fastify e composição das dependências
│   └── dashboard/           # Interface React e timeline SSE
├── packages/
│   ├── agents/              # Contratos e agentes mock/Codex
│   ├── codex-client/        # Adapter para codex exec
│   ├── event-store/         # Estado JSON e eventos JSONL
│   ├── orchestrator/        # Máquina de estados
│   ├── runner/              # LocalRunner e WorkspaceManager
│   └── schemas/             # Contratos compartilhados com Zod
├── templates/
│   └── react-task-app/      # Base copiada em cada execução
├── generated-projects/      # Workspaces descartáveis gerados
├── data/runs/               # Estados e eventos auditáveis
├── prompts/                 # Prompts especializados
├── docs/                    # Arquitetura e roteiro da demonstração
├── AGENTS.md                # Regras para agentes que editam o repositório
├── .env.example
└── package.json
```

## Tecnologias

- Node.js e TypeScript;
- npm Workspaces;
- React e Vite;
- Fastify;
- Server-Sent Events;
- Zod e JSON Schema;
- Vitest;
- Codex CLI;
- JSONL para auditoria;
- WSL2 no ambiente de desenvolvimento.

## Pré-requisitos

- Windows 11 com WSL2 e Ubuntu, ou uma distribuição Linux;
- Node.js instalado no Linux;
- npm;
- Git;
- Codex CLI nativo do Linux/WSL;
- autenticação válida do Codex, caso `LLM_PROVIDER=codex`.

O repositório deve ficar no filesystem Linux, por exemplo:

```text
/home/<usuario>/projects/autonomous-software-squad
```

Evite executar o projeto diretamente em `/mnt/c`, pois operações intensivas de arquivos podem ficar mais lentas.

## Instalação

```bash
git clone <URL_DO_REPOSITORIO>
cd autonomous-software-squad
nvm use
npm install
cp .env.example .env
```

Para usar o Codex com o plano do ChatGPT:

```bash
codex login
codex login status
```

O arquivo `.env` deve conter:

```env
LLM_PROVIDER=codex
LLM_MODEL=
MODEL_ROUTING_CONFIG=
LLM_API_KEY=
EXECUTION_MODE=local
MAX_QA_ATTEMPTS=3
GENERATED_PROJECTS_PATH=./generated-projects
PORT=3000
```

Não versione `.env`, credenciais ou arquivos internos de autenticação do Codex.

`MODEL_ROUTING_CONFIG` aceita JSON para sobrescrever uma rota específica. Um
provider externo precisa estar previamente configurado em
`~/.codex/config.toml`. O projeto não possui providers Anthropic configurados
por padrão e não presume nomes de modelos externos.

## Execução

Em um terminal, inicie a API:

```bash
npm run dev -w @squad/api
```

Em outro terminal, inicie o dashboard:

```bash
npm run dev -w @squad/dashboard
```

Acesse:

```text
http://localhost:5173
```

Verifique a API:

```bash
curl -s http://localhost:3000/health
```

## Exemplo de briefing

```text
Crie uma aplicação web para controle de equipamentos industriais. O usuário
deve cadastrar equipamentos com nome, código patrimonial e estado operacional,
listar os registros e filtrar por estado. O código patrimonial deve ser único.
```

## Endpoints

| Método | Endpoint | Responsabilidade |
|---|---|---|
| `GET` | `/health` | Saúde da API e provedor configurado |
| `GET` | `/documentation` | Documentos permitidos para leitura no dashboard |
| `POST` | `/runs` | Criar e iniciar uma execução |
| `GET` | `/runs/:runId` | Consultar o estado atual |
| `GET` | `/runs/:runId/events` | Consultar o histórico completo |
| `GET` | `/runs/:runId/stream` | Acompanhar eventos por SSE |
| `GET` | `/runs/:runId/artifact` | Consultar manifesto e resumo da entrega |
| `GET` | `/runs/:runId/artifact/preview` | Abrir o build validado da aplicação |
| `GET` | `/runs/:runId/artifact/download` | Baixar o projeto em ZIP |

O endpoint de saúde também informa `llmModel`. Depois que uma execução começa,
o dashboard exibe em cada cartão o provider, modelo e reasoning effort
efetivamente selecionados pelo Orquestrador.

O dashboard também oferece filtros por ator e texto na timeline. A seção de
documentação permite consultar regras do projeto, ADRs e personas sem conceder
acesso arbitrário ao filesystem: a API publica somente uma allowlist fixa de
arquivos versionados.

Quando a execução termina com sucesso, a seção de entrega mostra stories
aprovadas, decisões, eventos, duração e tamanho do pacote. O preview usa apenas
o conteúdo de `dist` e o download exclui `.git` e `node_modules`. Caminhos e
links simbólicos são validados antes de qualquer arquivo ser publicado.

## Skills

Skills externas são válidas, mas devem ser adotadas de forma gradual. O fluxo
prevê skills específicas por persona, sem instalar catálogos completos:

- PO: modelagem de domínio e decomposição de tickets;
- Developer: TDD, diagnóstico e design de código;
- QA: code review e diagnóstico em modo somente leitura.

Cada skill precisa de revisão de licença, `SKILL.md`, scripts, permissões e
gatilhos antes de ser versionada em `.agents/skills`. Consulte
`docs/decisions/ADR-002-agent-skills.md`.

## Auditabilidade

Cada execução possui uma pasta própria:

```text
data/runs/<run-id>/
├── state.json
└── events.jsonl
```

Um evento registra, entre outros campos:

```json
{
  "eventId": "evt-...",
  "runId": "run-...",
  "timestamp": "2026-08-15T00:00:00.000Z",
  "actor": "QA",
  "action": "STORY_REJECTED",
  "message": "US-001 foi rejeitada e retornará ao Developer.",
  "storyId": "US-001",
  "metadata": {
    "attempt": 1
  }
}
```

São registrados eventos de planejamento, implementação, instalação, build, testes, aprovação, reprovação, tentativas e encerramento.

## Execução controlada

O `LocalRunner`:

- trabalha somente dentro de `generated-projects`;
- não usa texto livre diretamente como comando de shell;
- aceita uma lista restrita de comandos npm;
- captura `stdout`, `stderr`, exit code e duração;
- aplica timeout;
- envia as evidências ao QA.

Comandos permitidos no MVP:

```text
npm install
npm run build
npm test
npm run typecheck
```

O Docker não é requisito do produto atual. Um `DockerRunner` poderá ser criado posteriormente atrás da mesma abstração, sem reconstruir o orquestrador.

## Qualidade

Antes de concluir uma alteração, execute:

```bash
npm run typecheck
npm run build
npm test
```

O workflow `.github/workflows/ci.yml` executa os mesmos comandos em Ubuntu para
pushes na `main`, pull requests e acionamentos manuais. O CI usa o provider
mock e não depende de credenciais de LLM. Consulte
`docs/decisions/ADR-004-continuous-integration.md`.

Os comandos raiz compilam os pacotes internos em ordem de dependência antes de
validar as aplicações. Portanto, também funcionam em um clone limpo, sem
arquivos `dist` preexistentes.

Os testes cobrem atualmente:

- validação dos schemas;
- persistência e ordem dos eventos;
- proteção contra `runId` inseguro;
- comportamento dos agentes simulados;
- retorno `QA FAIL -> Developer`;
- conclusão e limite de tentativas;
- allowlist do Runner;
- proteção do diretório de execução;
- preparação dos workspaces.
- proteção de caminhos, links simbólicos e arquivos do artefato.

## Limitações conhecidas

- o modo mock do Developer não modifica o produto conforme cada briefing;
- o template inicial é uma aplicação React de tarefas;
- a execução é sequencial;
- o Local Runner oferece controle, mas não isolamento forte como um container;
- pacotes internos precisam ser recompilados quando seus arquivos `src` mudam;
- JSONL é adequado ao MVP, mas não substitui um banco transacional em escala;
- interrupção e retomada automática de uma execução ainda não foram implementadas.

## Roadmap

1. transmitir logs do Codex para a timeline;
2. calibrar o roteamento com métricas de qualidade, latência e consumo;
3. revisar e incorporar um conjunto mínimo de skills em `.agents/skills`;
4. melhorar o modo watch dos pacotes internos;
5. adicionar retomada de execuções interrompidas;
6. criar integração opcional para publicar stories como GitHub Issues;
7. criar `DockerRunner` opcional;
8. adicionar autenticação e persistência em banco, caso o produto evolua.

## Demonstração sugerida

1. abrir o dashboard;
2. inserir um briefing industrial;
3. mostrar o PO criando stories específicas;
4. acompanhar as transições na timeline;
5. mostrar build e testes reais;
6. mostrar uma reprovação do QA;
7. mostrar a correção automática e aprovação;
8. abrir `events.jsonl` e demonstrar a auditoria;
9. abrir o preview e baixar o ZIP do projeto;
10. explicar as limitações atuais e o próximo marco.

## Decisões principais

- TypeScript em todas as camadas reduz troca de contexto;
- máquina de estados controla o workflow de maneira determinística;
- schemas evitam comunicação interna ambígua;
- mocks permitem demonstrações sem depender de rede ou modelo;
- Codex CLI permite usar autenticação do ChatGPT no ambiente local;
- um template controlado reduz tempo, custo e variabilidade;
- JSONL simplifica auditoria no MVP;
- Docker permanece opcional até o fluxo principal estar estável.

## Licença

Defina a licença antes da publicação pública do repositório. Para um projeto aberto, MIT é uma opção simples; valide essa decisão com todos os integrantes da equipe.
