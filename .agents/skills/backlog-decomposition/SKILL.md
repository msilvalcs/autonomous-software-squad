---
name: backlog-decomposition
description: Transform a product briefing into a small, prioritized, auditable backlog of vertical user stories with objective acceptance criteria. Use when a Product Owner must plan a new run, refine an ambiguous briefing, split oversized work, or verify that stories are independently testable without making technical implementation decisions.
---

# Backlog Decomposition

Convert the supplied briefing into the smallest useful sequence of independently
verifiable outcomes. Stay within the stated problem and constraints.

## Workflow

1. Extract users, goals, observable capabilities, constraints, risks, and explicit
   exclusions from the briefing.
2. Separate facts from assumptions. Record an assumption only when planning cannot
   proceed safely without it.
3. Identify a thin end-to-end outcome that proves the product loop first.
4. Split remaining work into vertical stories. Avoid layers such as "create the
   backend" or "build the UI" as standalone stories.
5. Order stories by dependency, risk reduction, and user value.
6. Write acceptance criteria as observable facts with a clear pass or fail result.
7. Check that each story can be implemented and validated without requiring an
   unrelated future story.
8. Return only the schema requested by the orchestrator.

## Story quality rules

- Use one concrete user or operator outcome per story.
- Keep the title short and use the description to state value and context.
- Prefer three to six precise criteria over a long implementation checklist.
- Include negative or boundary behavior when it changes user-visible correctness.
- Do not prescribe libraries, file names, architecture, or code structure unless the
  briefing explicitly requires them.
- Do not invent authentication, integrations, deployment, analytics, or persistence
  requirements.
- Mark dependencies through ordering and the story content, not hidden assumptions.

## Audit requirement

Add one decision named `Skill backlog-decomposition` to the structured output. State
the objective for activating the skill, the decomposition result, and any alternative
story split that was considered. If the skill adds no value for the briefing, record
that result instead of fabricating changes.

## Final check

Before returning, verify that every criterion is testable, no two stories duplicate
the same outcome, and the backlog covers every explicit capability in the briefing.
