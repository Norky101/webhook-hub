import type { WebhookProvider } from "../types";
import { hubspot } from "./hubspot";
import { shopify } from "./shopify";
import { linear } from "./linear";
import { intercom } from "./intercom";
import { gusto } from "./gusto";

/**
 * Provider registry — add new providers here.
 * Think of it as a phone book: look up a provider by name, get its handler.
 */
const providers = new Map<string, WebhookProvider>();

function register(provider: WebhookProvider) {
  providers.set(provider.name, provider);
}

// Register all providers
register(hubspot);
register(shopify);
register(linear);
register(intercom);
register(gusto);

export function getProvider(name: string): WebhookProvider | undefined {
  return providers.get(name);
}

export function listProviders(): string[] {
  return Array.from(providers.keys());
}
