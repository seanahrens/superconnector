import type { RequestHandler } from './$types';

interface ServiceBinding {
  fetch: typeof fetch;
}

export const GET: RequestHandler = async ({ platform }) => {
  const binding = (platform?.env as { WORKER_API?: ServiceBinding } | undefined)?.WORKER_API;
  if (!binding) {
    return new Response(
      JSON.stringify({ error: 'WORKER_API service binding missing on pages worker' }),
      { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
  const upstream = await binding.fetch('https://worker-api.internal/health');
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) respHeaders.set(k, v);
  respHeaders.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
};
