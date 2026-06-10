// workers/src/billing/provider.ts
//
// Provider-agnostic seam. The core billing routes / usage meter NEVER import a
// concrete provider — they call this interface. Real providers (Stripe / ERP /
// ILP) land later as impls that read credentials from env bindings. Until then
// every impl returns an explicit NOT_WIRED result; nothing throws into the
// request path.
//
// HARD CONSTRAINT (this unit): NO live credentials, NO external API calls. The
// three real-provider classes are clearly-marked STUBS — connecting them later
// is config + credentials + overriding individual methods, never a schema or
// code rebuild.

export type ProviderName = 'manual' | 'stripe' | 'erp' | 'ilp';

/** Uniform "this seam isn't connected yet" result. Callers branch on `ok`. */
export interface NotWired {
  ok: false;
  code: 'not_implemented' | 'not_wired';
  provider: ProviderName;
  message: string;
}
export interface ProviderOk<T> {
  ok: true;
  provider: ProviderName;
  data: T;
}
export type ProviderResult<T> = ProviderOk<T> | NotWired;

export interface CustomerRef {
  providerCustomerRef: string;
}
export interface SubscriptionRef {
  providerSubscriptionRef: string;
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}
export interface ChargeRef {
  providerInvoiceRef: string;
  amountMinor: number;
  currency: string;
}

/** Normalised webhook outcome the ingress route persists (idempotently). */
export interface WebhookOutcome {
  ok: boolean;
  handled: boolean; // false when event type is ignored / unrecognised
  eventType?: string;
  // Optional projections the route maps into subscriptions/invoices/usage:
  subscription?: Partial<SubscriptionRef> & { orgId?: string };
  invoice?: Partial<ChargeRef> & { orgId?: string; status?: string };
  note?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** True once credentials/config are present. All stubs return false today. */
  isConfigured(): boolean;

  createCustomer(input: {
    orgId: string;
    email: string;
    name?: string;
  }): Promise<ProviderResult<CustomerRef>>;
  createSubscription(input: {
    orgId: string;
    customerRef: string;
    plan: string;
  }): Promise<ProviderResult<SubscriptionRef>>;
  cancelSubscription(input: {
    providerSubscriptionRef: string;
    atPeriodEnd: boolean;
  }): Promise<ProviderResult<SubscriptionRef>>;
  recordCharge(input: {
    orgId: string;
    amountMinor: number;
    currency: string;
    description?: string;
  }): Promise<ProviderResult<ChargeRef>>;
  /** Verify signature + parse. Stubs return handled:false, never throw. */
  handleWebhook(input: {
    rawBody: string;
    signature: string | null;
    secret?: string;
  }): Promise<WebhookOutcome>;
}

/** Shared "not wired yet" result builder. */
function notWired(provider: ProviderName, method: string): NotWired {
  return {
    ok: false,
    code: 'not_wired',
    provider,
    message:
      `${provider}.${method} is not wired yet — no credentials configured. ` +
      `Connect this provider via env bindings; no schema/code rebuild required.`,
  };
}

/** Shared stub base — every method returns NOT_WIRED. Concrete providers
 *  override individual methods once credentials exist. */
abstract class StubProvider implements PaymentProvider {
  abstract readonly name: ProviderName;
  isConfigured(): boolean {
    return false;
  }
  // Signatures mirror the PaymentProvider interface exactly so concrete
  // providers (esp. ManualProvider) can override individual methods with the
  // real parameter list. The args are intentionally unused in the stub bodies.
  async createCustomer(
    _input: { orgId: string; email: string; name?: string },
  ): Promise<ProviderResult<CustomerRef>> {
    return notWired(this.name, 'createCustomer');
  }
  async createSubscription(
    _input: { orgId: string; customerRef: string; plan: string },
  ): Promise<ProviderResult<SubscriptionRef>> {
    return notWired(this.name, 'createSubscription');
  }
  async cancelSubscription(
    _input: { providerSubscriptionRef: string; atPeriodEnd: boolean },
  ): Promise<ProviderResult<SubscriptionRef>> {
    return notWired(this.name, 'cancelSubscription');
  }
  async recordCharge(
    _input: { orgId: string; amountMinor: number; currency: string; description?: string },
  ): Promise<ProviderResult<ChargeRef>> {
    return notWired(this.name, 'recordCharge');
  }
  async handleWebhook(
    _input?: { rawBody: string; signature: string | null; secret?: string },
  ): Promise<WebhookOutcome> {
    return { ok: true, handled: false, note: `${this.name} webhook received but not wired` };
  }
}

// ── Concrete stubs. Each is a clearly-marked seam. ──────────────────────────

/** Stripe: createCustomer→cus_, createSubscription→sub_, webhook→Stripe-Signature.
 *  Wire by reading STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET from env and
 *  overriding the individual methods. STUB today — every method NOT_WIRED. */
export class StripeProvider extends StubProvider {
  readonly name = 'stripe' as const;
}

/** ERP invoice rail (e.g. NetSuite / SAP / QuickBooks via middleware):
 *  recordCharge emits an external invoice ref; subscriptions map to contracts.
 *  STUB today — every method NOT_WIRED. */
export class ErpProvider extends StubProvider {
  readonly name = 'erp' as const;
}

/** ILP (Interledger) streaming micropayments: payment pointer in provider_ref,
 *  stream/quote id in metadata. recordCharge settles a stream; usage_events
 *  feed per-usage micropayment amounts. Open Payments handleWebhook stub for
 *  now. STUB today — every method NOT_WIRED. */
export class IlpProvider extends StubProvider {
  readonly name = 'ilp' as const;
}

/** Manual / free_beta: the ONLY provider that "works" today — it just records
 *  state in D1 with no external call. Lets billing flows exist end-to-end
 *  (subscriptions, invoices) without any external integration. */
export class ManualProvider extends StubProvider {
  readonly name = 'manual' as const;
  isConfigured(): boolean {
    return true;
  }
  // Manual overrides return ok with locally-minted refs (no external system).
  async createCustomer(input: {
    orgId: string;
    email: string;
    name?: string;
  }): Promise<ProviderResult<CustomerRef>> {
    return {
      ok: true,
      provider: this.name,
      data: { providerCustomerRef: `manual:${input.orgId}` },
    };
  }
  async createSubscription(input: {
    orgId: string;
    customerRef: string;
    plan: string;
  }): Promise<ProviderResult<SubscriptionRef>> {
    return {
      ok: true,
      provider: this.name,
      data: {
        providerSubscriptionRef: `manual:${input.orgId}:${input.plan}`,
        status: 'active',
      },
    };
  }
}

/** Factory — single resolution point. Defaults to manual so the platform has a
 *  working "billing" path with zero credentials. */
export function getProvider(name: ProviderName | string | undefined): PaymentProvider {
  switch (name) {
    case 'stripe':
      return new StripeProvider();
    case 'erp':
      return new ErpProvider();
    case 'ilp':
      return new IlpProvider();
    case 'manual':
    default:
      return new ManualProvider();
  }
}
