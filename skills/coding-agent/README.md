# 🧩 Coding-Agent Skill

**Status:** ✅ **Production Ready**  
**Last Updated:** 2026-02-08  
**Maintained By:** Jennings (senior coder), subagent (oc-cevz)

---

## Quick Start

The coding-agent skill enables spawning sub-agents for complex coding tasks. Four AI coding assistants are available:

| CLI          | Best For                    | Speed    | Cost     |
| ------------ | --------------------------- | -------- | -------- |
| **claude**   | Refactoring, code review    | Fast     | Moderate |
| **codex**    | Implementation, prototyping | Moderate | High     |
| **pi**       | Lightweight tasks           | Fast     | Moderate |
| **opencode** | Structured generation       | Moderate | Moderate |

### Inline Task (Quick)

```bash
# Refactor a single file
bash pty:true workdir:~/project command:"claude 'Refactor utils.js'"
```

### Background Task (Long-running)

```bash
# Spawn agent for multi-file work
SESSION=$(bash pty:true workdir:~/project background:true command:"claude 'Implement auth module'")

# Monitor progress
process action:log sessionId:$SESSION
```

### Batch Parallel Fixes

```bash
# Fix multiple issues simultaneously
git worktree add -b fix/issue-78 /tmp/issue-78 main
bash pty:true workdir:/tmp/issue-78 background:true command:"codex --yolo 'Fix issue #78'"
```

---

## Documentation

### 📖 [SKILL.md](./SKILL.md) — CLI Reference

Complete reference for all four coding agents. Covers:

- How to use each CLI (claude, codex, pi, opencode)
- PTY mode requirements (⚠️ critical!)
- Background process patterns
- Parallel execution with git worktrees
- PR review workflows
- Rules & safety guidelines

**Use this when:** You need CLI-specific details or command syntax.

### 🚀 [SETUP.md](./SETUP.md) — Integration Guide (START HERE)

Complete integration guide for agents. Covers:

- Model selection & recommendations
- Critical rules (PTY, workdir, git repo)
- Four use case patterns with examples:
  1. Single-file refactoring (inline)
  2. Multi-file implementation (background spawn)
  3. Code review (background spawn)
  4. Batch issue fixing (parallel execution)
- When to spawn vs direct execution
- Beads integration patterns (3 documented)
- Best practices for notifications & cleanup
- Troubleshooting guide

**Use this when:** Starting a new task or integrating with Beads.

### 🧪 [TEST_EXAMPLES.md](./TEST_EXAMPLES.md) — Test Cases

Eight comprehensive test cases with working examples. Covers:

- Quick inline tasks (Claude Code, Codex, Pi)
- Background spawning & monitoring
- PTY requirement validation
- Git repo requirement verification
- Beads integration example
- Error handling & recovery

**Use this when:** Learning how to execute tasks or debugging issues.

### ✅ [TEST_RESULT.md](./TEST_RESULT.md) — Verification Report

Complete verification that the skill is installed and ready. Covers:

- CLI installation status (all 4 verified)
- Documentation checklist
- Skill architecture overview
- Beads integration readiness
- Key findings & important notes
- Model recommendations
- Production readiness summary

**Use this when:** Confirming the skill is properly set up.

---

## Common Patterns

### Pattern 1: Quick Refactoring (Inline)

```bash
# For tasks < 5 minutes, execute inline
cd ~/myproject
bash pty:true workdir:. command:"claude 'Add error handling to api.js'"
```

### Pattern 2: Feature Implementation (Background)

```bash
# For tasks 5-30 minutes, spawn background
cd ~/myproject
SESSION=$(bash pty:true background:true command:"claude 'Build user auth module with JWT'")

# Track progress
sleep 5 && process action:log sessionId:$SESSION
```

### Pattern 3: Code Review (Background)

```bash
# Clone PR safely first
REVIEW_DIR=$(mktemp -d)
git clone <repo> $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130

# Review in background
SESSION=$(bash pty:true workdir:$REVIEW_DIR background:true command:"codex review --base origin/main")

# Check results
process action:log sessionId:$SESSION

# Cleanup
trash $REVIEW_DIR
```

### Pattern 4: Parallel Issue Fixes (Worktrees)

```bash
# Fix multiple issues simultaneously
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# Launch agents (parallel!)
bash pty:true workdir:/tmp/issue-78 background:true command:"codex --yolo 'Fix #78'"
bash pty:true workdir:/tmp/issue-99 background:true command:"codex --yolo 'Fix #99'"

# Monitor all
process action:list

# Create PRs when done
cd /tmp/issue-78 && git push && gh pr create --head fix/issue-78
cd /tmp/issue-99 && git push && gh pr create --head fix/issue-99

# Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

---

## Beads Integration

### Track Inline Tasks

```bash
bd update oc-1234 --status in_progress
bash pty:true workdir:~/project command:"claude 'Refactor module X'"
bd update oc-1234 --status done
```

### Track Background Spawns

```bash
# Create task
bd create --assignee james --title "Implement feature Y" --parent oc-1234

# Spawn agent
SESSION=$(bash pty:true workdir:~/project background:true command:"claude 'Implement feature Y'")

# Track
bd comments add oc-5678 "Background spawn: Session $SESSION"

# Mark done
process action:poll sessionId:$SESSION  # When complete
bd update oc-5678 --status done
```

---

## Critical Rules ⚠️

### 1. Always Use PTY Mode

Coding agents need pseudo-terminal (PTY) for proper output. Without it, they hang or output breaks.

```bash
# ✅ Correct
bash pty:true workdir:. command:"claude '...'"

# ❌ Wrong - will break
bash command:"claude '...'"
```

### 2. Set Appropriate workdir

Agent only sees target directory. Prevents reading sensitive files.

```bash
bash pty:true workdir:~/myproject command:"claude '...'"
```

### 3. Codex Requires Git Repo

Codex refuses to run outside git directory. Use `git init` for scratch work.

```bash
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init
bash pty:true workdir:$SCRATCH command:"codex exec 'Your task'"
```

### 4. Never Modify Live OpenClaw Instance

Do NOT checkout branches in your live OpenClaw directory (that's the running instance). Clone to temp first.

```bash
# ✅ Safe
TEMP=$(mktemp -d)
git clone https://github.com/user/repo.git $TEMP
cd $TEMP && git checkout feature-branch

# ❌ Dangerous (example - never modify the running instance)
cd ~/git/openclaw && git checkout something
```

### 5. Clean Up After Use

Always remove temp directories.

```bash
trash $REVIEW_DIR
trash $TEMP_PROJECT
git worktree remove /tmp/issue-xyz
```

---

## Model Recommendations

### Claude Code (Recommended for Most Tasks)

- **Strengths:** Strong code understanding, follows instructions precisely, fast feedback loops
- **Best for:** Refactoring, code review, architectural decisions
- **Cost:** Moderate (Anthropic API)
- **Speed:** Fast
- **Command:** `claude 'Your task'`

### Codex CLI

- **Strengths:** Rapid prototyping, creative solutions, broad knowledge
- **Best for:** Implementation, building from scratch, creative coding
- **Cost:** Higher (OpenAI API)
- **Speed:** Moderate
- **Command:** `codex exec 'Your task'`
- **Note:** Requires git repo

### Pi Coding Agent

- **Strengths:** Lightweight, terminal-first, prompt caching enabled (Jan 2026)
- **Best for:** Quick analysis, summarization, terminal workflows
- **Cost:** Moderate
- **Speed:** Fast
- **Command:** `pi 'Your task'`

### OpenCode

- **Strengths:** Structured code generation
- **Best for:** Fallback/alternative, structured tasks
- **Command:** `opencode run 'Your task'`

---

## Decision Tree

```
Is this coding task < 5 minutes?
├─ YES → Execute inline (direct execution)
│         Use: bash pty:true command:"claude '...'"
│         Best for: Quick fixes, small changes
│
└─ NO → Need background spawn
        ├─ < 10 files?
        │  └─ Use: Background spawn with Claude Code
        │          Monitor with process tool
        │
        └─ Fixing multiple bugs in parallel?
           └─ Use: git worktrees + multiple agents
              All run simultaneously
```

---

## Troubleshooting

### Agent Output is Broken or Colored Weirdly

**Cause:** PTY not enabled  
**Fix:** Add `pty:true` to bash command

### "Not a git repository" Error (Codex)

**Cause:** Running outside git directory  
**Fix:** Use `git init` in workdir or clone repo first

### Agent Asks for Approval But Can't Respond

**Cause:** Interactive mode but no input mechanism  
**Fix:** Use `--full-auto` flag (Codex) or send input via `process action:submit`

### Session Hangs or Takes Too Long

**Cause:** Task is too ambitious or agent is genuinely thinking  
**Fix:** Wait longer (agents think deeply), or kill and try simpler task: `process action:kill sessionId:$SESSION`

### "ANTHROPIC_API_KEY not set" (Claude Code)

**Cause:** Missing API key  
**Fix:** Set environment variable: `export ANTHROPIC_API_KEY="sk-..."`

---

## Environment Setup

Check these are configured:

```bash
# For Claude Code
echo $ANTHROPIC_API_KEY  # Must be set

# For Codex (check ~/.codex/config.toml)
cat ~/.codex/config.toml

# For Pi Agent (can use Anthropic or OpenAI)
echo $ANTHROPIC_API_KEY  # or $OPENAI_API_KEY
```

---

## File Structure

```
coding-agent/
├── README.md              ← You are here
├── SKILL.md               ← CLI reference (detailed)
├── SETUP.md               ← Integration guide (start here)
├── TEST_EXAMPLES.md       ← Working test cases
├── TEST_RESULT.md         ← Verification report
└── (source code tools)    ← claude, codex, pi, opencode CLIs
```

---

## Next Steps

1. ✅ Read this README
2. 📖 Read [SETUP.md](./SETUP.md) for your use case
3. 🧪 Try an example from [TEST_EXAMPLES.md](./TEST_EXAMPLES.md)
4. 🚀 Start spawning agents!
5. 📝 Track in Beads using documented patterns

---

## Support & Examples

- **Claude Code docs:** `claude --help`
- **Codex docs:** `codex --help`
- **Pi agent:** `pi --help`
- **This skill:** See SETUP.md and TEST_EXAMPLES.md
- **Beads integration:** See SETUP.md "Beads Integration" section

---

## Status

| Item              | Status   | Notes                 |
| ----------------- | -------- | --------------------- |
| Claude Code       | ✅ Ready | v2.1.29               |
| Codex             | ✅ Ready | v0.93.0               |
| OpenCode          | ✅ Ready | Installed             |
| Pi Agent          | ✅ Ready | With prompt caching   |
| PTY Support       | ✅ Ready | bash pty:true         |
| Background Spawn  | ✅ Ready | process tool          |
| Git Worktrees     | ✅ Ready | Parallel execution    |
| Beads Integration | ✅ Ready | 3 patterns documented |

**Production Status:** ✅ **READY**

---

**Last Verified:** 2026-02-08  
**Git Commit:** 5422d06b1  
**Task:** oc-cevz (Coding-Agent Skill Installation & Testing)
