import assert from "node:assert/strict";
import test from "node:test";
import { GitHubProvider } from "../src/provisioning/githubProvider.js";

test("generated branch can become the GitHub repository default", async () => {
  const calls = [];
  const provider = new GitHubProvider({ appId: "1", privateKey: "key", apiUrl: "https://api.github.test" });
  provider.request = async (path, options) => { calls.push({ path, options }); return { default_branch: options.body.default_branch }; };

  const repository = await provider.setDefaultBranch({ token: "token", owner: "Execution AI", repository: "portal-web", branch: "execution-ai/generation-3" });

  assert.equal(repository.default_branch, "execution-ai/generation-3");
  assert.deepEqual(calls, [{
    path: "/repos/Execution%20AI/portal-web",
    options: { method: "PATCH", token: "token", body: { default_branch: "execution-ai/generation-3" } },
  }]);
});
