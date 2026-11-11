import { useState } from "react";
import { Check, GitBranch, Image, ListChecks, MessageSquareText, Play, Plus, Rocket, ServerCog } from "lucide-react";
import { DEFAULT_ENVIRONMENTS } from "../../domain/workspace.js";
import { approveProjectPlan, generateProjectPlan } from "../../domain/projectPlanning.js";
import { useProvisioningJob } from "./useProvisioningJob.js";

export function ProjectDetailPage({ project, client, onBack, onUpdate, onProvision, onRefresh }) {
  const [brief, setBrief] = useState({ discussion: project.discussion || "", plan: project.plan || "", sketchName: project.sketchName || "" });
  const [environmentName, setEnvironmentName] = useState("");
  const environments = project.environments || DEFAULT_ENVIRONMENTS;
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const provisioned = Boolean(project.provisioning);
  const planApproved = project.projectPlan?.status === "approved";
  const { job, error: jobError, retry } = useProvisioningJob(project.provisioning?.jobId, onRefresh);

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

  return <>
    <button className="back-button" onClick={onBack}>← All projects</button>
    <div className="project-hero"><div><span className="eyebrow">{client?.name || "Project workspace"}</span><h1>{project.name}</h1><p>{project.description || "Capture the product intent, then provision the complete delivery stack."}</p></div><span className={`status status--${project.status.toLowerCase().replace(" ", "-")}`}>{project.status}</span></div>
    <div className="detail-grid">
      <section className="panel intake-panel"><header><div><h2>Product input</h2><p>Give Execution AI enough context to plan and build the application.</p></div><MessageSquareText size={20} /></header><div className="intake-form"><label>Project discussion<textarea rows="6" value={brief.discussion} onChange={(event) => setBrief({ ...brief, discussion: event.target.value })} placeholder="Paste meeting notes, user problems, requirements, constraints, and decisions…" /></label><label>Initial plan<textarea rows="6" value={brief.plan} onChange={(event) => setBrief({ ...brief, plan: event.target.value })} placeholder="Describe the preferred phases, features, architecture, or delivery plan…" /></label><label className="sketch-upload"><Image size={20} /><span><strong>{brief.sketchName || "Add a sketch or wireframe"}</strong><small>PNG, JPG, SVG, or PDF reference</small></span><input type="file" accept="image/*,.pdf" onChange={(event) => setBrief({ ...brief, sketchName: event.target.files?.[0]?.name || "" })} /></label><button className="button button--ghost" onClick={() => onUpdate(brief)}>Save inputs</button></div></section>
      <aside className="detail-side"><section className="panel environment-panel"><header><div><h2>Environments</h2><p>Promotion targets for this application.</p></div><ServerCog size={20} /></header><div className="environment-list">{environments.map((name, index) => <div key={name}><span>{index + 1}</span><div><strong>{name}</strong><small>{index === 0 ? "Deploy on every merge" : "Promote through pipeline"}</small></div><Check size={15} /></div>)}</div><div className="environment-add"><input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Add environment" onKeyDown={(event) => event.key === "Enter" && addEnvironment()} /><button onClick={addEnvironment}><Plus size={17} /></button></div></section>
      <section className="provision-card"><span><Rocket size={22} /></span><h2>{provisioned ? "Provisioning requested" : "Provision development stack"}</h2><p>{provisioned ? "Execution AI is creating and configuring the delivery stack." : "Provisioning is unlocked after the generated delivery plan is reviewed and approved."}</p>{job && <ProvisioningJobStatus job={job} onRetry={retry} />}{jobError && <div className="job-message job-message--error">Status could not be refreshed: {jobError}</div>}<button className="button button--primary button--wide" onClick={provision} disabled={!planApproved || provisioning || ["queued", "running", "retrying"].includes(job?.status)}><Play size={16} /> {provisioning ? "Starting…" : provisioned ? "Re-provision stack" : "Provision repositories"}</button>{!planApproved ? <small>Approve the project plan to continue.</small> : null}{provisionError && <small className="provision-error">{provisionError}</small>}</section></aside>
    </div>
    <PlanningWorkspace plan={project.projectPlan} canGenerate={Boolean(brief.discussion.trim() && brief.plan.trim())} onGenerate={generatePlan} onApprove={approvePlan} />
    {provisioned && <GeneratedStack provisioning={project.provisioning} />}
  </>;
}

function ProvisioningJobStatus({ job, onRetry }) {
  const step = readableStep(job.currentStep);
  if (job.status === "retrying") {
    const retryTime = job.nextRetryAt ? new Date(job.nextRetryAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "the next available window";
    const rateLimited = job.error?.status === 403 && /rate limit/i.test(job.error?.message || "");
    return <div className="job-message job-message--waiting"><strong>{rateLimited ? "GitHub temporarily paused repository creation" : "Provisioning will retry automatically"}</strong><span>{rateLimited ? `GitHub rejected the write before creating a repository. Execution AI will retry automatically at ${retryTime}. No action is required.` : `The ${step} step will retry at ${retryTime}.`}</span><small>Attempt {job.attempts} · {step}</small></div>;
  }
  if (job.status === "failed") return <div className="job-message job-message--error"><strong>Provisioning stopped at {step}</strong><span>{friendlyError(job.error)}</span><button className="button button--ghost" onClick={onRetry}>Retry provisioning</button></div>;
  if (job.status === "ready") return <div className="job-message job-message--success"><strong>Repositories and pipelines are ready</strong><span>Execution AI completed the GitHub configuration.</span></div>;
  return <div className="job-message job-message--active"><strong>{job.status === "queued" ? "Provisioning queued" : `Working on ${step}`}</strong><span>Execution AI is configuring GitHub. You can leave this page safely.</span><small>Attempt {job.attempts || 0}</small></div>;
}

function readableStep(step = "queued") {
  return step.replace(/^failed:/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyError(error) {
  if (!error) return "An unexpected provisioning error occurred.";
  if (error.code === "GITHUB_APP_NOT_CONFIGURED") return "The Execution AI administrator must configure the GitHub App before provisioning.";
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

function GeneratedStack({ provisioning }) {
  return <section className="panel stack-panel"><header><div><h2>Provisioning manifest</h2><p>{provisioning.idempotencyKey ? `Idempotent resource contract: ${provisioning.idempotencyKey}` : "Legacy provisioning record — re-provision to upgrade the manifest."}</p></div><span className="ready-badge"><Check size={13} /> {provisioning.status === "ready" ? "Ready" : "Awaiting provider"}</span></header><div className="stack-grid"><div><h3><GitBranch size={17} /> Repositories</h3>{(provisioning.repositories || []).map((repo) => <article key={repo.name}><span><strong>{repo.name}</strong><small>{repo.type} · private · protected main</small></span><em>{repo.status}</em></article>)}</div><div><h3><ServerCog size={17} /> Deployment pipelines</h3>{(provisioning.pipelines || []).map((pipeline) => <article key={pipeline.name}><span><strong>{pipeline.name}</strong><small>{pipeline.stages?.join(" · ") || "Build · test · deploy"}</small></span><em>{pipeline.status}</em></article>)}</div></div></section>;
}
