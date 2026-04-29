// Bindings for the Worker runtime. Keep in sync with wrangler.toml.
// Secrets are set via `wrangler secret put <NAME>`.

export interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  ENVIRONMENT: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  GRANOLA_API_KEY: string;
  PROTON_ICS_URL: string;
  RESEND_API_KEY: string;
  EMAIL_TO: string;
  EMAIL_FROM: string;
}
