# AGENTS.md — Autonomous Software Squad

Este documento orienta qualquer agente de IA ou ferramenta automatizada que leia, analise ou modifique este repositório.

## Missão do projeto

Construir um sistema multiagente capaz de receber um briefing, criar um backlog, implementar funcionalidades, executar build e testes, validar critérios de aceitação, corrigir falhas automaticamente e entregar uma aplicação funcional com comunicação visível e auditável.

O produto deve demonstrar coordenação real entre **Product Owner**, **Developer** e **Quality Assurance**. Sessões independentes de chat não substituem o orquestrador.

## Estado atual obrigatório

Antes de modificar o projeto, considere:

- o orquestrador e a máquina de estados estão funcionais;
- o Product Owner pode operar com Codex ou mock;
- Developer e QA ainda usam mocks;
- build e testes são executados pelo Local Runner;
- eventos são persistidos em JSONL e transmitidos por SSE;
- cada execução utiliza uma cópia do template React;
- Docker não faz parte do caminho principal do MVP.

Não descreva uma funcionalidade planejada como já implementada.

## Estrutura e propriedade

| Caminho | Responsabilidade |
|---|---|
| `apps/api` | HTTP, SSE e composição das dependências |
| `apps/dashboard` | Interface, stories, agentes e timeline |
| `packages/agents` | Interfaces e implementações dos agentes |
| `packages/codex-client` | Execução estruturada do Codex CLI |
| `packages/event-store` | Persistência do estado e eventos |
| `packages/orchestrator` | Máquina de estados e fluxo autônomo |
| `packages/runner` | Execução controlada e workspaces |
| `packages/schemas` | Contratos compartilhados e validação |
| `templates` | Base imutável das aplicações geradas |
| `generated-projects` | Cópias modificáveis por execução |
| `data/runs` | Histórico auditável das execuções |
| `prompts` | Instruções versionadas dos agentes |
| `docs` | Arquitetura, decisões e demonstração |

Não transfira responsabilidades entre pacotes sem justificar a decisão arquitetural.

## Regras gerais

- Use TypeScript com modo `strict`.
- Prefira alterações pequenas, coesas e verificáveis.
- Não altere arquivos fora do repositório.
- Não modifique o template original durante uma execução.
- Não escreva diretamente em outro workspace ou em `data/runs` sem usar as abstrações existentes.
- Não introduza dependências sem necessidade e justificativa.
- Não ignore erros de TypeScript, build ou testes.
- Não desative testes para concluir uma tarefa.
- Não use `any` para contornar contratos; prefira `unknown` e validação.
- Preserve compatibilidade com Linux e WSL2.
- Não dependa de caminhos absolutos específicos de um usuário.
- Mantenha mensagens e nomes de eventos estáveis quando consumidos pelo dashboard.
- Atualize documentação quando o comportamento público mudar.

## Segurança

- Nunca registre chaves, tokens, cookies ou arquivos de autenticação.
- Nunca leia, copie ou versione credenciais do Codex.
- Não inclua `.env` em commits.
- Não use texto livre do modelo diretamente como comando de shell.
- Execute somente comandos presentes na allowlist do Runner.
- Valide que o workspace está dentro de `generated-projects`.
- Valide todos os caminhos produzidos por agentes.
- Rejeite caminhos absolutos, `..`, links simbólicos inseguros e tentativas de escapar do workspace.
- Use timeout em processos externos.
- Capture exit code, `stdout` e `stderr` sem expor segredos.
- Não execute comandos destrutivos.
- Não entregue acesso irrestrito ao host ou ao Docker socket para agentes.

## Comunicação entre agentes

Toda saída utilizada pelo sistema deve ser estruturada e validada.

### Product Owner

Entrada:

- briefing;
- restrições do produto;
- schema de backlog.

Saída:

- stories pequenas e priorizadas;
- critérios de aceitação objetivos;
- status inicial `PENDING`.

O PO não pode alterar código.

### Developer

Entrada:

- story atual;
- critérios de aceitação;
- workspace permitido;
- último resultado do QA, quando existir.

Saída:

- resumo;
- arquivos alterados;
- comandos solicitados;
- status estruturado.

O Developer só pode modificar a cópia da execução atual.

### Quality Assurance

Entrada:

- story e critérios;
- resultado do Developer;
- arquivos alterados;
- resultados reais de build e testes.

Saída:

- `PASS` ou `FAIL`;
- evidência por critério;
- mudanças solicitadas.

O QA não deve aprovar uma story apenas porque o Developer afirmou que terminou.

## Orquestração

O fluxo obrigatório é:

```text
CREATED
  -> PLANNING
  -> DEVELOPING
  -> TESTING
       -> DEVELOPING, quando QA = FAIL e ainda há tentativas
       -> BLOCKED, quando o limite é atingido
       -> próxima story, quando QA = PASS
  -> COMPLETED, quando todas as stories passam
```

Regras:

- transições mecânicas pertencem ao orquestrador;
- agentes não escolhem livremente o próximo agente;
- toda transição relevante gera um evento;
- toda mudança de estado deve ser persistida;
- tentativas devem possuir limite configurável;
- erros inesperados levam a `FAILED` e geram evidência;
- não crie loops sem condição explícita de encerramento.

## Auditabilidade

Registre, quando aplicável:

- ator;
- ação;
- mensagem;
- `runId`;
- `storyId`;
- tentativa;
- timestamp;
- duração;
- exit code;
- timeout;
- mudanças solicitadas;
- evidências relevantes.

Não registre conteúdo sensível. Limite saídas extensas antes de persistir ou transmitir.

## Codex CLI

- Use `CodexClient`; não espalhe chamadas diretas a `codex exec` pelo projeto.
- Use argumentos em array e `shell: false`.
- Feche ou ignore o `stdin` do processo para evitar espera infinita.
- Use `--output-schema` e valide novamente com Zod.
- Comece com sandbox `read-only` para PO e QA.
- Restrinja Developer ao workspace da execução.
- Aplique timeout e registre falhas de forma segura.
- Preserve a opção `LLM_PROVIDER=mock` como fallback.
- Não presuma que uma assinatura do ChatGPT equivale a uma chave da API.

## Runner

Comandos aceitos no MVP:

```text
npm install
npm run build
npm test
npm run typecheck
```

Ao adicionar um comando:

1. justifique por que é necessário;
2. represente executável e argumentos separadamente;
3. não use interpolação em shell;
4. adicione testes de permissão e rejeição;
5. mantenha timeout e captura de evidências.

## Schemas

- Contratos compartilhados pertencem a `packages/schemas`.
- Valide dados nas fronteiras do sistema.
- Não confie apenas no schema solicitado ao modelo.
- Normalize IDs e prioridades quando necessário.
- Mudanças incompatíveis exigem atualização de produtores, consumidores e testes.
- Prefira enums explícitos para estados e resultados.

## Testes obrigatórios

Uma alteração deve incluir testes quando modificar:

- schemas;
- máquina de estados;
- decisão de agentes;
- persistência;
- segurança de caminhos;
- allowlist de comandos;
- timeout ou processos filhos;
- endpoints;
- comportamento público do dashboard.

Casos críticos do orquestrador:

- briefing inválido;
- PO inválido;
- falha de instalação;
- falha de build;
- falha de testes;
- QA reprovando;
- correção recebida pelo Developer;
- aprovação;
- limite de tentativas;
- conclusão de todas as stories;
- erro inesperado auditado.

## Validação antes de concluir

Execute na raiz:

```bash
npm run typecheck
npm run build
npm test
```

Quando um pacote interno for alterado e a API estiver em modo de desenvolvimento, recompile o pacote antes de validar a API, pois os workspaces utilizam os arquivos em `dist`.

Exemplo:

```bash
npm run build -w @squad/codex-client
npm run build -w @squad/agents
npm run build -w @squad/api
```

## Definição de pronto

Uma tarefa somente está concluída quando:

1. o comportamento solicitado foi implementado;
2. os contratos continuam válidos;
3. typecheck, build e testes passam;
4. falhas relevantes aparecem na auditoria;
5. nenhuma credencial foi exposta;
6. o código gerado permanece dentro do workspace;
7. documentação foi atualizada quando necessário;
8. limitações remanescentes foram declaradas.

## Prioridades do roadmap

1. estabilizar o Product Owner real;
2. implementar Developer real com escrita limitada;
3. implementar QA real baseado em evidências;
4. externalizar prompts;
5. melhorar observabilidade e streaming;
6. permitir acesso ao artefato final;
7. melhorar o watch dos pacotes;
8. adicionar Docker Runner somente após o fluxo principal estar estável.

## Fora de escopo sem autorização explícita

- Kubernetes;
- arquitetura de microserviços;
- Docker-in-Docker;
- execução paralela de stories;
- banco distribuído;
- autenticação multiusuário;
- alteração ampla de stack;
- substituição da máquina de estados por decisões livres de LLM;
- remoção dos mocks antes de existir um fallback estável.
