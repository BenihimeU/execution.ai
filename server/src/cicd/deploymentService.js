import { query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";
import { deployWorkflow } from "../provisioning/templates.js";

export async function dispatchDeployments(job, deployments, environment) {
  const github = new GitHubProvider();
  const token = await github.createInstallationToken(job.installation_id);
  const configuration = job.environment_configuration || {};
  const inputs = { environment, provider: job.deployment_provider || "github", aws_region: configuration.awsRegion || "", aws_role_arn: configuration.awsRoleArn || "" };
  for (const deployment of deployments) {
    if ((job.deployment_provider || "github") === "github") {
      await github.ensurePagesSite({ token, owner: job.external_owner, repository: deployment.repositoryName });
      await github.ensureEnvironment({ token, owner: job.external_owner, repository: { name: deployment.repositoryName }, environment: { name: "github-pages", protection: "custom" } });
      await github.ensureEnvironmentBranchPolicy({ token, owner: job.external_owner, repository: deployment.repositoryName, environment: "github-pages", branch: deployment.branch });
    }
    await github.ensureFiles({ token, owner: job.external_owner, repository: deployment.repositoryName, branch: deployment.branch, files: { ".github/workflows/deploy.yml": deployWorkflow } });
    await github.dispatchWorkflow({ token, owner: job.external_owner, repository: deployment.repositoryName, ref: deployment.branch, inputs });
    await query("update deployments set status='queued',updated_at=now() where id=$1", [deployment.id]);
  }
}

export async function autoDeployDevelopment(changeJobId) {
  const context = await query(`select cj.*,pc.external_owner,pc.installation_id,e.id as environment_id,e.name as environment,e.deployment_provider,e.configuration as environment_configuration from change_jobs cj join provider_connections pc on pc.id=cj.provider_connection_id join lateral (select * from project_environments where project_id=cj.project_id and environment_type='development' order by case when lower(name)='development' then 0 else 1 end,created_at limit 1) e on true where cj.id=$1 and cj.status='merged'`, [changeJobId]);
  if (!context.rowCount) return [];
  const job = context.rows[0];
  const repositories = (job.result?.repositories || []).filter((repository) => job.deployment_provider !== "github" || repository.type === "Frontend");
  const created = [];
  const github = new GitHubProvider();
  const token = await github.createInstallationToken(job.installation_id);
  for (const repository of repositories) {
    const existing = await query("select id from deployments where change_job_id=$1 and environment_id=$2 and repository_name=$3 limit 1", [job.id, job.environment_id, repository.name]);
    if (existing.rowCount) continue;
    const metadata = await github.getRepository({ token, owner: job.external_owner, repository: repository.name });
    const branch = selectDeploymentBranch(metadata, job.base_branch);
    const row = (await query(`insert into deployments (organization_id,project_id,change_job_id,environment_id,repository_type,repository_name,branch,commit_sha,status) values ($1,$2,$3,$4,$5,$6,$7,$8,'queued') returning id,repository_type as "repositoryType",repository_name as "repositoryName",branch,status`, [job.organization_id, job.project_id, job.id, job.environment_id, repository.type, repository.name, branch, repository.commitSha || null])).rows[0];
    created.push(row);
  }
  if (!created.length) return [];
  try { await dispatchDeployments(job, created, job.environment); }
  catch (error) {
    await query("update deployments set status='failed',error=$1,updated_at=now() where id=any($2::uuid[])", [{ message: error.message, status: error.status || null }, created.map((deployment) => deployment.id)]);
  }
  return created;
}

export function selectDeploymentBranch(repository, fallback) { return repository?.default_branch || fallback || "main"; }
