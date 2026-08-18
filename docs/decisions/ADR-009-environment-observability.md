# ADR-009: Observabilidade e proveniência do ambiente

## Status

Aceita e implementada.

## Contexto

O ambiente Docker já era criado e removido por run, mas a auditoria registrava
somente backend, identificador e tag da imagem. A tag não identifica de forma
imutável o conteúdo executado, e o dashboard não apresentava as políticas por
etapa nem separava eventos de infraestrutura.

Falhas ao preparar ou limpar o ambiente também encerravam a run como `FAILED`
sem oferecer retomada, apesar de serem falhas operacionais potencialmente
transitórias.

## Decisão

- Registrar `EXECUTION_BACKEND_DECIDED` com backend, justificativa e política
  efetiva antes da execução.
- Após criar o container, consultar `docker inspect` e registrar o identificador
  imutável da imagem em `imageDigest`.
- Anexar backend, environment ID, imagem, digest, etapa, limites, política de
  rede e duração aos eventos de preparação, instalação, build, testes e limpeza.
- Registrar tempos das etapas de PO, Developer e QA junto com a política da
  persona.
- Expor no dashboard uma matriz por persona com runtime, acesso ao workspace,
  rede, credenciais e limites.
- Permitir o filtro `Infraestrutura` na timeline. A busca também considera os
  metadados auditáveis, permitindo localizar backend, imagem ou digest.
- Incluir `environmentProvenance` no manifesto da entrega com backend, imagem,
  digest, limites, rede, justificativa e durações por etapa.
- Marcar falhas de criação e limpeza como `retryable` e permitir retomar uma run
  `FAILED` somente quando houver essa evidência de infraestrutura. Estados
  `COMPLETED` e `BLOCKED` continuam não retomáveis.
- Preservar a referência do container quando a remoção falha, permitindo que a
  próxima retomada tente a limpeza novamente.

## Segurança dos metadados

A proveniência é construída por allowlist. Ela não copia environment variables,
headers, tokens, stdout completo ou configuração de autenticação. Somente dados
operacionais não secretos entram no estado, nos eventos e no manifesto.

## Alternativas consideradas

- Exibir apenas `EXECUTION_MODE`: rejeitada porque representa configuração, não
  prova qual imagem foi realmente executada.
- Usar somente a tag Docker: rejeitada porque tags podem ser sobrescritas.
- Copiar todos os metadados dos eventos para o manifesto: rejeitada para evitar
  propagação acidental de dados sensíveis e acoplamento do contrato público.
- Impedir retomada de qualquer estado terminal: rejeitada para falhas
  operacionais, que podem desaparecer sem mudança no código ou no briefing.

## Consequências

- Uma run Docker passa a fazer uma chamada adicional a `docker inspect` durante
  a preparação.
- A timeline e o manifesto fornecem evidência suficiente para comparar Local,
  Docker e a futura implementação de microVM.
- Falhas de produto e runs que atingem `BLOCKED` não ganham novas tentativas por
  esse mecanismo. Somente `FAILED` com evento `retryable` pode ser retomado.
