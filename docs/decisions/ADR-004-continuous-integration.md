# ADR-004: Integração contínua do monorepo

## Status

Aceita.

## Contexto

O projeto possuía comandos locais de qualidade, mas nenhuma verificação
automática no GitHub. Uma regressão em qualquer workspace poderia chegar à
branch principal sem executar os contratos que protegem o orquestrador.

## Decisão

Executar um workflow de GitHub Actions em pushes para `main`, pull requests e
acionamento manual. Um job em Ubuntu usa a versão do Node definida em `.nvmrc`
e executa, nesta ordem:

1. `npm ci`;
2. `npm run typecheck`;
3. `npm test`;
4. `npm run build`.

O CI usa `LLM_PROVIDER=mock`, não acessa credenciais e possui apenas permissão
de leitura do conteúdo. Execuções mais antigas da mesma referência são
canceladas para evitar consumo desnecessário.

## Alternativas consideradas

- Separar cada comando em um job: melhora o paralelismo, mas repete instalação
  e pode esconder dependências de ordem entre os workspaces neste estágio.
- Executar agentes Codex no CI: exigiria credenciais, aumentaria variabilidade
  e não é necessário para validar o comportamento determinístico.
- Validar apenas a aplicação alterada: reduz tempo, mas deixa contratos
  compartilhados sem cobertura completa.

## Consequências

- Cada contribuição recebe uma barreira automática equivalente à validação
  local obrigatória.
- O job não demonstra qualidade de respostas de LLM; execuções reais continuam
  sendo tratadas como evidência separada de demonstração.
