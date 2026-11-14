import { query } from "../db.js";
import { createApplicationBlueprint } from "./blueprint.js";
import { generatedBackendFiles, generatedFrontendFiles } from "./templates.js";
import { deployWorkflow } from "../provisioning/templates.js";

export async function executeGenerationJob(job, github, ai) {
  const blueprint = createApplicationBlueprint(job.project_data);
  const blueprintRow = await step(job.id, "saving_blueprint", async () => {
    const result = await query(`insert into application_blueprints (organization_id, project_id, version, specification) values ($1, $2, $3, $4) on conflict (project_id, version) do update set specification = excluded.specification, updated_at = now() returning id`, [job.organization_id, job.project_id, blueprint.version, blueprint]);
    await query("update generation_jobs set blueprint_id = $1 where id = $2", [result.rows[0].id, job.id]);
    return result.rows[0];
  });
  const token = await step(job.id, "obtaining_installation_token", () => github.createInstallationToken(job.installation_id));
  const branch = `execution-ai/generation-${blueprint.version}`;
  const frontend = repository(job.repositories, "Frontend");
  const backend = job.repositories.find((item) => item.type === "Backend");
  const backendGeneration = backend ? await step(job.id, "generating_backend", () => generateRepository(ai, "Backend", blueprint, generatedBackendFiles(blueprint))) : null;
  const backendCommit = backend ? await step(job.id, "committing_backend", () => github.commitFiles({ token, owner: job.external_owner, repository: backend.name, branch, files: backendGeneration.files, message: `feat: generate ${job.project_data.name} backend` })) : null;
  const frontendGeneration = await step(job.id, "generating_frontend", () => generateRepository(ai, "Frontend", blueprint, generatedFrontendFiles(blueprint)));
  const frontendCommit = await step(job.id, "committing_frontend", () => github.commitFiles({ token, owner: job.external_owner, repository: frontend.name, branch, files: frontendGeneration.files, message: `feat: generate ${job.project_data.name} frontend` }));
  if (backend) await step(job.id, "setting_backend_default_branch", () => github.setDefaultBranch({ token, owner: job.external_owner, repository: backend.name, branch }));
  await step(job.id, "setting_frontend_default_branch", () => github.setDefaultBranch({ token, owner: job.external_owner, repository: frontend.name, branch }));
  const deployment = await step(job.id, "deploying_preview", () => deployInitialPreview({ github, token, owner: job.external_owner, repository: frontend.name, branch }));
  const result = { blueprintId: blueprintRow.id, blueprintVersion: blueprint.version, generationMode: "ai-assisted", branch, repositories: [...(backend ? [{ type: "Backend", name: backend.name, summary: backendGeneration.summary, ...backendCommit }] : []), { type: "Frontend", name: frontend.name, summary: frontendGeneration.summary, ...frontendCommit }], deployment, completedAt: new Date().toISOString() };
  await query("update generation_jobs set status = 'ready', current_step = 'complete', result = $1, error = null, locked_at = null, locked_by = null, updated_at = now() where id = $2", [result, job.id]);
  await query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2 and organization_id = $3", [JSON.stringify({ generation: { status: "ready", jobId: job.id, ...result } }), job.project_id, job.organization_id]);
  return result;
}

async function deployInitialPreview({ github, token, owner, repository, branch }) {
  try {
    await github.ensurePagesSite({ token, owner, repository });
    await github.ensureEnvironment({ token, owner, repository: { name: repository }, environment: { name: "github-pages", protection: "custom" } });
    await github.ensureEnvironmentBranchPolicy({ token, owner, repository, environment: "github-pages", branch });
    await github.ensureFiles({ token, owner, repository, branch, files: { ".github/workflows/deploy.yml": deployWorkflow } });
    const startedAt = Date.now() - 30_000;
    await github.dispatchWorkflow({ token, owner, repository, ref: branch, inputs: { environment: "Development", provider: "github", aws_region: "", aws_role_arn: "" } });
    const run = await waitForDeploymentRun({ github, token, owner, repository, branch, startedAt });
    if (!run) return { status: "queued", url: null, message: "GitHub accepted the preview deployment. Open Actions to follow its progress." };
    if (run.conclusion !== "success") return { status: "failed", url: null, workflowRunId: run.id, detailsUrl: run.html_url, message: `Initial preview deployment failed with ${run.conclusion || run.status}.` };
    return { status: "ready", url: `https://${owner.toLowerCase()}.github.io/${repository}/`, workflowRunId: run.id, detailsUrl: run.html_url };
  } catch (error) {
    return { status: "failed", url: null, message: error.message, statusCode: error.status || null, documentationUrl: error.documentationUrl || null };
  }
}

async function waitForDeploymentRun({ github, token, owner, repository, branch, startedAt }) {
  let run = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!run) {
      const runs = await github.getWorkflowRuns({ token, owner, repository, branch });
      run = runs.find((item) => new Date(item.created_at).getTime() >= startedAt) || null;
    } else run = await github.getWorkflowRun({ token, owner, repository, runId: run.id });
    if (run?.status === "completed") return run;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return run;
}

async function generateRepository(ai, repositoryType, blueprint, baselineFiles) {
  if (!ai) return { summary: "Generated from the approved application blueprint", files: baselineFiles };
  const generated = await ai.generateRepository({ blueprint, repositoryType, baselineFiles });
  return { summary: generated.summary, files: { ...baselineFiles, ...generated.files } };
}

async function step(jobId, name, action) {
  await query("update generation_jobs set status = 'running', current_step = $1, updated_at = now() where id = $2", [name, jobId]);
  return action();
}

function repository(repositories, type) {
  const match = repositories.find((item) => item.type === type);
  if (!match?.name) throw Object.assign(new Error(`${type} repository is missing from the provisioning result`), { retryable: false });
  return match;
}
