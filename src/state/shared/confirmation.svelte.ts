/**
 * A destructive action behind a question (leave a club, remove a member): `ask` opens the dialog for a target,
 * `confirm` closes it at once (the opener takes the focus back, a failure's message then takes it from there) and runs
 * the action once; a second confirm or an ask while it runs does nothing. Answers whether the action worked.
 */
export function createConfirmation<T>(run: (target: T) => Promise<boolean>) {
  let asking = $state<T | null>(null);
  let busy = $state(false);

  return {
    /** The target of the open question, or null. */
    get asking() {
      return asking;
    },
    /** The confirmed action is running. */
    get busy() {
      return busy;
    },
    ask(target: T) {
      if (!busy) asking = target;
    },
    cancel() {
      asking = null;
    },
    async confirm(): Promise<boolean> {
      const target = asking;
      if (target === null || busy) return false;
      asking = null;
      busy = true;
      try {
        return await run(target);
      } finally {
        busy = false;
      }
    },
  };
}
