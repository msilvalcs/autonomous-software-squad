import type { UserStory } from "@squad/schemas";

export interface PublishedStoryIssue {
  storyId: string;
  number: number;
  url: string;
}

export interface GitHubIssuesPublisherOptions {
  token: string;
  repository: string;
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
}

export class GitHubIssuesPublisher {
  private readonly token: string;
  private readonly repository: string;
  private readonly apiBaseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: GitHubIssuesPublisherOptions) {
    if (options.token.trim() === "") {
      throw new Error("GitHub token is required");
    }

    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
      throw new Error("GitHub repository must use owner/name format");
    }

    this.token = options.token;
    this.repository = options.repository;
    this.apiBaseUrl = (
      options.apiBaseUrl ?? "https://api.github.com"
    ).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  async publish(
    runId: string,
    stories: UserStory[]
  ): Promise<PublishedStoryIssue[]> {
    const published: PublishedStoryIssue[] = [];

    for (const story of stories) {
      if (story.externalIssue?.provider === "github") {
        published.push({
          storyId: story.id,
          number: story.externalIssue.number,
          url: story.externalIssue.url
        });
        continue;
      }

      const response = await this.fetcher(
        `${this.apiBaseUrl}/repos/${this.repository}/issues`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28"
          },
          body: JSON.stringify({
            title: `[${story.id}] ${story.title}`,
            body: formatIssueBody(runId, story),
            labels: ["user-story", "autonomous-squad"]
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `GitHub issue publication failed with status ${response.status}`
        );
      }

      const payload: unknown = await response.json();
      const issue = parseIssueResponse(payload, story.id);
      published.push(issue);
    }

    return published;
  }
}

function formatIssueBody(runId: string, story: UserStory): string {
  const criteria = story.acceptanceCriteria
    .map((criterion) => `- [ ] ${criterion}`)
    .join("\n");

  return [
    `<!-- autonomous-squad:${runId}:${story.id} -->`,
    "## User story",
    "",
    story.description,
    "",
    "## Critérios de aceitação",
    "",
    criteria,
    "",
    "## Rastreabilidade",
    "",
    `- Execução: \`${runId}\``,
    `- Prioridade: ${story.priority}`,
    "- Criada pelo Product Owner do Autonomous Software Squad"
  ].join("\n");
}

function parseIssueResponse(
  payload: unknown,
  storyId: string
): PublishedStoryIssue {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("number" in payload) ||
    !("html_url" in payload) ||
    typeof payload.number !== "number" ||
    typeof payload.html_url !== "string"
  ) {
    throw new Error("GitHub returned an invalid issue response");
  }

  return {
    storyId,
    number: payload.number,
    url: payload.html_url
  };
}
