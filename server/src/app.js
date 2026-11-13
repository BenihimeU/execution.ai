import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { createIntegrationState, createToken, requireAuth, verifyIntegrationState } from "./auth.js";
import { pool, query } from "./db.js";
import { buildProvisioningManifest } from "./provisioning.js";
import { GitHubProvider } from "./provisioning/githubProvider.js";
import { changeRequestPatchSchema, changeRequestSchema, clientSchema, githubCallbackSchema, loginSchema, projectPatchSchema, projectSchema, registerSchema, validate } from "./validation.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.webOrigin }));
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
    if (!provisioning.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Frontend and backend repositories must finish provisioning before application generation" }); }
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
    const result = await query(`select id, project_id as "projectId", blueprint_id as "blueprintId", status, current_step as "currentStep", result, error, attempts, available_at as "nextRetryAt", created_at as "createdAt", updated_at as "updatedAt" from generation_jobs where id = $1 and organization_id = $2`, [req.params.id, req.auth.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Generation job not found" });
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
    const baseline = await client.query("select 1 from generation_jobs where project_id = $1 and organization_id = $2 and status = 'ready' limit 1", [req.params.id, req.auth.organizationId]);
    if (!baseline.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Generate the initial application before creating a code change request" }); }
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

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : "Internal server error" }); });

