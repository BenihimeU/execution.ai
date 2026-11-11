import "dotenv/config";

const production = process.env.NODE_ENV === "production";

function configured(name, developmentDefault) {
  const value = process.env[name] || (!production ? developmentDefault : undefined);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: configured("DATABASE_URL", "postgres://execution:execution@127.0.0.1:5432/execution_ai"),
  jwtSecret: configured("JWT_SECRET", "execution-ai-local-development-secret"),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
  databaseSsl: process.env.DATABASE_SSL === "true",
  githubAppId: process.env.GITHUB_APP_ID || "",
  githubAppSlug: process.env.GITHUB_APP_SLUG || "",
  githubPrivateKey: (process.env.GITHUB_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  githubApiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  workerPollMs: Number(process.env.PROVISIONING_WORKER_POLL_MS || 3000),
  workerMaxAttempts: Number(process.env.PROVISIONING_WORKER_MAX_ATTEMPTS || 3),
};

