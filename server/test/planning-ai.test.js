import assert from "node:assert/strict";
import test from "node:test";
import { PlanningAiProvider } from "../src/planning/aiProvider.js";
import { planningAssistanceSchema } from "../src/validation.js";

test("planning assistance accepts discussion without initial-plan guidance", () => {
  assert.equal(planningAssistanceSchema.safeParse({ discussion: "Create an expense system for finance teams with approvals." }).success, true);
  assert.equal(planningAssistanceSchema.safeParse({ discussion: "Too short" }).success, false);
});

test("AI planner normalizes an editable narrative and structured review plan", async () => {
  class FakePlanner extends PlanningAiProvider {
    async withGemini() {
      return {
        initialPlan: "Build the expense workflow in two controlled phases.",
        backendRequired: true,
        backendRationale: "Persistent expense and approval records require an API.",
        product: { vision: "Make expense approval traceable", assumptions: ["Responsive web application"] },
        scope: { included: ["Expense submission"], excluded: ["Native mobile application"] },
        architecture: { frontend: "React", backend: "Express API", data: "PostgreSQL", delivery: "GitHub Actions" },
        phases: [{ name: "Foundation", outcome: "Working expense workflow" }],
        qualityGates: ["Automated tests"],
      };
    }
  }
  const result = await new FakePlanner({ aiProvider: "gemini" }).generate({ project: { name: "Expenses" }, discussion: "Finance users submit expenses and managers approve them.", initialPlan: "" });
  assert.equal(result.initialPlan, "Build the expense workflow in two controlled phases.");
  assert.equal(result.projectPlan.status, "review");
  assert.equal(result.projectPlan.application.backendRequired, true);
  assert.equal(result.projectPlan.product.sourceDiscussion, "Finance users submit expenses and managers approve them.");
});
