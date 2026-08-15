import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import {
  createRun,
  getRun,
  subscribeToEvents
} from "./api/squad-api";
import type {
  AuditEvent,
  RunState,
  RunStatus
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
        />

        <AgentCard
          name="Developer"
          role="DEV"
          status={getAgentStatus("DEV", run)}
        />

        <AgentCard
          name="Quality Assurance"
          role="QA"
          status={getAgentStatus("QA", run)}
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

            <span>{events.length} eventos</span>
          </div>

          {events.length === 0 ? (
            <EmptyState text="Os eventos aparecerão em tempo real." />
          ) : (
            <ol className="timeline">
              {[...events].reverse().map((event) => (
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

                    <code>{event.action}</code>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {finished && (
        <section className={`result result-${run.status.toLowerCase()}`}>
          <h2>
            {run.status === "COMPLETED"
              ? "Aplicação concluída"
              : "Execução encerrada"}
          </h2>
          <p>
            Status final: <strong>{run.status}</strong>
          </p>
          <p>
            Workspace: <code>{run.workspacePath}</code>
          </p>
        </section>
      )}
    </main>
  );
}

function AgentCard(props: {
  name: string;
  role: string;
  status: "WAITING" | "RUNNING" | "DONE" | "ERROR";
}) {
  return (
    <article className={`agent agent-${props.status.toLowerCase()}`}>
      <span className="agent-role">{props.role}</span>
      <div>
        <h2>{props.name}</h2>
        <p>{props.status}</p>
      </div>
      <span className="agent-indicator" />
    </article>
  );
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

export default App;