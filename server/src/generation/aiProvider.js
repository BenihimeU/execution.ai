import { config } from "../config.js";

const repositorySchema = {
  type: "object", additionalProperties: false, required: ["summary", "files"],
  properties: {
    summary: { type: "string" },
    files: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
  },
};

export class GenerationAiProvider {
  constructor(settings = config) { this.settings = settings; }

  async generateRepository({ blueprint, repositoryType, baselineFiles }) {
    const prompt = buildPrompt({ blueprint, repositoryType, baselineFiles });
    const result = this.settings.aiProvider === "gemini" ? await this.withGemini(prompt) : await this.withOpenAI(prompt);
    return validate(result);
  }

  async withOpenAI(prompt) {
    if (!this.settings.openaiApiKey) throw configuredError("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${this.settings.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.settings.aiModel, input: prompt, text: { format: { type: "json_schema", name: "generated_repository", strict: true, schema: repositorySchema } } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("OpenAI", response.status, payload.error?.message);
    const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!text) throw providerError("OpenAI", 502, "The model returned no repository output");
    return JSON.parse(text);
  }

  async withGemini(prompt) {
    if (!this.settings.geminiApiKey) throw configuredError("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
    const model = encodeURIComponent(this.settings.aiModel);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.settings.geminiApiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: repositorySchema } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("Gemini", response.status, payload.error?.message);
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    if (!text) throw providerError("Gemini", 502, "The model returned no repository output");
    return JSON.parse(text);
  }
}

function buildPrompt({ blueprint, repositoryType, baselineFiles }) {
  const role = repositoryType === "Frontend"
    ? "Build a polished, responsive React and Vite application implementing the approved user journeys. If backendRequired is false, the application must work without network API calls."
    : "Build a maintainable Express API with separated routes/modules, validation, health checks, and the approved resource operations.";
  return `You are the implementation agent for a new ${repositoryType} repository. ${role} Return complete content for every file you create or replace. Preserve maintainable role and file separation. Do not output secrets, .env files, binaries, lockfiles, node_modules, dist, or GitHub workflow files. Ensure npm scripts and imports are internally consistent. Generated code must pass ESLint no-unused-vars: do not import React when only JSX is used, remove unused imports and variables, and omit unused catch bindings. Return JSON matching the supplied schema.\n\nAPPROVED BLUEPRINT\n${JSON.stringify(blueprint, null, 2)}\n\nSAFE BASELINE FILES\n${Object.entries(baselineFiles).map(([path, content]) => `--- ${path}\n${content}`).join("\n")}`;
}

function validate(result) {
  if (!result?.summary || !Array.isArray(result.files) || !result.files.length) throw providerError("AI", 422, "The generation agent returned no application files");
  const files = {};
  for (const file of result.files) {
    if (!file?.path || typeof file.content !== "string") throw providerError("AI", 422, "The generation agent returned an invalid file");
    if (file.path.startsWith("/") || file.path.split("/").includes("..") || /(^|\/)(\.env|package-lock\.json|node_modules|dist)(\/|$)/.test(file.path) || file.path.startsWith(".github/workflows/")) throw providerError("AI", 422, `Unsafe generated path: ${file.path}`);
    if (Buffer.byteLength(file.content) > 500_000) throw providerError("AI", 422, `Generated file is too large: ${file.path}`);
    files[file.path] = file.content;
  }
  return { summary: result.summary, files };
}

function configuredError(message) { return Object.assign(new Error(message), { code: "AI_PROVIDER_NOT_CONFIGURED", retryable: false }); }
function providerError(provider, status, message) { return Object.assign(new Error(message || `${provider} request failed`), { status, code: "AI_PROVIDER_ERROR", retryable: status === 429 || status >= 500 }); }
