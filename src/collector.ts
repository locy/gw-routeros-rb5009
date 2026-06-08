import type { DatabaseWrapper, TrafficSample } from "./db.ts";
import type { InterfaceCounters, LinkState } from "./models.ts";
import type { RouterOSClient } from "./routeros.ts";
import { calculateRate } from "./traffic.ts";
import { pushLatestSample } from "./api.ts";

// Traffic spike threshold: > 100 Mbps
const SPIKE_THRESHOLD_BPS = 100_000_000;

// Poll delay warning: > 15 seconds between polls
const POLL_DELAY_THRESHOLD = 15;

export class Collector {
  private previous = new Map<string, InterfaceCounters>();
  private linkStates = new Map<string, boolean>();
  private lastPollTime = Date.now(); // Don't report poll_delay on first poll

  constructor(
    private readonly client: RouterOSClient,
    private readonly db: DatabaseWrapper,
    private readonly interfaces: string[],
  ) {}

  async pollOnce(): Promise<void> {
    const now = Date.now();
    const pollDelay = now - this.lastPollTime;
    this.lastPollTime = now;

    // Check poll delay
    if (this.lastPollTime > 0 && pollDelay > POLL_DELAY_THRESHOLD * 1000) {
      this.db.insertEvent(
        "poll_delay",
        null,
        `Poll delayed ${Math.round(pollDelay / 1000)}s`,
      );
    }

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

      // Detect link state change
      const oldLinkUp = this.linkStates.get(iface);
      if (oldLinkUp !== undefined && oldLinkUp !== current.linkUp) {
        const eventType = current.linkUp ? "link_up" : "link_down";
        this.db.insertEvent(eventType, iface, `${iface} link ${current.linkUp ? "up" : "down"}`);
        this.linkStates.set(iface, current.linkUp);
      } else if (oldLinkUp === undefined) {
        this.linkStates.set(iface, current.linkUp);
      }

      const sample = calculateRate(previous, current);
      this.db.insertSample(sample);
      pushLatestSample(sample as TrafficSample);

      // Detect traffic spikes
      if (sample.rxBps > SPIKE_THRESHOLD_BPS) {
        this.db.insertEvent(
          "traffic_spike_down",
          iface,
          `${iface} download spike: ${(sample.rxBps / 1_000_000).toFixed(0)} Mbps`,
        );
      }
      if (sample.txBps > SPIKE_THRESHOLD_BPS) {
        this.db.insertEvent(
          "traffic_spike_up",
          iface,
          `${iface} upload spike: ${(sample.txBps / 1_000_000).toFixed(0)} Mbps`,
        );
      }

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
