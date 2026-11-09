import { EventEmitter } from "node:events";
import type { ServerEvent } from "./types.ts";

/** Pub/sub used to push state snapshots to every connected browser (SSE). */
class Bus extends EventEmitter {
  publish(event: ServerEvent) {
    this.emit("event", event);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
