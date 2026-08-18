# ADR-008: Políticas de execução por persona

## Status

Aceita e implementada.

## Contexto

PO, Developer, QA e Runner já operavam com permissões diferentes, mas essas
regras estavam distribuídas entre prompts, opções do Codex CLI e argumentos do
Docker. O Orquestrador não possuía um contrato único para registrar qual
política estava ativa em cada run.

Mover as personas para containers também introduz uma fronteira de
autenticação. A documentação oficial do Codex informa que automações devem usar
API key ou access token próprio e que `~/.codex/auth.json` contém tokens e deve
ser tratado como senha. Por isso, a sessão pessoal do host não será copiada nem
montada em containers.

Referência: [Autenticação do Codex](https://learn.chatgpt.com/docs/auth).

## Decisão

Cada run persiste e audita quatro políticas de execução:

| Persona | Runtime atual | Workspace | Rede | Credencial | Timeout |
| --- | --- | --- | --- | --- | --- |
| PO | Codex no host | repositório somente leitura | somente provider | sessão do host | 300 s |
| Developer | Codex no host | workspace da run com escrita | somente provider | sessão do host | 600 s |
| QA | Codex no host | workspace da run somente leitura | somente provider | sessão do host | 300 s |
| Runner Docker | container por run | workspace da run com escrita | somente instalação | nenhuma | 180 s |

- O `CodexClient` associa cada persona a um sandbox obrigatório. PO e QA não
  podem solicitar `workspace-write`, e Developer não pode trocar a política
  declarada por outra durante a chamada.
- O Runner aceita somente `npm install`, `npm run build`, `npm test` e
  `npm run typecheck`.
- O Runner local remove variáveis conhecidas de credenciais de LLM e substitui
  `HOME` e `XDG_CONFIG_HOME` antes de iniciar `npm`.
- O Runner Docker recebe somente variáveis operacionais explícitas, não usa
  modo privilegiado, não monta o Docker socket e aplica limites de 1 CPU, 1 GiB
  de memória e 256 PIDs por padrão.
- O evento `EXECUTION_POLICIES_DECIDED` registra a matriz completa na timeline
  antes do início dos agentes.
- A imagem e os manifests nunca armazenam tokens.

## Autenticação para containers de persona

A evolução para executar o próprio Codex dentro de um container será opt-in e
aceitará apenas uma credencial efêmera fornecida em runtime:

- `OPENAI_API_KEY` para automação programática com cobrança da API; ou
- `CODEX_ACCESS_TOKEN` em ambientes ChatGPT Enterprise autorizados.

O segredo deverá entrar por um mecanismo de secrets do runtime, ser limitado à
persona que chama o provider e ser removido junto com o ambiente. O arquivo
`~/.codex/auth.json` do usuário não é uma entrada válida.

## Alternativas consideradas

- Montar `~/.codex` no container: rejeitada porque expõe credenciais e
  configuração pessoal além da necessidade da run.
- Copiar `auth.json` para a imagem: rejeitada porque persiste tokens em layers e
  viola a rotação segura.
- Declarar políticas apenas nos prompts: rejeitada porque prompts não impedem
  escalada de sandbox nem produzem uma garantia verificável.
- Bloquear toda rede do Runner desde o início: rejeitada porque `npm install`
  precisa do registry. A rede é removida antes de build e testes.

## Consequências

- Cada decisão de privilégio passa a fazer parte do estado e da auditoria.
- Testes cobrem escalada de sandbox, path traversal, comandos fora da allowlist
  e vazamento de credencial para o Runner local.
- O modo Docker possui os controles fortes de recursos e rede. O modo local
  continua adequado para desenvolvimento, mas não oferece isolamento de
  filesystem equivalente ao container.
- PO, Developer e QA continuam no host nesta entrega. A política e a fronteira
  de credenciais deixam preparada a etapa de containers diferenciados.
