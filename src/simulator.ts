/**
 * Webhook Simulator — "One More Thing"
 *
 * Generates realistic fake webhook payloads for any provider,
 * enabling live demos and testing without real provider accounts.
 *
 * POST /api/simulate/:provider/:tenant_id — single event
 * POST /api/simulate/:provider/:tenant_id?count=10 — burst of events
 */

import { generateEventId } from "./utils";

export interface SimulatedWebhook {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

// ─── Realistic random data pools ────────────────────────

const FIRST_NAMES = ["Alice", "Bob", "Charlie", "Dana", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack"];
const LAST_NAMES = ["Smith", "Johnson", "Chen", "Patel", "Williams", "Garcia", "Kim", "Davis", "Miller", "Wilson"];
const COMPANIES = ["Acme Corp", "Globex", "Initech", "Umbrella", "Stark Industries", "Wayne Enterprises", "Cyberdyne", "Soylent", "Hooli", "Pied Piper"];
const PRODUCTS = ["Pro Plan Annual", "Starter Kit", "Enterprise License", "Widget Pack x10", "API Credits 1000", "Team Seats x5", "Premium Support", "Data Export Add-on"];
const ISSUE_TITLES = ["Fix login redirect loop", "Dashboard not loading on mobile", "API rate limit too aggressive", "Export CSV missing headers", "Search indexing delay", "Password reset email not sent", "Webhook delivery timeout", "Dark mode contrast issue", "Memory leak in worker process", "Pagination cursor breaks on filter change"];
const DEAL_NAMES = ["Acme Expansion", "Globex Onboarding", "Series B Follow-on", "Enterprise Pilot", "Platform Migration", "Annual Renewal", "Upsell to Pro", "Partner Integration", "New Market Launch", "Proof of Concept"];
const DEAL_STAGES = ["appointmentscheduled", "qualifiedtobuy", "presentationscheduled", "decisionmakerboughtin", "contractsent", "closedwon", "closedlost"];
const CONVERSATION_SUBJECTS = ["Can't access my account", "Billing question", "Feature request: dark mode", "Bug report: export failing", "Need help with API", "Upgrade inquiry", "Cancel subscription", "Data migration help", "SSO setup issue", "Webhook not firing"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomEmail(): string {
  return `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}@${pick(["gmail.com", "company.io", "example.com", "work.dev"])}`;
}

function randomAmount(): string {
  return (randomInt(500, 50000) / 100).toFixed(2);
}

// ─── Provider-specific payload generators ───────────────

function hubspotPayload(): SimulatedWebhook {
  const types = [
    { sub: "deal.creation", obj: "deal" },
    { sub: "deal.propertyChange", obj: "deal", prop: "dealstage" },
    { sub: "deal.deletion", obj: "deal" },
    { sub: "contact.creation", obj: "contact" },
    { sub: "contact.propertyChange", obj: "contact", prop: "email" },
    { sub: "company.creation", obj: "company" },
  ];
  const evt = pick(types);
  const objectId = String(randomInt(1000, 99999));

  const body: Record<string, unknown> = {
    subscriptionType: evt.sub,
    objectId,
    portalId: String(randomInt(10000, 99999)),
    appId: String(randomInt(100, 999)),
    occurredAt: Date.now(),
  };

  if (evt.prop) {
    body.propertyName = evt.prop;
    body.propertyValue = evt.prop === "dealstage" ? pick(DEAL_STAGES) : randomEmail();
  }

  return {
    body,
    headers: { "x-hubspot-request-id": `sim_${generateEventId()}` },
  };
}

function shopifyPayload(): SimulatedWebhook {
  const topics = ["orders/create", "orders/updated", "orders/cancelled", "products/create", "customers/create"];
  const topic = pick(topics);

  const body: Record<string, unknown> = {
    id: randomInt(100000, 999999),
    _topic: topic,
  };

  if (topic.startsWith("orders")) {
    body.name = `#${randomInt(1000, 9999)}`;
    body.total_price = randomAmount();
    body.line_items = [{ title: pick(PRODUCTS), quantity: randomInt(1, 5), price: randomAmount() }];
    body.customer = { first_name: pick(FIRST_NAMES), last_name: pick(LAST_NAMES), email: randomEmail() };
  } else if (topic.startsWith("products")) {
    body.title = pick(PRODUCTS);
    body.vendor = pick(COMPANIES);
  } else if (topic.startsWith("customers")) {
    body.first_name = pick(FIRST_NAMES);
    body.last_name = pick(LAST_NAMES);
    body.email = randomEmail();
    body.total_spent = randomAmount();
  }

  return {
    body,
    headers: { "x-shopify-webhook-id": `sim_${generateEventId()}`, "x-shopify-topic": topic },
  };
}

function linearPayload(): SimulatedWebhook {
  const actions = [
    { action: "create", type: "Issue" },
    { action: "update", type: "Issue" },
    { action: "remove", type: "Issue" },
    { action: "create", type: "Comment" },
    { action: "create", type: "Project" },
  ];
  const evt = pick(actions);
  const states = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Cancelled"];
  const priorities = [0, 1, 2, 3, 4];

  const data: Record<string, unknown> = {
    id: `${evt.type.substring(0, 3).toUpperCase()}-${randomInt(1, 500)}`,
  };

  if (evt.type === "Issue") {
    data.title = pick(ISSUE_TITLES);
    data.priority = pick(priorities);
    data.state = { name: pick(states) };
    data.assignee = { name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}` };
  } else if (evt.type === "Comment") {
    data.body = pick(["Looks good", "Can we revisit this?", "Shipped!", "Needs more testing", "LGTM", "Blocked by infra"]);
    data.issue = { id: `ISS-${randomInt(1, 500)}`, title: pick(ISSUE_TITLES) };
  } else if (evt.type === "Project") {
    data.name = `${pick(["Q2", "Q3", "Q4"])} ${pick(["Launch", "Migration", "Refactor", "Integration", "Cleanup"])}`;
  }

  return {
    body: { action: evt.action, type: evt.type, data, webhookId: `sim_${generateEventId()}` },
    headers: { "linear-delivery": `sim_${generateEventId()}` },
  };
}

function intercomPayload(): SimulatedWebhook {
  const topics = [
    "conversation.user.created",
    "conversation.user.replied",
    "conversation.admin.replied",
    "conversation.admin.closed",
    "conversation.admin.assigned",
    "contact.created",
  ];
  const topic = pick(topics);

  const item: Record<string, unknown> = {
    id: `conv_${randomInt(100, 9999)}`,
    type: "conversation",
  };

  if (topic.includes("conversation")) {
    item.source = { subject: pick(CONVERSATION_SUBJECTS) };
    if (topic.includes("assigned") || topic.includes("admin")) {
      item.assignee = { name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}` };
    }
  } else {
    item.type = "contact";
    item.name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    item.email = randomEmail();
  }

  return {
    body: { topic, id: `notif_sim_${randomInt(1000, 9999)}`, data: { item } },
    headers: { "x-request-id": `sim_${generateEventId()}` },
  };
}

function gustoPayload(): SimulatedWebhook {
  const events = [
    { type: "payroll.processed", entity: "payroll" },
    { type: "payroll.created", entity: "payroll" },
    { type: "employee.created", entity: "employee" },
    { type: "employee.updated", entity: "employee" },
    { type: "employee.terminated", entity: "employee" },
    { type: "contractor_payment.processed", entity: "contractor_payment" },
  ];
  const evt = pick(events);

  return {
    body: {
      event_type: evt.type,
      entity_type: evt.entity,
      entity_uuid: `${evt.entity}_${randomInt(100, 9999)}`,
      company_uuid: `comp_${randomInt(100, 999)}`,
      event_id: `sim_${generateEventId()}`,
      timestamp: new Date().toISOString(),
    },
    headers: { "x-gusto-delivery-id": `sim_${generateEventId()}` },
  };
}

function salesforcePayload(): SimulatedWebhook {
  const actions = ["created", "updated", "deleted"];
  const objects = ["Opportunity", "Contact", "Account", "Lead", "Case"];
  const action = pick(actions);
  const sobjectType = pick(objects);

  return {
    body: {
      action,
      sobjectType,
      Id: `001${String.fromCharCode(randomInt(65, 90))}${randomInt(10000, 99999)}`,
      Name: `${pick(COMPANIES)} — ${pick(DEAL_NAMES)}`,
      attributes: { type: sobjectType },
    },
    headers: { "x-sfdc-delivery-id": `sim_${generateEventId()}` },
  };
}

function pagerdutyPayload(): SimulatedWebhook {
  const events = [
    { type: "incident.triggered", urgency: "high" },
    { type: "incident.triggered", urgency: "low" },
    { type: "incident.acknowledged", urgency: "high" },
    { type: "incident.resolved", urgency: "high" },
    { type: "incident.escalated", urgency: "high" },
  ];
  const evt = pick(events);
  const titles = ["CPU usage >95% on prod-web-01", "API latency p99 > 2s", "Database connection pool exhausted", "SSL certificate expires in 7 days", "Memory leak detected in worker", "Deployment pipeline failing"];

  return {
    body: {
      event: {
        event_type: evt.type,
        data: {
          id: `P${randomInt(100000, 999999)}`,
          title: pick(titles),
          urgency: evt.urgency,
          service: { name: pick(["web-api", "worker", "database", "cdn", "auth-service"]) },
        },
      },
      message_id: `sim_${generateEventId()}`,
    },
    headers: { "x-webhook-id": `sim_${generateEventId()}` },
  };
}

function zendeskPayload(): SimulatedWebhook {
  const events = [
    { action: "created", status: "new" },
    { action: "updated", status: "open" },
    { action: "updated", status: "pending" },
    { action: "updated", status: "solved" },
  ];
  const priorities = ["low", "normal", "high", "urgent"];
  const subjects = ["Can't login to dashboard", "Billing discrepancy on invoice", "Feature request: bulk export", "API returning 500 errors", "Need to upgrade plan", "Data not syncing"];
  const evt = pick(events);

  return {
    body: {
      type: "ticket",
      action: evt.action,
      ticket: {
        id: randomInt(10000, 99999),
        subject: pick(subjects),
        status: evt.status,
        priority: pick(priorities),
        requester: { name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, email: randomEmail() },
      },
    },
    headers: { "x-zendesk-webhook-id": `sim_${generateEventId()}` },
  };
}

// ─── Public API ─────────────────────────────────────────

const generators: Record<string, () => SimulatedWebhook> = {
  hubspot: hubspotPayload,
  shopify: shopifyPayload,
  linear: linearPayload,
  intercom: intercomPayload,
  gusto: gustoPayload,
  salesforce: salesforcePayload,
  pagerduty: pagerdutyPayload,
  zendesk: zendeskPayload,
};

export function generateWebhook(provider: string): SimulatedWebhook | null {
  const gen = generators[provider];
  if (!gen) return null;
  return gen();
}

export function simulatorProviders(): string[] {
  return Object.keys(generators);
}
