import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";
import { autoDeployDevelopment } from "./deploymentService.js";

export function verifyGitHubWebhook(rawBody, signature) {
  if (!config.githubWebhookSecret) throw Object.assign(new Error("GitHub webhook secret is not configured"), { status: 503 });
  const expected = `sha256=${createHmac("sha256", config.githubWebhookSecret).update(rawBody).digest("hex")}`;
  const supplied = String(signature || "");
  if (expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw Object.assign(new Error("Invalid GitHub webhook signature"), { status: 401 });
}

export async function handleGitHubWebhook(event, payload) {
  if (event === "workflow_run") return handleWorkflowRun(payload);
  if (event === "deployment_status") return handleDeploymentStatus(payload);
  if (event === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) return handleMergedPullRequest(payload);
  return null;
}

async function handleWorkflowRun(payload) {
  const run = payload.workflow_run;
  const repository = payload.repository;
  const owner = repository?.owner?.login;
  if (!run || !repository || !owner) return null;
  if (/deploy/i.test(run.name || "")) return handleDeploymentWorkflow(payload);
  const context = await findChangeJob(owner, repository.name, run.head_branch);
  if (!context) return null;
  await query(`insert into cicd_runs (organization_id,project_id,change_job_id,repository_type,repository_name,workflow_run_id,workflow_name,commit_sha,branch,status,conclusion,details_url,started_at,completed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (repository_name,workflow_run_id) do update set status=excluded.status,conclusion=excluded.conclusion,details_url=excluded.details_url,started_at=excluded.started_at,completed_at=excluded.completed_at,updated_at=now()`, [context.organization_id, context.project_id, context.id, context.repository_type, repository.name, run.id, run.name, run.head_sha, run.head_branch, run.status, run.conclusion, run.html_url, run.run_started_at || null, run.updated_at || null]);
  await reconcileChangeJob(context.id, context.expected_repositories);
  return context.id;
}

async function findChangeJob(owner, repository, branch) {
  const result = await query(`select cj.id,cj.organization_id,cj.project_id,cr.repositories as expected_repositories,r.item->>'type' as repository_type from change_jobs cj join change_requests cr on cr.id=cj.change_request_id join provider_connections pc on pc.id=cj.provider_connection_id cross join lateral jsonb_array_elements(cj.result->'repositories') r(item) where pc.external_owner=$1 and r.item->>'name'=$2 and cj.result->>'branch'=$3 order by cj.updated_at desc limit 1`, [owner, repository, branch]);
  return result.rows[0] || null;
}

async function reconcileChangeJob(jobId, expectedRepositories) {
  const latest = await query(`select distinct on (repository_name) repository_name,status,conclusion from cicd_runs where change_job_id=$1 order by repository_name,updated_at desc`, [jobId]);
  const expected = Array.isArray(expectedRepositories) ? expectedRepositories.length : 1;
  const failed = latest.rows.some((run) => run.status === "completed" && run.conclusion !== "success");
  const succeeded = latest.rows.filter((run) => run.status === "completed" && run.conclusion === "success").length;
  const status = failed ? "ci_failed" : succeeded >= expected ? "ready_to_merge" : "ci_running";
  await query("update change_jobs set status=$1,current_step=$2,updated_at=now() where id=$3", [status, status, jobId]);
  const requestStatus = status === "ready_to_merge" ? "ready_to_merge" : status === "ci_failed" ? "ci_failed" : "implementing";
  await query("update change_requests set status=$1,updated_at=now() where id=(select change_request_id from change_jobs where id=$2)", [requestStatus, jobId]);
}

async function handleMergedPullRequest(payload) {
  const branch = payload.pull_request.head.ref;
  const repository = payload.repository.name;
  const owner = payload.repository.owner.login;
  const context = await findChangeJob(owner, repository, branch);
  if (!context) return null;
  const details = await query(`select cj.result,pc.installation_id from change_jobs cj join provider_connections pc on pc.id=cj.provider_connection_id where cj.id=$1`, [context.id]);
  const job = details.rows[0];
  const repositories = job?.result?.repositories || [];
  if (!repositories.length || repositories.some((item) => !item.pullRequestNumber)) return context.id;
  const github = new GitHubProvider();
  const token = await github.createInstallationToken(job.installation_id);
  const pullRequests = await Promise.all(repositories.map((item) => github.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(item.name)}/pulls/${item.pullRequestNumber}`, { token })));
  if (!pullRequests.every((pullRequest) => pullRequest.merged)) return context.id;
  await query("update change_jobs set status='merged',current_step='merged',updated_at=now() where id=$1", [context.id]);
  await query("update change_requests set status='implemented',updated_at=now() where id=(select change_request_id from change_jobs where id=$1)", [context.id]);
  await autoDeployDevelopment(context.id);
  return context.id;
}

async function handleDeploymentWorkflow(payload) {
  const run = payload.workflow_run;
  const repository = payload.repository.name;
  const status = run.status === "completed" ? (run.conclusion === "success" ? "ready" : "failed") : "running";
  const owner = payload.repository.owner.login;
  const previewUrl = status === "ready" ? `https://${owner.toLowerCase()}.github.io/${repository}/` : null;
  const failure = run.conclusion && run.conclusion !== "success" ? { conclusion: run.conclusion, message: "GitHub Actions deployment failed. Open the workflow run for the failed step and logs.", detailsUrl: run.html_url } : null;
  const result = await query(`update deployments set status=$1,workflow_run_id=$2,commit_sha=coalesce(commit_sha,$3),environment_url=case when repository_type='Frontend' then coalesce($4,environment_url) else environment_url end,error=$5,updated_at=now() where id=(select id from deployments where repository_name=$6 and branch=$7 and status in ('queued','running') order by created_at desc limit 1) returning change_job_id`, [status, run.id, run.head_sha, previewUrl, failure, repository, run.head_branch]);
  return result.rows[0]?.change_job_id || null;
}

async function handleDeploymentStatus(payload) {
  const repository = payload.repository?.name;
  const status = payload.deployment_status;
  if (!repository || !status) return null;
  const result = await query(`update deployments set status=$1,environment_url=coalesce($2,environment_url),updated_at=now() where id=(select id from deployments where repository_name=$3 order by created_at desc limit 1) returning change_job_id`, [status.state, status.environment_url || null, repository]);
  return result.rows[0]?.change_job_id || null;
}
