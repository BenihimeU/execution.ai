import assert from "node:assert/strict";
import test from "node:test";
import { redeployGeneratedApplication } from "../src/generation/deploymentService.js";

test("generation redeployment reuses the generated branch and frontend repository", async () => {
  const calls = [];
  const github = new Proxy({ createInstallationToken: async () => "token" }, {
    get(target, property) {
      if (property in target) return target[property];
      return async (input) => { calls.push({ method: property, input }); return null; };
    },
  });
  const deployment = await redeployGeneratedApplication({
    installation_id: "installation",
    external_owner: "ExecutionAI",
    result: { branch: "execution-ai/generation-4", repositories: [{ type: "Frontend", name: "portal-web" }] },
  }, github);

  assert.equal(deployment.status, "queued");
  assert.match(deployment.message, /execution-ai\/generation-4/);
  assert.deepEqual(calls.find((call) => call.method === "setDefaultBranch").input, { token: "token", owner: "ExecutionAI", repository: "portal-web", branch: "execution-ai/generation-4" });
  assert.deepEqual(calls.find((call) => call.method === "dispatchWorkflow").input.ref, "execution-ai/generation-4");
});

test("generation redeployment requires a generated frontend baseline", async () => {
  await assert.rejects(() => redeployGeneratedApplication({ result: {} }, {}), /frontend repository or branch is missing/);
});
