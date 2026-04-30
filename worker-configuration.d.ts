// Bindings for the Worker runtime. Keep in sync with wrangler.toml.
// Secrets are set via `wrangler secret put <NAME>`.

export interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  AI: Ai;
  EMAIL: SendEmail;
  BACKUPS: R2Bucket;
  ENVIRONMENT: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  GRANOLA_API_KEY: string;
  PROTON_ICS_URL: string;
  EMAIL_TO: string;
  EMAIL_FROM: string;
  MCP_SECRET: string;
  WEB_AUTH_SECRET: string;
}
