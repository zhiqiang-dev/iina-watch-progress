/** Dependencies are primitive values or stable model records, never whole incoming messages. */
export class RenderSections {
  private previous = new Map<string, readonly unknown[]>();
  invalidate(section: string): void { this.previous.delete(section); }
  changed(section: string, dependencies: readonly unknown[]): boolean {
    const old = this.previous.get(section);
    if (old?.length === dependencies.length && old.every((value, index) => Object.is(value, dependencies[index]))) return false;
    this.previous.set(section, dependencies);
    return true;
  }
}
