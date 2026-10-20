export type ProxyInfo = {
  all?: string[];
  now?: string;
  type?: string;
  udp?: boolean;
  icon?: string;
  history?: { delay: number }[];
};
export type ProxyDelay = {
  state: "testing" | "success" | "error";
  delay?: number;
  message?: string;
};
