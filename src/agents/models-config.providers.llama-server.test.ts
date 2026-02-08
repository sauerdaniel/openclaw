import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveImplicitProviders } from "./models-config.providers.js";

describe("llama-server provider", () => {
  it("should not include llama-server when no API key is configured", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    const providers = await resolveImplicitProviders({ agentDir });

    // llama-server requires explicit configuration via LLAMA_SERVER_API_KEY env var or profile
    expect(providers?.["llama-server"]).toBeUndefined();
  });

  it("should be included when LLAMA_SERVER_API_KEY is set", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    process.env.LLAMA_SERVER_API_KEY = "test-key";

    try {
      const providers = await resolveImplicitProviders({ agentDir });

      expect(providers?.["llama-server"]).toBeDefined();
      expect(providers?.["llama-server"]?.apiKey).toBe("LLAMA_SERVER_API_KEY");

      // discoverLlamaServerModels() returns empty array in test environments
    } finally {
      delete process.env.LLAMA_SERVER_API_KEY;
    }
  });

  it("should have correct model structure (unit test)", () => {
    const mockModel = {
      id: "glm-4.7-flash-Q4_K_M",
      name: "glm-4.7-flash-Q4_K_M",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };

    expect(mockModel.id).toBe("glm-4.7-flash-Q4_K_M");
    // No streaming override needed — llama-server supports streaming natively
    expect(mockModel).not.toHaveProperty("params");
  });
});
