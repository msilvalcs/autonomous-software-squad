# ADR-006: Publicação opcional de stories no GitHub Issues

## Status

Aceita.

## Contexto

As user stories existiam somente no estado interno do Orquestrador. Para um
fluxo de engenharia real, é útil disponibilizá-las no sistema de trabalho já
usado pela equipe, preservando critérios e rastreabilidade da execução.

## Decisão

Adicionar um publisher opcional para GitHub Issues. Quando
`GITHUB_ISSUES_ENABLED=true`, a API exige `GITHUB_REPOSITORY` no formato
`owner/name` e `GITHUB_TOKEN` em variável de ambiente.

Após o PO criar o backlog, cada story é publicada com:

- ID e título;
- descrição;
- critérios como checklist;
- prioridade e `runId`;
- marcador de rastreabilidade;
- labels `user-story` e `autonomous-squad`.

O número e a URL retornados são persistidos na própria story e exibidos no
dashboard. Stories que já possuem esse vínculo não são republicadas. Falhas
geram `STORY_PUBLICATION_FAILED`, sem registrar token e sem interromper a
entrega do software. A publicação e a persistência ocorrem story por story,
evitando perder os vínculos já criados quando uma chamada posterior falha.

## Alternativas consideradas

- Criar issues diretamente pelo PO: mistura raciocínio de produto com efeito
  externo e amplia as permissões do agente.
- Tornar a publicação obrigatória: faria a execução depender da disponibilidade
  do GitHub e de credenciais.
- Publicar somente ao final: reduz a utilidade das issues durante o fluxo e
  perde a relação imediata com o backlog aprovado.

## Consequências

- A integração permanece desligada por padrão e não requer credenciais no CI.
- O Orquestrador controla o momento da publicação; as personas não recebem o
  token.
- Labels inexistentes podem exigir preparação no repositório para aparecerem
  como esperado.
- Permissões mínimas do token e regras de retenção devem ser definidas pelo
  proprietário do repositório.
