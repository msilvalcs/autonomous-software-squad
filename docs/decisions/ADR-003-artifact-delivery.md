# ADR-003: Entrega segura do artefato

## Status

Aceita.

## Contexto

Uma execução concluída produzia um workspace funcional, mas a API devolvia
apenas o caminho local. Esse caminho não era útil para um avaliador no
dashboard e expunha um detalhe interno do host.

## Decisão

A API publica um manifesto do artefato, um preview somente do build em `dist`
e um arquivo ZIP com o projeto. O dashboard mostra um resumo final, incorpora
o preview em um `iframe` isolado e oferece download.

Antes de ler ou compactar arquivos, o serviço:

- confirma que o workspace real corresponde exatamente ao `runId` dentro de
  `generated-projects`;
- rejeita links simbólicos;
- ignora `.git` e `node_modules`;
- permite servir no preview somente arquivos já presentes no manifesto;
- exige status `COMPLETED`.

O pacote `archiver` foi escolhido porque produz ZIP por streaming, sem montar
o arquivo completo em memória. A dependência fica restrita à API.

## Alternativas consideradas

- Expor o caminho do workspace: não funciona para acesso remoto e revela a
  estrutura do host.
- Servir o workspace inteiro como arquivos estáticos: amplia a superfície de
  leitura e poderia publicar fontes ou dependências sem controle.
- Gerar TAR.GZ apenas com módulos nativos: reduz dependências, mas entrega uma
  experiência pior para avaliadores em Windows.
- Abrir um servidor Vite por execução: aumenta processos, portas e ciclo de
  vida a controlar.

## Consequências

- O avaliador consegue inspecionar e baixar a entrega no dashboard.
- O preview usa o build que já passou pelo Runner e não executa o servidor de
  desenvolvimento do projeto gerado.
- Arquivos ZIP são produzidos sob demanda e podem consumir CPU em artefatos
  grandes. O MVP gera projetos pequenos e sequenciais.
