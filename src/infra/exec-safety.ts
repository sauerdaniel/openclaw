const SHELL_METACHARS = /[;&|`$<>]/;
const CONTROL_CHARS = /[\r\n]/;
const QUOTE_CHARS = /["']/;
const BARE_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

/**
 * Patterns that indicate pseudo-tool or XML-like syntax being passed to shell.
 * These indicate tool serialization errors where the tool call structure
 * is being sent as raw text instead of proper tool invocation.
 */
const PSEUDO_TOOL_PATTERNS = [
  // process tool pseudo-XML: process<arg key>...</arg><arg value>...</arg>
  /process<arg\s+(?:key|value)>\s*<\/?/,
  // Generic XML-like tags that shouldn't be in shell commands
  /<(action|arg|request|parameter)[^>]*>/i,
  // process<action>...</action> style pseudo-XML
  /process<(action|session|id)[^>]*>/i,
];

function isLikelyPath(value: string): boolean {
  if (value.startsWith(".") || value.startsWith("~")) {
    return true;
  }
  if (value.includes("/") || value.includes("\\")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Detects if a command string contains pseudo-tool syntax.
 * This catches cases where tool call structures (e.g., `process<arg key>action</arg>`)
 * are mistakenly passed as raw shell commands instead of proper tool invocations.
 *
 * @param command - The shell command to validate
 * @returns true if pseudo-tool syntax is detected (command should be rejected)
 *
 * @example
 * detectPseudoToolSyntax('process<arg key>action</arg><arg value>poll') // true
 * detectPseudoToolSyntax('ls -la') // false
 * detectPseudoToolSyntax('grep -E "(action|arg)" file.txt') // false (false positive check)
 */
export function detectPseudoToolSyntax(command: string): boolean {
  if (!command || typeof command !== "string") {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  // Check each pattern
  for (const pattern of PSEUDO_TOOL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

export function isSafeExecutableValue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("\0")) {
    return false;
  }
  if (CONTROL_CHARS.test(trimmed)) {
    return false;
  }
  if (SHELL_METACHARS.test(trimmed)) {
    return false;
  }
  if (QUOTE_CHARS.test(trimmed)) {
    return false;
  }

  if (isLikelyPath(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("-")) {
    return false;
  }
  return BARE_NAME_PATTERN.test(trimmed);
}
