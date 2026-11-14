import { query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";

export async function reconcileGenerationDeployment(generationJobId) {
  const context = await query(`select gj.id,gj.project_id,gj.organization_id,gj.result,pc.external_owner,pc.installation_id from generation_jobs gj join provider_connections pc on pc.id=gj.provider_connection_id where gj.id=$1 and gj.status='ready'`, [generationJobId]);
  if (!context.rowCount) return;
  const job = context.rows[0];
  const frontend = job.result?.repositories?.find((repository) => repository.type === "Frontend");
  const branch = job.result?.branch;
  if (!frontend?.name || !branch) return;
  const github = new GitHubProvider();
  const token = await github.createInstallationToken(job.installation_id);
  let runs;
  try { runs = await github.getWorkflowRuns({ token, owner: job.external_owner, repository: frontend.name, branch }); }
  catch (error) { if (error.status === 404) return; throw error; }
  const requestedAt = job.result?.deployment?.requestedAt ? new Date(job.result.deployment.requestedAt).getTime() : 0;
  const run = requestedAt ? runs.find((item) => new Date(item.created_at).getTime() >= requestedAt - 5000) : runs[0];
  if (!run) return;
  const deployment = generationDeploymentFromRun(run, job.external_owner, frontend.name);
  const current = job.result.deployment || {};
  if (current.workflowRunId === deployment.workflowRunId && current.status === deployment.status) return;
  const result = { ...job.result, deployment };
  await query("update generation_jobs set result=$1,updated_at=now() where id=$2", [result, job.id]);
  await query("update projects set data=jsonb_set(data,'{generation,deployment}',$1::jsonb,true),updated_at=now() where id=$2 and organization_id=$3", [JSON.stringify(deployment), job.project_id, job.organization_id]);
}

export function generationDeploymentFromRun(run, owner, repository) {
  if (run.status !== "completed") return { status: "queued", url: null, workflowRunId: run.id, detailsUrl: run.html_url, message: "GitHub Pages deployment is still running." };
  if (run.conclusion === "success") return { status: "ready", url: `https://${String(owner).toLowerCase()}.github.io/${repository}/`, workflowRunId: run.id, detailsUrl: run.html_url };
  return { status: "failed", url: null, workflowRunId: run.id, detailsUrl: run.html_url, message: `Initial preview deployment failed with ${run.conclusion || "an unknown error"}.` };
}
