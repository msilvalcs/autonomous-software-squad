# ADR-015 - Diff Git e aprovação explícita

## Status

Aceito

## Contexto

Uma execução autônoma não deve ser considerada entregue apenas porque PO e QA
aprovaram as stories. O usuário precisa enxergar quais arquivos mudaram antes
de aceitar o resultado aplicado ao workspace isolado.

## Decisão

Fontes locais recebem um índice Git interno no workspace após a cópia, sem
commit e sem alterar o repositório de origem. Clones Git usam seu próprio
índice. Ao terminar todas as stories, o Orquestrador coleta arquivos alterados
e um patch binário limitado a 200 KB, persiste o conjunto na run e muda o estado
para `AWAITING_APPROVAL`.

O dashboard exibe a lista de arquivos e o diff. Somente uma chamada explícita
ao endpoint de aprovação muda a run para `COMPLETED` e registra os eventos
`CHANGESET_CREATED`, `CHANGESET_APPROVED` e `RUN_COMPLETED`.

## Limites

- o Developer não pode alterar o índice, criar commits ou fazer push;
- patches maiores que 200 KB são truncados e marcados como tal;
- a aprovação conclui a entrega isolada, mas não cria branch, commit, pull
  request ou merge request no repositório remoto;
- publicação remota será um adaptador posterior e exigirá credencial e
  confirmação específicas.
