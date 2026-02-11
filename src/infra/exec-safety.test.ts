import { describe, expect, it } from "vitest";
import { detectPseudoToolSyntax } from "./exec-safety.js";

describe("detectPseudoToolSyntax", () => {
  describe("detects pseudo-tool syntax", () => {
    it("returns true for process<arg key>action</arg><arg value>poll", () => {
      expect(detectPseudoToolSyntax("process<arg key>action</arg key><arg value>poll")).toBe(true);
    });

    it("returns true for process<action>poll</action>", () => {
      expect(detectPseudoToolSyntax("process<action>poll</action>")).toBe(true);
    });

    it("returns true for process<session>abc123</session>", () => {
      expect(detectPseudoToolSyntax("process<session>abc123</session>")).toBe(true);
    });

    it("returns true for <request>...</request>", () => {
      expect(detectPseudoToolSyntax("<request><action>poll</action></request>")).toBe(true);
    });

    it("returns true for <parameter>...</parameter>", () => {
      expect(detectPseudoToolSyntax("<parameter>value</parameter>")).toBe(true);
    });

    it("returns true for process<arg name>something", () => {
      expect(detectPseudoToolSyntax("process<arg name>something")).toBe(true);
    });

    it("is case-insensitive for action tag", () => {
      expect(detectPseudoToolSyntax("process<ACTION>poll</ACTION>")).toBe(true);
      expect(detectPseudoToolSyntax("process<Action>poll</Action>")).toBe(true);
    });

    it("is case-insensitive for arg tag", () => {
      expect(detectPseudoToolSyntax("process<ARG key>action</ARG>")).toBe(true);
      expect(detectPseudoToolSyntax("process<Arg key>action</Arg>")).toBe(true);
    });
  });

  describe("allows legitimate shell commands", () => {
    it("returns false for simple ls command", () => {
      expect(detectPseudoToolSyntax("ls -la")).toBe(false);
    });

    it("returns false for echo command", () => {
      expect(detectPseudoToolSyntax("echo 'hello world'")).toBe(false);
    });

    it("returns false for grep with action pattern (no XML-like structure)", () => {
      expect(detectPseudoToolSyntax("grep -E 'action|arg' file.txt")).toBe(false);
    });

    it("returns false for sed command with escaped angle brackets", () => {
      expect(detectPseudoToolSyntax(`sed 's/<[^>]*>//g' input.txt`)).toBe(false);
    });

    it("returns false for cat command", () => {
      expect(detectPseudoToolSyntax("cat /etc/hosts")).toBe(false);
    });

    it("returns false for find command", () => {
      expect(detectPseudoToolSyntax("find /home -name '*.log'")).toBe(false);
    });

    it("returns false for npm command", () => {
      expect(detectPseudoToolSyntax("npm test")).toBe(false);
    });

    it("returns false for docker command", () => {
      expect(detectPseudoToolSyntax("docker ps")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for empty string", () => {
      expect(detectPseudoToolSyntax("")).toBe(false);
    });

    it("returns false for whitespace only", () => {
      expect(detectPseudoToolSyntax("   ")).toBe(false);
    });

    it("returns false for null/undefined input", () => {
      expect(detectPseudoToolSyntax(null as unknown as string)).toBe(false);
      expect(detectPseudoToolSyntax(undefined as unknown as string)).toBe(false);
    });

    it("returns false for non-string input", () => {
      expect(detectPseudoToolSyntax(123 as unknown as string)).toBe(false);
    });

    it("handles leading/trailing whitespace", () => {
      expect(detectPseudoToolSyntax("  process<arg key>action</arg>  ")).toBe(true);
      expect(detectPseudoToolSyntax("  ls -la  ")).toBe(false);
    });
  });
});
