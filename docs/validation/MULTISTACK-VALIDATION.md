# Validação multi-stack

O conjunto `packages/runner/src/multistack.integration.test.ts` valida o caminho completo de um repositório local: `WorkspaceManager` copia a origem para um workspace isolado, `ProjectAnalyzer` detecta a stack e `LocalRunner` executa apenas os comandos estruturados aprovados.

As fixtures versionadas em `test-fixtures/repositories` são mínimas e não possuem dependências vendorizadas nem artefatos de build. Node é obrigatório para a suíte. Os cenários Python e Go são pulados somente quando o runtime e, no caso de Python, o `pytest` não estão disponíveis no ambiente.

O teste também confirma que a origem permanece sem alterações, que o artefato é produzido apenas no workspace e que credenciais conhecidas do host são removidas do ambiente do runner.

Execute com `npm run test -w @squad/runner`. Em ambientes sem Node, a validação não é considerada verde e deve ser repetida em CI ou numa máquina com o runtime configurado.
