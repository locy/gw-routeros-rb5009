import type { DatabaseWrapper, TrafficSample } from "./db.ts";
import type { InterfaceCounters } from "./models.ts";
import type { RouterOSClient } from "./routeros.ts";
import { calculateRate } from "./traffic.ts";
import { pushLatestSample } from "./api.ts";

export class Collector {
  private previous = new Map<string, InterfaceCounters>();

  constructor(
    private readonly client: RouterOSClient,
    private readonly db: DatabaseWrapper,
    private readonly interfaces: string[],
  ) {}

  async pollOnce(): Promise<void> {
    let counters: Map<string, InterfaceCounters>;
    try {
      counters = await this.client.readInterfaceCounters();
    } catch (error) {
      this.db.insertEvent(
        "collector_error",
        null,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    for (const iface of this.interfaces) {
      const current = counters.get(iface);
      if (!current) {
        this.db.insertEvent(
          "missing_interface",
          iface,
          `${iface} not returned by RouterOS`,
        );
        continue;
      }
      const previous = this.previous.get(iface);
      this.previous.set(iface, current);
      if (!previous) continue;
      const sample = calculateRate(previous, current);
      this.db.insertSample(sample);
      pushLatestSample(sample as TrafficSample);
      if (sample.eventType) {
        this.db.insertEvent(
          sample.eventType,
          iface,
          `${iface} emitted ${sample.eventType}`,
        );
      }
    }
  }
}
