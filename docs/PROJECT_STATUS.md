# Estado do projeto e próximos passos

Atualizado em: 18 de agosto de 2026

## Resumo executivo

O Autonomous Software Squad possui um MVP funcional e alinhado à Trilha B do
Hackathon Reply. O sistema recebe um briefing, cria stories, direciona Product
Owner, Developer e QA, executa build e testes, persiste decisões e eventos e
apresenta o progresso em tempo real no dashboard.

A base publicada no GitHub está em `main`, no commit `a64989f`, com as seis
issues da fase de isolamento concluídas. Existe, porém, um conjunto de mudanças
locais ainda não publicado. Essas mudanças adicionam testes E2E com Playwright,
melhoram a retomada de runs e tornam o botão principal do dashboard contextual
ao estado da execução.

O projeto está tecnicamente avançado, mas ainda não deve ser tratado como uma
entrega final. O próximo marco é fechar o fluxo E2E em uma execução nova,
versionar as mudanças locais e confirmar o pipeline no GitHub Actions.

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
| Runner Docker | Funcional, em consolidação | Container efêmero, usuário sem root, rede controlada e limites de recursos |
| Entrega | Funcional para runs concluídas | Preview, manifesto e download ZIP |
| CI | Funcional na versão publicada | Typecheck, testes e build; validação E2E Docker está alterada apenas localmente |
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

## Mudanças locais ainda não publicadas

O working tree possui alterações não commitadas sobre `a64989f`. O conjunto
inclui:

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

Essas mudanças passaram localmente por lint, typecheck, build e 64 testes do
monorepo. O teste de integração Developer -> Runner Docker -> Playwright também
foi aprovado com dois projetos de navegador e sem rede durante a execução. O
conjunto ainda precisa ser commitado, enviado ao GitHub e confirmado no CI
remoto.

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

## Diagnóstico do bloqueio atual

Há uma diferença entre dois contextos de execução:

1. O Runner Docker consegue receber uma imagem com Chromium provisionado.
2. O Codex Developer ainda executa no host e pode chamar `npm test` antes de
   devolver sua saída estruturada.

Assim, um teste E2E solicitado pelo Developer pode falhar no host por ausência
do navegador antes de o Orquestrador encaminhar o mesmo comando ao Runner
Docker. O problema atual é de fronteira e contrato entre Developer e Runner,
não uma evidência de falha das cinco funcionalidades já aprovadas.

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
- [ ] Criar commit sem credenciais, fazer push e acompanhar o GitHub Actions até
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
- [ ] Adicionar cancelamento cooperativo de runs.
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
- não existe cancelamento imediato de um agente em processamento;
- não existe retomada automática após reinício da API;
- Firecracker exige Linux/KVM e ainda não possui ciclo de vida homologado;
- uma run que atinge `maxAttempts` não pode ser retomada pela interface.

## Critério do próximo marco

O marco seguinte estará concluído quando todos os itens abaixo forem verdadeiros:

- [ ] mudanças locais versionadas e publicadas;
- [ ] GitHub Actions aprovado, incluindo o job Docker com Playwright;
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
