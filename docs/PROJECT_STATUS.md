# Estado do projeto e próximos passos

Atualizado em: 22 de agosto de 2026

## Resumo executivo

O Autonomous Software Squad possui um MVP funcional e alinhado à Trilha B do
Hackathon Reply. O sistema recebe um briefing, cria stories, direciona Product
Owner, Developer e QA, executa build e testes, persiste decisões e eventos e
apresenta o progresso em tempo real no dashboard.

A base publicada no GitHub está na branch
`feat-cooperative-cancellation-and-antigravity`, no commit `ee7b94e`, com as
seis issues da fase de isolamento concluídas. A branch já está sincronizada com
o remoto e o CI está verde.

O projeto está tecnicamente avançado, mas ainda não deve ser tratado como uma
entrega final. O próximo marco é obter uma nova run Codex concluída em Docker,
com preview, ZIP e evidência E2E no dashboard.

## Estado por área

| Área | Estado | Evidência atual |
|---|---|---|
| Dashboard | Funcional | Histórico, filtros da timeline, documentação, modelos por persona e ações por estado |
| API | Funcional | Fastify, SSE, histórico, retomada, documentação e artefatos |
| Orquestrador | Funcional | Máquina de estados determinística, tentativas limitadas e decisões auditáveis |
| PO, Developer e QA | Funcional com Codex e mock | Personas, schemas, políticas e roteamento por complexidade |
| Auditoria | Funcional | Estado em JSON e eventos em JSONL, incluindo decisões e alternativas |
| GitHub Issues | Funcional e opcional | Seis stories de isolamento publicadas e concluídas |
| Runner local | Funcional | Allowlist, timeout, captura de evidências e workspace controlado |
| Runner Docker | Funcional e validado | Container efêmero, usuário sem root, rede controlada, Chromium e limites de recursos |
| Entrega | Funcional para runs concluídas | Preview, manifesto e download ZIP |
| CI | Verde | Typecheck, testes, build da imagem Docker e integração Playwright |
| MicroVM | Avaliada, não operacional | Gate fail-closed e critérios de adoção documentados no ADR-010 |

## O que já foi concluído

- arquitetura monorepo em TypeScript com contratos compartilhados;
- fluxo PO -> Developer -> Runner -> QA controlado pelo Orquestrador;
- roteamento de provider, modelo e esforço conforme a complexidade;
- personas separadas para PO, Developer e QA;
- skills revisadas, versionadas e restritas por persona;
- registro auditável de decisões, justificativas e alternativas;
- dashboard em tempo real com SSE, histórico e filtros da timeline;
- consulta da documentação pelo dashboard usando uma allowlist da API;
- publicação opcional das stories como GitHub Issues;
- CI sem dependência de credenciais de LLM;
- Docker Runner com ambiente efêmero por run;
- políticas de execução por etapa e proveniência do ambiente;
- avaliação de Firecracker, Kata Containers e Docker endurecido;
- seis issues do milestone de isolamento fechadas no GitHub.

## Mudanças recentes publicadas

O commit `d7d5fe6`, seguido pelo ajuste de workflow `ee7b94e`, publicou:

- Playwright no template React, com projetos de referência para 1280 x 800 e
  375 x 812;
- Chromium Headless Shell provisionado no build da imagem Docker;
- smoke E2E para visibilidade, erros de página e rolagem horizontal;
- `npm run test:e2e` na allowlist do Runner;
- validação do template com navegador no job Docker do CI;
- regra centralizada de retomabilidade na API;
- campos `active` e `canResume` nos contratos consumidos pelo dashboard;
- botão contextual com `Executando...`, `Retomar execução`, `Ver resultado` e
  estados terminais sem ação inválida;
- nova inscrição SSE quando uma run é retomada;
- ADR-011 com as decisões de E2E, retomada e ações por estado.

Essas mudanças passaram localmente por typecheck, build e 78 testes, com um
teste Docker local condicional. No GitHub Actions, a execução
`32546513744` passou nos jobs de verificação e de imagem Docker, incluindo a
integração Developer -> Runner Docker -> Playwright.

## Última execução representativa

Run: `run-58f9c02c-1ee8-4141-988b-ad45c2dab731`

| Campo | Resultado |
|---|---|
| Briefing | Painel de monitoramento industrial |
| Complexidade | `HIGH` |
| Estado final | `FAILED` |
| Stories aprovadas | 5 de 6 |
| Story pendente | `US-006 - Usar o painel em telas menores` |
| Tentativas | 3 de 3 |
| Ativa | Não |
| Retomável | Não |

O produto gerado implementou cadastro de máquinas, alteração de estado,
registro e histórico de ocorrências, atualização automática por falha ou
manutenção e indicadores consolidados. A US-006 não foi aprovada porque a
terceira tentativa criou testes E2E mais completos, mas o Developer não
encontrou o executável Chromium no ambiente em que validou seu próprio trabalho.

O limite de tentativas foi atingido. Por segurança, essa run não pode ser
retomada novamente. O workspace e a auditoria permanecem disponíveis para
diagnóstico, mas a comprovação final deve ocorrer em uma nova run.

Uma execução posterior (
un-bb023a78-3d96-4697-ab9a-a737ad2ebafe) revelou
que o Codex Developer pode exceder o timeout de 10 minutos ao processar uma
correção de QA. O evento foi registrado como RUN_FAILED, mas versões
anteriores não marcavam esse tipo de falha como retomável. O Orquestrador agora
classifica novos timeouts como CODEX_TIMEOUT com
etryable: true, permitindo
retomada enquanto ainda houver tentativa disponível. O run histórico não foi
alterado, preservando a auditoria; ele deve ser substituído por uma nova run.

Como validação do caminho mock após a correção, a run
`run-b002f0db-9b87-442e-a5fa-238b8e983e11` terminou em `COMPLETED`, com duas
stories aprovadas na segunda tentativa. Isso confirma o ciclo simulado
QA -> Developer -> Runner sem depender de Chromium no modo local.

Como validação adicional do ambiente isolado, a run
`run-2d1163f7-481b-48e1-a7a6-cadd40fe57ff` terminou em `COMPLETED` usando
`EXECUTION_MODE=docker`. As duas stories foram aprovadas na segunda tentativa,
e a auditoria registrou `EXECUTION_ENVIRONMENT_STARTED` e
`EXECUTION_ENVIRONMENT_DISPOSED` para o container efêmero.

## Diagnóstico do bloqueio atual

Há uma diferença entre dois contextos de execução:

1. O Runner Docker consegue receber uma imagem com Chromium provisionado.
2. O Codex Developer ainda executa no host e pode chamar `npm test` antes de
   devolver sua saída estruturada.

Assim, um teste E2E solicitado pelo Developer pode falhar no host por ausência
do navegador antes de o Orquestrador encaminhar o mesmo comando ao Runner
Docker. O problema atual é de fronteira e contrato entre Developer e Runner,
não uma evidência de falha das cinco funcionalidades já aprovadas.

Esse bloqueio foi corrigido no fluxo atual. O LocalRunner executa os testes
unitários sem exigir Chromium; o DockerRunner define `RUN_E2E=true` e executa
também os testes Playwright dentro da imagem provisionada.

## O que precisa ser feito

### P0 - Fechar a entrega atual

- [x] Definir que comandos dependentes do ambiente, especialmente E2E, são
  validados pelo Runner e não usados pelo Developer como condição incorreta de
  falha no host.
- [x] Garantir que `PLAYWRIGHT_BROWSERS_PATH` e o executável Chromium estejam
  disponíveis no ambiente efetivo que executa `npm test`.
- [x] Adicionar um teste de integração que reproduza Developer -> Runner Docker
  -> Playwright, sem instalação dinâmica durante a run.
- [x] Revisar o diff local completo e corrigir divergências entre código,
  `AGENTS.md` e README.
- [x] Executar novamente `npm run typecheck`, `npm run build` e `npm test`.
- [x] Criar commit sem credenciais, fazer push e acompanhar o GitHub Actions até
  a conclusão.
- [ ] Iniciar uma run nova com o briefing industrial e obter 6 de 6 stories
  aprovadas, preview e ZIP.

### P1 - Preparar a demonstração do hackathon

- [ ] Criar um roteiro curto com briefing, roteamento, execução, reprovação,
  correção, aprovação, auditoria e artefato final.
- [ ] Manter uma run concluída e uma run reprovada no histórico para demonstrar
  os dois caminhos.
- [ ] Exibir claramente qual provider, modelo e reasoning effort atuou em cada
  persona.
- [ ] Demonstrar a publicação das stories no GitHub e a rastreabilidade entre
  issue, evento e entrega.
- [ ] Registrar métricas simples de duração, número de tentativas e resultado
  por story.
- [ ] Confirmar o dashboard em 1280 px e 375 px no navegador.

### P2 - Evolução após a entrega

- [ ] Transmitir logs do Codex progressivamente para a timeline.
- [x] Adicionar cancelamento cooperativo de runs no Orquestrador, Codex Client,
  API e dashboard. Ainda falta interromper comandos do Runner no meio da
  execução.
- [ ] Recuperar runs não terminais automaticamente no startup.
- [ ] Melhorar o modo watch dos pacotes internos.
- [ ] Isolar o Developer em container próprio, mantendo PO e QA com políticas
  específicas.
- [ ] Calibrar modelos por qualidade, latência e consumo real.
- [ ] Medir o efeito de cada skill na qualidade e no uso de contexto.
- [ ] Adicionar autenticação e banco transacional somente se o produto sair do
  escopo de demonstração.

## Riscos e limitações conhecidas

- o Codex Developer ainda é executado no host, embora os comandos npm possam
  ser isolados pelo Docker Runner;
- a execução de stories é sequencial;
- o lock de execução ativa pertence ao processo da API;
- JSONL é adequado ao MVP, mas não a concorrência distribuída;
- o cancelamento cooperativo já interrompe o Codex e os próximos estágios, mas
  um comando npm já iniciado pelo Runner só é observado após seu retorno;
- não existe retomada automática após reinício da API;
- Firecracker exige Linux/KVM e ainda não possui ciclo de vida homologado;
- uma run que atinge `maxAttempts` não pode ser retomada pela interface.

## Critério do próximo marco

O marco seguinte estará concluído quando todos os itens abaixo forem verdadeiros:

- [x] mudanças versionadas e publicadas na branch de trabalho;
- [x] GitHub Actions aprovado, incluindo o job Docker com Playwright;
- [ ] nova run Codex termina em `COMPLETED`;
- [ ] todas as stories ficam em `PASSED`;
- [ ] preview e ZIP são gerados;
- [ ] timeline contém decisões, evidências E2E e proveniência do ambiente;
- [ ] dashboard mostra corretamente ação e progresso em `RUNNING`, `FAILED` e
  `COMPLETED`.

## Referências

- [README](../README.md)
- [Regras dos agentes](../AGENTS.md)
- [Validação industrial](demo/industrial-validation.md)
- [ADR-005: histórico e retomada](decisions/ADR-005-run-history-and-recovery.md)
- [ADR-007: isolamento de execução](decisions/ADR-007-execution-isolation.md)
- [ADR-009: observabilidade do ambiente](decisions/ADR-009-environment-observability.md)
- [ADR-010: microVM para alto risco](decisions/ADR-010-high-risk-microvm.md)
- [ADR-011: E2E, retomada e ações por estado](decisions/ADR-011-e2e-recovery-actions.md)
- [Issues do projeto no GitHub](https://github.com/msilvalcs/autonomous-software-squad/issues)

## Como manter este documento

Atualize este arquivo ao concluir um marco, alterar um risco relevante ou obter
uma nova run representativa. Separe sempre o estado publicado no GitHub das
mudanças locais ainda não versionadas e use os arquivos de auditoria como fonte
de verdade para resultados de execução.
