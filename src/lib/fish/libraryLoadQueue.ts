// The monitor and static filter share one research archive. Restore it at the
// monitor's priority; both directories then read the same verified snapshot.
const order = {instant: 0, monitor: 1, screening: 2, filter: 3, mining: 4} as const;
type Priority = keyof typeof order;
type Job = { priority: Priority; run: () => Promise<void> };
const instantReads = new Map<string | undefined, Promise<void>>();
const queues = new Map<string | undefined, Job[]>();

// New signals and existing positions may need screening history for admission checks.
const instantOwners = new Set<string>();
export function prioritizeInstantScreening(owner: string, urgent: boolean) {
  if (urgent) instantOwners.add(owner); else instantOwners.delete(owner);
}
function priorityOf(owner: string | undefined, job: Job) {
  return owner && instantOwners.has(owner) && job.priority === 'screening' ? order.instant + 0.5 : order[job.priority];
}

/** Queue initial account reads only. Live execution and writes have independent paths. */
export function readFishLibrary<T>(owner: string | undefined, priority: Priority, read: () => Promise<T>): Promise<T> {
  if (priority === 'instant') {
    const task = (instantReads.get(owner) ?? Promise.resolve()).then(read);
    const settled = task.then(() => {}, () => {});
    instantReads.set(owner, settled);
    void settled.then(() => { if (instantReads.get(owner) === settled) instantReads.delete(owner); });
    return task;
  }
  return new Promise((resolve, reject) => {
    let queue = queues.get(owner);
    if (!queue) {
      queue = [];
      queues.set(owner, queue);
      const jobs = queue;
      queueMicrotask(async () => {
        while (jobs.length) {
          while (instantReads.has(owner)) await instantReads.get(owner);
          jobs.sort((a, b) => priorityOf(owner, a) - priorityOf(owner, b));
          await jobs.shift()!.run();
        }
        queues.delete(owner);
      });
    }
    queue.push({priority, async run() {
      try { resolve(await read()); } catch (error) { reject(error); }
    }});
  });
}
