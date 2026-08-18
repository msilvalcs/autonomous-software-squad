import { describe, expect, it, vi } from "vitest";

import type { UserStory } from "@squad/schemas";

import { GitHubIssuesPublisher } from "./index.js";

const story: UserStory = {
  id: "US-001",
  title: "Cadastrar ocorrência",
  description: "Permitir o cadastro de uma não conformidade.",
  priority: 1,
  acceptanceCriteria: [
    "O código deve ser único",
    "A severidade deve ser obrigatória"
  ],
  status: "PENDING"
};

describe("GitHubIssuesPublisher", () => {
  it("publica uma issue rastreável para cada story", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 42,
          html_url: "https://github.com/acme/squad/issues/42"
        }),
        { status: 201 }
      )
    );
    const publisher = new GitHubIssuesPublisher({
      token: "test-token",
      repository: "acme/squad",
      fetcher
    });

    await expect(
      publisher.publish("run-001", [story])
    ).resolves.toEqual([{
      storyId: "US-001",
      number: 42,
      url: "https://github.com/acme/squad/issues/42"
    }]);

    const request = fetcher.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body));

    expect(request?.[0]).toBe(
      "https://api.github.com/repos/acme/squad/issues"
    );
    expect(body.title).toBe("[US-001] Cadastrar ocorrência");
    expect(body.body).toContain("autonomous-squad:run-001:US-001");
    expect(body.body).toContain("- [ ] O código deve ser único");
    expect(String(request?.[1]?.headers)).not.toContain("test-token");
  });

  it("não republica uma story que já possui issue", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const publisher = new GitHubIssuesPublisher({
      token: "test-token",
      repository: "acme/squad",
      fetcher
    });

    const published = await publisher.publish("run-001", [{
      ...story,
      externalIssue: {
        provider: "github",
        number: 7,
        url: "https://github.com/acme/squad/issues/7"
      }
    }]);

    expect(published[0]?.number).toBe(7);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejeita configuração e respostas inválidas sem expor token", async () => {
    expect(
      () => new GitHubIssuesPublisher({
        token: "",
        repository: "acme/squad"
      })
    ).toThrow("token is required");

    const publisher = new GitHubIssuesPublisher({
      token: "sensitive-token",
      repository: "acme/squad",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("Forbidden", { status: 403 })
      )
    });

    await expect(
      publisher.publish("run-001", [story])
    ).rejects.toThrow("status 403");
  });
});
