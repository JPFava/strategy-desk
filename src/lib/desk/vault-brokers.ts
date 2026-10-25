export const BROKER_IDS = ["alpaca", "schwab", "etrade", "ibkr"] as const;
export type BrokerId = (typeof BROKER_IDS)[number];

export type BrokerField = {
  id: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  long?: boolean;
};

export type BrokerChoice = {
  id: BrokerId;
  name: string;
  blurb: string;
  limitation: string;
  fields: BrokerField[];
};

export const BROKERS: BrokerChoice[] = [
  {
    id: "alpaca",
    name: "Alpaca",
    blurb: "Paste the key and secret from the paper account or the live account. They are not the same pair.",
    limitation: "A paper key only talks to the paper account. Uncheck this only when you paste the live key. Live orders also need the live key file, and they are real money.",
    fields: [
      { id: "keyId", label: "API key" },
      { id: "secret", label: "API secret", secret: true, long: true },
    ],
  },
  {
    id: "schwab",
    name: "Charles Schwab",
    blurb: "Paste the app key and secret from your own Schwab developer app. The refresh token is optional until the brokerage page gives you one.",
    limitation: "The refresh token dies in about 7 days, and you have to approve it again in a browser. There is no separate paper API. Thinkorswim paperMoney is not this key.",
    fields: [
      { id: "appKey", label: "App key" },
      { id: "secret", label: "App secret", secret: true, long: true },
      { id: "refreshToken", label: "Refresh token", secret: true, optional: true, long: true },
    ],
  },
  {
    id: "etrade",
    name: "E*TRADE",
    blurb: "Paste the consumer key and secret. The access token is optional. Sandbox keys and live keys are different.",
    limitation: "An access token dies at midnight Eastern. If nothing calls the broker for 2 hours, the token goes idle and has to be renewed. This desk does not renew it yet.",
    fields: [
      { id: "consumerKey", label: "Consumer key" },
      { id: "consumerSecret", label: "Consumer secret", secret: true, long: true },
      { id: "accessToken", label: "Access token", secret: true, optional: true, long: true },
      { id: "accessSecret", label: "Access secret", secret: true, optional: true, long: true },
    ],
  },
  {
    id: "ibkr",
    name: "Interactive Brokers",
    blurb: "Store the account id and the gateway address. Do not type the brokerage password here. Paper and live are different usernames at the gateway.",
    limitation: "The gateway program on this computer has to be logged in. That session does not last through the night by itself. Lite is $0 stock commission for a US resident. Pro is not.",
    fields: [
      { id: "accountId", label: "Account id" },
      { id: "gateway", label: "Gateway address" },
    ],
  },
];

export function brokerById(id: string): BrokerChoice | null {
  return BROKERS.find((broker) => broker.id === id) ?? null;
}

export function cleanEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 80);
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
