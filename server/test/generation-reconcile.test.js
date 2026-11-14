import assert from "node:assert/strict";
import test from "node:test";
import { generationDeploymentFromRun } from "../src/generation/reconcile.js";

test("successful Pages rerun replaces a stale deployment error with its URL", () => {
  const deployment = generationDeploymentFromRun({ id: 42, status: "completed", conclusion: "success", html_url: "https://github.com/example/run/42" }, "Example-Org", "portal-web");
  assert.equal(deployment.status, "ready");
  assert.equal(deployment.url, "https://example-org.github.io/portal-web/");
  assert.equal(deployment.workflowRunId, 42);
});

test("failed and running Pages workflows remain actionable", () => {
  assert.equal(generationDeploymentFromRun({ id: 1, status: "in_progress", html_url: "run" }, "org", "repo").status, "queued");
  const failed = generationDeploymentFromRun({ id: 2, status: "completed", conclusion: "failure", html_url: "run" }, "org", "repo");
  assert.equal(failed.status, "failed");
  assert.equal(failed.detailsUrl, "run");
});
