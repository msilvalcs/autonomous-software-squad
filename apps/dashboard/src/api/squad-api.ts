import type {
  ArtifactManifest,
  AuditEvent,
  CreateRunResponse,
  ProjectDocument,
  RunSummary,
  RunState,
  SquadConfiguration
} from "./types";

const API_BASE_URL = "/api";

export async function getSquadConfiguration(): Promise<SquadConfiguration> {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error("Não foi possível consultar a configuração do squad.");
  }

  return response.json() as Promise<SquadConfiguration>;
}

export async function getDocumentation(): Promise<ProjectDocument[]> {
  const response = await fetch(`${API_BASE_URL}/documentation`);

  if (!response.ok) {
    throw new Error("Não foi possível consultar a documentação.");
  }

  return response.json() as Promise<ProjectDocument[]>;
}

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
    const payload = await readErrorPayload(response);
    throw new Error(
      payload.activeRunId
        ? `A execução ${payload.activeRunId} ainda está ativa.`
        : "Não foi possível iniciar o squad."
    );
  }

  return response.json() as Promise<CreateRunResponse>;
}

export async function getRuns(): Promise<RunSummary[]> {
  const response = await fetch(`${API_BASE_URL}/runs?limit=30`);

  if (!response.ok) {
    throw new Error("Não foi possível consultar o histórico.");
  }

  return response.json() as Promise<RunSummary[]>;
}

export async function resumeRun(
  runId: string
): Promise<CreateRunResponse> {
  const response = await fetch(
    `${API_BASE_URL}/runs/${runId}/resume`,
    { method: "POST" }
  );

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new Error(
      payload.activeRunId
        ? `A execução ${payload.activeRunId} ainda está ativa.`
        : "Não foi possível retomar a execução."
    );
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

export async function getArtifact(
  runId: string
): Promise<ArtifactManifest> {
  const response = await fetch(
    `${API_BASE_URL}/runs/${runId}/artifact`
  );

  if (!response.ok) {
    throw new Error("Não foi possível consultar o artefato final.");
  }

  return response.json() as Promise<ArtifactManifest>;
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

async function readErrorPayload(
  response: Response
): Promise<{ activeRunId?: string }> {
  try {
    return await response.json() as { activeRunId?: string };
  } catch {
    return {};
  }
}
