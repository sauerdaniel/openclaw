import { describe, expect, it } from "vitest";
import { HeartbeatSchema } from "./zod-schema.agent-runtime.js";
import { OpenClawSchema } from "./zod-schema.js";

describe("heartbeat model schema validation", () => {
  it("accepts heartbeat.model as a plain string (backward compatibility)", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: "zai/glm-4.7",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toBe("zai/glm-4.7");
    }
  });

  it("accepts heartbeat.model as { primary, fallbacks[] } object", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: {
        primary: "zai/glm-4.7",
        fallbacks: ["openai/gpt-5-mini", "google/gemini-3-flash"],
      },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toEqual({
        primary: "zai/glm-4.7",
        fallbacks: ["openai/gpt-5-mini", "google/gemini-3-flash"],
      });
    }
  });

  it("accepts heartbeat.model with only primary (no fallbacks)", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: {
        primary: "zai/glm-4.7",
      },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toEqual({
        primary: "zai/glm-4.7",
      });
    }
  });

  it("accepts heartbeat.model with only fallbacks (no primary)", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: {
        fallbacks: ["openai/gpt-5-mini"],
      },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toEqual({
        fallbacks: ["openai/gpt-5-mini"],
      });
    }
  });

  it("accepts heartbeat.model as empty object (primary and fallbacks missing)", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: {},
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toEqual({});
    }
  });

  it("accepts heartbeat.model undefined (no model specified)", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model).toBeUndefined();
    }
  });

  it("rejects heartbeat.model with unknown fields", () => {
    const res = HeartbeatSchema.safeParse({
      every: "30m",
      model: {
        primary: "zai/glm-4.7",
        unknownField: "should reject",
      },
    });

    expect(res.success).toBe(false);
  });

  it("accepts agents.defaults.heartbeat.model as string in full config", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-5",
          },
          heartbeat: {
            model: "zai/glm-4.7",
          },
        },
      },
    });

    if (!res.success) {
      console.log("Error issues:", JSON.stringify(res.error.issues, null, 2));
    }
    expect(res.success).toBe(true);
  });

  it("accepts agents.defaults.heartbeat.model as { primary, fallbacks[] } in full config", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-5",
          },
          heartbeat: {
            model: {
              primary: "zai/glm-4.7",
              fallbacks: ["openai/gpt-5-mini", "google/gemini-3-flash"],
            },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("accepts agents.list[].heartbeat.model as string in full config", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-5",
          },
        },
        list: [
          {
            id: "test-agent",
            heartbeat: {
              model: "zai/glm-4.7",
            },
          },
        ],
      },
    });

    expect(res.success).toBe(true);
  });

  it("accepts agents.list[].heartbeat.model as { primary, fallbacks[] } in full config", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-5",
          },
        },
        list: [
          {
            id: "test-agent",
            heartbeat: {
              model: {
                primary: "zai/glm-4.7",
                fallbacks: ["openai/gpt-5-mini"],
              },
            },
          },
        ],
      },
    });

    expect(res.success).toBe(true);
  });
});
