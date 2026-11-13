import process from "node:process";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { pool, query } from "../db.js";
import { GitHubProvider } from "../provisioning/githubProvider.js";
import { executeGenerationJob } from "./executor.js";

const workerId = `${process.pid}:${randomUUID()}`;
const github = new GitHubProvider();
let stopping = false;

export async function runOnce() {
  const job = await claimJob();
  if (!job) return false;
  try { await executeGenerationJob(job, github); }
  catch (error) { await failJob(job, error); }
  return true;
}

async function claimJob() {
  const result = await query(`with candidate as (select id from generation_jobs where status in ('queued', 'retrying') and available_at <= now() order by created_at for update skip locked limit 1) update generation_jobs j set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, current_step = 'validating', updated_at = now() from candidate c where j.id = c.id returning j.*`, [workerId]);
  if (!result.rowCount) return null;
  const job = result.rows[0];
  const context = await query(`select p.data as project_data, pc.external_owner, pc.installation_id, pj.result->'repositories' as repositories from projects p join provider_connections pc on pc.id = $1 join lateral (select result from provisioning_jobs where project_id = p.id and status = 'ready' order by updated_at desc limit 1) pj on true where p.id = $2 and p.organization_id = $3`, [job.provider_connection_id, job.project_id, job.organization_id]);
  if (!context.rowCount) throw Object.assign(new Error("Generation context or ready provisioning result no longer exists"), { retryable: false });
  return { ...job, ...context.rows[0] };
}

async function failJob(job, error) {
  const retryable = error.retryable !== false && job.attempts < config.workerMaxAttempts;
  const delay = error.retryAfter || Math.min(300, 2 ** job.attempts * 15);
  const current = await query("select current_step from generation_jobs where id = $1", [job.id]);
  const failedStep = current.rows[0]?.current_step || "unknown";
  await query(`update generation_jobs set status = $1, current_step = $2, error = $3, available_at = now() + ($4 * interval '1 second'), locked_at = null, locked_by = null, updated_at = now() where id = $5`, [retryable ? "retrying" : "failed", `failed:${failedStep}`, { message: error.message, code: error.code || null, status: error.status || null, step: failedStep, at: new Date().toISOString() }, delay, job.id]);
}

async function main() {
  console.log(`Generation worker ${workerId} started`);
  while (!stopping) {
    const worked = await runOnce().catch((error) => { console.error("Generation worker iteration failed", error); return false; });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  }
  await pool.end();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  main();
}
