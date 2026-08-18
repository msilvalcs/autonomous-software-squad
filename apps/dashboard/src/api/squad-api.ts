import type {
  ArtifactManifest,
  AuditEvent,
  CreateRunResponse,
  ProjectDocument,
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
