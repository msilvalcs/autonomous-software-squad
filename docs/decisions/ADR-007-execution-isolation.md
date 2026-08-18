# ADR-007: Isolamento do backend de execução

## Status

Aceita para implementação incremental.

## Contexto

O LocalRunner restringe comandos e caminhos, mas os processos ainda compartilham
o host da API. O projeto precisa preservar o fluxo local do MVP e permitir um
backend com isolamento mais forte sem acoplar Docker à máquina de estados.

Além disso, um container apenas para `npm` não isola o Codex Developer, que
ainda é iniciado pelo CodexClient no host. Esta decisão cobre a primeira etapa:
isolar instalação, build, typecheck e testes. O isolamento das personas será
tratado como evolução separada.

## Decisão

- Definir o contrato `ExecutionRunner`, implementado por LocalRunner e
  DockerRunner.
- Selecionar o backend somente na composição da API com `EXECUTION_MODE`.
- Manter `local` como padrão e exigir `docker` explicitamente, sem fallback
  silencioso para modo desconhecido.
- Usar um container efêmero por run, montar somente o workspace validado em
  `/workspace` e reutilizá-lo nas tentativas e comandos daquela execução.
- Executar com usuário sem root, root filesystem somente leitura, `tmpfs` em
  `/tmp`, capabilities removidas, `no-new-privileges` e limites de CPU, memória
  e PIDs.
- Iniciar o ambiente na rede de instalação, desconectá-la após `npm install` e
  garantir a desconexão antes de build, typecheck ou testes. Em uma retomada
  que não reinstala dependências, o primeiro comando também remove a rede.
- Remover explicitamente o container em `finally` ao concluir, bloquear ou
  falhar a run, além de removê-lo quando um timeout for atingido.
- Registrar início e descarte do ambiente na auditoria com backend, imagem e
  identificador do container.
- Não montar o Docker socket e não incorporar credenciais na imagem.
- Fixar a imagem Node por versão e digest para tornar a base reproduzível.

## Alternativas consideradas

- Substituir o LocalRunner imediatamente: prejudicaria ambientes sem Docker e
  tornaria a demonstração dependente do engine.
- Criar um container permanente para todas as runs: aumentaria o risco de
  contaminação entre workspaces.
- Montar o Docker socket dentro dos agentes: concederia controle equivalente ao
  host e viola o modelo de menor privilégio.
- Usar uma microVM desde o início: oferece isolamento superior, mas adiciona
  complexidade operacional incompatível com a base atual do hackathon.

## Consequências

- O Orquestrador permanece independente do mecanismo de execução.
- O modo Docker exige a imagem `autonomous-squad-runner:local` ou outra imagem
  compatível configurada em `DOCKER_RUNNER_IMAGE`.
- A rede negada pode revelar testes que dependem indevidamente de serviços
  externos.
- O workspace continua persistido no host para suportar retomada e artefatos.
- A retomada cria um novo container e reutiliza o workspace persistido, sem
  depender de um processo anterior.
- Codex Developer, PO e QA permanecem no host nesta etapa. Containers por
  persona e microVMs continuam como diferenciais posteriores.
