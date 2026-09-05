/**
 * Promise-based completion debouncer in the style of a UUID race: every call
 * supersedes the previous one, and superseded callers resolve `false` when
 * their own timer fires so no pending promise is left dangling.
 */
export class CompletionDebouncer {
  private currentId = 0;
  private readonly pending = new Map<ReturnType<typeof setTimeout>, (proceed: boolean) => void>();

  /** Resolves `true` when this caller is still the latest and may proceed. */
  async delay(ms: number): Promise<boolean> {
    const id = ++this.currentId;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(timer);
        resolve(this.currentId === id);
      }, Math.max(0, ms));
      this.pending.set(timer, resolve);
    });
  }

  /** Resolves any in-flight callers as superseded and clears their timers. */
  dispose(): void {
    this.currentId++;
    for (const [timer, resolve] of this.pending) {
      clearTimeout(timer);
      resolve(false);
    }
    this.pending.clear();
  }
}
