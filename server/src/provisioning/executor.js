import { query } from "../db.js";

export async function executeProvisioningJob(job, github) {
  const token = await step(job.id, "obtaining_installation_token", () => github.createInstallationToken(job.installation_id));
  const installation = job.external_account_type ? null : await step(job.id, "reading_installation_account", () => github.getInstallation(job.installation_id));
  const accountType = job.external_account_type || installation?.account?.type;
  const repositories = [];
  const warnings = [];

  for (const specification of job.manifest.repositories) {
    const repository = await step(job.id, `creating_${specification.type.toLowerCase()}_repository`, () => github.ensureRepository({ token, owner: job.external_owner, accountType, specification }));
    repositories.push(repository);
    await step(job.id, `seeding_${specification.type.toLowerCase()}_repository`, () => github.ensureTemplateFiles({ token, owner: job.external_owner, repository, projectName: job.project_data.name }));
    for (const environment of job.manifest.environments) {
      const environmentWarning = await optionalGitHubFeature(
        () => step(job.id, `configuring_${specification.type.toLowerCase()}_${slug(environment.name)}`, () => github.ensureEnvironment({ token, owner: job.external_owner, repository, environment })),
        { feature: "environment_protection", repository: repository.name, environment: environment.name, message: "Environment protection is unavailable on the current GitHub plan for this private repository." },
      );
      if (environmentWarning) warnings.push(environmentWarning);
    }
  }

  const result = { repositories: repositories.map((repository) => ({ id: repository.id, type: repository.type, name: repository.name, url: repository.html_url })), warnings, completedAt: new Date().toISOString() };
  await query("update provisioning_jobs set status = 'ready', current_step = 'complete', result = $1, error = null, locked_at = null, locked_by = null, updated_at = now() where id = $2", [result, job.id]);
  await query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2 and organization_id = $3", [JSON.stringify({ status: "In progress", provisioning: { ...job.manifest, status: "ready", provider: "github", ...result } }), job.project_id, job.organization_id]);
  return result;
}

async function step(jobId, name, action) {
  await query("update provisioning_jobs set status = 'running', current_step = $1, updated_at = now() where id = $2", [name, jobId]);
  return action();
}

async function optionalGitHubFeature(action, warning) {
  try { await action(); return null; }
  catch (error) {
    const unavailableOnPlan = error.status === 403 && /upgrade to github pro|make this repository public|not available.*private repositor/i.test(error.message || "");
    if (!unavailableOnPlan) throw error;
    return { ...warning, code: "GITHUB_PLAN_LIMITATION" };
  }
}

function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_"); }
