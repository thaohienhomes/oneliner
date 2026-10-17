import { Comfy } from "@comfyorg/sdk";

/**
 * Shared Comfy client.
 *
 * - Auth: COMFY_API_KEY (sent as a bearer token; never logged).
 * - Target: COMFY_BASE_URL. Blank/unset = Comfy Cloud (https://cloud.comfy.org).
 *   The SDK reads COMFY_BASE_URL itself at construction; we only normalise a
 *   whitespace-only value so "blank" always means Cloud.
 */
let client: Comfy | null = null;

export function getComfy(): Comfy {
  if (client) return client;

  if (process.env.COMFY_BASE_URL !== undefined && process.env.COMFY_BASE_URL.trim() === "") {
    delete process.env.COMFY_BASE_URL;
  }

  const apiKey = process.env.COMFY_API_KEY?.trim() || undefined;
  // Throws MissingCredentials (no network) when targeting Cloud without a key.
  client = new Comfy({ apiKey, clientInfo: "oneliner" });
  return client;
}

export function comfyTarget(): string {
  return process.env.COMFY_BASE_URL?.trim() || "https://cloud.comfy.org (Comfy Cloud)";
}
