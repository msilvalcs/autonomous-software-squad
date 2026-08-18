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

## Evidência de skills e rota de alta complexidade

A execução `run-f0960d51-60c0-4e93-8460-0179afc3ca88` validou o briefing
industrial ampliado depois da incorporação das skills:

- complexidade `HIGH`;
- PO e Developer em `gpt-5.6-sol`, esforço high;
- QA em `gpt-5.6-sol`, esforço xhigh;
- 6 de 6 stories aprovadas;
- 49 eventos e 76 decisões auditadas;
- 9 ativações de skills registradas, incluindo `backlog-decomposition`, `tdd`
  e `diagnosing-bugs`;
- 35 arquivos e 469.910 bytes no artefato entregue;
- duração total de aproximadamente 46 minutos.

O PO registrou explicitamente por que usou a decomposição, o resultado e três
alternativas rejeitadas. Developer e QA também registraram objetivo e resultado
das skills utilizadas. Não houve reprovação nessa execução: o QA aprovou todas
as stories na primeira tentativa. Essa informação é mantida para não apresentar
um ciclo corretivo artificial como evidência real.

## Evidência de carregamento no workspace

Depois de identificar que as execuções anteriores usavam fallback local para
as skills do Developer, a execução
`run-cfc5ea43-da3e-4afc-8824-d0d5adc1e7d2` validou a cópia controlada:

- complexidade `LOW`, com PO, Developer e QA em `gpt-5.6-luna`, esforço low;
- os quatro `SKILL.md` aprovados estavam presentes no workspace isolado e não
  havia links simbólicos;
- o Developer registrou `Skill tdd` como aplicada, sem mensagem de fallback;
- o QA registrou por que `diagnosing-bugs` não precisava ser ativada;
- 1 de 1 story aprovada em 14 eventos.

Essa execução confirma tanto a ativação positiva quanto a decisão negativa
auditável de uma skill.

## Evidência de isolamento Docker

Em 18 de agosto de 2026, a execução mock
`run-5020478e-18cc-4111-9bc0-2ff901e30db9` validou o backend Docker real:

- API iniciada com `EXECUTION_MODE=docker`;
- imagem `autonomous-squad-runner:local` baseada em Node 24.19.0;
- um único container reutilizado durante toda a run;
- rede `bridge` disponível durante `npm install` e removida antes de build e
  testes;
- duas stories aprovadas e status final `COMPLETED`;
- eventos `EXECUTION_ENVIRONMENT_STARTED` e
  `EXECUTION_ENVIRONMENT_DISPOSED` persistidos;
- nenhum container do squad permaneceu após a conclusão.

Uma tentativa anterior registrou `RUN_FAILED` ao revelar que Docker não permite
conectar outra rede a um container iniciado no modo privado `none`. A política
foi corrigida para iniciar com a rede de instalação e desconectá-la antes dos
demais comandos. Essa falha permanece no Event Store como evidência auditável
do diagnóstico.

## Roteiro de apresentação

1. Explique o briefing de qualidade e rastreabilidade industrial.
2. Mostre a classificação de complexidade e os modelos escolhidos.
3. Acompanhe PO, Developer, Runner e QA na timeline filtrável.
4. Abra uma story e relacione seus critérios às evidências do QA.
5. Mostre as decisões registradas e as alternativas consideradas.
6. Abra a aplicação final no preview.
7. Baixe o ZIP e mostre que código e testes fazem parte da entrega.
8. Consulte os ADRs no próprio dashboard.
