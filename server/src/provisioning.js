export function buildProvisioningManifest(projectId, project) {
  if (project.projectPlan?.status !== "approved") {
    const error = new Error("The delivery plan must be approved before provisioning");
    error.status = 409;
    throw error;
  }
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const environments = project.environments || ["Development", "Test", "Production"];
  const repository = (name, type, workflow) => ({ name, type, visibility: "private", defaultBranch: "main", workflow, branchProtection: { pullRequestRequired: true, checksRequired: true, forcePushBlocked: true }, status: "Pending provider connection" });
  return {
    version: 1,
    status: "awaiting_provider",
    idempotencyKey: `${projectId}:plan-${project.projectPlan.version}`,
    provider: "unconnected",
    repositories: [repository(`${slug}-web`, "Frontend", "web-ci.yml"), repository(`${slug}-api`, "Backend", "api-ci.yml")],
    environments: environments.map((name, index) => ({ name, protection: index === 0 ? "automatic" : "approval-required", secrets: [], status: "Pending" })),
    pipelines: environments.map((name, index) => ({ name, trigger: index === 0 ? "merge-to-main" : "promotion", stages: ["install", "lint", "test", "security-scan", "build", "deploy"], status: "Pending" })),
    audit: [{ event: "manifest.created", at: new Date().toISOString(), actor: "authenticated-user" }],
    createdAt: new Date().toISOString(),
  };
}
