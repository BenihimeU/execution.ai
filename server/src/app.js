import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { handleGitHubWebhook, verifyGitHubWebhook } from "./cicd/githubWebhook.js";
import { reconcileChangeRuns, reconcileDeploymentRuns } from "./cicd/reconcile.js";
import { autoDeployDevelopment, dispatchDeployments } from "./cicd/deploymentService.js";
import { config } from "./config.js";
import { createIntegrationState, createToken, requireAuth, verifyIntegrationState } from "./auth.js";
import { pool, query } from "./db.js";
import { buildProvisioningManifest } from "./provisioning.js";
import { GitHubProvider } from "./provisioning/githubProvider.js";
import { PlanningAiProvider } from "./planning/aiProvider.js";
import { reconcileGenerationDeployment } from "./generation/reconcile.js";
import { redeployGeneratedApplication } from "./generation/deploymentService.js";
import { changeRequestPatchSchema, changeRequestSchema, clientSchema, deploymentSchema, environmentSchema, githubCallbackSchema, loginSchema, planningAssistanceSchema, projectPatchSchema, projectSchema, registerSchema, validate } from "./validation.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.webOrigin }));
app.post("/api/webhooks/github", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    verifyGitHubWebhook(req.body, req.headers["x-hub-signature-256"]);
    const payload = JSON.parse(req.body.toString("utf8"));
    await handleGitHubWebhook(req.headers["x-github-event"], payload);
    res.status(202).json({ accepted: true });
  } catch (error) { next(error); }
});
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/ready", async (_req, res) => {
  try { await query("select 1"); res.json({ status: "ready" }); }
  catch { res.status(503).json({ status: "unavailable" }); }
});

app.post("/api/auth/register", validate(registerSchema), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select 1 from users where email = $1", [req.body.email]);
    if (existing.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "An account already exists for this email" }); }
    const organization = (await client.query("insert into organizations (name) values ($1) returning *", [req.body.name])).rows[0];
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = (await client.query("insert into users (organization_id, email, password_hash) values ($1, $2, $3) returning id, organization_id, email", [organization.id, req.body.email, passwordHash])).rows[0];
    await client.query("commit");
    res.status(201).json({ token: createToken(user), workspace: { organization: { id: organization.id, name: organization.name, email: user.email }, clients: [], projects: [] } });
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.post("/api/auth/login", validate(loginSchema), async (req, res, next) => {
  try {
    const user = (await query("select id, organization_id, email, password_hash from users where email = $1", [req.body.email])).rows[0];
    if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ token: createToken(user) });
  } catch (error) { next(error); }
});

app.get("/api/workspace", requireAuth, async (req, res, next) => {
  try {
    const [org, clients, projects] = await Promise.all([
      query("select o.id, o.name, u.email from organizations o join users u on u.organization_id = o.id where o.id = $1 and u.id = $2", [req.auth.organizationId, req.auth.sub]),
      query("select id, data, created_at from clients where organization_id = $1 order by created_at", [req.auth.organizationId]),
      query("select id, data, created_at from projects where organization_id = $1 order by created_at", [req.auth.organizationId]),
    ]);
    if (!org.rows[0]) return res.status(404).json({ error: "Workspace not found" });
    const hydrate = ({ id, data, created_at: createdAt }) => ({ ...data, id, createdAt });
    res.json({ organization: org.rows[0], clients: clients.rows.map(hydrate), projects: projects.rows.map(hydrate) });
  } catch (error) { next(error); }
});

app.post("/api/clients", requireAuth, validate(clientSchema), async (req, res, next) => {
  try { const row = (await query("insert into clients (organization_id, data) values ($1, $2) returning id, data, created_at", [req.auth.organizationId, req.body])).rows[0]; res.status(201).json({ ...row.data, id: row.id, createdAt: row.created_at }); }
  catch (error) { next(error); }
});

app.post("/api/projects", requireAuth, validate(projectSchema), async (req, res, next) => {
  try {
    const ownsClient = await query("select 1 from clients where id = $1 and organization_id = $2", [req.body.clientId, req.auth.organizationId]);
    if (!ownsClient.rowCount) return res.status(400).json({ error: "Client does not belong to this workspace" });
    const row = (await query("insert into projects (organization_id, client_id, data) values ($1, $2, $3) returning id, data, created_at", [req.auth.organizationId, req.body.clientId, req.body])).rows[0];
    res.status(201).json({ ...row.data, id: row.id, createdAt: row.created_at });
  } catch (error) { next(error); }
});

app.patch("/api/projects/:id", requireAuth, validate(projectPatchSchema), async (req, res, next) => {
  try {
    const result = await query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2 and organization_id = $3 returning id, data, created_at", [JSON.stringify(req.body), req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Project not found" });
    const row = result.rows[0]; res.json({ ...row.data, id: row.id, createdAt: row.created_at });
  } catch (error) { next(error); }
});

app.post("/api/projects/:id/plan-assistance", requireAuth, validate(planningAssistanceSchema), async (req, res, next) => {
  try {
    const result = await query("select data from projects where id=$1 and organization_id=$2", [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Project not found" });
    const project = result.rows[0].data;
    const generated = await new PlanningAiProvider().generate({ project, discussion: req.body.discussion, initialPlan: req.body.initialPlan });
    const version = Number(project.projectPlan?.version || 0) + 1;
    res.json({ plan: generated.initialPlan, projectPlan: { ...generated.projectPlan, version, generatedAt: new Date().toISOString() } });
  } catch (error) { next(error); }
});

app.get("/api/provider-connections/github/install-url", requireAuth, (req, res) => {
  if (!config.githubAppSlug || !config.githubAppId || !config.githubPrivateKey) return res.status(503).json({ error: "GitHub integration is not configured by the Execution AI administrator" });
  const state = createIntegrationState(req.auth);
  res.json({ url: `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new?state=${encodeURIComponent(state)}` });
});

// GitHub opens the App Setup URL in the browser with a GET request. Send that
// browser back to the SPA, which can use the signed state and the user's
// existing session to complete the connection through the authenticated POST
// endpoint below.
app.get("/api/provider-connections/github/complete", (req, res) => {
  const destination = new URL(config.webOrigin);
  for (const key of ["installation_id", "setup_action", "state"]) {
    if (typeof req.query[key] === "string") destination.searchParams.set(key, req.query[key]);
  }
  res.redirect(303, destination.toString());
});

app.post("/api/provider-connections/github/complete", requireAuth, validate(githubCallbackSchema), async (req, res, next) => {
  try {
    verifyIntegrationState(req.body.state, req.auth);
    const installation = await new GitHubProvider().getInstallation(req.body.installationId);
    if (!installation?.account?.login) return res.status(400).json({ error: "GitHub installation account could not be verified" });
    const result = await query(`insert into provider_connections (organization_id, provider, external_owner, external_account_type, installation_id, status, last_error) values ($1, 'github', $2, $3, $4, 'connected', null) on conflict (organization_id, provider) do update set external_owner = excluded.external_owner, external_account_type = excluded.external_account_type, installation_id = excluded.installation_id, status = 'connected', last_error = null, updated_at = now() returning id, provider, external_owner as owner, external_account_type as "accountType", installation_id as "installationId", status, last_error as "lastError", created_at as "createdAt"`, [req.auth.organizationId, installation.account.login, installation.account.type, req.body.installationId]);
    res.json(result.rows[0]);
  } catch (error) {
    if (error.status === 404) {
      return res.status(409).json({
        code: "GITHUB_INSTALLATION_NOT_ACCESSIBLE",
        error: "GitHub installation could not be accessed by the configured GitHub App. Verify that GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_PRIVATE_KEY all belong to the same App that was installed, then reconnect GitHub.",
      });
    }
    next(error);
  }
});

app.get("/api/provider-connections", requireAuth, async (req, res, next) => {
  try { const result = await query(`select id, provider, external_owner as owner, external_account_type as "accountType", installation_id as "installationId", status, last_error as "lastError", created_at as "createdAt" from provider_connections where organization_id = $1 order by provider`, [req.auth.organizationId]); res.json(result.rows); }
  catch (error) { next(error); }
});

app.delete("/api/provider-connections/github", requireAuth, async (req, res, next) => {
  try { await query("update provider_connections set status = 'disconnected', last_error = null, updated_at = now() where organization_id = $1 and provider = 'github'", [req.auth.organizationId]); res.status(204).end(); }
  catch (error) { next(error); }
});

app.post("/api/projects/:id/provision", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query("select id, data from projects where id = $1 and organization_id = $2 for update", [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Project not found" }); }
    const current = result.rows[0];
    const connection = await client.query("select id, status, last_error from provider_connections where organization_id = $1 and provider = 'github'", [req.auth.organizationId]);
    if (!connection.rowCount) { await client.query("rollback"); return res.status(409).json({ code: "PROVIDER_CONNECTION_REQUIRED", error: "Connect a GitHub organization before provisioning" }); }
    if (connection.rows[0].status !== "connected") { await client.query("rollback"); return res.status(409).json({ code: connection.rows[0].status === "needs_attention" ? "PROVIDER_CONNECTION_UNHEALTHY" : "PROVIDER_CONNECTION_REQUIRED", error: connection.rows[0].status === "needs_attention" ? "GitHub is blocking repository creation for this installation. Reconnect the App to a GitHub organization before provisioning." : "Connect GitHub before provisioning." }); }
    const manifest = buildProvisioningManifest(current.id, current.data);
    const job = await client.query(`
      insert into provisioning_jobs (organization_id, project_id, provider_connection_id, idempotency_key, manifest)
      values ($1, $2, $3, $4, $5)
      on conflict (idempotency_key) do update
        set provider_connection_id = excluded.provider_connection_id,
            manifest = excluded.manifest,
            status = case when provisioning_jobs.status = 'failed' then 'queued' else provisioning_jobs.status end,
            current_step = case when provisioning_jobs.status = 'failed' then 'queued' else provisioning_jobs.current_step end,
            result = case when provisioning_jobs.status = 'failed' then '{}'::jsonb else provisioning_jobs.result end,
            error = case when provisioning_jobs.status = 'failed' then null else provisioning_jobs.error end,
            attempts = case when provisioning_jobs.status = 'failed' then 0 else provisioning_jobs.attempts end,
            available_at = case when provisioning_jobs.status = 'failed' then now() else provisioning_jobs.available_at end,
            locked_at = case when provisioning_jobs.status = 'failed' then null else provisioning_jobs.locked_at end,
            locked_by = case when provisioning_jobs.status = 'failed' then null else provisioning_jobs.locked_by end,
            updated_at = now()
      returning id, status, current_step as "currentStep", created_at as "createdAt"
    `, [req.auth.organizationId, current.id, connection.rows[0].id, manifest.idempotencyKey, manifest]);
    const provisioning = { ...manifest, status: "queued", jobId: job.rows[0].id };
    await client.query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2", [JSON.stringify({ provisioning, status: "Provisioning" }), current.id]);
    await client.query("commit");
    res.status(202).json(job.rows[0]);
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.get("/api/provisioning-jobs/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`select id, project_id as "projectId", status, current_step as "currentStep", result, error, attempts, available_at as "nextRetryAt", created_at as "createdAt", updated_at as "updatedAt" from provisioning_jobs where id = $1 and organization_id = $2`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Provisioning job not found" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/provisioning-jobs/:id/retry", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`update provisioning_jobs set status = 'queued', current_step = 'queued', error = null, available_at = now(), locked_at = null, locked_by = null, updated_at = now() where id = $1 and organization_id = $2 and status = 'failed' returning id, status`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(409).json({ error: "Only failed jobs can be retried" });
    res.status(202).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/projects/:id/generate", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const project = await client.query("select id, data from projects where id = $1 and organization_id = $2 for update", [req.params.id, req.auth.organizationId]);
    if (!project.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Project not found" }); }
    if (project.rows[0].data.projectPlan?.status !== "approved") { await client.query("rollback"); return res.status(409).json({ error: "Approve the delivery plan before generating the application" }); }
    const existingBaseline = await client.query("select 1 from generation_jobs where project_id = $1 and organization_id = $2 and status = 'ready' limit 1", [req.params.id, req.auth.organizationId]);
    if (existingBaseline.rowCount) { await client.query("rollback"); return res.status(409).json({ code: "INITIAL_GENERATION_COMPLETE", error: "The initial application already exists. Create a change request for subsequent repository changes." }); }
    const provisioning = await client.query("select provider_connection_id from provisioning_jobs where project_id = $1 and organization_id = $2 and status = 'ready' order by updated_at desc limit 1", [req.params.id, req.auth.organizationId]);
    if (!provisioning.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Required repositories must finish provisioning before application generation" }); }
    const version = project.rows[0].data.projectPlan.version;
    const idempotencyKey = `${req.params.id}:generation-${version}`;
    const job = await client.query(`insert into generation_jobs (organization_id, project_id, provider_connection_id, idempotency_key) values ($1, $2, $3, $4) on conflict (idempotency_key) do update set status = case when generation_jobs.status = 'failed' then 'queued' else generation_jobs.status end, current_step = case when generation_jobs.status = 'failed' then 'queued' else generation_jobs.current_step end, error = case when generation_jobs.status = 'failed' then null else generation_jobs.error end, attempts = case when generation_jobs.status = 'failed' then 0 else generation_jobs.attempts end, available_at = case when generation_jobs.status = 'failed' then now() else generation_jobs.available_at end, locked_at = case when generation_jobs.status = 'failed' then null else generation_jobs.locked_at end, locked_by = case when generation_jobs.status = 'failed' then null else generation_jobs.locked_by end, updated_at = now() returning id, status, current_step as "currentStep", created_at as "createdAt"`, [req.auth.organizationId, req.params.id, provisioning.rows[0].provider_connection_id, idempotencyKey]);
    await client.query("update projects set data = data || $1::jsonb, updated_at = now() where id = $2", [JSON.stringify({ generation: { status: job.rows[0].status, jobId: job.rows[0].id, version } }), req.params.id]);
    await client.query("commit");
    res.status(202).json(job.rows[0]);
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.get("/api/generation-jobs/:id", requireAuth, async (req, res, next) => {
  try {
    const owned = await query("select 1 from generation_jobs where id=$1 and organization_id=$2", [req.params.id, req.auth.organizationId]);
    if (!owned.rowCount) return res.status(404).json({ error: "Generation job not found" });
    await reconcileGenerationDeployment(req.params.id);
    const result = await query(`select id, project_id as "projectId", blueprint_id as "blueprintId", status, current_step as "currentStep", result, error, attempts, available_at as "nextRetryAt", created_at as "createdAt", updated_at as "updatedAt" from generation_jobs where id = $1 and organization_id = $2`, [req.params.id, req.auth.organizationId]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/generation-jobs/:id/retry", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`update generation_jobs set status = 'queued', current_step = 'queued', error = null, attempts = 0, available_at = now(), locked_at = null, locked_by = null, updated_at = now() where id = $1 and organization_id = $2 and status = 'failed' returning id, status`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(409).json({ error: "Only failed generation jobs can be retried" });
    res.status(202).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/generation-jobs/:id/redeploy", requireAuth, async (req, res, next) => {
  try {
    const context = await query(`select gj.id,gj.project_id,gj.organization_id,gj.result,pc.external_owner,pc.installation_id from generation_jobs gj join provider_connections pc on pc.id=gj.provider_connection_id where gj.id=$1 and gj.organization_id=$2 and gj.status='ready'`, [req.params.id, req.auth.organizationId]);
    if (!context.rowCount) return res.status(409).json({ error: "A completed application generation is required before deployment can be retried" });
    const job = context.rows[0];
    const deployment = await redeployGeneratedApplication(job);
    const result = { ...job.result, deployment };
    await query("update generation_jobs set result=$1,updated_at=now() where id=$2", [result, job.id]);
    await query("update projects set data=jsonb_set(data,'{generation,deployment}',$1::jsonb,true),updated_at=now() where id=$2 and organization_id=$3", [JSON.stringify(deployment), job.project_id, job.organization_id]);
    res.status(202).json(deployment);
  } catch (error) { next(error); }
});

app.get("/api/projects/:id/blueprint", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`select b.id, b.version, b.status, b.specification, b.created_at as "createdAt" from application_blueprints b join projects p on p.id = b.project_id where b.project_id = $1 and p.organization_id = $2 order by b.version desc limit 1`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Application blueprint not found" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/projects/:id/change-requests", requireAuth, validate(changeRequestSchema), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const project = await client.query("select id from projects where id = $1 and organization_id = $2 for update", [req.params.id, req.auth.organizationId]);
    if (!project.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Project not found" }); }
    const baseline = await client.query("select result->'repositories' as repositories from generation_jobs where project_id = $1 and organization_id = $2 and status = 'ready' order by updated_at desc limit 1", [req.params.id, req.auth.organizationId]);
    if (!baseline.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Generate the initial application before creating a code change request" }); }
    const availableTypes = new Set((baseline.rows[0].repositories || []).map((repository) => repository.type));
    const unavailable = req.body.repositories.find((repository) => !availableTypes.has(repository));
    if (unavailable) { await client.query("rollback"); return res.status(409).json({ error: `${unavailable} repository is not part of this project's approved architecture` }); }
    const sequence = Number((await client.query("select coalesce(max(sequence), 0) + 1 as sequence from change_requests where project_id = $1", [req.params.id])).rows[0].sequence);
    const result = await client.query(`insert into change_requests (organization_id, project_id, created_by, sequence, title, discussion, acceptance_criteria, repositories) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, project_id as "projectId", sequence, title, discussion, acceptance_criteria as "acceptanceCriteria", repositories, status, approved_at as "approvedAt", created_at as "createdAt", updated_at as "updatedAt"`, [req.auth.organizationId, req.params.id, req.auth.sub, sequence, req.body.title, req.body.discussion, JSON.stringify(req.body.acceptanceCriteria), JSON.stringify(req.body.repositories)]);
    await client.query("commit");
    res.status(201).json(result.rows[0]);
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.get("/api/projects/:id/change-requests", requireAuth, async (req, res, next) => {
  try {
    const project = await query("select 1 from projects where id = $1 and organization_id = $2", [req.params.id, req.auth.organizationId]);
    if (!project.rowCount) return res.status(404).json({ error: "Project not found" });
    const result = await query(`select cr.id, cr.project_id as "projectId", cr.sequence, cr.title, cr.discussion, cr.acceptance_criteria as "acceptanceCriteria", cr.repositories, cr.status, cr.approved_at as "approvedAt", cr.created_at as "createdAt", cr.updated_at as "updatedAt", case when cj.id is null then null else jsonb_build_object('id',cj.id,'status',cj.status,'currentStep',cj.current_step,'result',cj.result,'error',cj.error,'attempts',cj.attempts,'updatedAt',cj.updated_at) end as job from change_requests cr left join change_jobs cj on cj.change_request_id=cr.id where cr.project_id = $1 and cr.organization_id = $2 order by cr.sequence desc`, [req.params.id, req.auth.organizationId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.patch("/api/change-requests/:id", requireAuth, validate(changeRequestPatchSchema), async (req, res, next) => {
  try {
    const fields = { title: req.body.title, discussion: req.body.discussion, acceptance_criteria: req.body.acceptanceCriteria, repositories: req.body.repositories };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    const assignments = updates.map(([field], index) => `${field} = $${index + 1}`).join(", ");
    const values = updates.map(([field, value]) => ["acceptance_criteria", "repositories"].includes(field) ? JSON.stringify(value) : value);
    const result = await query(`update change_requests set ${assignments}, updated_at = now() where id = $${values.length + 1} and organization_id = $${values.length + 2} and status = 'draft' returning id, project_id as "projectId", sequence, title, discussion, acceptance_criteria as "acceptanceCriteria", repositories, status, approved_at as "approvedAt", created_at as "createdAt", updated_at as "updatedAt"`, [...values, req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(409).json({ error: "Only an existing draft change request can be edited" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/change-requests/:id/approve", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await client.query(`select cr.*, pc.id as provider_connection_id from change_requests cr join provider_connections pc on pc.organization_id=cr.organization_id and pc.provider='github' and pc.status='connected' where cr.id=$1 and cr.organization_id=$2 and cr.status='draft' for update of cr`, [req.params.id, req.auth.organizationId]);
    if (!request.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Only a draft change request with a connected GitHub installation can be approved" }); }
    const baseline = await client.query("select 1 from generation_jobs where project_id=$1 and organization_id=$2 and status='ready' limit 1", [request.rows[0].project_id, req.auth.organizationId]);
    if (!baseline.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "A completed generated baseline is required before implementing changes" }); }
    const approved = await client.query(`update change_requests set status='approved', approved_at=now(), updated_at=now() where id=$1 returning id, project_id as "projectId", sequence, title, discussion, acceptance_criteria as "acceptanceCriteria", repositories, status, approved_at as "approvedAt", created_at as "createdAt", updated_at as "updatedAt"`, [req.params.id]);
    const job = await client.query(`insert into change_jobs (organization_id, project_id, change_request_id, provider_connection_id) values ($1,$2,$3,$4) returning id,status,current_step as "currentStep",result,error,attempts,updated_at as "updatedAt"`, [req.auth.organizationId, request.rows[0].project_id, req.params.id, request.rows[0].provider_connection_id]);
    await client.query("commit");
    res.json({ ...approved.rows[0], job: job.rows[0] });
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.post("/api/change-jobs/:id/retry", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`update change_jobs set status='queued',current_step='queued',error=null,attempts=0,available_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=$1 and organization_id=$2 and status='failed' returning id,status,current_step as "currentStep",result,error,attempts,updated_at as "updatedAt"`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(409).json({ error: "Only failed change jobs can be retried" });
    res.status(202).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/change-requests/:id/implement", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await client.query(`select cr.*, pc.id as provider_connection_id from change_requests cr join provider_connections pc on pc.organization_id=cr.organization_id and pc.provider='github' and pc.status='connected' left join change_jobs cj on cj.change_request_id=cr.id where cr.id=$1 and cr.organization_id=$2 and cr.status='approved' and cj.id is null for update of cr`, [req.params.id, req.auth.organizationId]);
    if (!request.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "This approved request already has an implementation job or GitHub is not connected" }); }
    const job = await client.query(`insert into change_jobs (organization_id,project_id,change_request_id,provider_connection_id) values ($1,$2,$3,$4) returning id,status,current_step as "currentStep",result,error,attempts,updated_at as "updatedAt"`, [req.auth.organizationId, request.rows[0].project_id, req.params.id, request.rows[0].provider_connection_id]);
    await client.query("commit");
    res.status(202).json(job.rows[0]);
  } catch (error) { await client.query("rollback"); next(error); }
  finally { client.release(); }
});

app.get("/api/change-jobs/:id/cicd", requireAuth, async (req, res, next) => {
  try {
    const owned = await query("select 1 from change_jobs where id=$1 and organization_id=$2", [req.params.id, req.auth.organizationId]);
    if (!owned.rowCount) return res.status(404).json({ error: "Change job not found" });
    await reconcileChangeRuns(req.params.id);
    await reconcileDeploymentRuns(req.params.id);
    const job = await query(`select id,status,current_step as "currentStep",result,error,attempts,updated_at as "updatedAt" from change_jobs where id=$1 and organization_id=$2`, [req.params.id, req.auth.organizationId]);
    const [runs, deployments] = await Promise.all([
      query(`select repository_type as "repositoryType",repository_name as "repositoryName",workflow_run_id as "workflowRunId",workflow_name as "workflowName",commit_sha as "commitSha",branch,status,conclusion,details_url as "detailsUrl",updated_at as "updatedAt" from cicd_runs where change_job_id=$1 order by updated_at desc`, [req.params.id]),
      query(`select d.id,d.environment_id as "environmentId",d.repository_type as "repositoryType",d.repository_name as "repositoryName",d.branch,d.commit_sha as "commitSha",d.status,d.workflow_run_id as "workflowRunId",d.environment_url as "environmentUrl",d.error,e.name as environment,e.requires_approval as "requiresApproval",d.created_at as "createdAt",d.updated_at as "updatedAt" from deployments d join project_environments e on e.id=d.environment_id where d.change_job_id=$1 order by d.created_at desc`, [req.params.id]),
    ]);
    res.json({ ...job.rows[0], runs: runs.rows, deployments: deployments.rows });
  } catch (error) { next(error); }
});

app.post("/api/change-jobs/:id/merge", requireAuth, async (req, res, next) => {
  try {
    const context = await query(`select cj.*,pc.external_owner,pc.installation_id from change_jobs cj join provider_connections pc on pc.id=cj.provider_connection_id where cj.id=$1 and cj.organization_id=$2 and cj.status='ready_to_merge'`, [req.params.id, req.auth.organizationId]);
    if (!context.rowCount) return res.status(409).json({ error: "Change job must have successful CI before merge" });
    const job = context.rows[0]; const repositories = job.result.repositories || [];
    if (repositories.some((repository) => !repository.pullRequestNumber)) return res.status(409).json({ error: "One or more repositories do not have a pull request to merge" });
    const github = new GitHubProvider(); const token = await github.createInstallationToken(job.installation_id);
    for (const repository of repositories) await github.mergePullRequest({ token, owner: job.external_owner, repository: repository.name, pullNumber: repository.pullRequestNumber });
    await query("update change_jobs set status='merged',current_step='merged',updated_at=now() where id=$1", [job.id]);
    await query("update change_requests set status='implemented',updated_at=now() where id=$1", [job.change_request_id]);
    await autoDeployDevelopment(job.id);
    res.json({ id: job.id, status: "merged" });
  } catch (error) { next(error); }
});

app.get("/api/projects/:id/environments", requireAuth, async (req, res, next) => {
  try { const result = await query(`select e.id,e.name,e.environment_type as "environmentType",e.deployment_provider as "deploymentProvider",e.deployment_strategy as "deploymentStrategy",e.requires_approval as "requiresApproval",e.configuration,e.created_at as "createdAt",e.updated_at as "updatedAt" from project_environments e join projects p on p.id=e.project_id where e.project_id=$1 and p.organization_id=$2 order by case e.environment_type when 'development' then 1 when 'test' then 2 when 'production' then 3 else 4 end,e.name`, [req.params.id, req.auth.organizationId]); res.json(result.rows); }
  catch (error) { next(error); }
});

app.post("/api/projects/:id/environments", requireAuth, validate(environmentSchema), async (req, res, next) => {
  try {
    const project = await query("select 1 from projects where id=$1 and organization_id=$2", [req.params.id, req.auth.organizationId]);
    if (!project.rowCount) return res.status(404).json({ error: "Project not found" });
    const configuration = req.body.configuration;
    const result = await query(`insert into project_environments (organization_id,project_id,name,environment_type,deployment_provider,deployment_strategy,requires_approval,configuration) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (project_id,name) do update set environment_type=excluded.environment_type,deployment_provider=excluded.deployment_provider,deployment_strategy=excluded.deployment_strategy,requires_approval=excluded.requires_approval,configuration=excluded.configuration,updated_at=now() returning id,name,environment_type as "environmentType",deployment_provider as "deploymentProvider",deployment_strategy as "deploymentStrategy",requires_approval as "requiresApproval",configuration`, [req.auth.organizationId, req.params.id, req.body.name, req.body.environmentType, req.body.deploymentProvider, req.body.deploymentStrategy, req.body.requiresApproval, configuration]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete("/api/projects/:id/environments/:environmentId", requireAuth, async (req, res, next) => {
  try {
    const existing = await query(`select e.id from project_environments e join projects p on p.id=e.project_id where e.id=$1 and e.project_id=$2 and p.organization_id=$3`, [req.params.environmentId, req.params.id, req.auth.organizationId]);
    if (!existing.rowCount) return res.status(404).json({ error: "Environment not found" });
    const used = await query("select 1 from deployments where environment_id=$1 limit 1", [req.params.environmentId]);
    if (used.rowCount) return res.status(409).json({ error: "This environment has deployment history and cannot be removed" });
    await query("delete from project_environments where id=$1", [req.params.environmentId]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/change-jobs/:id/deploy", requireAuth, validate(deploymentSchema), async (req, res, next) => {
  try {
    const context = await query(`select cj.*,pc.external_owner,pc.installation_id,e.name as environment,e.requires_approval,e.deployment_provider,e.configuration as environment_configuration from change_jobs cj join provider_connections pc on pc.id=cj.provider_connection_id join project_environments e on e.id=$3 and e.project_id=cj.project_id where cj.id=$1 and cj.organization_id=$2 and cj.status in ('merged','ready','development_ready','test_ready','production_ready')`, [req.params.id, req.auth.organizationId, req.body.environmentId]);
    if (!context.rowCount) return res.status(409).json({ error: "Change must be merged before deployment and the environment must belong to this project" });
    const job = context.rows[0];
    const repositories = (job.result.repositories || []).filter((repository) => job.deployment_provider !== "github" || repository.type === "Frontend");
    if (!repositories.length) return res.status(409).json({ error: "GitHub Pages preview requires a frontend repository" });
    const status = job.requires_approval ? "pending_approval" : "queued";
    const created = [];
    const github = new GitHubProvider();
    const token = await github.createInstallationToken(job.installation_id);
    for (const repository of repositories) {
      const metadata = await github.getRepository({ token, owner: job.external_owner, repository: repository.name });
      const deploymentBranch = metadata.default_branch || job.base_branch || "main";
      const row = (await query(`insert into deployments (organization_id,project_id,change_job_id,environment_id,repository_type,repository_name,branch,commit_sha,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,repository_type as "repositoryType",repository_name as "repositoryName",branch,status`, [req.auth.organizationId, job.project_id, job.id, req.body.environmentId, repository.type, repository.name, deploymentBranch, repository.commitSha, status])).rows[0];
      created.push(row);
    }
    if (!job.requires_approval) {
      try { await dispatchDeployments(job, created, job.environment); }
      catch (dispatchError) {
        await query("update deployments set status='failed',error=$1,updated_at=now() where id=any($2::uuid[])", [{ message: dispatchError.message, status: dispatchError.status || null }, created.map((deployment) => deployment.id)]);
        throw dispatchError;
      }
    }
    res.status(202).json({ environment: job.environment, status, deployments: created });
  } catch (error) { next(error); }
});

app.post("/api/deployments/:id/approve", requireAuth, async (req, res, next) => {
  try {
    const result = await query(`select d.*,e.name as environment,e.deployment_provider,e.configuration as environment_configuration,pc.external_owner,pc.installation_id,cj.result from deployments d join project_environments e on e.id=d.environment_id join change_jobs cj on cj.id=d.change_job_id join provider_connections pc on pc.id=cj.provider_connection_id where d.id=$1 and d.organization_id=$2 and d.status='pending_approval'`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(409).json({ error: "Deployment is not waiting for approval" });
    const deployment = result.rows[0]; await dispatchDeployments(deployment, [{ id: deployment.id, repositoryName: deployment.repository_name, branch: deployment.branch }], deployment.environment);
    await query("update deployments set approved_at=now() where id=$1", [deployment.id]);
    res.status(202).json({ id: deployment.id, status: "queued" });
  } catch (error) { next(error); }
});

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : "Internal server error" }); });

