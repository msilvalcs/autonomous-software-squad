# ADR-002: Skills opcionais e controladas por persona

## Status

Aceito e aplicado em conjunto mínimo.

## Contexto

Skills podem adicionar workflows reutilizáveis, mas também ocupam contexto, executam scripts e podem conflitar com os limites de uma persona. O repositório `mattpocock/skills` oferece skills compatíveis com Codex e licença MIT, porém é uma dependência externa mantida fora do projeto.

## Decisão

Não instalar o catálogo completo. Avaliar, fixar uma revisão e versionar somente skills aprovadas em `.agents/skills`.

Fluxo permitido:

1. PO usa `backlog-decomposition`, uma skill local sem scripts, para estruturar stories sem alterar código.
2. Developer pode usar `tdd`, `diagnosing-bugs` e `codebase-design` dentro do workspace isolado.
3. QA pode usar `diagnosing-bugs` em modo somente leitura.
4. Skills que fazem commit, push, publicação em issue tracker, deploy ou escrita fora do workspace exigem autorização separada e não entram no fluxo autônomo padrão.
5. Toda ativação de skill deve gerar decisão auditável com nome, objetivo e resultado.

As três skills externas foram fixadas no commit
`9c9f36ccd3995266cd675468af71639c8dde1ec5` de `mattpocock/skills`. A licença
e a atribuição estão em `.agents/skills/THIRD_PARTY_NOTICES.md`.

## Avaliação realizada

| Skill | Decisão | Motivo |
|---|---|---|
| `tdd` | Aprovada para Developer | Orienta testes por comportamento e não amplia permissões. |
| `diagnosing-bugs` | Aprovada para Developer e QA | Prioriza reprodução e evidência; o QA permanece somente leitura. |
| `codebase-design` | Aprovada para Developer | Ajuda a avaliar coesão antes de abstrações; `DESIGN-IT-TWICE` fica vedado por exigir delegação paralela. |
| `domain-modeling` | Rejeitada no fluxo automático | Pressupõe criação de documentos de contexto e ADRs, incompatível com o PO somente leitura. |
| `to-tickets` | Rejeitada no fluxo automático | Pressupõe configuração interativa e publicação em tracker. |
| `code-review` | Rejeitada no fluxo automático | Pressupõe agentes paralelos e um tracker externo. |

Para preencher a lacuna do PO, o projeto mantém `backlog-decomposition`, skill
curta e sem recursos executáveis. Instruções interativas presentes nas skills
externas não interrompem uma execução: a persona escolhe a opção conservadora,
respeita seu sandbox e registra a decisão.

Antes de iniciar uma execução, o Workspace Manager copia as skills aprovadas
para `.agents/skills` no workspace gerado. Isso torna as instruções detectáveis
por Developer e QA sem ampliar o sandbox para a raiz do repositório. A origem é
validada recursivamente e qualquer link simbólico bloqueia a preparação.

## Critérios para incorporar uma skill

- licença compatível;
- `SKILL.md` revisado integralmente;
- scripts revisados e testados em sandbox;
- gatilho e limites claros;
- ausência de comandos destrutivos ou transmissão implícita de dados;
- versão ou commit de origem registrado;
- teste positivo, negativo e de conflito com a persona.

## Consequências

- Skills permanecem composáveis e auditáveis.
- Atualizações externas não entram automaticamente.
- A equipe assume a manutenção das cópias versionadas.
