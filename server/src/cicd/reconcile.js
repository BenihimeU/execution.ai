import { query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";
import { autoDeployDevelopment } from "./deploymentService.js";

export async function reconcileChangeRuns(changeJobId) {
  const context = await query(`select cj.id,cj.organization_id,cj.project_id,cj.status,cj.result,cj.created_at,pc.external_owner,pc.installation_id from change_jobs cj join provider_connections pc on pc.id=cj.provider_connection_id where cj.id=$1 and cj.status in ('waiting_for_ci','ci_running','ci_failed')`, [changeJobId]);
  if (!context.rowCount) return;
  const job = context.rows[0];
  const repositories = job.result?.repositories || [];
  if (!repositories.length) return;
  const github = new GitHubProvider();
  const token = await github.createInstallationToken(job.installation_id);
  const earliest = new Date(job.created_at).getTime() - 60_000;
  for (const repository of repositories) {
    let runs;
    try { runs = await github.getWorkflowRuns({ token, owner: job.external_owner, repository: repository.name, workflow: "ci.yml", branch: job.result.branch, event: null }); }
    catch (error) { if (error.status === 404) continue; throw error; }
    const run = runs.find((item) => item.head_branch === job.result.branch && new Date(item.created_at).getTime() >= earliest);
    if (!run) continue;
    await query(`insert into cicd_runs (organization_id,project_id,change_job_id,repository_type,repository_name,workflow_run_id,workflow_name,commit_sha,branch,status,conclusion,details_url,started_at,completed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (repository_name,workflow_run_id) do update set status=excluded.status,conclusion=excluded.conclusion,details_url=excluded.details_url,started_at=excluded.started_at,completed_at=excluded.completed_at,updated_at=now()`, [job.organization_id, job.project_id, job.id, repository.type, repository.name, run.id, run.name, run.head_sha, run.head_branch, run.status, run.conclusion, run.html_url, run.run_started_at || null, run.updated_at || null]);
  }
  const latest = await query(`select distinct on (repository_name) repository_name,status,conclusion from cicd_runs where change_job_id=$1 order by repository_name,updated_at desc`, [job.id]);
  let status = deriveChangeStatus(latest.rows, repositories.length);
  if (status === "ready_to_merge" && repositories.every((repository) => repository.pullRequestNumber)) {
    const pullRequests = await Promise.all(repositories.map((repository) => github.request(`/repos/${encodeURIComponent(job.external_owner)}/${encodeURIComponent(repository.name)}/pulls/${repository.pullRequestNumber}`, { token })));
    if (pullRequests.every((pullRequest) => pullRequest.merged)) status = "merged";
  }
  await query("update change_jobs set status=$1,current_step=$1,updated_at=now() where id=$2", [status, job.id]);
  const requestStatus = status === "merged" ? "implemented" : status === "ready_to_merge" ? "ready_to_merge" : status === "ci_failed" ? "ci_failed" : "implementing";
  await query("update change_requests set status=$1,updated_at=now() where id=(select change_request_id from change_jobs where id=$2)", [requestStatus, job.id]);
  if (status === "merged") await autoDeployDevelopment(job.id);
}

export function deriveChangeStatus(runs, expectedCount) {
  if (runs.some((run) => run.status === "completed" && run.conclusion !== "success")) return "ci_failed";
  if (runs.filter((run) => run.status === "completed" && run.conclusion === "success").length >= expectedCount) return "ready_to_merge";
  if (runs.length) return "ci_running";
  return "waiting_for_ci";
}

export async function reconcileDeploymentRuns(changeJobId) {
  const pending = await query(`select d.id,d.repository_name,d.repository_type,d.branch,d.workflow_run_id,d.created_at,e.deployment_provider,pc.external_owner,pc.installation_id from deployments d join change_jobs cj on cj.id=d.change_job_id join project_environments e on e.id=d.environment_id join provider_connections pc on pc.id=cj.provider_connection_id where d.change_job_id=$1 and d.status in ('queued','running') order by d.created_at desc`, [changeJobId]);
  if (!pending.rowCount) return;
  const github = new GitHubProvider();
  const tokenCache = new Map();
  const usedRuns = new Set((await query("select workflow_run_id from deployments where change_job_id=$1 and workflow_run_id is not null", [changeJobId])).rows.map((row) => String(row.workflow_run_id)));
  for (const deployment of pending.rows) {
    let token = tokenCache.get(String(deployment.installation_id));
    if (!token) { token = await github.createInstallationToken(deployment.installation_id); tokenCache.set(String(deployment.installation_id), token); }
    let run;
    if (deployment.workflow_run_id) run = await github.getWorkflowRun({ token, owner: deployment.external_owner, repository: deployment.repository_name, runId: deployment.workflow_run_id });
    else {
      const runs = await github.getWorkflowRuns({ token, owner: deployment.external_owner, repository: deployment.repository_name, branch: deployment.branch });
      const createdAt = new Date(deployment.created_at).getTime() - 30_000;
      run = runs.find((item) => !usedRuns.has(String(item.id)) && new Date(item.created_at).getTime() >= createdAt);
    }
    if (!run) continue;
    usedRuns.add(String(run.id));
    const status = run.status === "completed" ? (run.conclusion === "success" ? "ready" : "failed") : run.status === "in_progress" ? "running" : "queued";
    const previewUrl = status === "ready" && deployment.deployment_provider === "github" && deployment.repository_type === "Frontend" ? githubPagesUrl(deployment.external_owner, deployment.repository_name) : null;
    const failure = status === "failed" ? { conclusion: run.conclusion, message: "GitHub Actions deployment failed. Open the workflow run for the failed step and logs.", detailsUrl: run.html_url } : null;
    await query("update deployments set status=$1,workflow_run_id=$2,commit_sha=coalesce(commit_sha,$3),environment_url=coalesce($4,environment_url),error=$5,updated_at=now() where id=$6", [status, run.id, run.head_sha || null, previewUrl, failure, deployment.id]);
  }
}

function githubPagesUrl(owner, repository) { return `https://${String(owner).toLowerCase()}.github.io/${repository}/`; }
