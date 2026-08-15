import { describe, expect, it } from "vitest";

import {
  MockDeveloperAgent,
  MockProductOwnerAgent,
  MockQualityAssuranceAgent
} from "./index.js";

describe("agentes simulados", () => {
  it("o PO transforma o briefing em stories", async () => {
    const po = new MockProductOwnerAgent();

    const stories = await po.createBacklog(
      "Criar uma aplicação de tarefas."
    );

    expect(stories).toHaveLength(2);
    expect(stories[0]?.id).toBe("US-001");
  });

  it("o PO rejeita briefing vazio", async () => {
    const po = new MockProductOwnerAgent();

    await expect(po.createBacklog("   ")).rejects.toThrow(
      "Briefing cannot be empty"
    );
  });

  it("o Developer diferencia implementação e correção", async () => {
    const po = new MockProductOwnerAgent();
    const developer = new MockDeveloperAgent();
    const story = (await po.createBacklog("Aplicação"))[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const initialResult = await developer.implement({
      story,
      previousQaResult: null
    });

    expect(initialResult.summary).toContain("inicial");
  });

  it("o QA falha na primeira tentativa e aprova a segunda", async () => {
    const po = new MockProductOwnerAgent();
    const developer = new MockDeveloperAgent();
    const qa = new MockQualityAssuranceAgent();
    const story = (await po.createBacklog("Aplicação"))[0];

    if (!story) {
      throw new Error("Story was not created");
    }

    const implementation = await developer.implement({
      story,
      previousQaResult: null
    });

    const firstResult = await qa.validate({
      story,
      implementation
    });

    const secondResult = await qa.validate({
      story,
      implementation
    });

    expect(firstResult.status).toBe("FAIL");
    expect(secondResult.status).toBe("PASS");
  });
});
