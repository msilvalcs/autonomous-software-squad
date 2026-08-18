# ADR-005: Histórico e retomada de execuções

## Status

Aceita.

## Contexto

O dashboard perdia a execução selecionada ao recarregar a página e não havia
uma forma suportada de continuar um estado não terminal após a interrupção do
processo da API. Além disso, a API aceitava novas execuções concorrentes mesmo
que o Runner e o MVP tenham sido projetados para processamento sequencial.

## Decisão

- O Event Store lista estados persistidos em ordem de atualização.
- `GET /runs` publica um resumo seguro do histórico, sem o caminho interno do
  workspace.
- O dashboard persiste somente o `runId` selecionado no `localStorage` e
  recarrega estado e eventos pela API.
- `POST /runs/:runId/resume` continua stories não aprovadas, preserva a
  tentativa registrada e recupera o último relatório de reprovação do QA.
- A retomada consulta os eventos e executa `npm install` quando ainda não há um
  marco `DEPENDENCY_INSTALL_COMPLETED`; uma instalação já concluída não é
  repetida.
- A API mantém no processo uma execução ativa por vez e rejeita concorrência
  com HTTP 409.

Uma retomada registra `RUN_RESUMED` e `STORY_RESUMED`, tornando explícito que o
fluxo não começou do zero.

## Alternativas consideradas

- Persistir todo o estado no navegador: duplicaria a fonte de verdade e
  permitiria divergência em relação ao Event Store.
- Reiniciar sempre do planejamento: repetiria trabalho aprovado e perderia a
  continuidade auditável.
- Permitir concorrência sem fila: poderia disputar CPU, porta e workspace em
  uma demonstração local.
- Adotar banco e fila agora: solução mais ampla que a necessidade do MVP.

## Consequências

- Recarregar o dashboard não perde o contexto selecionado.
- Uma interrupção entre etapas pode ser retomada sem repetir stories aprovadas.
- Processos externos em andamento não são interrompidos imediatamente; o
  controle de cancelamento cooperativo permanece uma evolução futura.
- O controle de concorrência é local ao processo e deverá migrar para um lock
  persistente se houver múltiplas instâncias da API.
