import type { WebhookProvider } from "../types";
import { hubspot } from "./hubspot";

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

export function getProvider(name: string): WebhookProvider | undefined {
  return providers.get(name);
}

export function listProviders(): string[] {
  return Array.from(providers.keys());
}
