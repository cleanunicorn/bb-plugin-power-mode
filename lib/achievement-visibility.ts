/** Invalidates asynchronous observations across even a brief hidden interval. */
export class ObservationVisibility {
  private generation = 0;
  private disposed = false;
  private document: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  private disconnect: () => void;

  constructor(
    document: Pick<
      Document,
      "visibilityState" | "addEventListener" | "removeEventListener"
    >,
    disconnect: () => void,
  ) {
    this.document = document;
    this.disconnect = disconnect;
    document.addEventListener("visibilitychange", this.reset);
  }

  reset = () => {
    this.generation++;
    this.disconnect();
  };

  private hidden() {
    return this.document.visibilityState === "hidden";
  }

  async run<T>(request: () => Promise<T>, accept: (value: T) => void) {
    if (this.disposed) return;
    if (this.hidden()) {
      this.reset();
      return;
    }
    const generation = this.generation;
    try {
      const value = await request();
      if (!this.disposed && generation === this.generation && !this.hidden())
        accept(value);
    } catch {
      // An obsolete request must not disconnect a newer observation.
      if (!this.disposed && generation === this.generation) this.reset();
    }
  }

  dispose() {
    this.disposed = true;
    this.document.removeEventListener("visibilitychange", this.reset);
    this.reset();
  }
}
