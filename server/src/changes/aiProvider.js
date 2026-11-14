import { config } from "../config.js";

const patchSchema = {
  type: "object", additionalProperties: false, required: ["summary", "files"],
  properties: {
    summary: { type: "string" },
    files: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
  },
};

export class ChangeAiProvider {
  constructor(settings = config) { this.settings = settings; }

  async generatePatch({ project, changeRequest, repository, files }) {
    const prompt = buildPrompt({ project, changeRequest, repository, files });
    const result = this.settings.aiProvider === "gemini" ? await this.generateWithGemini(prompt) : await this.generateWithOpenAI(prompt);
    validatePatch(result, files);
    return result;
  }

  async generateWithOpenAI(prompt) {
    if (!this.settings.openaiApiKey) throw configuredError("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${this.settings.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.settings.aiModel, input: prompt, text: { format: { type: "json_schema", name: "repository_patch", strict: true, schema: patchSchema } } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("OpenAI", response.status, payload.error?.message);
    const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!text) throw providerError("OpenAI", 502, "The model returned no patch output");
    return JSON.parse(text);
  }

  async generateWithGemini(prompt) {
    if (!this.settings.geminiApiKey) throw configuredError("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
    const model = encodeURIComponent(this.settings.aiModel);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.settings.geminiApiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: patchSchema } }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError("Gemini", response.status, payload.error?.message);
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    if (!text) throw providerError("Gemini", 502, "The model returned no patch output");
    return JSON.parse(text);
  }
}

function buildPrompt({ project, changeRequest, repository, files }) {
  return `You are implementing an approved change in an existing ${repository.type} repository. Return JSON matching the supplied schema. Return full content only for files that must be created or changed. Preserve unrelated behavior. Never output .env files, secrets, binaries, lockfiles, or files outside the repository. Generated code must pass ESLint no-unused-vars: remove unused imports and variables, do not import React solely for JSX, and omit unused catch bindings.\n\nPROJECT\n${project.name}\n\nCHANGE TITLE\n${changeRequest.title}\n\nDISCUSSION\n${changeRequest.discussion}\n\nACCEPTANCE CRITERIA\n${changeRequest.acceptance_criteria.map((item) => `- ${item}`).join("\n")}\n\nCURRENT FILES\n${Object.entries(files).map(([path, content]) => `--- ${path}\n${content}`).join("\n")}`;
}

function validatePatch(patch, existingFiles) {
  if (!patch || typeof patch.summary !== "string" || !Array.isArray(patch.files) || patch.files.length === 0) throw providerError("AI", 422, "The generated patch did not contain files");
  for (const file of patch.files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw providerError("AI", 422, "The generated patch contains an invalid file");
    if (file.path.startsWith("/") || file.path.split("/").includes("..") || /(^|\/)(\.env|package-lock\.json)$/.test(file.path) || file.path.startsWith(".github/workflows/")) throw providerError("AI", 422, `Unsafe generated path: ${file.path}`);
    if (Buffer.byteLength(file.content) > 500_000) throw providerError("AI", 422, `Generated file is too large: ${file.path}`);
  }
  const changed = patch.files.some((file) => existingFiles[file.path] !== file.content);
  if (!changed) throw providerError("AI", 422, "The model produced no effective code changes");
}

function configuredError(message) { return Object.assign(new Error(message), { code: "AI_PROVIDER_NOT_CONFIGURED", retryable: false }); }
function providerError(provider, status, message) { return Object.assign(new Error(message || `${provider} request failed`), { status, code: "AI_PROVIDER_ERROR", retryable: status === 429 || status >= 500 }); }
