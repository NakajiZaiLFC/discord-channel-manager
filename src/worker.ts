// Stub worker entrypoint. Real handlers land in Slim B.
// Exists so vitest-pool-workers can bootstrap for tests that touch bindings (D1, etc).
export default {
  async fetch(): Promise<Response> {
    return new Response('Not Implemented', { status: 501 });
  },
};
