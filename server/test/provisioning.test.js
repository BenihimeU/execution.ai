import assert from "node:assert/strict";
import test from "node:test";
import { buildProvisioningManifest } from "../src/provisioning.js";
import { deployWorkflow, templateFiles } from "../src/provisioning/templates.js";

test("provisioning requires an approved delivery plan", () => {
  assert.throws(() => buildProvisioningManifest("project-1", { name: "Portal", projectPlan: { status: "review" } }), /approved/);
});

test("GitHub deployment publishes the frontend through Pages", () => {
  assert.match(deployWorkflow, /actions\/deploy-pages@v4/);
  assert.match(deployWorkflow, /npm run build -- --base/);
  assert.match(deployWorkflow, /pages: write/);
  assert.doesNotMatch(deployWorkflow, /enablement: true/);
  assert.match(deployWorkflow, /pull_request:\n {4}types: \[closed\]/);
  assert.match(deployWorkflow, /pull_request\.merged == true/);
  assert.match(deployWorkflow, /pull_request\.base\.ref/);
});

test("only generated frontend repositories auto-deploy merged pull requests", () => {
  const frontend = templateFiles("Frontend", "Portal")[".github/workflows/deploy.yml"];
  const backend = templateFiles("Backend", "Portal")[".github/workflows/deploy.yml"];
  assert.match(frontend, /pull_request:\n {4}types: \[closed\]/);
  assert.doesNotMatch(backend, /pull_request:\n {4}types: \[closed\]/);
});

test("generated CI reports lint issues without blocking delivery", () => {
  const frontend = templateFiles("Frontend", "Portal")[".github/workflows/ci.yml"];
  const backend = templateFiles("Backend", "Portal")[".github/workflows/ci.yml"];
  for (const workflow of [frontend, backend]) {
    assert.match(workflow, /Lint \(non-blocking\)/);
    assert.match(workflow, /continue-on-error: true/);
    assert.match(workflow, /npm run lint --if-present/);
    assert.doesNotMatch(workflow, /branches: \[main\]/);
  }
});

test("provisioning produces private repositories and environment pipelines", () => {
  const manifest = buildProvisioningManifest("project-1", { name: "Client Portal", projectPlan: { status: "approved", version: 2 }, environments: ["Development", "Production"] });
  assert.equal(manifest.idempotencyKey, "project-1:plan-2");
  assert.deepEqual(manifest.repositories.map((repo) => repo.name), ["client-portal-web", "client-portal-api"]);
  assert.equal(manifest.repositories[0].visibility, "private");
  assert.equal(manifest.repositories[0].defaultBranch, "execution-ai/generation-2");
  assert.equal(manifest.pipelines[0].trigger, "merge-to-execution-ai/generation-2");
  assert.equal("branchProtection" in manifest.repositories[0], false);
  assert.equal(manifest.environments[1].protection, "approval-required");
});

test("explicit frontend-only projects do not provision a backend repository", () => {
  const manifest = buildProvisioningManifest("project-2", { name: "Marketing Site", discussion: "Build a responsive static website. Backend is not required.", projectPlan: { status: "approved", version: 1 }, environments: ["Development"] });
  assert.deepEqual(manifest.repositories.map((repository) => repository.type), ["Frontend"]);
});
