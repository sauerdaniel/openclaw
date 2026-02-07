import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { retryAsync } from "../../infra/retry.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["brave", "perplexity", "grok"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];

const XAI_API_ENDPOINT = "https://api.x.ai/v1/responses";
const DEFAULT_GROK_MODEL = "grok-4-1-fast";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

// Rate limiting configuration - Token Bucket Pattern
// Brave Search free tier: 1 request per second = 60 requests per minute
// Token bucket allows smooth rate limiting with small bursts
const REQUESTS_PER_SECOND = 1;
const TOKEN_REFILL_INTERVAL_MS = 1000; // Refill 1 token every second
const MAX_TOKENS = 10; // Allow small bursts (up to 10 requests)

// Token bucket state - shared across all concurrent requests
let availableTokens = MAX_TOKENS;
let lastRefillTime = Date.now();

// Circuit breaker configuration
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5; // Open circuit after 5 consecutive failures
const CIRCUIT_BREAKER_TIMEOUT_MS = 60_000; // Wait 60s before attempting recovery
let circuitBreakerFailures = 0;
let circuitBreakerOpenUntil = 0; // Timestamp when circuit can attempt recovery

// Retry configuration for 429 errors with exponential backoff
const RETRY_ATTEMPTS = 4; // Initial attempt + 3 retries
const RETRY_MIN_DELAY_MS = 1000; // Start with 1 second
const RETRY_MAX_DELAY_MS = 32000; // Cap at 32 seconds
const RETRY_JITTER = 0.25; // 25% jitter to avoid thundering herd

/**
 * Token bucket rate limiter: waits until a token is available, then consumes it.
 * Enforces strict 1 request/second limit for Brave Search API (free tier).
 * Returns the actual wait time in milliseconds.
 */
async function checkRateLimit(): Promise<number> {
  let waitedMs = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const timeSinceLastRefill = now - lastRefillTime;

    // Refill tokens based on elapsed time
    // We get 1 token per second, up to MAX_TOKENS
    const tokensToAdd = Math.floor(timeSinceLastRefill / TOKEN_REFILL_INTERVAL_MS);
    if (tokensToAdd > 0) {
      availableTokens = Math.min(MAX_TOKENS, availableTokens + tokensToAdd);
      lastRefillTime = now - (timeSinceLastRefill % TOKEN_REFILL_INTERVAL_MS);
    }

    // If token available, consume it and return
    if (availableTokens > 0) {
      availableTokens -= 1;
      return waitedMs;
    }

    // Calculate wait time until next refill
    const nextRefillMs =
      TOKEN_REFILL_INTERVAL_MS - (timeSinceLastRefill % TOKEN_REFILL_INTERVAL_MS);
    // Add small jitter (5%) to avoid thundering herd
    const jitterMs = Math.random() * (nextRefillMs * 0.05);
    const sleepMs = nextRefillMs + jitterMs;

    // Sleep and try again
    await new Promise((resolve) => {
      setTimeout(resolve, sleepMs);
    });
    waitedMs += sleepMs;
  }
}

/**
 * Circuit breaker: prevents cascading failures by backing off after repeated failures.
 * Waits before allowing requests if circuit is open.
 */
async function checkCircuitBreaker(): Promise<void> {
  if (circuitBreakerOpenUntil === 0) {
    // Circuit is closed, proceed immediately
    return;
  }

  const now = Date.now();

  // If circuit is open, wait until it can attempt recovery
  if (circuitBreakerOpenUntil > now) {
    const waitMs = circuitBreakerOpenUntil - now;
    console.warn(
      `[web_search] Circuit breaker open: Waiting ${Math.ceil(waitMs / 1000)}s before recovery attempt after ${circuitBreakerFailures} failures.`,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
  }

  // Circuit can now attempt recovery (half-open state)
}

/**
 * Record a circuit breaker failure and open circuit if threshold exceeded.
 */
function recordCircuitBreakerFailure(): void {
  circuitBreakerFailures += 1;

  if (circuitBreakerFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    const now = Date.now();
    circuitBreakerOpenUntil = now + CIRCUIT_BREAKER_TIMEOUT_MS;
    console.warn(
      `[web_search] Circuit breaker opened after ${circuitBreakerFailures} consecutive failures. Will recover after ${CIRCUIT_BREAKER_TIMEOUT_MS / 1000}s.`,
    );
  }
}

/**
 * Record a circuit breaker success and reset failure counter.
 */
function recordCircuitBreakerSuccess(): void {
  const wasOpen = circuitBreakerOpenUntil > 0;
  if (wasOpen) {
    console.warn(
      `[web_search] Circuit breaker recovered after ${circuitBreakerFailures} failures.`,
    );
  }

  circuitBreakerFailures = 0;
  circuitBreakerOpenUntil = 0;
}

/**
 * Extract Retry-After header value in milliseconds.
 */
function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }

  // Try parsing as seconds (numeric)
  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  try {
    const date = new Date(retryAfter);
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine if an error is retryable (e.g., 429 rate limit).
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof Error && err.message.includes("(429)")) {
    return true;
  }
  return false;
}

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  country: Type.Optional(
    Type.String({
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    }),
  ),
  search_lang: Type.Optional(
    Type.String({
      description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
    }),
  ),
  ui_lang: Type.Optional(
    Type.String({
      description: "ISO language code for UI elements.",
    }),
  ),
  freshness: Type.Optional(
    Type.String({
      description:
        "Filter results by discovery time (Brave only). Values: 'pd' (past 24h), 'pw' (past week), 'pm' (past month), 'py' (past year), or date range 'YYYY-MM-DDtoYYYY-MM-DD'.",
    }),
  ),
});

type WebSearchConfig = NonNullable<OpenClawConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexityConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type GrokConfig = {
  apiKey?: string;
  model?: string;
  inlineCitations?: boolean;
};

type GrokSearchResponse = {
  output_text?: string;
  citations?: string[];
  inline_citations?: Array<{
    start_index: number;
    end_index: number;
    url: string;
  }>;
};

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

function resolveSearchConfig(cfg?: OpenClawConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function resolveSearchApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string"
      ? normalizeSecretInput(search.apiKey)
      : "";
  const fromEnv = normalizeSecretInput(process.env.BRAVE_API_KEY);
  return fromConfig || fromEnv || undefined;
}

function missingSearchKeyPayload(provider: (typeof SEARCH_PROVIDERS)[number]) {
  if (provider === "perplexity") {
    return {
      error: "missing_perplexity_api_key",
      message:
        "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
      docs: "https://docs.openclaw.ai/tools/web",
    };
  }
  if (provider === "grok") {
    return {
      error: "missing_xai_api_key",
      message:
        "web_search (grok) needs an xAI API key. Set XAI_API_KEY in the Gateway environment, or configure tools.web.search.grok.apiKey.",
      docs: "https://docs.openclaw.ai/tools/web",
    };
  }
  return {
    error: "missing_brave_api_key",
    message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("openclaw configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment.`,
    docs: "https://docs.openclaw.ai/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "perplexity") {
    return "perplexity";
  }
  if (raw === "grok") {
    return "grok";
  }
  if (raw === "brave") {
    return "brave";
  }
  return "brave";
}

function resolvePerplexityConfig(search?: WebSearchConfig): PerplexityConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const perplexity = "perplexity" in search ? search.perplexity : undefined;
  if (!perplexity || typeof perplexity !== "object") {
    return {};
  }
  return perplexity as PerplexityConfig;
}

function resolvePerplexityApiKey(perplexity?: PerplexityConfig): {
  apiKey?: string;
  source: PerplexityApiKeySource;
} {
  const fromConfig = normalizeApiKey(perplexity?.apiKey);
  if (fromConfig) {
    return { apiKey: fromConfig, source: "config" };
  }

  const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (fromEnvPerplexity) {
    return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
  }

  const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
  if (fromEnvOpenRouter) {
    return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
  }

  return { apiKey: undefined, source: "none" };
}

function normalizeApiKey(key: unknown): string {
  return normalizeSecretInput(key);
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) {
    return undefined;
  }
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(
  perplexity?: PerplexityConfig,
  apiKeySource: PerplexityApiKeySource = "none",
  apiKey?: string,
): string {
  const fromConfig =
    perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
      ? perplexity.baseUrl.trim()
      : "";
  if (fromConfig) {
    return fromConfig;
  }
  if (apiKeySource === "perplexity_env") {
    return PERPLEXITY_DIRECT_BASE_URL;
  }
  if (apiKeySource === "openrouter_env") {
    return DEFAULT_PERPLEXITY_BASE_URL;
  }
  if (apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
    if (inferred === "direct") {
      return PERPLEXITY_DIRECT_BASE_URL;
    }
    if (inferred === "openrouter") {
      return DEFAULT_PERPLEXITY_BASE_URL;
    }
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolvePerplexityModel(perplexity?: PerplexityConfig): string {
  const fromConfig =
    perplexity && "model" in perplexity && typeof perplexity.model === "string"
      ? perplexity.model.trim()
      : "";
  return fromConfig || DEFAULT_PERPLEXITY_MODEL;
}

function isDirectPerplexityBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase() === "api.perplexity.ai";
  } catch {
    return false;
  }
}

function resolvePerplexityRequestModel(baseUrl: string, model: string): string {
  if (!isDirectPerplexityBaseUrl(baseUrl)) {
    return model;
  }
  return model.startsWith("perplexity/") ? model.slice("perplexity/".length) : model;
}

function resolveGrokConfig(search?: WebSearchConfig): GrokConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const grok = "grok" in search ? search.grok : undefined;
  if (!grok || typeof grok !== "object") {
    return {};
  }
  return grok as GrokConfig;
}

function resolveGrokApiKey(grok?: GrokConfig): string | undefined {
  const fromConfig = normalizeApiKey(grok?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.XAI_API_KEY);
  return fromEnv || undefined;
}

function resolveGrokModel(grok?: GrokConfig): string {
  const fromConfig =
    grok && "model" in grok && typeof grok.model === "string" ? grok.model.trim() : "";
  return fromConfig || DEFAULT_GROK_MODEL;
}

function resolveGrokInlineCitations(grok?: GrokConfig): boolean {
  return grok?.inlineCitations === true;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
    return lower;
  }

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) {
    return undefined;
  }

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return undefined;
  }
  if (start > end) {
    return undefined;
  }

  return `${start}to${end}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}): Promise<{ content: string; citations: string[] }> {
  const baseUrl = params.baseUrl.trim().replace(/\/$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = resolvePerplexityRequestModel(baseUrl, params.model);

  // Check rate limit and circuit breaker before making request
  await checkRateLimit();
  await checkCircuitBreaker();

  // Wrap fetch in retry logic with exponential backoff
  try {
    const result = await retryAsync(
      async () => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.apiKey}`,
            "HTTP-Referer": "https://openclaw.ai",
            "X-Title": "OpenClaw Web Search",
          },
          body: JSON.stringify({
            model: params.model,
            messages: [
              {
                role: "user",
                content: params.query,
              },
            ],
          }),
          signal: withTimeout(undefined, params.timeoutSeconds * 1000),
        });

        if (!res.ok) {
          const detail = await readResponseText(res);
          const error = new Error(
            `Perplexity API error (${res.status}): ${detail || res.statusText}`,
          );
          // Attach response for retry logic
          (error as any).response = res;
          throw error;
        }

        return res;
      },
      {
        attempts: RETRY_ATTEMPTS,
        minDelayMs: RETRY_MIN_DELAY_MS,
        maxDelayMs: RETRY_MAX_DELAY_MS,
        jitter: RETRY_JITTER,
        shouldRetry: (err) => isRetryableError(err),
        retryAfterMs: (err) => {
          if (err instanceof Error && (err as any).response instanceof Response) {
            return parseRetryAfter((err as any).response.headers);
          }
          return undefined;
        },
        onRetry: (info) => {
          console.warn(
            `[web_search] Perplexity API rate limited, retrying (${info.attempt}/${info.maxAttempts}) after ${info.delayMs}ms`,
          );
        },
      },
    );

    const data = (await result.json()) as PerplexitySearchResponse;
    const content = data.choices?.[0]?.message?.content ?? "No response";
    const citations = data.citations ?? [];

    // Record success for circuit breaker
    recordCircuitBreakerSuccess();

    return { content, citations };
  } catch (err) {
    // Record failure for circuit breaker (only for retryable errors)
    if (isRetryableError(err)) {
      recordCircuitBreakerFailure();
    }
    throw err;
  }
}

async function runGrokSearch(params: {
  query: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  inlineCitations: boolean;
}): Promise<{
  content: string;
  citations: string[];
  inlineCitations?: GrokSearchResponse["inline_citations"];
}> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: [
      {
        role: "user",
        content: params.query,
      },
    ],
    tools: [{ type: "web_search" }],
  };

  if (params.inlineCitations) {
    body.include = ["inline_citations"];
  }

  const res = await fetch(XAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`xAI API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as GrokSearchResponse;
  const content = data.output_text ?? "No response";
  const citations = data.citations ?? [];
  const inlineCitations = data.inline_citations;

  return { content, citations, inlineCitations };
}

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  perplexityBaseUrl?: string;
  perplexityModel?: string;
  grokModel?: string;
  grokInlineCitations?: boolean;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    params.provider === "brave"
      ? `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}:${params.freshness || "default"}`
      : params.provider === "perplexity"
        ? `${params.provider}:${params.query}:${params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL}:${params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL}`
        : `${params.provider}:${params.query}:${params.grokModel ?? DEFAULT_GROK_MODEL}:${String(params.grokInlineCitations ?? false)}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "grok") {
    const { content, citations, inlineCitations } = await runGrokSearch({
      query: params.query,
      apiKey: params.apiKey,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      inlineCitations: params.grokInlineCitations ?? false,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      tookMs: Date.now() - start,
      content,
      citations,
      inlineCitations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    url.searchParams.set("ui_lang", params.ui_lang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }

  // Check rate limit and circuit breaker before making request
  await checkRateLimit();
  await checkCircuitBreaker();

  // Wrap fetch in retry logic with exponential backoff
  try {
    const res = await retryAsync(
      async () => {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": params.apiKey,
          },
          signal: withTimeout(undefined, params.timeoutSeconds * 1000),
        });

        if (!response.ok) {
          const detail = await readResponseText(response);
          const error = new Error(
            `Brave Search API error (${response.status}): ${detail || response.statusText}`,
          );
          // Attach response for retry logic
          (error as any).response = response;
          throw error;
        }

        return response;
      },
      {
        attempts: RETRY_ATTEMPTS,
        minDelayMs: RETRY_MIN_DELAY_MS,
        maxDelayMs: RETRY_MAX_DELAY_MS,
        jitter: RETRY_JITTER,
        shouldRetry: (err) => isRetryableError(err),
        retryAfterMs: (err) => {
          if (err instanceof Error && (err as any).response instanceof Response) {
            return parseRetryAfter((err as any).response.headers);
          }
          return undefined;
        },
        onRetry: (info) => {
          console.warn(
            `[web_search] Brave Search API rate limited, retrying (${info.attempt}/${info.maxAttempts}) after ${info.delayMs}ms`,
          );
        },
      },
    );

    const data = (await res.json()) as BraveSearchResponse;
    const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
    const mapped = results.map((entry) => {
      const description = entry.description ?? "";
      const title = entry.title ?? "";
      const url = entry.url ?? "";
      const rawSiteName = resolveSiteName(url);
      return {
        title: title ? wrapWebContent(title, "web_search") : "",
        url, // Keep raw for tool chaining
        description: description ? wrapWebContent(description, "web_search") : "",
        published: entry.age || undefined,
        siteName: rawSiteName || undefined,
      };
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      count: mapped.length,
      tookMs: Date.now() - start,
      results: mapped,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);

    // Record success for circuit breaker
    recordCircuitBreakerSuccess();

    return payload;
  } catch (err) {
    // Record failure for circuit breaker (only for retryable errors)
    if (isRetryableError(err)) {
      recordCircuitBreakerFailure();
    }
    throw err;
  }
}

export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return null;
  }

  const provider = resolveSearchProvider(search);
  const perplexityConfig = resolvePerplexityConfig(search);
  const grokConfig = resolveGrokConfig(search);

  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search."
      : provider === "grok"
        ? "Search the web using xAI Grok. Returns AI-synthesized answers with citations from real-time web search."
        : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const perplexityAuth =
        provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
      const apiKey =
        provider === "perplexity"
          ? perplexityAuth?.apiKey
          : provider === "grok"
            ? resolveGrokApiKey(grokConfig)
            : resolveSearchApiKey(search);

      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload(provider));
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
      const country = readStringParam(params, "country");
      const search_lang = readStringParam(params, "search_lang");
      const ui_lang = readStringParam(params, "ui_lang");
      const rawFreshness = readStringParam(params, "freshness");
      if (rawFreshness && provider !== "brave") {
        return jsonResult({
          error: "unsupported_freshness",
          message: "freshness is only supported by the Brave web_search provider.",
          docs: "https://docs.openclaw.ai/tools/web",
        });
      }
      const freshness = rawFreshness ? normalizeFreshness(rawFreshness) : undefined;
      if (rawFreshness && !freshness) {
        return jsonResult({
          error: "invalid_freshness",
          message:
            "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
          docs: "https://docs.openclaw.ai/tools/web",
        });
      }
      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        country,
        search_lang,
        ui_lang,
        freshness,
        perplexityBaseUrl: resolvePerplexityBaseUrl(
          perplexityConfig,
          perplexityAuth?.source,
          perplexityAuth?.apiKey,
        ),
        perplexityModel: resolvePerplexityModel(perplexityConfig),
        grokModel: resolveGrokModel(grokConfig),
        grokInlineCitations: resolveGrokInlineCitations(grokConfig),
      });
      return jsonResult(result);
    },
  };
}

export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  isDirectPerplexityBaseUrl,
  resolvePerplexityRequestModel,
  normalizeFreshness,
  resolveGrokApiKey,
  resolveGrokModel,
  resolveGrokInlineCitations,
  parseRetryAfter,
  isRetryableError,
  checkRateLimit,
  checkCircuitBreaker,
} as const;
