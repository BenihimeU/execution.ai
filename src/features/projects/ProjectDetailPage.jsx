import { useEffect, useState } from "react";
import { Check, Code2, ExternalLink, GitBranch, Image, ListChecks, LoaderCircle, MessageSquareText, PencilLine, Play, Plus, Rocket, ServerCog } from "lucide-react";
import { DEFAULT_ENVIRONMENTS } from "../../domain/workspace.js";
import { approveProjectPlan, generateProjectPlan } from "../../domain/projectPlanning.js";
import { useProvisioningJob } from "./useProvisioningJob.js";
import { useGenerationJob } from "./useGenerationJob.js";
import { api } from "../../lib/api.js";

export function ProjectDetailPage({ project, client, onBack, onUpdate, onProvision, onGenerate, onRefresh }) {
  const [brief, setBrief] = useState({ discussion: project.discussion || "", plan: project.plan || "", sketchName: project.sketchName || "" });
  const [environmentName, setEnvironmentName] = useState("");
  const environments = project.environments || DEFAULT_ENVIRONMENTS;
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const [generationStarting, setGenerationStarting] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const provisioned = Boolean(project.provisioning);
  const planApproved = project.projectPlan?.status === "approved";
  const { job, error: jobError, retry } = useProvisioningJob(project.provisioning?.jobId, onRefresh);
  const { job: generationJob, error: generationJobError, retry: retryGeneration } = useGenerationJob(project.generation?.jobId, onRefresh);

  function addEnvironment() {
    const name = environmentName.trim();
    if (!name || environments.includes(name)) return;
    onUpdate({ environments: [...environments, name], provisioning: undefined });
    setEnvironmentName("");
  }
  async function provision() {
    setProvisioning(true); setProvisionError("");
    try { await onUpdate({ ...brief, environments }); await onProvision(); }
    catch (error) { setProvisionError(error.message); }
    finally { setProvisioning(false); }
  }
  function generatePlan() { onUpdate({ ...brief, projectPlan: generateProjectPlan(project, brief), provisioning: undefined }); }
  function approvePlan() { onUpdate({ projectPlan: approveProjectPlan(project.projectPlan) }); }
  async function generateApplication() {
    setGenerationStarting(true); setGenerationError("");
    try { await onGenerate(); }
    catch (error) { setGenerationError(error.message); }
    finally { setGenerationStarting(false); }
  }

  return <>
    <button className="back-button" onClick={onBack}>← All projects</button>
    <div className="project-hero"><div><span className="eyebrow">{client?.name || "Project workspace"}</span><h1>{project.name}</h1><p>{project.description || "Capture the product intent, then provision the complete delivery stack."}</p></div><span className={`status status--${project.status.toLowerCase().replace(" ", "-")}`}>{project.status}</span></div>
    <div className="detail-grid">
      <section className="panel intake-panel"><header><div><h2>Product input</h2><p>Give Execution AI enough context to plan and build the application.</p></div><MessageSquareText size={20} /></header><div className="intake-form"><label>Project discussion<textarea rows="6" value={brief.discussion} onChange={(event) => setBrief({ ...brief, discussion: event.target.value })} placeholder="Paste meeting notes, user problems, requirements, constraints, and decisions…" /></label><label>Initial plan<textarea rows="6" value={brief.plan} onChange={(event) => setBrief({ ...brief, plan: event.target.value })} placeholder="Describe the preferred phases, features, architecture, or delivery plan…" /></label><label className="sketch-upload"><Image size={20} /><span><strong>{brief.sketchName || "Add a sketch or wireframe"}</strong><small>PNG, JPG, SVG, or PDF reference</small></span><input type="file" accept="image/*,.pdf" onChange={(event) => setBrief({ ...brief, sketchName: event.target.files?.[0]?.name || "" })} /></label><button className="button button--ghost" onClick={() => onUpdate(brief)}>Save inputs</button></div></section>
      <aside className="detail-side"><section className="panel environment-panel"><header><div><h2>Environments</h2><p>Promotion targets for this application.</p></div><ServerCog size={20} /></header><div className="environment-list">{environments.map((name, index) => <div key={name}><span>{index + 1}</span><div><strong>{name}</strong><small>{index === 0 ? "Deploy on every merge" : "Promote through pipeline"}</small></div><Check size={15} /></div>)}</div><div className="environment-add"><input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Add environment" onKeyDown={(event) => event.key === "Enter" && addEnvironment()} /><button onClick={addEnvironment}><Plus size={17} /></button></div></section>
      <section className="provision-card"><span><Rocket size={22} /></span><h2>{provisioned ? "Provisioning requested" : "Provision development stack"}</h2><p>{provisioned ? "Execution AI is creating and configuring the delivery stack." : "Provisioning is unlocked after the generated delivery plan is reviewed and approved."}</p>{job && <ProvisioningJobStatus job={job} onRetry={retry} />}{jobError && <div className="job-message job-message--error">Status could not be refreshed: {jobError}</div>}<button className="button button--primary button--wide" onClick={provision} disabled={!planApproved || provisioning || ["queued", "running", "retrying"].includes(job?.status)}><Play size={16} /> {provisioning ? "Starting…" : provisioned ? "Re-provision stack" : "Provision repositories"}</button>{!planApproved ? <small>Approve the project plan to continue.</small> : null}{provisionError && <small className="provision-error">{provisionError}</small>}</section></aside>
    </div>
    <PlanningWorkspace plan={project.projectPlan} canGenerate={Boolean(brief.discussion.trim() && brief.plan.trim())} onGenerate={generatePlan} onApprove={approvePlan} />
    {provisioned && <GeneratedStack provisioning={project.provisioning} job={job} />}
    <GenerationWorkspace project={project} job={generationJob} jobError={generationJobError} starting={generationStarting} error={generationError} onGenerate={generateApplication} onRetry={retryGeneration} />
    {(project.generation?.status === "ready" || generationJob?.status === "ready") && <ChangeRequestsWorkspace projectId={project.id} />}
  </>;
}

function GenerationWorkspace({ project, job, jobError, starting, error, onGenerate, onRetry }) {
  const repositoriesReady = project.provisioning?.status === "ready" || job?.status === "ready" || Boolean(project.generation);
  const active = ["queued", "running", "retrying"].includes(job?.status);
  const generatedRepositories = job?.result?.repositories || project.generation?.repositories || [];
  const initialGenerationReady = project.generation?.status === "ready" || job?.status === "ready";
  return <section className="panel generation-panel"><header><div><span className="eyebrow">Stage 2</span><h2>Application generation</h2><p>Generate a versioned blueprint and implementation branches for the backend and frontend repositories.</p></div><Code2 size={22} /></header><div className="generation-body"><div className="generation-actions">{!initialGenerationReady && <button className="button button--primary" disabled={!repositoriesReady || active || starting} onClick={onGenerate}>{starting || active ? <LoaderCircle className="spin" size={16} /> : <Code2 size={16} />} {starting ? "Starting…" : active ? generationStep(job.currentStep) : "Generate application"}</button>}{initialGenerationReady && <span className="generation-ready"><Check size={14} /> Initial application generated</span>}{!repositoriesReady && <small>Complete repository provisioning before generating application code.</small>}{error && <small className="provision-error">{error}</small>}{jobError && <small className="provision-error">Status could not be refreshed: {jobError}</small>}</div>{job && <GenerationProgress job={job} />}{job?.status === "failed" && <div className="job-message job-message--error"><strong>Generation stopped at {readableStep(job.currentStep)}</strong><span>{job.error?.message || "Application generation failed."}</span><button className="button button--ghost" onClick={onRetry}>Retry generation</button></div>}{generatedRepositories.length > 0 && <div className="generation-results">{generatedRepositories.map((repository) => <a key={repository.type} href={repository.url} target="_blank" rel="noreferrer"><span><strong>{repository.type} implementation</strong><small>{repository.name} · {repository.branch}</small></span><ExternalLink size={15} /></a>)}</div>}</div></section>;
}

function ChangeRequestsWorkspace({ projectId }) {
  const emptyForm = { title: "", discussion: "", acceptanceCriteria: "", repositories: ["Frontend", "Backend"] };
  const [form, setForm] = useState(emptyForm);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pollRevision, setPollRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      try {
        const items = await api.getChangeRequests(projectId);
        if (!active) return;
        setRequests(items); setError(""); setLoading(false);
        if (items.some((item) => ["queued", "running", "retrying"].includes(item.job?.status))) timer = window.setTimeout(refresh, 3000);
      } catch (requestError) {
        if (!active) return;
        setError(requestError.message); setLoading(false); timer = window.setTimeout(refresh, 10000);
      }
    }
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [projectId, pollRevision]);

  function toggleRepository(repository) {
    setForm((current) => ({ ...current, repositories: current.repositories.includes(repository) ? current.repositories.filter((item) => item !== repository) : [...current.repositories, repository] }));
  }

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const acceptanceCriteria = form.acceptanceCriteria.split("\n").map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      const created = await api.createChangeRequest(projectId, { title: form.title, discussion: form.discussion, acceptanceCriteria, repositories: form.repositories });
      setRequests((current) => [created, ...current]); setForm(emptyForm);
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  async function approve(requestId) {
    setError("");
    try { const approved = await api.approveChangeRequest(requestId); setRequests((current) => current.map((item) => item.id === requestId ? approved : item)); setPollRevision((value) => value + 1); }
    catch (requestError) { setError(requestError.message); }
  }

  async function retry(jobId) {
    setError("");
    try { await api.retryChangeJob(jobId); setPollRevision((value) => value + 1); }
    catch (requestError) { setError(requestError.message); }
  }

  async function implement(requestId) {
    setError("");
    try { const job = await api.implementChangeRequest(requestId); setRequests((current) => current.map((item) => item.id === requestId ? { ...item, job } : item)); setPollRevision((value) => value + 1); }
    catch (requestError) { setError(requestError.message); }
  }

  const valid = form.title.trim().length >= 3 && form.discussion.trim().length >= 20 && form.acceptanceCriteria.trim().length >= 3 && form.repositories.length > 0;
  return <section className="panel changes-panel"><header><div><span className="eyebrow">Ongoing delivery</span><h2>Code change requests</h2><p>Describe subsequent changes against the existing repositories. Approval starts the AI implementation worker on a dedicated change branch.</p></div><PencilLine size={22} /></header><div className="changes-layout"><form className="change-form" onSubmit={submit}><label>Change title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Add recurring expenses" maxLength="180" /></label><label>Change discussion<textarea rows="7" value={form.discussion} onChange={(event) => setForm({ ...form, discussion: event.target.value })} placeholder="Explain the problem, desired behavior, constraints, and anything that must remain unchanged…" /></label><label>Acceptance criteria<textarea rows="5" value={form.acceptanceCriteria} onChange={(event) => setForm({ ...form, acceptanceCriteria: event.target.value })} placeholder={"One requirement per line\nUsers can create recurring expenses\nExisting expenses remain unchanged"} /></label><fieldset><legend>Affected repositories</legend>{["Frontend", "Backend"].map((repository) => <label key={repository}><input type="checkbox" checked={form.repositories.includes(repository)} onChange={() => toggleRepository(repository)} /> {repository}</label>)}</fieldset>{error && <div className="change-error">{error}</div>}<button className="button button--primary" disabled={!valid || saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} {saving ? "Saving…" : "Create change request"}</button></form><div className="change-history"><h3>Change history</h3>{loading ? <div className="change-empty"><LoaderCircle className="spin" size={18} /> Loading requests…</div> : requests.length === 0 ? <div className="change-empty">No subsequent changes have been requested.</div> : requests.map((request) => <article key={request.id}><header><span>Change {request.sequence}</span><em className={`change-status change-status--${request.status}`}>{request.status}</em></header><h4>{request.title}</h4><p>{request.discussion}</p><small>{request.repositories.join(" + ")} · {request.acceptanceCriteria.length} acceptance criteria</small>{request.status === "draft" && <button className="button button--ghost" onClick={() => approve(request.id)}><Check size={14} /> Approve and implement</button>}{request.status === "approved" && !request.job && <button className="button button--ghost" onClick={() => implement(request.id)}><Code2 size={14} /> Start implementation</button>}{request.job && <ChangeJobProgress job={request.job} onRetry={() => retry(request.job.id)} />}</article>)}</div></div></section>;
}

function ChangeJobProgress({ job, onRetry }) {
  const step = readableStep(job.currentStep);
  const active = ["queued", "running", "retrying"].includes(job.status);
  const repositories = job.result?.repositories || [];
  return <div className={`change-job change-job--${job.status}`}><div>{active && <LoaderCircle className="spin" size={14} />}{job.status === "ready" && <Check size={14} />}{job.status === "failed" && <strong>!</strong>}<span><b>{job.status === "queued" ? "Queued for AI implementation" : job.status === "ready" ? "Implementation ready for review" : job.status === "failed" ? `Stopped at ${step}` : step}</b><small>{job.status === "queued" ? "Waiting for the change worker" : `Attempt ${job.attempts || 0}`}</small></span></div>{job.error && <p>{job.error.message}</p>}{repositories.map((repository) => <a key={repository.type} href={repository.pullRequestUrl || repository.url} target="_blank" rel="noreferrer">{repository.type}: {repository.pullRequestUrl ? "Open pull request" : "Open change branch"} <ExternalLink size={12} /></a>)}{job.status === "failed" && <button className="button button--ghost" onClick={onRetry}>Retry implementation</button>}</div>;
}

function GenerationProgress({ job }) {
  const normalizedStep = String(job.currentStep || "queued").replace(/^failed:/, "");
  const stages = [
    { id: "blueprint", label: "Blueprint", steps: ["validating", "saving_blueprint", "obtaining_installation_token"] },
    { id: "backend", label: "Backend", steps: ["generating_backend"] },
    { id: "frontend", label: "Frontend", steps: ["generating_frontend"] },
    { id: "complete", label: "Ready", steps: ["complete"] },
  ];
  const activeIndex = job.status === "queued" ? -1 : Math.max(0, stages.findIndex((stage) => stage.steps.includes(normalizedStep)));
  return <div className="generation-progress"><div className="generation-progress__summary"><strong>{job.status === "queued" ? "Waiting for generation worker" : job.status === "ready" ? "Application generation completed" : job.status === "failed" ? `Stopped during ${readableStep(normalizedStep)}` : generationStep(normalizedStep)}</strong><small>{job.status === "queued" ? "The job is safely queued and will start when a worker is available." : `Attempt ${job.attempts || 0} · Last update ${new Date(job.updatedAt || job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</small></div><div className="generation-progress__steps">{stages.map((stage, index) => { const complete = job.status === "ready" || index < activeIndex; const current = job.status !== "failed" && index === activeIndex; const failed = job.status === "failed" && index === activeIndex; return <div className={`generation-step ${complete ? "generation-step--complete" : ""} ${current ? "generation-step--active" : ""} ${failed ? "generation-step--failed" : ""}`} key={stage.id}><span>{complete ? <Check size={13} /> : current ? <LoaderCircle className="spin" size={13} /> : failed ? "!" : index + 1}</span><small>{stage.label}</small></div>; })}</div></div>;
}

function generationStep(step) {
  const readable = readableStep(step);
  return step?.includes("backend") ? "Generating backend…" : step?.includes("frontend") ? "Generating frontend…" : `${readable}…`;
}

function ProvisioningJobStatus({ job, onRetry }) {
  const step = readableStep(job.currentStep);
  if (job.status === "retrying") {
    const retryTime = job.nextRetryAt ? new Date(job.nextRetryAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "the next available window";
    const rateLimited = job.error?.status === 403 && /rate limit/i.test(job.error?.message || "");
    return <div className="job-message job-message--waiting"><strong>{rateLimited ? "GitHub temporarily paused repository creation" : "Provisioning will retry automatically"}</strong><span>{rateLimited ? `GitHub rejected the write before creating a repository. Execution AI will retry automatically at ${retryTime}. No action is required.` : `The ${step} step will retry at ${retryTime}.`}</span><small>Attempt {job.attempts} · {step}</small></div>;
  }
  if (job.status === "failed") { const reconnectRequired = job.error?.code === "GITHUB_REPOSITORY_CREATION_BLOCKED"; return <div className="job-message job-message--error"><strong>Provisioning stopped at {step}</strong><span>{friendlyError(job.error)}</span>{!reconnectRequired && <button className="button button--ghost" onClick={onRetry}>Retry provisioning</button>}</div>; }
  if (job.status === "ready") {
    const planWarnings = job.result?.warnings || [];
    return <div className={`job-message ${planWarnings.length ? "job-message--waiting" : "job-message--success"}`}><strong>Repositories and pipelines are ready</strong><span>{planWarnings.length ? "Provisioning completed, but GitHub plan restrictions prevented some protection rules." : "Execution AI completed the GitHub configuration."}</span>{planWarnings.length > 0 && <small>{planWarnings.length} optional configuration {planWarnings.length === 1 ? "warning" : "warnings"}</small>}</div>;
  }
  return <div className="job-message job-message--active"><strong>{job.status === "queued" ? "Provisioning queued" : `Working on ${step}`}</strong><span>Execution AI is configuring GitHub. You can leave this page safely.</span><small>Attempt {job.attempts || 0}</small></div>;
}

function readableStep(step = "queued") {
  return String(step || "queued").replace(/^failed:/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyError(error) {
  if (!error) return "An unexpected provisioning error occurred.";
  if (error.code === "GITHUB_REPOSITORY_CREATION_BLOCKED") return "GitHub repeatedly blocked repository creation even though normal API capacity remains. Connect the GitHub App to an organization account and provision there, or contact GitHub Support before retrying.";
  if (error.code === "GITHUB_APP_NOT_CONFIGURED") return "The Execution AI administrator must configure the GitHub App before provisioning.";
  if (error.status === 403 && /upgrade to github pro|make this repository public/i.test(error.message || "")) return "GitHub Free does not support branch protection on this private repository. Retry provisioning; Execution AI will continue and record protection as unavailable.";
  if (error.status === 401) return "GitHub rejected the App credentials. Reconnect GitHub or ask an administrator to rotate the private key.";
  if (error.status === 403) return "GitHub denied this operation. Confirm the App permissions and installation access, then retry.";
  if (error.status === 404) return "The GitHub installation or target account could not be found. Reconnect the integration and retry.";
  return error.message || "An unexpected provisioning error occurred.";
}

function PlanningWorkspace({ plan, canGenerate, onGenerate, onApprove }) {
  return <section className="panel planning-panel"><header><div><h2>Delivery plan</h2><p>Turn the raw discussion into an approved, provisionable contract.</p></div><button className="button button--ghost" onClick={onGenerate} disabled={!canGenerate}><ListChecks size={16} /> {plan ? "Regenerate" : "Generate plan"}</button></header>
    {!plan ? <div className="planning-empty"><ListChecks size={26} /><strong>No structured plan yet</strong><span>Add the project discussion and initial plan, then generate a review draft.</span></div> : <><div className="plan-status"><span className={`status status--${plan.status}`}>{plan.status}</span><small>Version {plan.version} · generated {new Date(plan.generatedAt).toLocaleString()}</small>{plan.status !== "approved" && <button className="button button--primary" onClick={onApprove}><Check size={15} /> Approve plan</button>}</div><div className="plan-grid"><article><h3>Product vision</h3><p>{plan.product.vision}</p><h3>Assumptions</h3><ul>{plan.product.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></article><article><h3>Included scope</h3><ul>{plan.scope.included.map((item) => <li key={item}>{item}</li>)}</ul><h3>Explicitly excluded</h3><ul>{plan.scope.excluded.map((item) => <li key={item}>{item}</li>)}</ul></article><article><h3>Architecture</h3>{Object.entries(plan.architecture).map(([key, value]) => <p key={key}><strong>{key}</strong><span>{value}</span></p>)}</article><article><h3>Delivery phases</h3>{plan.phases.map((phase, index) => <p key={phase.name}><strong>{index + 1}. {phase.name}</strong><span>{phase.outcome}</span></p>)}<h3>Quality gates</h3><ul>{plan.qualityGates.map((item) => <li key={item}>{item}</li>)}</ul></article></div></>}
  </section>;
}

function GeneratedStack({ provisioning, job }) {
  return <section className="panel stack-panel"><header><div><h2>Provisioning manifest</h2><p>{provisioning.idempotencyKey ? `Idempotent resource contract: ${provisioning.idempotencyKey}` : "Legacy provisioning record — re-provision to upgrade the manifest."}</p></div><span className="ready-badge"><Check size={13} /> {provisioning.status === "ready" ? "Ready" : "Awaiting provider"}</span></header>{provisioning.warnings?.length > 0 && <div className="stack-warning">Completed with {provisioning.warnings.length} optional GitHub configuration {provisioning.warnings.length === 1 ? "warning" : "warnings"}.</div>}<div className="stack-grid"><div><h3><GitBranch size={17} /> Repositories</h3>{(provisioning.repositories || []).map((repo) => <RepositoryStatus key={repo.name} repository={repo} provisioning={provisioning} job={job} />)}</div><div><h3><ServerCog size={17} /> Deployment pipelines</h3>{(provisioning.pipelines || []).map((pipeline) => <article key={pipeline.name}><span><strong>{pipeline.name}</strong><small>{pipeline.stages?.join(" · ") || "Build · test · deploy"}</small></span><em>{pipeline.status}</em></article>)}</div></div></section>;
}

function RepositoryStatus({ repository, provisioning, job }) {
  const repositoryType = repository.type?.toLowerCase();
  const creating = job?.status === "running" && job.currentStep === `creating_${repositoryType}_repository`;
  const status = repository.status || (provisioning.status === "ready" ? "Ready" : "Pending");
  return <article><span><strong>{repository.name}</strong><small>{repository.type} · private</small></span><em className={creating ? "repository-status repository-status--creating" : "repository-status"}>{creating && <LoaderCircle size={13} />} {creating ? "Creating…" : status}</em></article>;
}
