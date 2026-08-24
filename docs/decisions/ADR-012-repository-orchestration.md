# ADR-012: Orquestração agnóstica de repositórios

## Status

Proposto

## Contexto

O MVP atual cria uma cópia de um template React para cada execução. O próximo
direcionamento do produto é receber um repositório local ou Git e aplicar nele
uma tarefa solicitada, sem pressupor linguagem ou framework.

## Decisão

O domínio passará a representar a origem do repositório, o perfil detectado do
projeto, comandos estruturados e metadados do workspace por contratos
compartilhados em `packages/schemas`. Fontes locais serão copiadas para um
workspace controlado; fontes Git serão materializadas a partir de uma
referência explícita ou padrão do provedor.

Comandos serão representados por executável e argumentos separados, com
propósito, diretório, rede e timeout. Isso mantém a futura execução compatível
com a allowlist existente e evita tratar texto livre como shell.

## Consequências

- Os contratos são retrocompatíveis: os schemas existentes e o fluxo baseado em
  template continuam inalterados neste incremento.
- Analyzer, Workspace Manager, Runner, API e dashboard ainda precisam ser
  adaptados em incrementos posteriores.
- A detecção de linguagem não é inferida por este ADR; ela será uma etapa de
  análise somente leitura.
