import { z } from "zod";

export const registerSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().transform((v) => v.toLowerCase()), password: z.string().min(8).max(128) });
export const loginSchema = z.object({ email: z.string().trim().email().transform((v) => v.toLowerCase()), password: z.string().min(1) });
export const clientSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")), company: z.string().trim().max(120).optional().default(""), notes: z.string().trim().max(5000).optional().default("") }).passthrough();
export const projectSchema = z.object({ name: z.string().trim().min(2).max(160), clientId: z.string().uuid(), description: z.string().trim().max(5000).optional().default(""), status: z.string().trim().max(50).optional().default("Planning") }).passthrough();
export const projectPatchSchema = z.record(z.string(), z.unknown()).refine((value) => !["id", "organizationId", "createdAt"].some((key) => key in value), "Immutable fields cannot be updated");
export const githubCallbackSchema = z.object({ installationId: z.coerce.number().int().positive(), state: z.string().min(20).max(4000) });
const repositoryTargets = z.array(z.enum(["Frontend", "Backend"])).min(1).max(2).transform((items) => [...new Set(items)]);
export const changeRequestSchema = z.object({
  title: z.string().trim().min(3).max(180),
  discussion: z.string().trim().min(20).max(20_000),
  acceptanceCriteria: z.array(z.string().trim().min(3).max(500)).min(1).max(30),
  repositories: repositoryTargets,
});
export const changeRequestPatchSchema = changeRequestSchema.partial().refine((value) => Object.keys(value).length > 0, "At least one change is required");
export const environmentSchema = z.object({ name: z.string().trim().min(2).max(80), environmentType: z.enum(["development", "test", "production", "custom"]), deploymentProvider: z.enum(["github", "aws"]).default("github"), deploymentStrategy: z.enum(["workflow_dispatch", "external"]).default("workflow_dispatch"), requiresApproval: z.boolean().default(false), configuration: z.object({ awsRegion: z.string().trim().max(80).optional(), awsRoleArn: z.string().trim().max(300).optional() }).passthrough().optional().default({}) });
export const deploymentSchema = z.object({ environmentId: z.string().uuid() });
export const planningAssistanceSchema = z.object({ discussion: z.string().trim().min(20).max(20_000), initialPlan: z.string().trim().max(20_000).optional().default("") });
export function validate(schema) { return (req, res, next) => { const result = schema.safeParse(req.body); if (!result.success) return res.status(400).json({ error: "Invalid request", details: result.error.flatten() }); req.body = result.data; next(); }; }

