import { clamp01, ease, type Ease } from './math';

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

export const isCancelled = (e: unknown): e is Cancelled => e instanceof Cancelled;

interface Task {
  step(dt: number): boolean;
}

export class Tasks {
  private readonly tasks = new Set<Task>();
  timeScale = 1;
  now = 0;

  update(dt: number): void {
    const scaled = dt * this.timeScale;
    this.now += scaled;
    for (const task of this.tasks) {
      if (task.step(scaled)) this.tasks.delete(task);
    }
  }

  private run<T>(signal: AbortSignal | undefined, make: (resolve: (v: T) => void) => Task): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Cancelled());
        return;
      }
      let task: Task | null = null;
      const onAbort = () => {
        if (task) this.tasks.delete(task);
        reject(new Cancelled());
      };
      task = make((v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.tasks.add(task);
    });
  }

  wait(seconds: number, signal?: AbortSignal): Promise<void> {
    let left = seconds;
    return this.run<void>(signal, (resolve) => ({
      step: (dt) => {
        left -= dt;
        if (left > 0) return false;
        resolve();
        return true;
      },
    }));
  }

  nextFrame(signal?: AbortSignal): Promise<void> {
    return this.run<void>(signal, (resolve) => ({
      step: () => {
        resolve();
        return true;
      },
    }));
  }

  until(predicate: (dt: number) => boolean, signal?: AbortSignal): Promise<void> {
    return this.run<void>(signal, (resolve) => ({
      step: (dt) => {
        if (!predicate(dt)) return false;
        resolve();
        return true;
      },
    }));
  }

  tween(seconds: number, onUpdate: (k: number) => void, easing: Ease = ease.inOutCubic, signal?: AbortSignal): Promise<void> {
    let elapsed = 0;
    if (seconds <= 0) {
      onUpdate(1);
      return Promise.resolve();
    }
    onUpdate(easing(0));
    return this.run<void>(signal, (resolve) => ({
      step: (dt) => {
        elapsed += dt;
        const k = clamp01(elapsed / seconds);
        onUpdate(easing(k));
        if (k < 1) return false;
        resolve();
        return true;
      },
    }));
  }

  spawn(step: (dt: number) => boolean, signal?: AbortSignal): void {
    const task: Task = { step };
    this.tasks.add(task);
    signal?.addEventListener('abort', () => this.tasks.delete(task), { once: true });
  }

  clear(): void {
    this.tasks.clear();
  }
}

export class Signal<T = void> {
  private readonly listeners = new Set<(value: T) => void>();
  on(fn: (value: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    for (const fn of [...this.listeners]) fn(value);
  }
  next(signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Cancelled());
        return;
      }
      const off = this.on((v) => {
        signal?.removeEventListener('abort', onAbort);
        off();
        resolve(v);
      });
      const onAbort = () => {
        off();
        reject(new Cancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
