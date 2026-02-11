import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecApprovalsResolved } from "../infra/exec-approvals.js";

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return {
    ...mod,
    getShellPathFromLoginShell: vi.fn(() => "/bin:/usr/bin"),
    resolveShellEnvFallbackTimeoutMs: vi.fn(() => 1234),
  };
});

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  const approvals: ExecApprovalsResolved = {
    path: "/tmp/exec-approvals.json",
    socketPath: "/tmp/exec-approvals.sock",
    token: "token",
    defaults: {
      security: "full",
      ask: "off",
      askFallback: "full",
      autoAllowSkills: false,
    },
    agent: {
      security: "full",
      ask: "off",
      askFallback: "full",
      autoAllowSkills: false,
    },
    allowlist: [],
    file: {
      version: 1,
      socket: { path: "/tmp/exec-approvals.sock", token: "token" },
      defaults: {
        security: "full",
        ask: "off",
        askFallback: "full",
        autoAllowSkills: false,
      },
      agents: {},
    },
  };
  return { ...mod, resolveExecApprovals: () => approvals };
});

describe("exec pseudo-tool syntax validation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects process<arg key>action</arg><arg value>poll pseudo-tool syntax", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    await expect(
      tool.execute("call1", {
        command: "process<arg key>action</arg key><arg value>poll",
      }),
    ).rejects.toThrow(/Invalid command: detected pseudo-tool syntax/);
  });

  it("rejects process<action>poll</action> pseudo-tool syntax", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    await expect(
      tool.execute("call1", {
        command: "process<action>poll</action>",
      }),
    ).rejects.toThrow(/Invalid command: detected pseudo-tool syntax/);
  });

  it("rejects <request><action>poll</action></request> pseudo-tool syntax", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    await expect(
      tool.execute("call1", {
        command: "<request><action>poll</action></request>",
      }),
    ).rejects.toThrow(/Invalid command: detected pseudo-tool syntax/);
  });

  it("allows normal shell commands with grep patterns containing 'action' or 'arg'", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    // Should not throw pseudo-tool syntax error for grep with action/arg in pattern
    // The command may fail for other reasons (file doesn't exist), but we just want to
    // ensure it doesn't get blocked by the pseudo-tool syntax check
    const result = await tool.execute("call1", {
      command: "echo 'action arg' | grep -E 'action|arg'",
    });
    expect(result.content.some((c) => c.type === "text" && c.text.includes("action arg"))).toBe(
      true,
    );
  });

  it("allows normal shell commands", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    // Should not block legitimate shell commands
    const result1 = await tool.execute("call1", {
      command: "ls -la /dev/null",
    });
    expect(result1.content[0]?.type).toBe("text");

    const result2 = await tool.execute("call2", {
      command: "echo 'hello world'",
    });
    expect(result2.content[0]?.type).toBe("text");
  });

  it("allows shell commands with sed containing angle brackets (escaped)", async () => {
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });

    // Escaped angle brackets in sed should be allowed
    const result = await tool.execute("call1", {
      command: `echo '<tag>remove</tag>' | sed 's/<[^>]*>//g'`,
    });
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("remove");
  });
});
