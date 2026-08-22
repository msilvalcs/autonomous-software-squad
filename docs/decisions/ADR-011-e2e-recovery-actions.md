# ADR-011: Evidência E2E, retomada e ações por estado

## Status

Aceita e implementada.

## Contexto

Uma run real concluiu cinco stories e falhou na última porque o QA solicitou
evidência em navegador nas larguras de 1280 px e 375 px. O workspace não tinha
Playwright nem navegador instalado. Duas tentativas de baixar o runtime durante
a execução falharam com `EAI_AGAIN`.

O estado persistido ainda possuía uma tentativa, mas a retomada de `FAILED`
aceitava somente falhas do Runner marcadas como `retryable`. O dashboard também
deduzia essa condição varrendo eventos e ocultava o botão nos demais casos.

## Decisão

- Provisionar `@playwright/test` 1.62.1 no template e Chromium Headless Shell
  na imagem Docker. O download acontece no build da imagem, nunca durante uma
  run.
- Executar testes unitários por `npm test` no LocalRunner e, quando
  `RUN_E2E=true`, executar também E2E no DockerRunner. O Runner também
  reconhece `npm run test:e2e` explicitamente.
- Fazer o Developer criar os testes e solicitar os comandos na saída
  estruturada, sem usar execuções dependentes do host como condição de falha.
  O Runner configurado para a run é a fonte de verdade para build e testes.
- Usar Playwright `webServer` para iniciar o Vite somente durante os testes.
- Manter projetos de referência para 1280 x 800 e 375 x 812. O smoke test falha
  diante de erro de página, erro de console ou rolagem horizontal.
- Executar Chromium como o usuário não-root da run, sem Docker socket, sem rede,
  com root filesystem somente leitura e 256 MiB de shared memory privada.
- Validar o smoke E2E do template no job Docker do CI.
- Centralizar a retomabilidade em `canResumeRun`. Runs não terminais podem ser
  retomadas quando inativas. Uma falha do Developer pode ser retomada enquanto
  houver tentativa. Falhas retryable do ambiente também podem ser retomadas.
  `COMPLETED`, `BLOCKED`, limite esgotado e violação de isolamento não podem.
- A API é a fonte de verdade e expõe `active` e `canResume` no detalhe e no
  histórico. O dashboard não interpreta mensagens da timeline.
- O botão contextual segue a tabela abaixo.

| Estado efetivo | Ação exibida |
|---|---|
| Run ativa | `Executando...`, desabilitado e com indicador de progresso |
| Run inativa e retomável | `Retomar execução` |
| `COMPLETED` | `Ver resultado` |
| `BLOCKED` | `Limite de tentativas atingido`, desabilitado |
| `FAILED` não retomável | `Falha não retomável`, desabilitado |

Ao retomar, o dashboard cria uma nova inscrição SSE para a mesma run. Isso evita
que a interface permaneça parada depois que o stream terminal anterior fechou.

Fontes primárias:

- [Instalação de browsers Playwright](https://playwright.dev/docs/browsers)
- [Configuração de web server](https://playwright.dev/docs/test-webserver)
- [Playwright em Docker](https://playwright.dev/docs/docker)

## Segurança

- A imagem mantém execução sem root, `cap-drop ALL`, `no-new-privileges`, rede
  desabilitada durante build e testes, limites de memória, CPU e PIDs e nenhum
  socket Docker.
- O browser acessa somente o servidor Vite em loopback no próprio container.
- A retomada permanece limitada por `maxAttempts` e não contorna a política de
  isolamento.
- Downloads e instalação de pacotes do sistema não acontecem durante a run.

## Alternativas consideradas

- Instalar Puppeteer dinamicamente pelo Developer: rejeitada por depender de
  rede durante a execução e por não ser reproduzível.
- Aprovar responsividade somente por inspeção de CSS: rejeitada porque não mede
  overflow, interação nem erros reais do navegador.
- Permitir retomada de qualquer `FAILED`: rejeitada porque poderia contornar
  isolamento ou repetir indefinidamente uma falha sem tentativa restante.
- Manter a regra do botão no frontend: rejeitada para evitar divergência entre
  API e dashboard.

## Consequências

- A imagem Docker fica maior por incluir Chromium e suas dependências.
- `npm test` demora mais, mas passa a produzir evidência compatível com critérios
  visuais e de interação.
- A execução real que motivou esta decisão atingiu o limite de tentativas e
  permanece disponível somente para diagnóstico. A comprovação final deve ser
  feita em uma run nova, sem repetir uma run terminal.
