import { query } from "../db.js";
import { createApplicationBlueprint } from "./blueprint.js";
import { generatedBackendFiles, generatedFrontendFiles } from "./templates.js";

export async function executeGenerationJob(job, github) {
  const blueprint = createApplicationBlueprint(job.project_data);
  const blueprintRow = await step(job.id, "saving_blueprint", async () => {
    const result = await query(`insert into application_blueprints (organization_id, project_id, version, specification) values ($1, $2, $3, $4) on conflict (project_id, version) do update set specification = excluded.specification, updated_at = now() returning id`, [job.organization_id, job.project_id, blueprint.version, blueprint]);
    await query("update generation_jobs set blueprint_id = $1 where id = $2", [result.rows[0].id, job.id]);
    return result.rows[0];
  });
  const token = await step(job.id, "obtaining_installation_token", () => github.createInstallationToken(job.installation_id));
  const branch = `execution-ai/generation-${blueprint.version}`;
  const backend = repository(job.repositories, "Backend");
  const frontend = repository(job.repositories, "Frontend");
  const backendCommit = await step(job.id, "generating_backend", () => github.commitFiles({ token, owner: job.external_owner, repository: backend.name, branch, files: generatedBackendFiles(blueprint), message: `feat: generate ${job.project_data.name} backend` }));
  const frontendCommit = await step(job.id, "generating_frontend", () => github.commitFiles({ token, owner: job.external_owner, repository: frontend.name, branch, files: generatedFrontendFiles(blueprint), message: `feat: generate ${job.project_data.name} frontend` }));
  const result = { blueprintId: blueprintRow.id, blueprintVersion: blueprint.version, branch, repositories: [{ type: "Backend", name: backend.name, ...backendCommit }, { type: "Frontend", name: frontend.name, ...frontendCommit }], completedAt: new Date().toISOString() };
  await query("update generation_jobs set status = 'ready', current_step = 'complete', result = $1, error = null, locked_at = null, locked_by = null, updated_at = now() where id = $2", [result, job.id]);
  await query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2 and organization_id = $3", [JSON.stringify({ generation: { status: "ready", jobId: job.id, ...result } }), job.project_id, job.organization_id]);
  return result;
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
