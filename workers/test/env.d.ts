/// <reference types="@cloudflare/vitest-pool-workers/types" />

// The triple-slash reference above pulls in the pool-workers ambient types,
// which declare the `cloudflare:test` virtual module (and its `env` export).
//
// We augment `Cloudflare.Env` (the interface `cloudflare:test`'s `env` is typed
// against) with the bindings our worker expects, so `env.DB` / `env.STORAGE`
// are typed without casts in the harness.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    STORAGE: R2Bucket;
    ENVIRONMENT: string;
  }
}
