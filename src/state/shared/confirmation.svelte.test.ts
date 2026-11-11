import { describe, expect, it, vi } from 'vitest';
import { createConfirmation } from './confirmation.svelte';

function setup(result = true) {
  let finish: (value: boolean) => void = () => {};
  const run = vi.fn((target: string) => {
    void target;
    return new Promise<boolean>((resolve) => (finish = resolve));
  });
  const question = createConfirmation(run);
  return { question, run, finish: (value = result) => finish(value) };
}

describe('createConfirmation', () => {
  it('asks first; Cancel sends nothing', async () => {
    const { question, run } = setup();
    question.ask('u2');
    expect(question.asking).toBe('u2');
    question.cancel();
    expect(question.asking).toBeNull();
    expect(await question.confirm()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('closes the question at once and runs the action once for the asked target', async () => {
    const { question, run, finish } = setup();
    question.ask('u2');
    const first = question.confirm();
    expect(question).toMatchObject({ asking: null, busy: true });
    expect(await question.confirm()).toBe(false);
    question.ask('u3');
    expect(question.asking).toBeNull();
    finish();
    expect(await first).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('u2');
    expect(question.busy).toBe(false);
  });

  it('answers a failure and can ask again', async () => {
    const { question, finish } = setup(false);
    question.ask('u2');
    const done = question.confirm();
    finish();
    expect(await done).toBe(false);
    question.ask('u2');
    expect(question.asking).toBe('u2');
  });

  it('is ready again after the action threw', async () => {
    const question = createConfirmation(async () => {
      throw new Error('offline');
    });
    question.ask('u2');
    await expect(question.confirm()).rejects.toThrow('offline');
    expect(question.busy).toBe(false);
  });
});
