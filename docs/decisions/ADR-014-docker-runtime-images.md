# ADR-014 - Imagens Docker por perfil de runtime

## Status

Aceito

## Contexto

Uma única imagem Node.js não executa de forma confiável projetos Python, Go,
JVM, .NET ou Rust. Usar essa imagem como fallback silencioso produz falhas
tardias e contradiz o isolamento agnóstico definido no ADR-012.

## Decisão

O Docker Runner mantém uma imagem base Node.js para o fluxo legado e aceita
imagens diferenciais declarando todas as linguagens que suportam. Antes de
preparar a execução, ele seleciona somente uma imagem que cubra integralmente o
perfil detectado. Se nenhuma imagem for compatível, a criação do ambiente falha
de forma explícita e retomável, sem executar comandos na imagem errada.

As primeiras imagens diferenciais adicionam Python com pytest e Go sobre a
base endurecida. A API recebe as imagens por `DOCKER_RUNNER_PYTHON_IMAGE` e
`DOCKER_RUNNER_GO_IMAGE`. JVM, .NET e Rust possuem pontos de configuração
equivalentes, mas suas imagens ainda precisam ser homologadas.

## Consequências

- a imagem selecionada e seu digest continuam registrados na auditoria;
- repositórios multi-stack exigem uma imagem que declare cobertura para todas
  as linguagens detectadas;
- não existe fallback de Docker para o host;
- novas imagens reutilizam usuário sem root, filesystem somente leitura,
  limites de recursos e política de rede da base.
