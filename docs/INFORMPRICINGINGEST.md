# HVAC Design Pro ↔ DDI Inform — Pricing Feed Integration Ask

**Date:** 2026-09-11 (supersedes the 2026-07-23 draft)
**From:** HVAC Design Pro engineering (C4 Technologies)
**To:** DDI Inform admin / integration owner
**Goal:** Feed real, customer-specific distributor pricing from Inform into HVAC Design Pro's live cost estimates, replacing the national-average ballpark we show today.

---

## 1. What we're trying to do

When an engineer finishes a load calc, our app generates an equipment + materials cost estimate. Today those numbers come from hardcoded national-average tables — a disclaimed ballpark, not your real shelf/contract price. We want to swap in **your actual Inform pricing** so quotes and estimates reflect what the customer would really pay, and name the exact Inform item number on each quote line.

Our side already has a live, per-organization, tenant-isolated pricing engine with **two live intake channels** — a CSV price book and an **inbound JSON feed** (you push to us). Either one works with **no new development on our side**.

---

## 2. Three paths — pick whichever is easiest on the Inform side

### ✅ Path A — Scheduled price-book export (CSV). Live today.
Inform produces a flat-file/CSV price book on a schedule (daily or weekly is fine) → an admin drops it into our upload pipeline (or a job on your side POSTs it — see Path B). Schema in §3.

Realistic vehicles, whichever you already have plumbing for:
- Native Inform report/export scheduled to a file drop, **or**
- **EDI-832 price/sales catalog** (via your SPS Commerce EDI Gateway) transformed to CSV, **or**
- A middleware/iPaaS job (DCKAP Integrator, etc.) that pulls the price matrix and emits CSV.

### ✅ Path B — Inbound JSON feed (you push to us). Live today. **Recommended.**
We give you an **ingest URL + bearer token** (per feed, rotatable). A scheduled job on your side — an Inform export script, DCKAP/iPaaS flow, or anything that can make an HTTPS POST — sends the price book as JSON. Each push **replaces** the previous book, so the feed is idempotent and can simply re-run on a schedule. Full contract in **§8**.

This is the machine-to-machine version of Path A: same fields, same match keys, no human in the loop.

### 🔜 Path C — Live pull via the Inform eCommerce API. Later (needs build on our side).
Your **eCommerce API "price and stock"** call returns real-time, **customer-specific contract price** by passing an authenticated customer account. That's the richer end state (per-customer, live). It requires us to build the executor + encrypted credential storage, and it requires **partner API credentials from DDI/Advantive**. Worth doing later; not needed to start.

> We don't need outbound webhooks from Inform for Path C — a pull/export model is right. Path B is the reverse (you push), and is the fastest way to real numbers on every estimate.

---

## 3. The price-book schema — exact columns / fields

These are the same for CSV (Path A) and JSON (Path B). Names are case-insensitive; separators (`_`, `-`, space) are ignored, so `unit_price`, `Unit Price` and `unitPrice` are all the same field. Two are required; the rest are optional but **strongly** wanted for good matching.

| Field | Required? | Allowed / expected values | Notes |
|---|---|---|---|
| `category` | **Yes** | `equipment` \| `ductwork` \| `controls` \| `labor` \| `permits` \| `misc` | Buckets the line. See §4 for which we actually price. If you'd rather send your own **product group / item class** codes, we map them on our side (see §5). |
| `unit_price` | **Yes** | **number > 0** | `$` and thousands commas are OK (`$4,850` fine). Net/contract price preferred over list. **Blank, `$`-only, `0`, negative and non-numeric prices are rejected** (row skipped and reported) — they are never loaded as $0.00. Omit a row you don't have a price for. |
| `system_type` | For equipment | `heat_pump` \| `ac_furnace` \| `mini_split` \| `packaged` | Drives the equipment match key (see §4). `Heat Pump` / `mini-split` spellings are normalized. |
| `tonnage` | For equipment | number | e.g. `3` or `3.5` (`3.5 ton` tolerated). |
| `model` | Recommended | brand / model / SKU / **Inform item #** | Shown on the quote line so a branch can quote the exact SKU; also builds keys for non-equipment rows. |
| `description` | Recommended | free text | Shown on the line; fallback for key building. |
| `unit` | Optional | defaults to `each` | Informational (we take quantity from the calc). |
| `match_key` | **See §4** | literal key string | The override that guarantees a hit for non-equipment lines. |
| `currency` | Optional | defaults `USD` | Keep `USD` — non-USD is stored but not converted yet. |

**Accepted aliases** (so a native Inform export can load without renaming columns):

| Our field | Also accepted as |
|---|---|
| `category` | `product_group`, `product_class`, `item_class`, `item_group`, `group`, `class` |
| `unit_price` | `price`, `net_price`, `contract_price`, `customer_price`, `cust_price`, `sell_price`, `unit_cost` |
| `system_type` | `equipment_type` |
| `tonnage` | `tons`, `capacity_tons`, `nominal_tons` |
| `model` | `model_number`, `item_number`, `item_no`, `item_id`, `sku`, `part_number`, `mfr_model`, `mfg_model` |
| `description` | `desc`, `item_description`, `name` |
| `unit` | `uom`, `unit_of_measure` |
| `match_key` | `matchKey` |
| `currency` | `currency_code` |

If a record carries both a canonical name and an alias, the canonical name wins. Unknown columns/properties are ignored.

Rows that fail validation are **skipped and reported back** (row/item number + reason); everything else loads.

---

## 4. The match keys — **the part that makes it actually align**

Our estimator resolves each estimate line against a **specific set of literal keys**. If a row's key doesn't match one of these exactly, the row loads fine but is silently ignored and the average stands. So this section is the whole ballgame. (Path B's response echoes the keys your payload covered — `matchKeys` — so you can see coverage on every push.)

### Equipment rows — easy, automatic
Just give `category=equipment` + `system_type` + `tonnage` and **leave `match_key` blank**. We auto-build the key. For best coverage, provide a price for **each tonnage bucket** we snap to: **1.5, 2, 2.5, 3, 3.5, 4, 5**.

The keys we build (for reference): `equipment:heat_pump:3`, `equipment:ac_furnace:3.5`, `equipment:mini_split:2`, `equipment:packaged:4`, etc.

### Everything else — set `match_key` to one of these **exact** literals
Auto-derivation does **not** produce these, so for non-equipment lines the `match_key` must be filled with the exact string:

| Line we're pricing | Put this in `match_key` | Category |
|---|---|---|
| Air handler (split systems) | `equipment:air_handler` | equipment |
| Ductwork, ducts in conditioned space (per ft) | `ductwork:conditioned` | ductwork |
| Ductwork, ducts in attic (per ft) | `ductwork:attic` | ductwork |
| Ductwork, ducts in crawlspace (per ft) | `ductwork:crawlspace` | ductwork |
| Ductwork, ducts in garage (per ft) | `ductwork:garage` | ductwork |
| Ductwork, ducts in unconditioned basement (per ft) | `ductwork:basement_uncond` | ductwork |
| Refrigerant line set | `misc:lineset` | misc |
| Thermostat | `controls:thermostat` | controls |
| Condensate kit/pump | `misc:condensate` | misc |
| Air filter | `misc:filter` | misc |

Per-foot lines keep their cents (`3.25` stays `$3.25/ft`); the line total is computed from the exact unit price.

### Don't bother sending these — the engine computes them itself
**Labor, permits, duct fittings/boots/registers, and sales tax** are calculated by our app (regional labor index, tax tables, etc.) and are **not** sourced from the feed. Rows for them will just be ignored. (If you *want* to drive labor/permits from Inform later, that's a small enhancement on our side — flag it and we'll scope it.)

---

## 5. Inform → feed field mapping (for the DDI expert)

Roughly how Inform concepts map to our fields — you'll know the exact table/field names:

- **Item / product number** (and/or mfr model #, UPC) → `model`
- **Item description** → `description`
- **Net / contract price from the price matrix** → `unit_price`  ← the important one: we want the *customer's* price, not blind list, if you can pin an export to a **customer account or price class**
- **Product group / price class / item class** → `category`. You can send your own codes as-is (e.g. `HP-COND`, `TSTAT`): tell us the code → bucket mapping once and we configure it on the feed (a **category map**), so your export needs no translation step.
- **Tonnage** → `tonnage` (if it lives in a product attribute / UDF / model-number convention, tell us where so we can validate)

The main human judgment we need from you: **which Inform item groups/classes correspond to** condensers/heat pumps, furnaces/AC, mini-splits, packaged units, air handlers, thermostats, line sets, condensate kits, and filters — plus the tonnage attribute on equipment.

---

## 6. Open questions for DDI / Advantive

1. Can Inform produce a **scheduled export** of a price book — native report/export, EDI-832, or middleware? And can that job **POST JSON to an HTTPS endpoint** (Path B) or only write a file (Path A)?
2. Which **customer account or price class** should the export reflect (contract vs list)? Or do we want a representative "house" price class to start?
3. Where is **tonnage** stored on equipment items (attribute, UDF, model-number convention)?
4. For the eventual **API path (Path C)**: is the eCommerce API "price and stock" enabled on this install? Is it **on-prem or hosted** (affects connectivity/auth)? What partner credentials does Advantive require, and is the wire format REST/JSON or SOAP/XML? Any rate limits?
5. What **refresh cadence** suits you for Path A/B — nightly is plenty for us.

---

## 7. Sample CSV (this is exactly what "good" looks like)

```csv
category,system_type,tonnage,model,description,unit,unit_price,match_key
equipment,heat_pump,2,ACME-HP24,2-ton heat pump condenser,each,3950,
equipment,heat_pump,3,ACME-HP36,3-ton heat pump condenser,each,4850,
equipment,heat_pump,3.5,ACME-HP42,3.5-ton heat pump condenser,each,5400,
equipment,ac_furnace,3,ACME-AC36,3-ton AC + furnace,each,4200,
equipment,,,ACME-AH,Variable-speed air handler,each,1200,equipment:air_handler
ductwork,,,FLEX-R8,R8 insulated flex duct (attic),ft,3.25,ductwork:attic
ductwork,,,SHEET-COND,Sheet-metal trunk (conditioned),ft,4.10,ductwork:conditioned
controls,,,ECO-PREM,ecobee Premium thermostat,each,245,controls:thermostat
misc,,,LS-3438,3/8 x 3/4 line set 25ft,each,185,misc:lineset
misc,,,CDP-100,Condensate pump kit,each,95,misc:condensate
misc,,,MERV13,MERV-13 media filter,each,65,misc:filter
```

Send one file like this (as many equipment tonnage rows as you can), and estimates start showing real DDI pricing on the flagged lines immediately. Anything you're unsure how to map — send it over and we'll sort the keys together.

---

## 8. Path B contract — inbound JSON feed

### Endpoint
```
POST https://hvac-api.c4tech.workers.dev/api/pricing/ingest/{sourceId}
Authorization: Bearer {ingestToken}
Content-Type: application/json
```
We send you `{sourceId}` and `{ingestToken}` out of band (the token is shown once when issued and can be rotated at any time; store it in your job's secret store). `X-Ingest-Token: {ingestToken}` is accepted instead of the `Authorization` header if your tool can't set it.

### Body
```json
{
  "items": [
    { "category": "equipment", "system_type": "heat_pump", "tonnage": 3,   "model": "ACME-HP36", "description": "3-ton heat pump condenser", "unit_price": 4850 },
    { "category": "equipment", "system_type": "heat_pump", "tonnage": 3.5, "model": "ACME-HP42", "description": "3.5-ton heat pump condenser", "unit_price": "$5,400.00" },
    { "category": "equipment", "match_key": "equipment:air_handler", "model": "ACME-AH", "description": "Variable-speed air handler", "unit_price": 1200 },
    { "category": "ductwork",  "match_key": "ductwork:attic", "model": "FLEX-R8", "description": "R8 flex duct", "unit": "ft", "unit_price": 3.25 },
    { "category": "controls",  "match_key": "controls:thermostat", "model": "ECO-PREM", "unit_price": 245 },
    { "category": "misc",      "match_key": "misc:lineset", "model": "LS-3438", "unit_price": 185 },
    { "category": "misc",      "match_key": "misc:condensate", "model": "CDP-100", "unit_price": 95 },
    { "category": "misc",      "match_key": "misc:filter", "model": "MERV13", "unit_price": 65 }
  ],
  "dryRun": false
}
```
- Fields per item are exactly §3 (aliases accepted; numbers or strings are fine for `unit_price` / `tonnage`).
- `dryRun: true` validates the whole payload and reports what *would* load — **nothing is written**. Use it while you're building the job.
- **Replace semantics:** each successful push replaces the previous book for that feed. Send the complete book every time; don't send deltas.
- Limits: **1,000 items** and **2 MB** per request. Non-object items are skipped and reported.

### Response
`200 OK`
```json
{
  "ok": true,
  "sourceId": "…",
  "dryRun": false,
  "loaded": 8,
  "skipped": 0,
  "errors": [],
  "matchKeys": ["equipment:heat_pump:3", "equipment:heat_pump:3.5", "equipment:air_handler", "ductwork:attic", "controls:thermostat", "misc:lineset", "misc:condensate", "misc:filter"],
  "status": "active"
}
```
- `skipped` / `errors` list the rejected items with the reason, e.g. `"Item 4: unit_price must be greater than 0"`, `"Item 7: unknown category \"WIDGETS\""`. Up to 20 errors are echoed.
- `matchKeys` is the set of estimator keys your book now covers (§4) — the quickest way to confirm alignment.

| Status | Meaning |
|---|---|
| `200` | Loaded (or dry-run validated). |
| `400` | Malformed body, empty `items`, or **no valid rows** (the previous book is left untouched; `details` lists the reasons). |
| `401` | Missing/invalid token or unknown feed. (Unknown feed and bad token look identical on purpose.) |
| `409` | The feed was **disabled** by an admin on our side — nothing is written until it's re-enabled. |
| `413` | More than 1,000 items or more than 2 MB. |

### Quick test from a shell
```bash
curl -sS -X POST "https://hvac-api.c4tech.workers.dev/api/pricing/ingest/$SOURCE_ID" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"items":[{"category":"controls","match_key":"controls:thermostat","model":"ECO-PREM","unit_price":245}]}'
```
Expect `{"ok":true,"dryRun":true,"loaded":1,"skipped":0,…,"matchKeys":["controls:thermostat"]}`. Flip `dryRun` to `false` (or drop it) to load for real.
