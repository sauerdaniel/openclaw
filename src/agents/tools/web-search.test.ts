import { describe, expect, it, beforeEach } from "vitest";
import { __testing } from "./web-search.js";

const {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  normalizeFreshness,
  parseRetryAfter,
  isRetryableError,
  checkRateLimit,
  checkCircuitBreaker,
} = __testing;

describe("web_search perplexity baseUrl defaults", () => {
  it("detects a Perplexity key prefix", () => {
    expect(inferPerplexityBaseUrlFromApiKey("pplx-123")).toBe("direct");
  });

  it("detects an OpenRouter key prefix", () => {
    expect(inferPerplexityBaseUrlFromApiKey("sk-or-v1-123")).toBe("openrouter");
  });

  it("returns undefined for unknown key formats", () => {
    expect(inferPerplexityBaseUrlFromApiKey("unknown-key")).toBeUndefined();
  });

  it("prefers explicit baseUrl over key-based defaults", () => {
    expect(resolvePerplexityBaseUrl({ baseUrl: "https://example.com" }, "config", "pplx-123")).toBe(
      "https://example.com",
    );
  });

  it("defaults to direct when using PERPLEXITY_API_KEY", () => {
    expect(resolvePerplexityBaseUrl(undefined, "perplexity_env")).toBe("https://api.perplexity.ai");
  });

  it("defaults to OpenRouter when using OPENROUTER_API_KEY", () => {
    expect(resolvePerplexityBaseUrl(undefined, "openrouter_env")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("defaults to direct when config key looks like Perplexity", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "pplx-123")).toBe(
      "https://api.perplexity.ai",
    );
  });

  it("defaults to OpenRouter when config key looks like OpenRouter", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "sk-or-v1-123")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("defaults to OpenRouter for unknown config key formats", () => {
    expect(resolvePerplexityBaseUrl(undefined, "config", "weird-key")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });
});

describe("web_search freshness normalization", () => {
  it("accepts Brave shortcut values", () => {
    expect(normalizeFreshness("pd")).toBe("pd");
    expect(normalizeFreshness("PW")).toBe("pw");
  });

  it("accepts valid date ranges", () => {
    expect(normalizeFreshness("2024-01-01to2024-01-31")).toBe("2024-01-01to2024-01-31");
  });

  it("rejects invalid date ranges", () => {
    expect(normalizeFreshness("2024-13-01to2024-01-31")).toBeUndefined();
    expect(normalizeFreshness("2024-02-30to2024-03-01")).toBeUndefined();
    expect(normalizeFreshness("2024-03-10to2024-03-01")).toBeUndefined();
  });
});

describe("web_search retry logic", () => {
  it("identifies retryable 429 errors", () => {
    const err = new Error("Brave Search API error (429): Rate limit exceeded");
    expect(isRetryableError(err)).toBe(true);
  });

  it("does not retry non-429 errors", () => {
    const err = new Error("Brave Search API error (500): Internal server error");
    expect(isRetryableError(err)).toBe(false);
  });

  it("parses Retry-After header in seconds", () => {
    const headers = new Headers();
    headers.set("retry-after", "30");
    expect(parseRetryAfter(headers)).toBe(30000);
  });

  it("parses Retry-After header as HTTP date", () => {
    const futureDate = new Date(Date.now() + 60000);
    const headers = new Headers();
    headers.set("retry-after", futureDate.toUTCString());
    const result = parseRetryAfter(headers);
    expect(result).toBeGreaterThan(50000);
    expect(result).toBeLessThan(70000);
  });

  it("returns undefined for missing Retry-After header", () => {
    const headers = new Headers();
    expect(parseRetryAfter(headers)).toBeUndefined();
  });

  it("returns undefined for invalid Retry-After values", () => {
    const headers = new Headers();
    headers.set("retry-after", "invalid");
    expect(parseRetryAfter(headers)).toBeUndefined();
  });
});

describe("web_search token bucket rate limiting", () => {
  it("exports rate limiting and circuit breaker functions", () => {
    expect(typeof checkRateLimit).toBe("function");
    expect(typeof checkCircuitBreaker).toBe("function");
  });

  it("rate limiter is async and returns a number", async () => {
    const result = await checkRateLimit();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("circuit breaker is async and returns void", async () => {
    const result = await checkCircuitBreaker();
    expect(result).toBeUndefined();
  });
});
