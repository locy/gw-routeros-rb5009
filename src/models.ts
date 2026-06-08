export type InterfaceCounters = {
  interface: string;
  timestamp: Date;
  rxBytes: number;
  txBytes: number;
  linkUp: boolean;
  rxErrors: number;
  txErrors: number;
};

export type TrafficSample = {
  interface: string;
  timestamp: Date;
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  linkUp: boolean;
  valid: boolean;
  eventType?: "counter_reset" | "invalid_interval" | "link_down" | "link_up" | "traffic_spike_down" | "traffic_spike_up" | "poll_delay";
};

export type DeviceIdentity = {
  ipAddress: string;
  macAddress: string;
  hostname?: string;
  source: "arp" | "dhcp" | "traffic_flow";
  lastSeen: Date;
};
