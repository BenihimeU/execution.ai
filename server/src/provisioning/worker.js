import process from "node:process";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { pool, query } from "../db.js";
import { executeProvisioningJob } from "./executor.js";
import { GitHubProvider } from "./githubProvider.js";

const workerId = `${process.pid}:${randomUUID()}`;
const github = new GitHubProvider();
let stopping = false;

export async function runOnce() {
  const job = await claimJob();
  if (!job) return false;
  try { await executeProvisioningJob(job, github); }
  catch (error) { await failJob(job, error); }
  return true;
}

async function claimJob() {
  const result = await query(`
    with candidate as (
      select id from provisioning_jobs
      where status in ('queued', 'retrying') and available_at <= now()
      order by created_at for update skip locked limit 1
    )
    update provisioning_jobs j
       set status = 'running', locked_at = now(), locked_by = $1,
           attempts = attempts + 1, current_step = 'validating', updated_at = now()
      from candidate c
     where j.id = c.id
    returning j.*
  `, [workerId]);
  if (!result.rowCount) return null;
  const job = result.rows[0];
  const context = await query(`select p.data as project_data, pc.external_owner, pc.external_account_type, pc.installation_id from projects p join provider_connections pc on pc.id = $1 where p.id = $2 and p.organization_id = $3`, [job.provider_connection_id, job.project_id, job.organization_id]);
  if (!context.rowCount) throw new Error("Provisioning context no longer exists");
  return { ...job, ...context.rows[0] };
}

async function failJob(job, error) {
  const retryable = error.retryable !== false && job.attempts < config.workerMaxAttempts;
  const resetDelay = error.rateLimitReset ? Math.max(30, Number(error.rateLimitReset) - Math.floor(Date.now() / 1000) + 5) : 0;
  const delaySeconds = error.retryAfter || resetDelay || Math.min(300, 2 ** job.attempts * 15);
  const current = await query("select current_step from provisioning_jobs where id = $1", [job.id]);
  const failedStep = current.rows[0]?.current_step || "unknown";
  await query(`update provisioning_jobs set status = $1, current_step = $2, error = $3, available_at = now() + ($4 * interval '1 second'), locked_at = null, locked_by = null, updated_at = now() where id = $5`, [retryable ? "retrying" : "failed", `failed:${failedStep}`, { message: error.message, code: error.code || null, status: error.status || null, step: failedStep, retryAfter: error.retryAfter || null, rateLimitRemaining: error.rateLimitRemaining ?? null, rateLimitReset: error.rateLimitReset ?? null, documentationUrl: error.documentationUrl || null, at: new Date().toISOString() }, delaySeconds, job.id]);
}

async function main() {
  console.log(`Provisioning worker ${workerId} started`);
  while (!stopping) {
    const worked = await runOnce().catch((error) => { console.error("Worker iteration failed", error); return false; });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  }
  await pool.end();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  main();
}
