import type { CronJob, CronJobCreate, CronJobPatch } from "../types.js";
import type { CronServiceState } from "./state.js";
import {
  applyJobPatch,
  computeJobNextRunAtMs,
  createJob,
  findJobOrThrow,
  isJobDue,
  nextWakeAtMs,
  recomputeNextRuns,
} from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist, warnIfDisabled } from "./store.js";
import {
  armTimer,
  applyJobResult,
  emit,
  executeJobCore,
  onTimer,
  stopTimer,
  wake,
} from "./timer.js";

export async function start(state: CronServiceState) {
  if (!state.deps.cronEnabled) {
    state.deps.log.info({ enabled: false }, "cron: disabled");
    return;
  }

  // Phase 1: load persisted store without recomputing next runs (preserves persisted
  // nextRunAtMs for restart catch-up), and clear stale running markers.
  await locked(state, async () => {
    await ensureLoaded(state, { skipRecompute: true });
    const jobs = state.store?.jobs ?? [];
    let mutated = false;
    for (const job of jobs) {
      if (typeof job.state.runningAtMs === "number") {
        state.deps.log.warn(
          { jobId: job.id, runningAtMs: job.state.runningAtMs },
          "cron: clearing stale running marker on startup",
        );
        job.state.runningAtMs = undefined;
        mutated = true;
      }
    }
    if (mutated) {
      await persist(state);
    }
  });

  // Phase 2: run any due jobs without holding the store lock. This keeps
  // cron.status/cron.list responsive even if a catch-up job is slow.
  await onTimer(state);

  // Phase 3: ensure next runs are consistent, arm the timer, and log.
  await locked(state, async () => {
    await ensureLoaded(state, { skipRecompute: true });
    if (state.store) {
      const changed = recomputeNextRuns(state);
      if (changed) {
        await persist(state);
      }
    }
    armTimer(state);
    state.deps.log.info(
      {
        enabled: true,
        jobs: state.store?.jobs.length ?? 0,
        nextWakeAtMs: nextWakeAtMs(state) ?? null,
      },
      "cron: started",
    );
  });
}

/**
 * Auto-clear stale runningAtMs markers during list/status operations.
 * Safety net for cases where job execution hangs (e.g., agent context explosion).
 * Threshold: 30 minutes (max job timeout is 20 minutes).
 */
async function clearStaleRunningMarkers(state: CronServiceState): Promise<boolean> {
  const jobs = state.store?.jobs ?? [];
  const now = state.deps.nowMs();
  const STALE_THRESHOLD_MS = 30 * 60_000; // 30 minutes
  let mutated = false;
  for (const job of jobs) {
    const runningAt = job.state.runningAtMs;
    if (typeof runningAt === "number" && now - runningAt > STALE_THRESHOLD_MS) {
      state.deps.log.warn(
        { jobId: job.id, ageMs: now - runningAt, runningAtMs: runningAt },
        "cron: auto-clearing stale running marker",
      );
      job.state.runningAtMs = undefined;
      mutated = true;
    }
  }
  return mutated;
}

export function stop(state: CronServiceState) {
  stopTimer(state);
}

export async function status(state: CronServiceState) {
  return await locked(state, async () => {
    await ensureLoaded(state, { skipRecompute: true });

    const cleared = await clearStaleRunningMarkers(state);
    if (cleared) {
      await persist(state);
    }

    if (state.store) {
      const changed = recomputeNextRuns(state);
      if (changed) {
        await persist(state);
      }
    }
    return {
      enabled: state.deps.cronEnabled,
      storePath: state.deps.storePath,
      jobs: state.store?.jobs.length ?? 0,
      nextWakeAtMs: state.deps.cronEnabled ? (nextWakeAtMs(state) ?? null) : null,
    };
  });
}

export async function list(state: CronServiceState, opts?: { includeDisabled?: boolean }) {
  return await locked(state, async () => {
    await ensureLoaded(state, { skipRecompute: true });

    const cleared = await clearStaleRunningMarkers(state);
    if (cleared) {
      await persist(state);
    }

    if (state.store) {
      const changed = recomputeNextRuns(state);
      if (changed) {
        await persist(state);
      }
    }
    const includeDisabled = opts?.includeDisabled === true;
    const jobs = (state.store?.jobs ?? []).filter((j) => includeDisabled || j.enabled);
    return jobs.toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0));
  });
}

export async function add(state: CronServiceState, input: CronJobCreate) {
  return await locked(state, async () => {
    warnIfDisabled(state, "add");
    await ensureLoaded(state);
    const job = createJob(state, input);
    state.store?.jobs.push(job);

    // Defensive: recompute all next-run times to ensure consistency
    recomputeNextRuns(state);

    await persist(state);
    armTimer(state);

    state.deps.log.info(
      {
        jobId: job.id,
        jobName: job.name,
        nextRunAtMs: job.state.nextRunAtMs,
        schedulerNextWakeAtMs: nextWakeAtMs(state) ?? null,
        timerArmed: state.timer !== null,
        cronEnabled: state.deps.cronEnabled,
      },
      "cron: job added",
    );

    emit(state, {
      jobId: job.id,
      action: "added",
      nextRunAtMs: job.state.nextRunAtMs,
    });
    return job;
  });
}

export async function update(state: CronServiceState, id: string, patch: CronJobPatch) {
  return await locked(state, async () => {
    warnIfDisabled(state, "update");
    await ensureLoaded(state);
    const job = findJobOrThrow(state, id);
    const now = state.deps.nowMs();
    applyJobPatch(job, patch);
    if (job.schedule.kind === "every") {
      const anchor = job.schedule.anchorMs;
      if (typeof anchor !== "number" || !Number.isFinite(anchor)) {
        const patchSchedule = patch.schedule;
        const fallbackAnchorMs =
          patchSchedule?.kind === "every"
            ? now
            : typeof job.createdAtMs === "number" && Number.isFinite(job.createdAtMs)
              ? job.createdAtMs
              : now;
        job.schedule = {
          ...job.schedule,
          anchorMs: Math.max(0, Math.floor(fallbackAnchorMs)),
        };
      }
    }
    const scheduleChanged = patch.schedule !== undefined;
    const enabledChanged = patch.enabled !== undefined;

    job.updatedAtMs = now;
    if (scheduleChanged || enabledChanged) {
      if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
      } else {
        job.state.nextRunAtMs = undefined;
        job.state.runningAtMs = undefined;
      }
    }

    await persist(state);
    armTimer(state);
    emit(state, {
      jobId: id,
      action: "updated",
      nextRunAtMs: job.state.nextRunAtMs,
    });
    return job;
  });
}

export async function remove(state: CronServiceState, id: string) {
  return await locked(state, async () => {
    warnIfDisabled(state, "remove");
    await ensureLoaded(state);
    const before = state.store?.jobs.length ?? 0;
    if (!state.store) {
      return { ok: false, removed: false } as const;
    }
    state.store.jobs = state.store.jobs.filter((j) => j.id !== id);
    const removed = (state.store.jobs.length ?? 0) !== before;
    await persist(state);
    armTimer(state);
    if (removed) {
      emit(state, { jobId: id, action: "removed" });
    }
    return { ok: true, removed } as const;
  });
}

export async function run(state: CronServiceState, id: string, mode?: "due" | "force") {
  warnIfDisabled(state, "run");

  type RunPreflight =
    | { ok: true; ran: false; reason: "already-running" | "not-due" }
    | { ok: true; ran: true; startedAt: number; snapshot: CronJob };

  const forced = mode === "force";

  const preflight: RunPreflight = await locked(state, async () => {
    await ensureLoaded(state, { skipRecompute: true });
    const job = findJobOrThrow(state, id);

    if (typeof job.state.runningAtMs === "number") {
      return { ok: true, ran: false, reason: "already-running" };
    }

    const now = state.deps.nowMs();
    const due = isJobDue(job, now, { forced });
    if (!due) {
      return { ok: true, ran: false, reason: "not-due" };
    }

    job.state.runningAtMs = now;
    job.state.lastError = undefined;

    const snapshot: CronJob = structuredClone(job);

    return { ok: true, ran: true, startedAt: now, snapshot };
  });

  if (preflight.ran === false) {
    return preflight;
  }

  const { snapshot, startedAt } = preflight;

  const prevSchedulerRunning = state.running;
  state.running = true;
  try {
    emit(state, { jobId: id, action: "started", runAtMs: startedAt });

    const jobTimeoutMs =
      snapshot.payload.kind === "agentTurn" && typeof snapshot.payload.timeoutSeconds === "number"
        ? snapshot.payload.timeoutSeconds * 1_000
        : 10 * 60_000;

    let coreResult: {
      status: "ok" | "error" | "skipped";
      error?: string;
      summary?: string;
      sessionId?: string;
      sessionKey?: string;
    };

    try {
      let timeoutId: NodeJS.Timeout;
      coreResult = await Promise.race([
        executeJobCore(state, snapshot),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("cron: job execution timed out")),
            jobTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timeoutId!));
    } catch (err) {
      state.deps.log.warn(
        { jobId: id, jobName: snapshot.name, timeoutMs: jobTimeoutMs },
        `cron: job failed: ${String(err)}`,
      );
      coreResult = { status: "error", error: String(err) };
    }

    const endedAt = state.deps.nowMs();

    await locked(state, async () => {
      await ensureLoaded(state, { skipRecompute: true });
      const job = state.store?.jobs.find((j) => j.id === id);
      if (!job) {
        return;
      }

      const shouldDelete = applyJobResult(state, job, {
        status: coreResult.status,
        error: coreResult.error,
        startedAt,
        endedAt,
      });

      emit(state, {
        jobId: job.id,
        action: "finished",
        status: coreResult.status,
        error: coreResult.error,
        summary: coreResult.summary,
        sessionId: coreResult.sessionId,
        sessionKey: coreResult.sessionKey,
        runAtMs: startedAt,
        durationMs: job.state.lastDurationMs,
        nextRunAtMs: job.state.nextRunAtMs,
      });

      if (shouldDelete && state.store) {
        state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
        emit(state, { jobId: job.id, action: "removed" });
      }

      recomputeNextRuns(state);
      await persist(state);
      armTimer(state);
    });

    return { ok: true, ran: true } as const;
  } finally {
    state.running = prevSchedulerRunning;
  }
}

export function wakeNow(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  return wake(state, opts);
}
