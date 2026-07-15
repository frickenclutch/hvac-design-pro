# Ceiling CLTD Transcription Worksheet — Unblock Phase-2 Cutover

**Status:** awaiting source photos of the ceiling CLTD pages (book in hand — Nathan
photographing; Dan also has a copy).
**Blocks:** Phase-2 cutover readiness — 100% of shadow-run failures (24/24 all-time,
19 in the last 30 days) trace to missing ceiling CLTD cells. Zero drift samples can
be collected until these land.

> **SOURCE CORRECTION (2026-07-15, verified against book photos of pp. 383–387):**
> This worksheet (and the engine's TABLE-4D-GAP charter / error messages) originally
> cited "Table 4D" for ceiling CLTDs. **That citation is wrong.** In the actual
> v2.50 book the Table 4 series is: 4B = wall/partition CLTD (p.383, now verified
> cell-for-cell against the encoded table4B.ts, incl. the quirky Group D 15/M=19.4),
> 4B Notes (p.384), 4C = closed-garage ambient temp (p.385), **4D = isolated-sunroom
> ambient temp (p.386)**, 4E = encapsulated-attic ambient temp (p.387). The ceiling
> CLTD matrix is NOT in Table 4D. Candidate real locations, in likelihood order:
> (1) the Table 4A Construction 16/17/18 ceiling pages (p.355 onward, after basement
> walls end at 354); (2) Appendix 12 — p.384 note 3 cites "Figure A12-8 CLTD values"
> for walls, so the roof/ceiling equivalent likely sits nearby in A12. The cert-
> anchored VALUES already encoded (16B-30ad 15/M=50 etc.) are unaffected — only the
> table name was misattributed. Engine error-message wording and constructions.ts
> comments will be corrected in the same commit that lands the transcribed cells.

---

## Why this exists

The cert-grade `manualJ8` engine deliberately **throws** instead of guessing when a
CLTD cell isn't in its registry (a silently-wrong CLTD on a permit-bound calc is
worse than a loud failure). The ceiling registry (`frontend/src/engines/manualJ8/
tables/constructions.ts`, `TABLE-4D-GAP` block) carries only the single cell per
ceiling that the Smith/Walker cert cases exercised — all at **CTD=15**, one DR each.

Production users are in **cooler climates** (upstate NY / VT — CTD 11–20, DR M/H),
so every one of their calcs demands a cell the registry doesn't have:

| Production demand (from prod `calculations` failure rows) | Failures | Distinct projects |
|---|---|---|
| `16B-30ad` @ **bin 15, DR=H** (requested CTD=11) | 8 recent + 4 older mislabeled "4B" | 5+ |
| `16B-30ad` @ **bin 20, DR=M** (requested CTD=20) | 7 recent + 5 older mislabeled "4B" | 3+ |

(The pre-July failures labeled "Table 4B" predate the error-attribution refactor —
same cells, same ceiling. Walls/doors/partitions are fully populated and were never
the problem.)

## Transcription rules (non-negotiable — from the TABLE-4D-GAP charter)

1. Values come **only** from ACCA Manual J 8th Edition v2.50, from wherever the
   book actually publishes the **ceiling/roof CLTD matrix** (see SOURCE CORRECTION
   above — not Table 4D). Record the **page number** you read them from.
2. **NO value may be interpolated, extrapolated from wall Table 4B, or derived
   from the legacy `getCeilingCLTD()` formula.** If a (CTD, DR) cell is not
   printed in the book, leave it absent — the engine's round-up lookup and
   attributable-throw behavior handle gaps correctly.
3. Transcribe the value exactly as printed (including decimals).
4. Note the transcriber + date at the top of each matrix.

## Cells needed — TRANSCRIBED 2026-07-15 (16B/16C/16D) from source photos

Ceiling CLTDs are printed in **Table 4A** as one row per FAMILY (16A..16F, keyed
by attic temperature), shared by every R-value variant. Transcribed by Claude from
Nathan Griffith's photographs of the physical book; encoded in
`frontend/src/engines/manualJ8/tables/constructions.ts` with golden tests in
`__tests__/ceilingCltd.test.ts`. All three pre-existing cert anchors matched their
family rows exactly (✓ below), and rows carry the book's arithmetic structure
(+5 per CTD bin step, −10 per attic-temp tier).

```
Column order: 10/L 10/M | 15/L 15/M 15/H | 20/L 20/M 20/H | 25/M 25/H | 30/H | 35/H

16A (p.362, attic 150°F): 69 65 | 74  70  65 | 79 75 70 | 80 75 | 80 | 85   (transcribed, NOT encoded — no 16A registry variant; RE-VERIFY against the p.362 photo before ever encoding: this row has no cert anchor to cross-check it)
16B (p.362, attic 130°F): 49 45 | 54 [50✓] 45 | 59 55 50 | 60 55 | 60 | 65  ← ENCODED (16B-30ad; 15/M=50 = Smith anchor)
16C (p.363, attic 120°F): 39 35 | [44✓] 40 35 | 49 45 40 | 50 45 | 50 | 55  ← ENCODED (16C-38aw; 15/L=44 = Walker anchor)
16D (p.363, attic 110°F): 29 25 | [34✓] 30 25 | 39 35 30 | 40 35 | 40 | 45  ← ENCODED (16DR-38aw; 15/L=34 = Walker anchor)
```

The two production-unblocking cells both live in the 16B row: **15/H = 45**
(CTD=11 upstate-NY climates) and **20/M = 55**.

### COMPLETE — 16E/16F rows transcribed from p. 364 (second photo batch)

```
16E (p.364, attic 105°F): 24 20 | 29 25 20 | 34 30 25 | 35 30 | 35 | 40   (transcribed, NOT encoded — no 16E registry variant; RE-VERIFY against the p.364 photo before ever encoding: no cert anchor)
16F (p.364, attic  95°F): 14 10 | [19✓] 15 10 | 24 20 15 | 25 20 | 25 | 30 ← ENCODED (16F-38tw; 15/L=19 = Walker anchor, matched exactly)
```

Linear structure verified across ALL six families: the 10/L cell equals
attic_temp − 81 (150→69, 130→49, 120→39, 110→29, 105→24, 95→14). Every
registry ceiling (16B-30ad, 16C-38aw, 16DR-38aw, 16F-38tw) now carries its
complete book row — no ceiling data gaps remain. Engine: manualJ8-ts-1.2.1.

### Also photographed, available for future work (not needed today)

- **pp. 365-367 — Construction 17 (Ceiling on Exposed Beams)**: 17A dark
  (p.365), 17B medium (p.366), 17C white (p.367) — full CLTD matrices
  varying by deck construction / U-value tier. No 17-series variant exists
  in the registry; transcribe from the photos if one is added.
- **pp. 368-370 — Construction 18 (Ceiling Below Roof Joists)**: 18A dark,
  18B medium, 18C white CLTD matrices. No 18-series registry variant yet.
- **pp. 345-353, 355-361** — Table 4A constructions 11/12/13/14/15 (doors,
  frame/block/alt/basement walls): source material for a full registry-vs-
  book verification sweep (doors + Table 4B already verified cell-for-cell).

## ⚠ NEXT ENGINE GAP — Construction 19 floor PTD tables (pp. 371-375)

Discovered 2026-07-15 from the pp. 371-375 photos: the book publishes floor
PTDH as a FULL TABLE varying with HTD (columns 30..95) and PTDC varying with
(CTD, DR), per exposed-wall insulation tier (19A = none, 19B = R-4, 19C =
R-11) × floor insulation × floor cover (tile / carpet-hardwood) × sealed /
vented. The engine currently pins floors to FIXED point values
(`ptdh: 6.6, ptdc: 1.3` on 19B-osp — worksheets/opaque.ts applies them
regardless of climate). Unlike the ceiling gap this CANNOT throw — an
off-reference climate silently gets the reference-point value, understating
floor heating loss in colder-than-reference climates. (The legacy engine
scales with HTD × 0.67, so this divergence IS visible in drift telemetry.)

To fix (engine 1.3.0 unit):
1. Crisp CLOSE-UP photos of each PTDH/PTDC table block on pp. 371-375 —
   the full-page shots are too dense to transcribe reliably.
2. Map registry `19B-osp` to its exact book row — the transcription must
   reproduce the cert-anchored 6.6 / 1.3 at Smith's design conditions
   before anything is encoded (same anchor discipline as the ceilings).
3. Implement ptdh(htd) / ptdc(ctd, dr) lookups. NOTE: the ACCA 5%
   interpolation rule (CLAUDE.md §3 rule 1) likely REQUIRES interpolation
   between the 5°F HTD columns at low PTDH magnitudes — unlike the CLTD
   round-up convention. Confirm against the book's floor-table notes.
4. Pages 376+ (Constructions 20 radiant / 21 basement floors / 22 slabs)
   complete the floor story — not yet photographed.

## Where the values go

`frontend/src/engines/manualJ8/tables/constructions.ts` → each ceiling's
`directCLTD` matrix, e.g.:

```ts
// Source: ACCA Manual J 8th Ed v2.50 Table 4D, p.____, transcribed <who> <date>
directCLTD: {
  15: { L: __, M: 50, H: __ },
  20: { L: __, M: __, H: __ },
  // ...only cells printed in the book
} as Partial<Record<CTDBin, CLTDCell>>,
```

## Verification after values land

1. `cd frontend && npx vitest run` — the cert suite must stay green (Smith/Walker/
   Cobb anchors unchanged) and `__tests__/ceilingCltd.test.ts` gap tests updated.
2. Add a golden test per new cell (value straight from the book — this is the
   transcription's regression lock).
3. Deploy frontend; ask the affected users to re-run their Manual J calcs (or
   re-run via their projects). Shadow reliability on the QA panel should start
   climbing immediately; drift samples begin accruing toward the three Phase-2
   gates (≥10 distinct projects, |drift| ≤5%, reliability ≥95%).
