import { config } from "../config.js";

const planSchema = {
  type: "object", additionalProperties: false,
  required: ["initialPlan", "backendRequired", "backendRationale", "product", "scope", "architecture", "phases", "qualityGates"],
  properties: {
    initialPlan: { type: "string" },
    backendRequired: { type: "boolean" },
    backendRationale: { type: "string" },
    product: { type: "object", additionalProperties: false, required: ["vision", "assumptions"], properties: { vision: { type: "string" }, assumptions: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } } } },
    scope: { type: "object", additionalProperties: false, required: ["included", "excluded"], properties: { included: { type: "array", minItems: 1, maxItems: 15, items: { type: "string" } }, excluded: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } } } },
    architecture: { type: "object", additionalProperties: false, required: ["frontend", "backend", "data", "delivery"], properties: { frontend: { type: "string" }, backend: { type: "string" }, data: { type: "string" }, delivery: { type: "string" } } },
    phases: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["name", "outcome"], properties: { name: { type: "string" }, outcome: { type: "string" } } } },
    qualityGates: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
  },
};

export class PlanningAiProvider {
  constructor(settings = config) { this.settings = settings; }

  async generate({ project, discussion, initialPlan }) {
    const prompt = `You are a senior product manager and solution architect. Turn the raw project discussion into a clear, practical web-application delivery plan. Resolve ambiguity with explicit assumptions, keep scope realistic, separate included and excluded scope, and define maintainable frontend, backend, data, delivery phases, and quality gates. Decide whether a backend repository is actually required. If the user explicitly says no backend, frontend-only, or static site, backendRequired must be false and the architecture must not invent a backend. The initial plan is optional guidance and must not override clear discussion requirements. Return JSON matching the supplied schema.\n\nPROJECT\n${project.name}\n\nDESCRIPTION\n${project.description || "Not provided"}\n\nDISCUSSION\n${discussion}\n\nINITIAL GUIDANCE\n${initialPlan || "Not provided"}`;
    const result = this.settings.aiProvider === "gemini" ? await this.withGemini(prompt) : await this.withOpenAI(prompt);
    return normalize(result, discussion);
  }

  async withOpenAI(prompt) {
    if (!this.settings.openaiApiKey) throw configuredError("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${this.settings.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.settings.aiModel, input: prompt, text: { format: { type: "json_schema", name: "project_delivery_plan", strict: true, schema: planSchema } } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("OpenAI", response.status, payload.error?.message);
    const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!text) throw providerError("OpenAI", 502, "The model returned no planning output");
    return JSON.parse(text);
  }

  async withGemini(prompt) {
    if (!this.settings.geminiApiKey) throw configuredError("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
    const model = encodeURIComponent(this.settings.aiModel);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.settings.geminiApiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: planSchema } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("Gemini", response.status, payload.error?.message);
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    if (!text) throw providerError("Gemini", 502, "The model returned no planning output");
    return JSON.parse(text);
  }
}

function normalize(result, discussion) {
  if (!result?.initialPlan || !result.product?.vision || !result.scope?.included?.length || !result.phases?.length) throw providerError("AI", 422, "The generated delivery plan was incomplete");
  return { initialPlan: result.initialPlan.trim(), projectPlan: { status: "review", application: { backendRequired: result.backendRequired, backendRationale: result.backendRationale }, product: { ...result.product, sourceDiscussion: discussion }, scope: result.scope, architecture: result.architecture, phases: result.phases, qualityGates: result.qualityGates } };
}

function configuredError(message) { return Object.assign(new Error(message), { status: 503, code: "AI_PROVIDER_NOT_CONFIGURED" }); }
function providerError(provider, status, message) { return Object.assign(new Error(message || `${provider} request failed`), { status, code: "AI_PROVIDER_ERROR" }); }
