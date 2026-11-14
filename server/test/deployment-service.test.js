import assert from "node:assert/strict";
import test from "node:test";
import { selectDeploymentBranch } from "../src/cicd/deploymentService.js";

test("deployment uses the repository's current GitHub default branch", () => {
  assert.equal(selectDeploymentBranch({ default_branch: "execution-ai/generation-3" }, "main"), "execution-ai/generation-3");
});

test("deployment falls back safely when repository metadata has no default branch", () => {
  assert.equal(selectDeploymentBranch({}, "execution-ai/generation-2"), "execution-ai/generation-2");
  assert.equal(selectDeploymentBranch({}, ""), "main");
});
