import type { InterfaceCounters, TrafficSample } from "./models.ts";

export function calculateRate(
  previous: InterfaceCounters,
  current: InterfaceCounters,
): TrafficSample {
  const elapsedSeconds =
    (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000;
  const base = {
    interface: current.interface,
    timestamp: current.timestamp,
    rxBytes: current.rxBytes,
    txBytes: current.txBytes,
    linkUp: current.linkUp,
  };

  if (elapsedSeconds <= 0) {
    return {
      ...base,
      rxBps: 0,
      txBps: 0,
      valid: false,
      eventType: "invalid_interval",
    };
  }

  const rxDelta = current.rxBytes - previous.rxBytes;
  const txDelta = current.txBytes - previous.txBytes;
  if (rxDelta < 0 || txDelta < 0) {
    return {
      ...base,
      rxBps: 0,
      txBps: 0,
      valid: false,
      eventType: "counter_reset",
    };
  }

  return {
    ...base,
    rxBps: Math.trunc((rxDelta * 8) / elapsedSeconds),
    txBps: Math.trunc((txDelta * 8) / elapsedSeconds),
    valid: true,
  };
}
