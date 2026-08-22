# ADR-001: Roteamento de modelos por complexidade e persona

## Status

Aceito.

## Contexto

PO, Developer e QA possuem perfis de trabalho diferentes. Usar sempre o mesmo modelo e o mesmo esforço aumenta latência em tarefas simples e reduz qualidade em tarefas complexas.

## Decisão

O Orquestrador classifica o briefing de forma determinística como `LOW`, `MEDIUM` ou `HIGH`. A classificação considera tamanho, quantidade de capacidades e sinais críticos como autenticação, pagamentos, tempo real, persistência e integrações externas.

Cada execução recebe uma rota explícita para PO, DEV e QA com:

- provider;
- modelo;
- reasoning effort;
- complexidade;
- justificativa.

A decisão é persistida pelo evento `MODEL_ROUTING_DECIDED`. Overrides podem ser fornecidos por `MODEL_ROUTING_CONFIG`.

Defaults executáveis no ambiente atual:

| Complexidade | PO | Developer | QA |
|---|---|---|---|
| LOW | Luna, low | Luna, medium | Luna, low |
| MEDIUM | Terra, medium | Luna, medium | Terra, high |
| HIGH | Sol, high | Luna, medium | Sol, xhigh |

Providers externos só podem ser usados depois de configurados no Codex CLI. O ambiente atual possui apenas o provider Codex autenticado pelo ChatGPT.

## Consequências

- A seleção fica visível no estado, API, dashboard e auditoria.
- Um provider configurado incorretamente falha de forma explícita.
- A heurística precisa ser calibrada com execuções reais e métricas de qualidade, latência e consumo.
