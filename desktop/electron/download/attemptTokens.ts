/**
 * Which transfer of a download may still speak (Download PRD §2.4).
 *
 * Each start takes a new token; a pause, cancel or restart withdraws it. A
 * cancelled yt-dlp or HTTP transfer can still emit progress, an error or even
 * success after it was replaced, and without this a paused task could be
 * failed (and sent into source refresh) by the transfer it had just stopped.
 * Pure.
 */
export class AttemptTokens {
  private readonly current = new Map<string, number>();
  private next = 0;

  public begin(taskId: string): number {
    const attempt = ++this.next;
    this.current.set(taskId, attempt);
    return attempt;
  }

  public withdraw(taskId: string): void {
    this.current.delete(taskId);
  }

  /** Wraps an engine callback so only the task's current transfer reaches it. */
  public guard<A extends unknown[]>(taskId: string, attempt: number, fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      if (this.current.get(taskId) !== attempt) return;
      fn(...args);
    };
  }
}
