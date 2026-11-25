/** Keep JS callbacks rooted for the lifetime of each IINA JavaScript context.
 * IINA's message hubs use JSManagedValue; a local registration alone is not a
 * reliable lifetime boundary when JavaScriptCore collects bridge wrappers.
 */
type MessageHandler = (data: any, player?: string) => void;
interface MessageEndpoint { onMessage(name: string, handler: MessageHandler): void; }
type CallbackRoots = Map<MessageEndpoint, Map<string, MessageHandler>>;
const root = globalThis as typeof globalThis & { __watchProgressMessageCallbacks?: CallbackRoots };
const callbacks = root.__watchProgressMessageCallbacks ??= new Map();

export function onNativeMessage(api: MessageEndpoint, name: string, handler: MessageHandler): void {
  let listeners = callbacks.get(api);
  if (!listeners) { listeners = new Map(); callbacks.set(api, listeners); }
  listeners.set(name, handler);
  api.onMessage(name, handler);
}

interface Envelope { player: string; name: string; wire: string; }

/** Never synchronously reenter a player's JSContext from its call into global.
 * JSON is captured before scheduling so mutable records cannot change in flight.
 */
export class DeferredGlobalMessages {
  private pending = new Map<string, Envelope>();
  private scheduled = false;

  constructor(
    private readonly send: (player: string, name: string, wire: string) => void,
    private readonly schedule: (callback: () => void) => void,
    private readonly reportError: (error: unknown) => void,
  ) {}

  post(player: string, name: string, data: unknown,
    merge?: (previousWire: string, nextWire: string) => string): void {
    let wire = JSON.stringify(data);
    if (wire === undefined) throw new Error("Message must be JSON serializable");
    const key = JSON.stringify([player, name]);
    const previous = this.pending.get(key);
    if (previous && merge) wire = merge(previous.wire, wire);
    this.pending.set(key, { player, name, wire });
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      const batch = [...this.pending.values()];
      this.pending.clear();
      this.scheduled = false;
      for (const message of batch) {
        try { this.send(message.player, message.name, message.wire); }
        catch (error) { this.reportError(error); }
      }
    });
  }
}
