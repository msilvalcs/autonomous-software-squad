# ADR-010: MicroVM para execuções de alto risco

## Status

Aceita como avaliação. A adoção operacional foi adiada.

## Contexto

O DockerRunner endurecido isola os comandos npm, mas containers compartilham o
kernel do host. A hipótese desta spike é usar um kernel guest por execução para
workloads classificados como alto risco, sem permitir que indisponibilidade ou
complexidade operacional reduzam silenciosamente o isolamento exigido.

Esta análise foi realizada em 18 de agosto de 2026 no WSL2 usado pelo projeto.
O host expôs `/dev/kvm` e cgroup v2, mas o usuário da aplicação não tinha acesso
de leitura e escrita a KVM. Os binários `firecracker` e `jailer` não estavam
instalados. Portanto, esses itens são evidência deste host, não uma afirmação de
compatibilidade geral do WSL.

## Comparação

| Critério | Docker endurecido | Firecracker | Kata Containers |
|---|---|---|---|
| Fronteira de isolamento | Namespaces, cgroups, capabilities e seccomp sobre o kernel do host | MicroVM com kernel guest e device model mínimo sobre KVM | VM leve por container ou pod, com kernel guest |
| Integração | Já implementada no `ExecutionRunner` | API própria, Jailer, TAP, kernel e rootfs precisam de ciclo de vida próprio | OCI/CRI via containerd, CRI-O e Kubernetes RuntimeClass |
| Linux e WSL2 | Funcional no host atual via Docker Desktop | Linux com KVM é requisito; o host atual falhou em permissões e ferramentas | Requer extensões de virtualização no host ou virtualização aninhada na VM |
| Startup | Mediana observada de 340 ms em cinco execuções descartáveis locais | Especificação informa boot do guest em até 125 ms no ambiente de referência | Depende do hypervisor, guest assets e integração escolhidos; medir no host alvo |
| Memória | 8,922 MiB observados para o processo Node ocioso, além do daemon compartilhado | Especificação informa até 5 MiB de overhead do VMM, além da memória do guest | Inclui VMM, guest kernel, agent e recursos do workload |
| Manutenção | Baixa no projeto atual | Alta: binários, Jailer, kernel, rootfs, TAP, cgroups, logs e limpeza | Alta: runtime, containerd/CRI, hypervisor, guest assets e configuração |
| Adequação atual | Base operacional | Melhor candidato a PoC dedicado por run, ainda não homologado | Melhor candidato se o produto migrar para containerd/Kubernetes |

Os números locais servem apenas como baseline deste notebook, sem carga e sem
warmup controlado. Não são uma comparação de performance entre as três opções.
Os valores do Firecracker são metas publicadas para hardware e configuração de
referência, não resultados reproduzidos no WSL.

Fontes primárias consultadas:

- [Firecracker Getting Started](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- [Firecracker Specification](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)
- [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
- [Kata Containers architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/README.md)
- [Kata Containers installation](https://github.com/kata-containers/kata-containers/blob/main/docs/installation.md)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)

## Decisão

1. Manter Docker endurecido como backend base do hackathon.
2. Não instalar nem declarar Firecracker operacional nesta fase. O host atual
   não satisfaz os pré-requisitos e ainda não existe adaptador homologado para
   kernel, rootfs, rede, processo, logs e descarte seguro da microVM.
3. Disponibilizar `MicroVmRunner` somente como gate experimental fail-closed.
   Ele valida Linux, KVM, Firecracker, Jailer, kernel e rootfs. Mesmo quando o
   host passa, a execução permanece bloqueada até a homologação do ciclo de
   vida. Não há fallback para Docker ou LocalRunner.
4. Aplicar `MinimumIsolationPolicy` depois da classificação do briefing. A
   ordem de isolamento é `local < docker < microvm`. Se o backend selecionado
   for inferior ao mínimo da complexidade, a run registra
   `ISOLATION_REQUIREMENT_NOT_MET` e termina como `FAILED` antes de preparar o
   ambiente.
5. Manter os mínimos padrão em `local` para preservar a compatibilidade do MVP.
   A configuração é explícita por `MINIMUM_ISOLATION_LOW`,
   `MINIMUM_ISOLATION_MEDIUM` e `MINIMUM_ISOLATION_HIGH`. Definir alto risco
   como `microvm` hoje bloqueia a run, que é o comportamento seguro enquanto o
   backend não está homologado.

## Critérios para adoção pós-hackathon

Firecracker somente poderá ser promovido de gate para backend operacional se
todos os itens abaixo forem atendidos:

- host Linux dedicado ou VM com KVM funcional para a identidade do serviço;
- Firecracker e Jailer fixados por versão e checksum em caminhos absolutos;
- Jailer obrigatório com usuário sem privilégios, cgroups e limites por run;
- kernel e rootfs mínimos, imutáveis, reproduzíveis, assinados e versionados;
- rede TAP e namespace com egress negado por padrão e política explícita;
- nenhum Docker socket ou credencial de LLM disponível no guest;
- montagem exclusiva do workspace validado, sem acesso à raiz do repositório;
- captura limitada de logs, timeout, término forçado e limpeza idempotente;
- testes de falha em cada etapa e prova de ausência de processos, TAPs e discos
  residuais;
- runner CI Linux com KVM para testes end-to-end reais;
- benchmark repetível com pelo menos 30 amostras de startup, memória e execução;
- p95 de startup menor ou igual a 1 segundo e overhead ocioso menor ou igual a
  128 MiB por microVM no host alvo;
- revisão de segurança aprovada e plano de rollback para Docker endurecido que
  somente possa ser acionado quando a política da run permitir Docker.

Kata Containers deve ser reavaliado se a arquitetura adotar containerd ou
Kubernetes. Sem essa mudança, seu custo de integração não é justificado para o
MVP atual.

## Consequências

- O produto demonstra uma política verificável que nunca reduz o isolamento por
  conveniência operacional.
- `npm run microvm:check` fornece um relatório JSON sem instalar componentes ou
  alterar o host.
- `EXECUTION_MODE=microvm` é intencionalmente não operacional nesta versão.
- Docker continua sendo a opção executável mais isolada do projeto no
  hackathon, mas não deve ser apresentado como uma fronteira de kernel próprio.

## Alternativas consideradas

- Fazer fallback automático de Firecracker para Docker: rejeitada porque viola
  o isolamento mínimo de uma run de alto risco.
- Instalar Firecracker e assets durante a inicialização da API: rejeitada por
  ampliar privilégios, depender da rede e perder reprodutibilidade.
- Adotar Kata Containers agora: rejeitada porque o produto não usa containerd
  nem Kubernetes e passaria a carregar uma plataforma operacional maior.
- Não criar nenhum artefato de código: rejeitada porque a política fail-closed e
  o readiness check são evidências executáveis da decisão.
