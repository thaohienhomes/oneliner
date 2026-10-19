/**
 * Tiny FIFO concurrency limiter: at most `max` tasks run at once, the rest
 * wait in submission order. Used to cap concurrent Comfy render jobs.
 */
export type Limiter = {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
};

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) throw new Error(`limiter max must be a positive integer, got ${max}`);
  let active = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) start();
  };

  return {
    run<T>(task: () => Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          active++;
          // Promise.resolve().then() also catches a task that throws synchronously.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active--;
              next();
            });
        });
        next();
      });
    },
    get active() {
      return active;
    },
    get pending() {
      return waiting.length;
    },
  };
}
