# Coding-Agent Skill Setup & Integration Guide

## Overview

The **coding-agent** skill enables programmatic execution of Codex CLI, Claude Code, OpenCode, and Pi Coding Agent for automating complex coding workflows. This allows agents to spawn background processes for multi-file refactoring, implementation, testing, and code review tasks.

**Status:** ✅ Installed & Ready
**Installed CLIs:**

- `claude` → Claude Code (Anthropic's AI coding assistant)
- `codex` → Codex CLI (GPT-5.2-based)
- `opencode` → OpenCode (another AI coding framework)
- `pi` → Pi Coding Agent (npm-based, with prompt caching support)

---

## Model Selection & Recommendations

### Claude Code (Recommended)

- **Command:** `claude 'Your task'`
- **Best for:** Refactoring, code review, architectural decisions
- **Speed:** Fast iterative loops
- **Cost:** Moderate (Anthropic billing)
- **Reasoning:** Strong code understanding, follows instructions precisely

### Codex CLI

- **Command:** `codex exec 'Your task'`
- **Model:** `gpt-5.2-codex` (configured in `~/.codex/config.toml`)
- **Best for:** Implementation, rapid prototyping, creative solutions
- **Speed:** Moderate
- **Cost:** High (OpenAI API)
- **Note:** Requires git repo. Use `git init` for scratch work.

### Pi Coding Agent

- **Command:** `pi 'Your task'`
- **Installation:** `npm install -g @mariozechner/pi-coding-agent`
- **Best for:** Lightweight tasks, terminal-first workflows
- **Feature:** Anthropic prompt caching enabled (Jan 2026)
- **Speed:** Fast
- **Cost:** Moderate

### OpenCode

- **Command:** `opencode run 'Your task'`
- **Best for:** Structured code generation
- **Status:** Alternative/fallback

---

## ⚠️ Critical Rules

### 1. **Always Use PTY Mode**

Coding agents are interactive terminal apps. Without pseudo-terminal, output breaks or agent hangs.

```bash
# ✅ Correct
bash pty:true workdir:~/project command:"claude 'Your task'"

# ❌ Wrong
bash command:"claude 'Your task'"
```

### 2. **Set Appropriate workdir**

Agent sees only the target folder's context. Prevents reading sensitive files (like soul.md).

```bash
bash pty:true workdir:~/myproject command:"claude 'Refactor auth.js'"
```

### 3. **Git Repo Required for Codex**

Codex refuses to run outside a git directory.

```bash
# Quick scratch work:
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && codex exec "Your prompt"
```

### 4. **Never Use in OpenClaw Internal Folders**

Do NOT checkout branches in your live OpenClaw directory — that's the running instance. Clone to temp folder instead.

---

## Use Cases & Integration with Beads

### Use Case 1: Single-File Refactoring (Inline Execution)

**When:** Quick improvements to known files, small scope
**Spawn:** No — execute directly via bash tool
**Beads Task:** Link the task ID for context

```bash
# In a Beads task context (e.g., oc-1234):
bash pty:true workdir:~/myproject command:"claude 'Refactor utils.js for performance. Add detailed comments.'"
```

**Output:** Changes applied to file, shown in agent response

---

### Use Case 2: Multi-File Implementation (Background Spawn)

**When:** Building a new feature across multiple files, long-running task
**Spawn:** YES — background process with PTY
**Beads Task:** Create subtask or use comments for progress

```bash
# Spawn a background coding agent
bash pty:true workdir:~/myproject background:true command:"claude 'Implement user authentication module: create auth.js, update routes.js, add tests. Commit when done.'"

# Returns sessionId (e.g., "abc123")

# Monitor progress periodically
process action:log sessionId:abc123

# Check if done
process action:poll sessionId:abc123
```

**Beads Integration:**

```bash
# Start task in Beads
bd update oc-5678 --status in_progress

# Add comment with session tracking
bd comments add oc-5678 "Spawned coding agent: session abc123 - building auth module"

# Later, when done:
bd update oc-5678 --status done
bd comments add oc-5678 "✅ Auth module complete - https://github.com/user/repo/commit/abc123"
```

---

### Use Case 3: Code Review (Background Spawn)

**When:** Reviewing pull requests, code audits
**Spawn:** YES — background process
**Beads Task:** Link to PR, capture review results

```bash
# Clone PR to temp directory (safe!)
REVIEW_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130

# Spawn reviewer
bash pty:true workdir:$REVIEW_DIR background:true command:"codex review --base origin/main"

# Capture session ID
sessionId="def456"

# Monitor
process action:log sessionId:def456

# Post results to GitHub (when complete)
gh pr comment 130 --body "Review results: $(process action:log sessionId:def456)"

# Cleanup
trash $REVIEW_DIR
```

---

### Use Case 4: Batch Issue Fixing (Parallel Army!)

**When:** Fixing multiple issues simultaneously
**Spawn:** YES — multiple background processes
**Beads Task:** One task per issue, reference all session IDs

```bash
# Create git worktrees
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# Launch agents (parallel, with PTY!)
bash pty:true workdir:/tmp/issue-78 background:true command:"codex --yolo 'Fix issue #78: null pointer in parser. Commit and push.'"
bash pty:true workdir:/tmp/issue-99 background:true command:"codex --yolo 'Fix issue #99: memory leak in handler. Commit and push.'"

# Track in Beads
bd comments add oc-8001 "Spawned fix-78: session id123"
bd comments add oc-9901 "Spawned fix-99: session id456"

# Monitor both
process action:list

# Create PRs when done
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --title "fix: issue #78" --body "Fixes #78"

# Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

---

## When to Spawn vs Direct Execution

| Scenario                        | Spawn?   | Why                                     |
| ------------------------------- | -------- | --------------------------------------- |
| Quick fix to 1-2 files          | ❌ No    | Execute inline, faster feedback         |
| New feature (3+ files)          | ✅ Yes   | Long-running, needs monitoring          |
| Code review of PR               | ✅ Yes   | May take time, need to track results    |
| Refactoring module              | ✅ Maybe | If <5 min, inline; if 10+ min, spawn    |
| Testing suite run               | ✅ Yes   | Can take a while, separate concern      |
| Fixing multiple bugs (parallel) | ✅ Yes   | Each gets own session, runs in parallel |

---

## Best Practices

### 1. **Notify When Starting Background Tasks**

Send message to user immediately after spawning:

```
Spawned: Building auth module (session: abc123)
Running in: /home/user/myproject
Task: Implement user authentication
ETA: 10-15 minutes
```

### 2. **Use Auto-Notify for Completion**

Append to prompt so agent wakes you when done:

```bash
command:"claude 'Build feature X.

When completely finished, run: openclaw gateway wake --text \"Done: Feature X complete\" --mode now'"
```

### 3. **Track in Beads**

Every spawned agent should have a Beads comment with:

- Session ID
- What's running
- Where it's running
- Expected completion time

### 4. **Kill Politely**

Only kill if agent is clearly stuck. Before killing, try sending input or waiting longer.

```bash
# Ask a question first
process action:submit sessionId:abc123 data:"yes"

# Wait 30 seconds
# Then check status
process action:poll sessionId:abc123

# Only kill if truly stuck
process action:kill sessionId:abc123
```

### 5. **Clean Up After Reviews**

Always remove temp directories:

```bash
trash $REVIEW_DIR
git worktree remove /tmp/issue-xyz
```

---

## Beads Integration Patterns

### Pattern 1: Inline Coding Task

```bash
# In main task flow
bd update oc-1234 --status in_progress

# Execute coding work
bash pty:true workdir:~/project command:"claude 'Refactor module X'"

# When done
bd update oc-1234 --status done
```

### Pattern 2: Background Spawn with Monitoring

```bash
# Create subtask for background work
bd create --assignee james --title "Implement feature Y" --parent oc-1234

# Spawn agent
sessionId=$(bash pty:true workdir:~/project background:true command:"claude 'Implement feature Y'")

# Track
bd comments add oc-5678 "Background task spawned. Session: $sessionId"

# Periodically check
process action:poll sessionId:$sessionId

# Mark done when complete
bd update oc-5678 --status done --comment "Implementation complete. Session log: ..."
```

### Pattern 3: Parallel Issue Fixing

```bash
# Multiple tasks, multiple agents
for issue in 78 99 105; do
  sessionId=$(bash pty:true workdir:/tmp/issue-$issue background:true command:"codex --yolo 'Fix issue #$issue'")
  bd comments add oc-${issue}01 "Fix spawned: $sessionId"
done

# Monitor all at once
process action:list
```

---

## Environment Variables

Check these before spawning agents:

```bash
# Claude Code config
echo $ANTHROPIC_API_KEY  # Required for claude

# Codex config (check ~/.codex/config.toml)
cat ~/.codex/config.toml

# Pi agent
echo $OPENAI_API_KEY     # Required for Pi with OpenAI
```

---

## Troubleshooting

### Agent Hangs or Broken Output

**Cause:** PTY not enabled
**Fix:** Add `pty:true` to bash command

### "Not a git repository" (Codex)

**Cause:** Running outside git directory
**Fix:** Use workdir that's inside a git repo, or `git init` in scratch directory

### Agent Asks for Approval But Can't Respond

**Cause:** Running interactively but agent waits for input
**Fix:** Use `--full-auto` flag (Codex) or `--yolo` (Codex no sandbox)
**Or:** Send input via `process action:submit`

### Session Hangs Before Starting

**Cause:** Waiting for git config or initialization
**Fix:** Ensure workdir is a valid git repo

---

## Next Steps

1. ✅ **SKILL.md** — Detailed CLI documentation (already provided)
2. ✅ **SETUP.md** — This file (integration guide)
3. 🧪 **Create test:** Spawn a minimal coding task (see below)
4. 📝 **Document example:** Add to workspace reference
5. 🔗 **Link to Beads:** Tag coding-related tasks with agent spawning pattern

---

## Skill Status

| Item                 | Status       | Notes                                                 |
| -------------------- | ------------ | ----------------------------------------------------- |
| `claude` CLI         | ✅ Installed | `~/.local/bin/claude`                                 |
| `codex` CLI          | ✅ Installed | `~/.npm-global/bin/codex`                             |
| `opencode` CLI       | ✅ Installed | `~/.opencode/bin/opencode`                            |
| `pi` CLI             | ✅ Installed | `~/.npm-global/bin/pi` (with prompt caching)          |
| PTY support          | ✅ Ready     | bash tool supports `pty:true`                         |
| Process monitoring   | ✅ Ready     | process tool supports list/poll/log/write/submit/kill |
| Git worktree support | ✅ Ready     | Can spawn multiple agents in parallel                 |
| Beads integration    | ✅ Ready     | Pattern documented above                              |

**Last Updated:** 2026-02-08
**Maintained By:** Coding Agent Task (oc-cevz)
