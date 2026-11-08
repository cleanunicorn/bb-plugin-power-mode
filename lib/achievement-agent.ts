// Canonical event adapter, independent of transcript DOM. Establish a high-water
// cursor before observing; a remount never starts at history sequence zero.
import type { InputObservation } from "./achievement-input";
export interface EventRow {
  seq: number;
  createdAt: number;
  scope: { kind: string; turnId?: string };
  type: string;
  data: unknown;
}
interface Message {
  words: number;
  inWord: boolean;
  started: boolean;
  done: boolean;
}
function countChunk(message: Message, text: string) {
  for (const char of text) {
    const word = !/\s/u.test(char);
    if (word && !message.inWord) message.words++;
    message.inWord = word;
  }
}
interface ObservedTurn {
  partial: boolean;
  messages: Map<string, Message>;
}
export class AgentObservation {
  private cursor: number | null = null;
  private turns = new Map<string, ObservedTurn>();
  private emit: (event: InputObservation) => void;
  private thread: string;
  constructor(emit: (event: InputObservation) => void, thread: string) {
    this.emit = emit;
    this.thread = thread;
  }
  seed(seq: number) {
    this.cursor = seq;
    this.turns.clear();
  }
  disconnect() {
    const active = this.cursor !== null || this.turns.size > 0;
    this.cursor = null;
    this.turns.clear();
    if (active) this.emit({ type: "disconnect", thread: this.thread });
  }
  accept(rows: readonly EventRow[]) {
    if (this.cursor === null) return;
    for (const row of rows) {
      if (row.seq <= this.cursor) continue;
      this.cursor = row.seq;
      if (row.scope.kind !== "turn" || !row.scope.turnId) continue;
      const id = row.scope.turnId,
        d = row.data as Record<string, unknown>;
      if (!d || typeof d !== "object") continue;
      if (row.type === "turn/started") {
        if (d.parentToolCallId || this.turns.has(id)) continue;
        this.turns.set(id, { messages: new Map(), partial: false });
        this.emit({
          type: "start",
          thread: this.thread,
          turn: id,
          wall: row.createdAt,
        });
        continue;
      }
      const turn = this.turns.get(id);
      if (!turn) continue;
      if (row.type === "item/started" || row.type === "item/completed") {
        const item = d.item as Record<string, unknown> | undefined;
        if (item?.type !== "agentMessage" || typeof item.id !== "string")
          continue;
        if (row.type === "item/started") {
          const m = { words: 0, inWord: false, started: true, done: false };
          if (typeof item.text === "string") countChunk(m, item.text);
          turn.messages.set(item.id, m);
        } else {
          const m = turn.messages.get(item.id);
          if (m) {
            if (typeof item.text === "string") {
              m.words = 0;
              m.inWord = false;
              countChunk(m, item.text);
            }
            m.done = true;
          } else turn.partial = true;
        }
        this.emit({ type: "activity", thread: this.thread, turn: id });
      }
      if (
        row.type === "item/agentMessage/delta" &&
        typeof d.itemId === "string" &&
        typeof d.delta === "string"
      ) {
        const m = turn.messages.get(d.itemId);
        if (m) countChunk(m, d.delta);
        else turn.partial = true;
        this.emit({ type: "activity", thread: this.thread, turn: id });
      }
      if (row.type === "turn/completed") {
        this.turns.delete(id);
        const messages = [...turn.messages.values()];
        // Final text, not per-chunk word counts ("hel" + "lo" is one word).
        const words = messages.reduce((sum, m) => sum + m.words, 0);
        this.emit({
          type: "complete",
          thread: this.thread,
          turn: id,
          status: typeof d.status === "string" ? d.status : "unknown",
          fresh:
            !turn.partial &&
            messages.length > 0 &&
            messages.every((m) => m.started && m.done),
          words,
        });
      }
    }
  }
  get afterSeq() {
    return this.cursor;
  }
}
