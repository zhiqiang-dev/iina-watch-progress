/** Delay expensive queries until typing settles; never query an unfinished IME composition. */
export class SearchInput {
  private timer?: ReturnType<typeof setTimeout>;
  private composing = false;
  constructor(private readonly apply: () => void, private readonly delay = 150) {}
  input(): void {
    this.cancel();
    if (!this.composing) this.timer = setTimeout(() => { this.timer = undefined; this.apply(); }, this.delay);
  }
  compositionStart(): void { this.composing = true; this.cancel(); }
  compositionEnd(): void { this.composing = false; this.input(); }
  flush(): void { this.cancel(); if (!this.composing) this.apply(); }
  reset(): void { this.cancel(); this.composing = false; }
  cancel(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
}
