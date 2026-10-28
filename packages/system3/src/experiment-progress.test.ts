import { describe, expect, test } from 'bun:test';
import {
  ExperimentProgress,
  experimentProgressEventSchema,
  type ExperimentProgressEvent,
} from './experiment-progress';

describe('ExperimentProgress', () => {
  test('announces a step as running, then reports its outcome under the same id', () => {
    const received: ExperimentProgressEvent[] = [];
    const progress = new ExperimentProgress(event => received.push(event));
    const finish = progress.start({ stage: 'prepare', action: 'generate', round: 1 });
    finish('passed', 'wrote prepare_data.py');
    finish('failed', 'ignored second call');

    expect(received).toEqual(progress.events);
    expect(received.map(event => [event.seq, event.status])).toEqual([
      [0, 'running'],
      [1, 'passed'],
    ]);
    const [running, done] = received;
    expect(done?.step).toBe(running?.step);
    expect(done?.detail).toBe('wrote prepare_data.py');
    expect(running?.durationMs).toBeNull();
    expect(done?.durationMs).toBeGreaterThanOrEqual(0);
    for (const event of received) expect(experimentProgressEventSchema.parse(event)).toEqual(event);
  });

  test('gives every step its own id and keeps the variant', () => {
    const progress = new ExperimentProgress();
    progress.start({ stage: 'run', action: 'variant_run', variantId: 'xgboost' })('passed');
    progress.start({ stage: 'run', action: 'variant_run', variantId: 'lightgbm' })('failed');
    const steps = new Set(progress.events.map(event => event.step));
    expect(steps.size).toBe(2);
    expect(progress.events.at(-1)).toMatchObject({ variantId: 'lightgbm', status: 'failed' });
  });

  test('track marks a step failed with the error and rethrows it', async () => {
    const progress = new ExperimentProgress();
    await expect(
      progress.track({ stage: 'review', action: 'review', round: 2 }, () =>
        Promise.reject(new Error('model timed out'))
      )
    ).rejects.toThrow('model timed out');
    expect(progress.events.at(-1)).toMatchObject({
      status: 'failed',
      detail: 'model timed out',
      round: 2,
    });
  });

  test('track lets the caller judge a resolved result as failed', async () => {
    const progress = new ExperimentProgress();
    const value = await progress.track(
      { stage: 'run', action: 'evaluate' },
      () => Promise.resolve(0),
      verified => ({ status: verified > 0 ? 'passed' : 'failed', detail: 'no valid predictions' })
    );
    expect(value).toBe(0);
    expect(progress.events.at(-1)).toMatchObject({
      status: 'failed',
      detail: 'no valid predictions',
    });
  });

  test('keeps the end of an over-long detail', () => {
    const progress = new ExperimentProgress();
    progress.start({ stage: 'prepare', action: 'prepare_data' })(
      'failed',
      `${'x'.repeat(10_000)}KeyError: target`
    );
    const detail = progress.events.at(-1)?.detail ?? '';
    expect(detail.length).toBe(8_000);
    expect(detail.endsWith('KeyError: target')).toBe(true);
  });
});
