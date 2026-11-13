import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationBlueprint } from "../src/generation/blueprint.js";
import { generatedBackendFiles, generatedFrontendFiles } from "../src/generation/templates.js";

const project = {
  name: "Expense Portal",
  description: "Track expenses and transactions",
  discussion: "Users create expenses and review transactions.",
  environments: ["Development", "Production"],
  projectPlan: { status: "approved", version: 3, product: { vision: "Expense visibility" } },
};

test("generation creates a versioned blueprint from the approved plan", () => {
  const blueprint = createApplicationBlueprint(project);
  assert.equal(blueprint.version, 3);
  assert.deepEqual(blueprint.backend.resources.map((resource) => resource.plural), ["transactions", "expenses", "users"]);
});

test("generation emits separated backend and frontend application files", () => {
  const blueprint = createApplicationBlueprint(project);
  const backend = generatedBackendFiles(blueprint);
  const frontend = generatedFrontendFiles(blueprint);
  assert.ok(backend["openapi.yaml"].includes("/api/expenses"));
  assert.ok(backend["src/modules/expenses.js"]);
  assert.ok(frontend["src/App.jsx"].includes("Expense Portal"));
  assert.ok(frontend["generation-blueprint.json"]);
});
