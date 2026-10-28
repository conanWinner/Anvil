import { z } from '@hono/zod-openapi';

/**
 * Live trace of an experiment execution (TW-06): one row per step the builder, reviewer, sandbox
 * or Anvil takes. A step is emitted once as `running` and once more with its outcome under the same
 * `step` id, so a viewer can show what is happening now and what happened before.
 */

export const EXPERIMENT_PROGRESS_EVENT_TYPE = 'system3_progress';

const DETAIL_LIMIT = 8_000;

export const experimentProgressStageSchema = z.enum(['prepare', 'variants', 'review', 'run']);
export const experimentProgressActionSchema = z.enum([
  /** Anvil checks that the sandbox can read the pinned data and write its output at all. */
  'sandbox_check',
  /** Builder model writes or fixes code. */
  'generate',
  /** prepare_data.py runs in the sandbox on the pinned data. */
  'prepare_data',
  /** Anvil splits the modeling table and keeps the test labels. */
  'split',
  /** Every variant runs on a small sample. */
  'smoke',
  /** Reviewer model checks the codebase. */
  'review',
  /** Builder stopped because the blueprint conflicts with the data; a person must decide. */
  'question',
  /** One variant runs on the full split. */
  'variant_run',
  /** Anvil scores the predictions with the held-out labels. */
  'evaluate',
]);

export const experimentProgressEventSchema = z.object({
  /** Order within one execution; `step` ids repeat for the running and finished event. */
  seq: z.number().int().nonnegative(),
  step: z.string().min(1).max(64),
  at: z.string().datetime(),
  stage: experimentProgressStageSchema,
  action: experimentProgressActionSchema,
  status: z.enum(['running', 'passed', 'failed']),
  /** Fix round within the stage (1-based); 0 when rounds do not apply. */
  round: z.number().int().nonnegative(),
  variantId: z.string().max(120).nullable(),
  detail: z.string().max(DETAIL_LIMIT),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type ExperimentProgressEvent = z.infer<typeof experimentProgressEventSchema>;

export type ExperimentProgressSink = (event: ExperimentProgressEvent) => void;

function clipDetail(text: string): string {
  return text.length <= DETAIL_LIMIT ? text : `…${text.slice(text.length - DETAIL_LIMIT + 1)}`;
}

interface StepStart {
  stage: ExperimentProgressEvent['stage'];
  action: ExperimentProgressEvent['action'];
  round?: number;
  variantId?: string;
  detail?: string;
}

export class ExperimentProgress {
  readonly events: ExperimentProgressEvent[] = [];
  private seq = 0;
  private stepCount = 0;
  /** Keeps step ids unique if a workflow run executes the node again (resume). */
  private readonly prefix = crypto.randomUUID().slice(0, 8);

  constructor(private readonly sink?: ExperimentProgressSink) {}

  private emit(event: Omit<ExperimentProgressEvent, 'seq' | 'at'>): void {
    const full = experimentProgressEventSchema.parse({
      ...event,
      detail: clipDetail(event.detail),
      seq: this.seq,
      at: new Date().toISOString(),
    });
    this.seq += 1;
    this.events.push(full);
    this.sink?.(full);
  }

  /** Records a running step; call the returned function once with its outcome. */
  start(step: StepStart): (status: 'passed' | 'failed', detail?: string) => void {
    this.stepCount += 1;
    const id = `${this.prefix}-${this.stepCount.toString()}`;
    const started = Date.now();
    const base = {
      step: id,
      stage: step.stage,
      action: step.action,
      round: step.round ?? 0,
      variantId: step.variantId ?? null,
    };
    this.emit({ ...base, status: 'running', detail: step.detail ?? '', durationMs: null });
    let finished = false;
    return (status, detail) => {
      if (finished) return;
      finished = true;
      this.emit({
        ...base,
        status,
        detail: detail ?? step.detail ?? '',
        durationMs: Date.now() - started,
      });
    };
  }

  /** Runs `work` as one step: passed when it resolves, failed (and rethrown) when it throws. */
  async track<T>(
    step: StepStart,
    work: () => Promise<T>,
    describe?: (value: T) => { status: 'passed' | 'failed'; detail: string }
  ): Promise<T> {
    const finish = this.start(step);
    try {
      const value = await work();
      const outcome = describe?.(value) ?? { status: 'passed' as const, detail: step.detail ?? '' };
      finish(outcome.status, outcome.detail);
      return value;
    } catch (error) {
      finish('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
