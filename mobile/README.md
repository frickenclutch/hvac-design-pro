# HVAC Design Pro — Mobile (placeholder)

React Native (Expo) field-tech app, **not yet started**. Per the
strategic priority order in `~/.claude/projects/.../memory/project_layer_priorities.md`:

> 7. **Mobile** — Field-tech experience. Blocked by everything else;
>    needs stable backend + clear offline sync.

Do not begin Expo scaffolding until:

1. Backend persistence Priority 1 is fully closed (calc + CAD drawing
   sync to D1, currently localStorage-only).
2. Auth hardening lands (today's auth is mocked; v1.1 target is OTP
   via Cloudflare Workers).
3. WebSocket collab (Phase 4) has a stable contract — mobile users
   coming and going on flaky connections should not desync the
   shared project graph.

Until those land, this directory stays empty intentionally so we
don't accumulate stale scaffolding that mis-signals readiness.

When work begins, target the latest Expo SDK + React Native 0.78+,
with `react-native-web` for code reuse with the existing engines/
modules in `frontend/src/engines/`.
