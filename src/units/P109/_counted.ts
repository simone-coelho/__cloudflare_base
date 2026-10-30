// src/units/P109/_counted.ts
// P109 (E33, amendment 13; R-P707): the counted forms the gate's tests share with their meta-legs, so that what
// unit:P109.GD1 and unit:P109.GD2 prove is the very code W12.02 and P35.Z2 run. No clock decides anything here.
//
//   · `perAction` (P35.Z2, GD2): writes compared action by action, order-free within one action. Two writes of one
//     request are concurrent fire-and-forget chains (src/routes/realtime.ts, the action route's forwardEventToOdp and
//     upsertOdpProfile, each on waitUntil; src/durable-objects/ShopperReflex.ts, the same two on retainOwnerWork), so their order inside one
//     action is the scheduler's, not the product's; the order across actions, every byte and the count of writes stay
//     pinned (S55 DESIGN §2.3).
//   · `deliveries` and `observedAfterDelivery` (W12.02, GD1): the native monitor's observation stage polls under its own
//     `stageMs` deadline (src/ops/synthetic.ts `stage`, and executeSynthetic's observation stage), which races the real
//     queue delivery on a busy machine. The counted form awaits the delivery event the test records (its
//     W0906_OBSERVER service binding), then makes one re-observation: at most one per tenant and host, a count, not a
//     time (S55 DESIGN §1.3). A delivery that never comes leaves it waiting, so the test fails on its own timeout.

/**
 * The items of one run cut into its actions at `marks` (the item count after each drained action; the first window is
 * everything before the first mark, the last everything after the last), each item rendered by `render` (null leaves
 * it out) and each action's renderings sorted. Equal results mean the same writes, byte for byte and in the same
 * number, action by action; only the order inside one action is not compared.
 */
export function perAction<T>(items: readonly T[], marks: readonly number[], render: (item: T) => string | null): string[][] {
  const bounds = [0, ...marks, items.length];
  const out: string[][] = [];
  for (let i = 1; i < bounds.length; i++) {
    out.push(items.slice(bounds[i - 1], bounds[i]).map(render).filter((s): s is string => s !== null).sort());
  }
  return out;
}

/** The delivery events a test records, awaited by what they hold, never by a clock. */
export interface Deliveries<B> {
  /** Every recorded event, in arrival order. */
  readonly batches: B[];
  /** Record one delivery event (the observer binding calls this). */
  record(batch: B): void;
  /** Resolves once `done` holds over the events recorded so far; it is checked now and after each new event. */
  until(done: (batches: readonly B[]) => boolean): Promise<void>;
}

export function deliveries<B>(): Deliveries<B> {
  const batches: B[] = [];
  let waiting: Array<{ done: (batches: readonly B[]) => boolean; resolve: () => void }> = [];
  return {
    batches,
    record(batch) {
      batches.push(batch);
      const still: typeof waiting = [];
      for (const w of waiting) { if (w.done(batches)) w.resolve(); else still.push(w); }
      waiting = still;
    },
    until(done) {
      if (done(batches)) return Promise.resolve();
      return new Promise<void>(resolve => { waiting.push({ done, resolve }); });
    },
  };
}

/** A delivery event as the W12.02 fixture's queue handler posts it to its observer: the queue and each message's body. */
export interface Delivered { queue: string; messages: Array<{ body: unknown }> }

/**
 * Every wire named by `digests` (the monitor's own record of what it sent) has reached the consumer on `queue`: a
 * delivered message whose envelope carries that digest. The fixture posts a batch only after the consumer ran it.
 */
export const wiresDelivered = (queue: string, digests: readonly string[]) => (batches: readonly Delivered[]): boolean =>
  digests.every(digest => batches.some(batch => batch.queue === queue && batch.messages.some(message => (message.body as { digest?: unknown } | null)?.digest === digest)));

/** The answer of the monitor's run as W12.02 reads it (src/ops/synthetic.ts SyntheticResult). */
export interface Observed { failedStage?: unknown; event?: unknown; dlq?: unknown; producer?: unknown; consumer?: unknown; ledger?: unknown; learning?: unknown }

/**
 * The run's observation ended before the delivery it observes, on either of executeSynthetic's two endings: the stage's
 * deadline (`failedStage: 'observation'`, the polled flags dropped), or the poll's own last turn (`Date.now() + 100 >=
 * until`), which answers the partial flags with no failed stage — `state` 'pending', or 'failed' where latencyExceeded
 * is set, so the state alone does not say it. Unfinished means: the event accepted, nothing dead-lettered, and not every
 * one of producer, consumer, ledger and learning yet true — the poll's own condition to go on.
 */
export const observationUnfinished = (r: Observed): boolean => r.failedStage === 'observation'
  || (r.failedStage === undefined && r.event === true && r.dlq !== true && !(r.producer === true && r.consumer === true && r.ledger === true && r.learning === true));

/**
 * One run; where its observation ended unfinished (`observationUnfinished`), await `delivered` (the recorded delivery
 * event), then exactly one re-observation, whose answer is returned. `runs` is the count of runs made: 1 or 2, never more.
 */
export async function observedAfterDelivery<R extends Observed>(run: () => Promise<R>, delivered: () => Promise<void>): Promise<{ result: R; runs: number }> {
  const first = await run();
  if (!observationUnfinished(first)) return { result: first, runs: 1 };
  await delivered();
  return { result: await run(), runs: 2 };
}
