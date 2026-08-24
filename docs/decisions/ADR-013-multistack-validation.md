# ADR-013 - Validação multi-stack por fixtures

## Decisão

Manter fixtures pequenas e determinísticas de Node, Python e Go dentro do repositório e validar o fluxo Workspace Manager -> Project Analyzer -> Structured LocalRunner em testes de integração.

## Motivo

Testes unitários não provam que os contratos funcionam juntos nem que uma origem local fica intacta. Fixtures versionadas evitam dependência de rede e tornam o comportamento reproduzível no CI.

## Condições

Node deve estar presente. Python e Go são cenários condicionais, com justificativa explícita no teste quando o runtime não existe. Nenhum teste executa comandos livres: os comandos vêm do perfil detectado e são verificados pela allowlist estruturada.
