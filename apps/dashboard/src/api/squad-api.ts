import type {
  AuditEvent,
  CreateRunResponse,
  RunState
} from "./types";

const API_BASE_URL = "/api";

export async function createRun(
  briefing: string
): Promise<CreateRunResponse> {
  const response = await fetch(`${API_BASE_URL}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      briefing,
      maxAttempts: 3
    })
  });

  if (!response.ok) {
    throw new Error("Não foi possível iniciar o squad.");
  }

  return response.json() as Promise<CreateRunResponse>;
}

export async function getRun(
  runId: string
): Promise<RunState> {
  const response = await fetch(
    `${API_BASE_URL}/runs/${runId}`
  );

  if (!response.ok) {
    throw new Error("Não foi possível consultar a execução.");
  }

  return response.json() as Promise<RunState>;
}

export function subscribeToEvents(
  runId: string,
  callbacks: {
    onEvent: (event: AuditEvent) => void;
    onCompleted: () => void;
    onError: () => void;
  }
): () => void {
  const source = new EventSource(
    `${API_BASE_URL}/runs/${runId}/stream`
  );

  source.addEventListener("audit-event", (event) => {
    const message = event as MessageEvent<string>;
    callbacks.onEvent(JSON.parse(message.data) as AuditEvent);
  });

  source.addEventListener("stream-completed", () => {
    callbacks.onCompleted();
    source.close();
  });

  source.addEventListener("stream-error", () => {
    callbacks.onError();
    source.close();
  });

  source.onerror = () => {
    callbacks.onError();
    source.close();
  };

  return () => source.close();
}