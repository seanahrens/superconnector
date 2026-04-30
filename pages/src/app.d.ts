// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    interface Platform {
      env?: {
        WORKER_API?: { fetch: typeof fetch };
        WEB_AUTH_SECRET?: string;
      };
    }
  }
}

export {};
