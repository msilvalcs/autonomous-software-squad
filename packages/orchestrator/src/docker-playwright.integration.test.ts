import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  CodexDeveloperAgent,
  type DeveloperInput
} from "@squad/agents";
import {
  DockerRunner,
  type AllowedCommand
} from "@squad/runner";
import type { UserStory } from "@squad/schemas";

const runDockerIntegration =
  process.env.RUN_DOCKER_PLAYWRIGHT_INTEGRATION === "1"
    ? describe
    : describe.skip;

const story: UserStory = {
  id: "US-E2E",
  title: "Validar a interface em desktop e mobile",
  description: "Produzir evidência real no navegador.",
  priority: 1,
  acceptanceCriteria: [
    "A página não deve apresentar erros nem rolagem horizontal"
  ],
  status: "PENDING"
};

runDockerIntegration(
  "Developer -> Docker Runner -> Playwright",
  () => {
    it("executa o E2E solicitado pelo Developer no Runner sem rede", async () => {
      const requests: Array<{ prompt: string }> = [];
      const client = {
        generate: async (request: { prompt: string }) => {
          requests.push(request);
          return {
            data: {
              storyId: story.id,
              summary: "Teste E2E preparado para validação pelo Runner.",
              changedFiles: ["e2e/smoke.spec.ts"],
              commands: ["npm run test:e2e"],
              status: "IMPLEMENTED",
              decisions: [{
                decision: "Solicitar validação real no navegador.",
                rationale: "O Runner possui o ambiente reproduzível.",
                alternativesConsidered: [
                  "Executar Playwright no host do Developer."
                ]
              }]
            },
            stdout: "",
            stderr: "",
            durationMs: 1
          };
        }
      };
      const input: DeveloperInput = {
        story,
        previousQaResult: null,
        workspacePath: path.resolve(
          import.meta.dirname,
          "../../../templates/react-task-app"
        )
      };
      const developer = new CodexDeveloperAgent(client as never);

      const implementation = await developer.implement(input);
      const command = implementation.commands[0] as AllowedCommand;

      expect(command).toBe("npm run test:e2e");
      expect(requests[0]?.prompt).toContain(
        "Somente o resultado retornado pelo Runner determina se build"
      );

      const runner = new DockerRunner({
        baseDirectory: path.dirname(input.workspacePath),
        image:
          process.env.DOCKER_RUNNER_IMAGE ??
          "autonomous-squad-runner:ci"
      });
      const result = await runner.run({
        workspace: input.workspacePath,
        command,
        timeoutMs: 120_000
      });

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.stdout).toContain("2 passed");
    }, 130_000);
  }
);
