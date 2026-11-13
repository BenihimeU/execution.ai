import assert from "node:assert/strict";
import test from "node:test";
import { buildProvisioningManifest } from "../src/provisioning.js";

test("provisioning requires an approved delivery plan", () => {
  assert.throws(() => buildProvisioningManifest("project-1", { name: "Portal", projectPlan: { status: "review" } }), /approved/);
});

test("provisioning produces private repositories and environment pipelines", () => {
  const manifest = buildProvisioningManifest("project-1", { name: "Client Portal", projectPlan: { status: "approved", version: 2 }, environments: ["Development", "Production"] });
  assert.equal(manifest.idempotencyKey, "project-1:plan-2");
  assert.deepEqual(manifest.repositories.map((repo) => repo.name), ["client-portal-web", "client-portal-api"]);
  assert.equal(manifest.repositories[0].visibility, "private");
  assert.equal("branchProtection" in manifest.repositories[0], false);
  assert.equal(manifest.environments[1].protection, "approval-required");
});
