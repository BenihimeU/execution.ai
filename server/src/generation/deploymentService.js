import { deployWorkflow } from "../provisioning/templates.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";

export async function redeployGeneratedApplication(job, github = new GitHubProvider()) {
  const frontend = job.result?.repositories?.find((repository) => repository.type === "Frontend");
  const branch = job.result?.branch;
  if (!frontend?.name || !branch) {
    const error = new Error("The generated frontend repository or branch is missing");
    error.status = 409;
    throw error;
  }

  const token = await github.createInstallationToken(job.installation_id);
  await github.setDefaultBranch({ token, owner: job.external_owner, repository: frontend.name, branch });
  await github.ensurePagesSite({ token, owner: job.external_owner, repository: frontend.name });
  await github.ensureEnvironment({ token, owner: job.external_owner, repository: { name: frontend.name }, environment: { name: "github-pages", protection: "custom" } });
  await github.ensureEnvironmentBranchPolicy({ token, owner: job.external_owner, repository: frontend.name, environment: "github-pages", branch });
  await github.ensureFiles({ token, owner: job.external_owner, repository: frontend.name, branch, files: { ".github/workflows/deploy.yml": deployWorkflow } });
  await github.dispatchWorkflow({ token, owner: job.external_owner, repository: frontend.name, ref: branch, inputs: { environment: "Development", provider: "github", aws_region: "", aws_role_arn: "" } });

  return {
    status: "queued",
    url: null,
    workflowRunId: null,
    detailsUrl: null,
    requestedAt: new Date().toISOString(),
    message: `Redeployment queued from ${branch}. Waiting for GitHub Actions.`,
  };
}
