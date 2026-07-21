# calc-service — ASPIRATIONAL / NON-SHIPPING

> **Do not implement the engines in this tree. Do not "complete" the stubs.**

This Python/FastAPI tree is **architectural scaffolding for a possible future
backend**. It is **not used in production**, it is **not on the deploy path**,
and every engine/validator file here is an empty placeholder (a one-line
comment). It exists only to document an intended shape.

## The live engine is TypeScript — and it is the single source of truth

The calculation engines that actually ship and are under **ACCA certification
review** live entirely in:

```
frontend/src/engines/
  ├── manualJ.ts            # legacy per-room engine (display today)
  ├── manualJ8/             # cert-grade Form J1 engine (manualJ8-ts-1.3.0)
  ├── manualD.ts            # duct sizing
  ├── aed.ts                # Adequate Exposure Diversity
  └── manualS.ts            # equipment selection
```

These are **pure, typed, portable functions** with their own cert-grade vitest
suite (Smith / Walker / Cobb reference cases) gated in CI (`.github/workflows/ci.yml`).
They run client-side today and could run unchanged inside a Cloudflare Worker if
server-side recompute is ever needed (Workers execute JS natively).

## Why this matters — the duplication trap

If someone "fills in" `engines/acca/manual_j.py` (or `manual_s.py`,
`sizing_limits.py`, …), the project immediately has **two** calculation engines
that can silently diverge. One of them is ACCA-certified; the other is not.
Outputs from an uncertified engine are **legally invalid** for permit
applications. A divergence between the two is a correctness *and* compliance
hazard with no upside — there is nothing this Python engine could do that the
TypeScript engine does not already do as the certified, single source of truth.

**If you need server-side or international calculation work, extend the
TypeScript engines** (e.g. a thin `engines/registry.ts` `CalcEngine` seam for
region-selected standards like CSA F280 / EN 12831). Keep one engine.

## What about the `tests/` here?

`calc-service/tests/test_smith_residence.py` etc. are also stubs. The **real**
ACCA reference validation lives in `frontend/src/engines/manualJ8/__tests__/`
(Smith / Walker / Cobb) and is the actual CI correctness gate. The older
`deploy.yml` pytest job targets this non-shipping tree and is not the gate.

## If you're cleaning up

It is safe to delete this entire tree. It is kept only as documented intent.
If you keep it, leave it stubbed and leave this README in place so the next
contributor doesn't walk into the trap above.
