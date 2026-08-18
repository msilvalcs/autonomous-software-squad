# Validação industrial da demonstração

## Posicionamento

O Autonomous Software Squad é apresentado como um acelerador auditável para o
modelo Squad as a Service da Hermes Reply. Ele transforma um briefing de
manufatura em backlog, código, testes, validação independente e entrega
inspecionável.

## Briefing de referência

```text
Crie uma aplicação web para gestão de não conformidades em uma linha de
produção. Deve permitir cadastrar ocorrência com código único, equipamento,
severidade BAIXA, MÉDIA, ALTA ou CRÍTICA, responsável e descrição obrigatória.
O usuário deve listar ocorrências, buscar por código ou equipamento e filtrar
por severidade e status ABERTA, EM_ANÁLISE ou RESOLVIDA. Alterar para RESOLVIDA
exige registrar uma ação corretiva. Exiba indicadores de total em aberto e
ocorrências críticas. Os dados devem persistir após recarregar a página. A
interface deve ter labels acessíveis, feedback claro de validação e funcionar
em 320 px sem rolagem horizontal. Inclua testes automatizados para regras de
código único, ação corretiva obrigatória, filtros, indicadores e persistência.
```

## Evidência executada

Em 17 de agosto de 2026, a execução
`run-18221baa-4165-4958-ae54-548d059f4596` concluiu o fluxo Codex real:

- complexidade `MEDIUM`;
- PO `gpt-5.6-terra`, esforço medium;
- Developer `gpt-5.6-luna`, esforço medium;
- QA `gpt-5.6-terra`, esforço high;
- 4 stories aprovadas;
- 35 eventos de auditoria;
- 32 decisões registradas;
- build e testes aprovados em cada story;
- duração total de aproximadamente 10 minutos e 13 segundos;
- preview e ZIP disponíveis no endpoint de artefato.

Os dados de execução e o workspace são locais e não são versionados. O roteiro
serve para repetir a demonstração em outro ambiente autenticado.

## Evidência de recuperação

A execução `run-ceeeb92f-6d3b-40a1-b0fb-478026941fee` foi interrompida durante
a terceira story após duas aprovações. A retomada preservou as stories já
aprovadas, registrou `RUN_RESUMED` e `STORY_RESUMED`, continuou a tentativa
pendente e encerrou com 5 de 5 stories aprovadas e 45 eventos. Essa execução
comprova a continuidade do Orquestrador sem esconder ou apagar a interrupção.

## Roteiro de apresentação

1. Explique o briefing de qualidade e rastreabilidade industrial.
2. Mostre a classificação de complexidade e os modelos escolhidos.
3. Acompanhe PO, Developer, Runner e QA na timeline filtrável.
4. Abra uma story e relacione seus critérios às evidências do QA.
5. Mostre as decisões registradas e as alternativas consideradas.
6. Abra a aplicação final no preview.
7. Baixe o ZIP e mostre que código e testes fazem parte da entrega.
8. Consulte os ADRs no próprio dashboard.
