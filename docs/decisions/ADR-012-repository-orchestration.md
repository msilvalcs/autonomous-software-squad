# ADR-012: Orquestração agnóstica de repositórios

## Status

Aceito

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
- API e dashboard ainda precisam consumir os novos contratos em incrementos
  posteriores.
- A detecção de linguagem é conservadora, somente leitura e baseada em arquivos
  conhecidos; projetos desconhecidos produzem um perfil vazio válido.

O primeiro incremento implementa os contratos, a materialização isolada de
fontes locais e Git e o Project Analyzer somente leitura. A integração dessas
capacidades está integrada à API e ao dashboard. A criação da run executa o
diagnóstico uma única vez e mantém a origem e o perfil na auditoria.
## Estado da API estruturada do Runner

O Runner possui a API `runProjectCommand`, que valida comandos contra uma
lista de planos aprovados e executa `executable` e `args` sem shell. Ela cobre
LocalRunner e DockerRunner. O Orquestrador a utiliza apenas no modo repositório
e registra comandos ausentes como `VALIDATION_COMMAND_SKIPPED`.

### Integração de fronteira

A API usa um helper validado para normalizar
epositorySource; o dashboard usa contratos e helpers puros para manter o formulário testável sem acoplamento ao React.
