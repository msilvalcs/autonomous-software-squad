import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import {
  createRun,
  getArtifact,
  getDocumentation,
  getRun,
  getSquadConfiguration,
  subscribeToEvents
} from "./api/squad-api";
import type {
  ArtifactManifest,
  AuditEvent,
  ProjectDocument,
  RunState,
  RunStatus,
  SquadConfiguration
} from "./api/types";
import "./App.css";

const terminalStatuses: RunStatus[] = [
  "COMPLETED",
  "BLOCKED",
  "FAILED"
];

function App() {
  const [briefing, setBriefing] = useState(
    "Crie uma aplicação web para controle de tarefas."
  );
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [configuration, setConfiguration] =
    useState<SquadConfiguration | null>(null);
  const [actorFilter, setActorFilter] = useState("ALL");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [artifact, setArtifact] = useState<ArtifactManifest | null>(null);

  useEffect(() => {
    let active = true;

    getSquadConfiguration()
      .then((result) => {
        if (active) {
          setConfiguration(result);
        }
      })
      .catch(() => {
        if (active) {
          setConfiguration(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    getDocumentation()
      .then((result) => {
        setDocuments(result);
        setSelectedDocumentId((current) => current || result[0]?.id || "");
      })
      .catch(() => setDocuments([]));
  }, []);

  useEffect(() => {
    if (!runId) {
      return;
    }

    let active = true;

    async function refreshRun() {
      try {
        const state = await getRun(runId!);

        if (active) {
          setRun(state);
        }
      } catch {
        if (active) {
          setError("Não foi possível atualizar a execução.");
        }
      }
    }

    void refreshRun();

    const unsubscribe = subscribeToEvents(runId, {
      onEvent: (event) => {
        setEvents((current) => {
          if (
            current.some(
              (existing) =>
                existing.eventId === event.eventId
            )
          ) {
            return current;
          }

          return [...current, event];
        });

        void refreshRun();
      },
      onCompleted: () => {
        void refreshRun();
      },
      onError: () => {
        void refreshRun();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [runId]);

  useEffect(() => {
    if (!runId || run?.status !== "COMPLETED") {
      setArtifact(null);
      return;
    }

    let active = true;

    getArtifact(runId)
      .then((result) => {
        if (active) {
          setArtifact(result);
        }
      })
      .catch(() => {
        if (active) {
          setArtifact(null);
        }
      });

    return () => {
      active = false;
    };
  }, [run?.status, runId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (briefing.trim() === "") {
      setError("Informe um briefing.");
      return;
    }

    try {
      setStarting(true);
      setError("");
      setEvents([]);
      setRun(null);
      setArtifact(null);

      const result = await createRun(briefing);
      setRunId(result.runId);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Erro ao iniciar o squad."
      );
    } finally {
      setStarting(false);
    }
  }

  const finished =
    run !== null &&
    terminalStatuses.includes(run.status);
  const filteredEvents = events.filter((event) => {
    const matchesActor =
      actorFilter === "ALL" || event.actor === actorFilter;
    const query = timelineSearch.trim().toLocaleLowerCase();
    const matchesSearch =
      query === "" ||
      event.message.toLocaleLowerCase().includes(query) ||
      event.action.toLocaleLowerCase().includes(query) ||
      event.storyId?.toLocaleLowerCase().includes(query) === true;

    return matchesActor && matchesSearch;
  });
  const selectedDocument = documents.find(
    (document) => document.id === selectedDocumentId
  );

  return (
    <main className="dashboard">
      <header className="hero">
        <div>
          <span className="eyebrow">
            AUTONOMOUS SOFTWARE SQUAD
          </span>
          <h1>Do briefing ao software funcional</h1>
          <p>
            Acompanhe PO, Developer e QA trabalhando de
            maneira autônoma e auditável.
          </p>
        </div>

        <StatusBadge status={run?.status ?? "CREATED"} />
      </header>

      <section className="panel briefing-panel">
        <form onSubmit={handleSubmit}>
          <label htmlFor="briefing">
            Briefing do cliente
          </label>

          <textarea
            id="briefing"
            value={briefing}
            onChange={(event) =>
              setBriefing(event.target.value)
            }
            disabled={starting}
            rows={5}
          />

          <div className="form-footer">
            <span>
              {runId
                ? `Execução: ${runId}`
                : "Nenhuma execução iniciada"}
            </span>

            <button type="submit" disabled={starting}>
              {starting
                ? "Iniciando..."
                : "Iniciar squad"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="agents-grid">
        <AgentCard
          name="Product Owner"
          role="PO"
          status={getAgentStatus("PO", run)}
          model={formatModel(configuration, run, "PO")}
        />

        <AgentCard
          name="Developer"
          role="DEV"
          status={getAgentStatus("DEV", run)}
          model={formatModel(configuration, run, "DEV")}
        />

        <AgentCard
          name="Quality Assurance"
          role="QA"
          status={getAgentStatus("QA", run)}
          model={formatModel(configuration, run, "QA")}
        />
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">BACKLOG</span>
              <h2>User stories</h2>
            </div>

            <span>{run?.stories.length ?? 0} stories</span>
          </div>

          {!run || run.stories.length === 0 ? (
            <EmptyState text="O PO ainda não criou o backlog." />
          ) : (
            <div className="stories">
              {run.stories.map((story) => (
                <article
                  className="story"
                  key={story.id}
                >
                  <div>
                    <span className="story-id">
                      {story.id}
                    </span>
                    <h3>{story.title}</h3>
                    <p>{story.description}</p>
                  </div>

                  <StatusBadge status={story.status} />
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">AUDITORIA</span>
              <h2>Timeline</h2>
            </div>

            <span>
              {filteredEvents.length} de {events.length} eventos
            </span>
          </div>

          <div className="timeline-filters">
            <label>
              <span>Agente</span>
              <select
                value={actorFilter}
                onChange={(event) => setActorFilter(event.target.value)}
              >
                <option value="ALL">Todos</option>
                <option value="PO">PO</option>
                <option value="DEV">Developer</option>
                <option value="QA">QA</option>
                <option value="ORCHESTRATOR">Orquestrador</option>
                <option value="RUNNER">Runner</option>
                <option value="CLIENT">Cliente</option>
              </select>
            </label>

            <label>
              <span>Buscar</span>
              <input
                type="search"
                placeholder="Ação, mensagem ou story"
                value={timelineSearch}
                onChange={(event) => setTimelineSearch(event.target.value)}
              />
            </label>
          </div>

          {events.length === 0 ? (
            <EmptyState text="Os eventos aparecerão em tempo real." />
          ) : filteredEvents.length === 0 ? (
            <EmptyState text="Nenhum evento corresponde aos filtros." />
          ) : (
            <ol className="timeline">
              {[...filteredEvents].reverse().map((event) => (
                <li key={event.eventId}>
                  <div className="timeline-marker" />

                  <div>
                    <div className="event-header">
                      <strong>{event.actor}</strong>
                      <time>
                        {new Date(
                          event.timestamp
                        ).toLocaleTimeString()}
                      </time>
                    </div>

                    <p>{event.message}</p>

                    {getEventDecisions(event).length > 0 && (
                      <ul className="decision-list">
                        {getEventDecisions(event).map(
                          (decision, index) => (
                            <li key={`${event.eventId}-decision-${index}`}>
                              <strong>{decision.decision}</strong>
                              <span>{decision.rationale}</span>
                            </li>
                          )
                        )}
                      </ul>
                    )}

                    <code>{event.action}</code>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="panel documentation-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">DOCUMENTAÇÃO</span>
            <h2>Decisões, regras e personas</h2>
          </div>

          <span>{documents.length} documentos</span>
        </div>

        {documents.length === 0 ? (
          <EmptyState text="A documentação não está disponível." />
        ) : (
          <div className="documentation-layout">
            <nav className="document-list" aria-label="Documentos do projeto">
              {documents.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={
                    document.id === selectedDocumentId ? "active" : ""
                  }
                  onClick={() => setSelectedDocumentId(document.id)}
                >
                  <span>{document.category}</span>
                  <strong>{document.title}</strong>
                </button>
              ))}
            </nav>

            <article className="document-content">
              <header>
                <span>{selectedDocument?.category}</span>
                <h3>{selectedDocument?.title}</h3>
              </header>
              <pre>{selectedDocument?.content}</pre>
            </article>
          </div>
        )}
      </section>

      {finished && (
        <section className={`result result-${run.status.toLowerCase()}`}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">ENTREGA</span>
              <h2>
                {run.status === "COMPLETED"
                  ? "Aplicação concluída"
                  : "Execução encerrada"}
              </h2>
            </div>
            <StatusBadge status={run.status} />
          </div>

          {artifact ? (
            <>
              <dl className="artifact-metrics">
                <div>
                  <dt>Stories aprovadas</dt>
                  <dd>
                    {artifact.summary.approvedStories}/{artifact.summary.stories}
                  </dd>
                </div>
                <div>
                  <dt>Decisões auditadas</dt>
                  <dd>{artifact.summary.decisions}</dd>
                </div>
                <div>
                  <dt>Eventos</dt>
                  <dd>{artifact.summary.events}</dd>
                </div>
                <div>
                  <dt>Duração</dt>
                  <dd>{formatDuration(artifact.summary.durationMs)}</dd>
                </div>
                <div>
                  <dt>Pacote</dt>
                  <dd>
                    {artifact.fileCount} arquivos · {formatBytes(artifact.totalBytes)}
                  </dd>
                </div>
              </dl>

              <div className="artifact-actions">
                {artifact.hasPreview && artifact.previewUrl && (
                  <a
                    className="button-link button-link-secondary"
                    href={artifact.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir em nova aba
                  </a>
                )}
                {artifact.downloadUrl && (
                  <a className="button-link" href={artifact.downloadUrl}>
                    Baixar projeto .zip
                  </a>
                )}
              </div>

              {artifact.hasPreview && artifact.previewUrl && (
                <div className="artifact-preview">
                  <div className="preview-toolbar">
                    <span>PREVIEW DO ARTEFATO</span>
                    <code>{artifact.runId}</code>
                  </div>
                  <iframe
                    title="Preview da aplicação gerada"
                    src={artifact.previewUrl}
                    sandbox="allow-scripts"
                  />
                </div>
              )}
            </>
          ) : (
            <p>
              Status final: <strong>{run.status}</strong>
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function AgentCard(props: {
  name: string;
  role: string;
  status: "WAITING" | "RUNNING" | "DONE" | "ERROR";
  model: string;
}) {
  return (
    <article className={`agent agent-${props.status.toLowerCase()}`}>
      <span className="agent-role">{props.role}</span>
      <div>
        <h2>{props.name}</h2>
        <p>{props.status}</p>
        <span className="agent-model">{props.model}</span>
      </div>
      <span className="agent-indicator" />
    </article>
  );
}

function formatModel(
  configuration: SquadConfiguration | null,
  run: RunState | null,
  agent: "PO" | "DEV" | "QA"
): string {
  const assignment = run?.modelAssignments.find(
    (candidate) => candidate.agent === agent
  );

  if (assignment) {
    return assignment.model
      ? `${assignment.provider} · ${assignment.model} · ${assignment.reasoningEffort}`
      : `${assignment.provider} · ${assignment.reasoningEffort}`;
  }

  if (!configuration) {
    return "Modelo não disponível";
  }

  if (configuration.llmProvider === "mock") {
    return "Agente simulado";
  }

  return configuration.llmModel
    ? `${configuration.llmProvider} · ${configuration.llmModel}`
    : `${configuration.llmProvider} · modelo padrão`;
}

function StatusBadge(props: { status: string }) {
  return (
    <span className={`status status-${props.status.toLowerCase()}`}>
      {props.status}
    </span>
  );
}

function EmptyState(props: { text: string }) {
  return <p className="empty-state">{props.text}</p>;
}

interface VisibleDecision {
  decision: string;
  rationale: string;
}

function getEventDecisions(event: AuditEvent): VisibleDecision[] {
  const decisions = event.metadata?.decisions;

  if (!Array.isArray(decisions)) {
    return [];
  }

  return decisions.filter((value): value is VisibleDecision => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.decision === "string" &&
      typeof candidate.rationale === "string"
    );
  });
}

function getAgentStatus(
  agent: "PO" | "DEV" | "QA",
  run: RunState | null
): "WAITING" | "RUNNING" | "DONE" | "ERROR" {
  if (!run) {
    return "WAITING";
  }

  if (run.status === "FAILED" || run.status === "BLOCKED") {
    return "ERROR";
  }

  if (run.status === "COMPLETED") {
    return "DONE";
  }

  const activeStatus = {
    PO: "PLANNING",
    DEV: "DEVELOPING",
    QA: "TESTING"
  }[agent];

  if (run.status === activeStatus) {
    return "RUNNING";
  }

  const completed =
    (agent === "PO" &&
      ["DEVELOPING", "TESTING"].includes(run.status)) ||
    (agent === "DEV" && run.status === "TESTING");

  return completed ? "DONE" : "WAITING";
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatBytes(totalBytes: number): string {
  if (totalBytes < 1024) {
    return `${totalBytes} B`;
  }

  const kilobytes = totalBytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

export default App;
