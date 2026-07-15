# Supplier Matrix — Design Spec (Phase 1)

**Status:** Design locked, build deferred (decided 2026-07-06, post-Liberty-demo).
**Author:** engineering + founder (Nathan Griffith).
**Scope of this doc:** the per-tenant, self-calibrated supplier directory that
feeds the retailer finder + cost/matching engine. This is the framing for the
"connect your own suppliers" vision. It does **not** cover in-platform ordering,
server-side email-with-PDF, live API sync, or the parts/SKU matrix — those are
named here as deferred so the structure accommodates them, but they are out of
scope for the first build.

---

## 1. Product intent

The platform sits at the **top of the procurement funnel**: blueprint → Manual
J/S/D → a qualified bill of materials. Whoever owns that owns the buying
decision. To be "encompassing to the industry and all her models," every tenant
— from a national network down to a **single proprietor** — must be able to
bring **their own** supplier network into that funnel and **calibrate it
themselves**, within their own tenant, without engineering involvement.

Design principles:

1. **Tenant-owned & isolated.** A tenant's suppliers live in that tenant. No
   tenant sees another's. (Enforced by the platform's existing org-scoping —
   §2 Layer 3 in CLAUDE.md; the D1 table joins the tenant-scoping CI guard's
   strict-tables list.)
2. **Self-calibrated.** The tenant uploads, classifies, and maintains their
   own records — they own the accuracy, not us.
3. **User-driven ingestion, low floor.** CSV upload for anyone with a
   spreadsheet; manual add/edit for the small shop that won't bother with a
   file. API/webhook sync is a later provenance, not a prerequisite.
4. **Neutral by construction.** Ranking is transparent (distance + capability +
   tier), and any "preferred/sponsored" placement is labeled — never silent
   self-dealing. This is what keeps contractors trusting the procurement.

---

## 2. Data model

### 2.1 `SupplierRecord`

```ts
interface SupplierRecord {
  id: string;
  orgId: string;                 // owning tenant; platform defaults use a sentinel
  name: string;

  // Relationship tier — EXTENSIBLE (see §2.2). Stored as a key referencing a
  // tier definition, so tenants can add custom labels without a code change.
  relationshipKey: string;       // e.g. 'main' | 'ancillary' | 'complementary' | 'competitor' | <tenant-custom>

  // Provenance — where this record came from + who owns its calibration.
  source: 'platform_default' | 'tenant_manual' | 'tenant_csv' | 'api';

  address: {
    line1?: string; line2?: string;
    city?: string; state?: string; zip?: string;
  };
  coordinates?: { lat: number; lng: number };  // geocoded from zip/state if absent
  phone?: string;
  email?: string;
  website?: string;
  ecommerceUrl?: string;         // ships-anywhere channel (Howland pattern)

  // What they actually supply — drives capability-based line-item routing.
  capabilities: string[];        // e.g. ['hvac_equipment','ductwork','radiant','controls','electrical','ventilation']

  preferred: boolean;            // tenant's own "lead with this one" flag (labeled in UI)
  priority?: number;             // optional fine-grained ordering within a tier
  active: boolean;               // soft on/off without deleting
  notes?: string;

  createdAt: string;
  updatedAt: string;
}
```

### 2.2 Relationship tiers — extensible taxonomy

The four **built-in** tiers ship as defaults; tenants may add **custom** tiers.
Do NOT model `relationshipKey` as a closed TypeScript union — model tiers as
data so the set is open.

```ts
interface RelationshipTier {
  key: string;                   // stable id, e.g. 'main' or 'tenant_abc_partner'
  label: string;                 // display, e.g. 'Main network', 'Strategic partner'
  builtin: boolean;              // true for the four defaults
  orgId: string | null;          // null for builtin; tenant id for custom
  rank: number;                  // default sort weight (lower = surfaces earlier)
  routing: 'lead' | 'alongside' | 'reference' | 'hidden';
                                 // how the matching engine treats this tier by default
}
```

**Built-in defaults:**

| key | label | routing | intent |
|---|---|---|---|
| `main` | Main network | `lead` | Networks the tenant operates — lead the results. |
| `complementary` | Complementary | `alongside` | Cover *different* line items on the same project (e.g. Liberty's radiant/duct-heat/ventilation/controls next to a full-line supply house). Surface alongside, per line-item capability. |
| `ancillary` | Ancillary | `alongside` | Adjacent/occasional suppliers — surfaced when relevant. |
| `competitor` | Competitor | `reference` (default; tenant may set `hidden` or `watch`) | Rivals. Shown for intel/coverage in contested zones, hidden, or watched — tenant's call. Never silently favored or leaked cross-tenant. |

Tenants can add custom tiers (e.g. "Preferred distributor", "Buyout target",
"Manufacturer rep") with their own `routing` + `rank`. The Liberty thesis lives
here: a former "competitor" can be re-tiered to `complementary` when the
footprints overlap and the catalogs are additive rather than competing.

---

## 3. CSV ingestion (user-driven)

A tenant downloads a **template**, fills it, uploads it; the client parses,
shows a **preview + validation**, and imports. Idempotent on `(orgId, name+zip)`
or a tenant-supplied `external_id`.

### 3.1 CSV columns

| column | required | notes |
|---|---|---|
| `name` | yes | supplier/branch name |
| `relationship` | no | one of the built-in keys or a custom label; blank → `ancillary` |
| `address_line1` | no | |
| `city` | no | |
| `state` | no | 2-letter; used for centroid distance if no coords |
| `zip` | no | |
| `phone` | no | |
| `email` | no | enables the quote-request email |
| `website` | no | |
| `ecommerce_url` | no | ships-anywhere channel |
| `capabilities` | no | semicolon-separated (e.g. `hvac_equipment;ductwork;controls`) |
| `preferred` | no | `true`/`false` |
| `external_id` | no | tenant's own key for idempotent re-import |

Validation rules: name required; state must be a valid 2-letter code if given;
unknown `relationship` values become a **custom tier** (prompted) rather than an
error; rows with no location are kept but flagged "no location — won't rank by
distance" (they still show + support quote email / e-commerce).

### 3.2 Manual entry

Same fields via a form, for the small proprietor. `source = 'tenant_manual'`.

---

## 4. Storage & tenancy

- **Build-1 (framing):** tenant-scoped `localStorage` key `hvac_suppliers_{orgId}`
  (via `scopedKey`), shaped exactly like the D1 rows so the lift is mechanical.
  Same trajectory projects took before D1.
- **Phase-1 persistence:** D1 table `org_suppliers` (+ `org_relationship_tiers`
  for custom tiers), `org_id NOT NULL`, added to `STRICT_TABLES` in
  `check-tenant-scoping.mjs` so every query is org-scoped or waived. REST under
  `/api/suppliers` (+ bulk CSV import endpoint), behind auth middleware, role-
  gated for write (engineer/admin). Never trust a client-supplied `orgId` — bind
  the session org, per CLAUDE.md §2.
- **Platform defaults** (the current Howland set) become `source='platform_default'`
  seed records a tenant can adopt, hide, or replace — not hard-coded competitors.

---

## 5. UI surface

Visible in **account setup / onboarding** and **Settings → Suppliers**, reachable
by every role down to a single proprietor (read for viewer/tech; write for
engineer/admin).

- **Suppliers list** grouped by relationship tier, with tier badges, capability
  chips, source provenance, active toggle, edit.
- **Import CSV** (download template → upload → preview/validate → import) and
  **Add supplier** (manual form).
- **Manage tiers** — rename/add custom relationship tiers, set their routing +
  rank.
- Empty state seeds nothing by default (or offers to adopt the platform-default
  network) so a proprietor starts clean and owns their list.

---

## 6. Matching-engine integration

The retailer/estimate panel already ranks by distance + footprint. Phase-1
change: it reads the **tenant's** suppliers (merged with any adopted defaults)
and layers in tier routing:

1. Filter to suppliers whose `capabilities` intersect the project's needed line
   items (from Manual J/S/D — e.g. primary equipment vs. radiant vs. controls).
2. Within each needed line-item group, order by `tier.routing` then distance:
   `lead` tiers first, `alongside` shown per capability, `reference` collapsed,
   `hidden` omitted.
3. Label every placement with its tier; mark `preferred` as such (ads-vs-organic
   clarity). This is the neutrality guarantee from §1.

This is what turns "one BOM" into "route the right slice to the right supplier"
— the complementary-coverage story (Howland primary equipment + e-commerce;
Liberty radiant/duct-heat/ventilation/controls) in overlapping zones.

---

## 7. Explicitly deferred (framed, not built)

- **Server-side email with the Manual J PDF attached** (a real backend send, vs.
  the current honest mailto + manual attach).
- **In-platform ordering / checkout** against a supplier's catalog.
- **Live API / webhook sync** of a supplier's inventory + pricing (`source='api'`
  is reserved for it).
- **Parts / SKU matrix** — the per-part availability + price grid across
  suppliers. (Founder-deferred; the capability model here is the hook it plugs
  into.)

Each is named so the model above accommodates it without a redesign.

---

## 8. First-build checklist (when un-deferred)

1. `types/supplier.ts` — `SupplierRecord`, `RelationshipTier`, built-in tiers.
2. CSV template + `parseSuppliersCsv()` (client) with validation/preview.
3. `useSupplierStore` — tenant-scoped local persistence, CRUD, tier management.
4. Settings → Suppliers UI (list, import, manual add, manage tiers).
5. Retailer panel: consume tenant suppliers + tier routing + capability filter;
   tier/source badges.
6. Phase-1 persistence: migration `org_suppliers` + `org_relationship_tiers`,
   `/api/suppliers` (+ bulk import), add to STRICT_TABLES, wire the store to D1
   with local fallback (mirror `projectStorage`).
