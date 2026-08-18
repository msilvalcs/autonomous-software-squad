# ADR-002: Skills opcionais e controladas por persona

## Status

Aceito para adoção gradual.

## Contexto

Skills podem adicionar workflows reutilizáveis, mas também ocupam contexto, executam scripts e podem conflitar com os limites de uma persona. O repositório `mattpocock/skills` oferece skills compatíveis com Codex e licença MIT, porém é uma dependência externa mantida fora do projeto.

## Decisão

Não instalar o catálogo completo. Avaliar, fixar uma revisão e versionar somente skills aprovadas em `.agents/skills`.

Fluxo permitido:

1. PO pode usar `domain-modeling` e `to-tickets` para estruturar domínio e stories.
2. Developer pode usar `tdd`, `diagnosing-bugs` e `codebase-design` dentro do workspace isolado.
3. QA pode usar `code-review` e `diagnosing-bugs` em modo somente leitura.
4. Skills que fazem commit, push, publicação em issue tracker, deploy ou escrita fora do workspace exigem autorização separada e não entram no fluxo autônomo padrão.
5. Toda ativação de skill deve gerar decisão auditável com nome, objetivo e resultado.

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
