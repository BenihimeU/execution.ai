import process from "node:process";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { pool, query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";
import { ChangeAiProvider } from "./aiProvider.js";
import { executeChangeJob } from "./executor.js";

const workerId = `${process.pid}:${randomUUID()}`;
const github = new GitHubProvider();
const ai = new ChangeAiProvider();
let stopping = false;

export async function runOnce() {
  const job = await claimJob();
  if (!job) return false;
  try { await executeChangeJob(job, github, ai); }
  catch (error) { await failJob(job, error); }
  return true;
}

async function claimJob() {
  const claimed = await query(`with candidate as (select id from change_jobs where status in ('queued','retrying') and available_at <= now() order by created_at for update skip locked limit 1) update change_jobs j set status='running', current_step='validating', attempts=attempts+1, locked_at=now(), locked_by=$1, updated_at=now() from candidate c where j.id=c.id returning j.*`, [workerId]);
  if (!claimed.rowCount) return null;
  const job = claimed.rows[0];
  const context = await query(`select cr.sequence, cr.title, cr.discussion, cr.acceptance_criteria, cr.repositories, p.data as project_data, pc.external_owner, pc.installation_id, gj.result->>'branch' as base_branch, gj.result->'repositories' as generated_repositories from change_requests cr join projects p on p.id=cr.project_id join provider_connections pc on pc.id=$1 join lateral (select result from generation_jobs where project_id=cr.project_id and status='ready' order by updated_at desc limit 1) gj on true where cr.id=$2 and cr.organization_id=$3`, [job.provider_connection_id, job.change_request_id, job.organization_id]);
  if (!context.rowCount) throw Object.assign(new Error("Approved change request or generated repository baseline is missing"), { retryable: false });
  return { ...job, ...context.rows[0] };
}

async function failJob(job, error) {
  const retryable = error.retryable !== false && job.attempts < config.workerMaxAttempts;
  const delay = error.retryAfter || Math.min(300, 2 ** job.attempts * 15);
  const current = await query("select current_step from change_jobs where id=$1", [job.id]);
  const failedStep = current.rows[0]?.current_step || "unknown";
  await query(`update change_jobs set status=$1, current_step=$2, error=$3, available_at=now()+($4*interval '1 second'), locked_at=null, locked_by=null, updated_at=now() where id=$5`, [retryable ? "retrying" : "failed", `failed:${failedStep}`, { message: error.message, code: error.code || null, status: error.status || null, step: failedStep, at: new Date().toISOString() }, delay, job.id]);
}

async function main() {
  console.log(`Change worker ${workerId} started with ${config.aiProvider}:${config.aiModel}`);
  while (!stopping) {
    const worked = await runOnce().catch((error) => { console.error("Change worker iteration failed", error); return false; });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  }
  await pool.end();
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; }); main();
}
