// Wie haalt de AH-bonnetjes op? Bij voorkeur de browser-extensie (voor
// iedereen); anders, als hij draait, de lokale ontwikkelhelper ah_bridge.py.

import * as bridge from "./ahBridge";
import * as ext from "./ahExtension";

export interface Connector {
  kind: "extension" | "bridge";
  getStatus(account: string): Promise<{ loggedIn: boolean }>;
  openLogin(account: string): Promise<void>;
  logout(account: string): Promise<void>;
  fetchReceipts(
    account: string,
    knownIds: string[],
    onProgress: (done: number, total: number) => void,
  ): Promise<{ receipts: unknown[]; error?: string }>;
}

const extension: Connector = { kind: "extension", ...ext };
const localBridge: Connector = {
  kind: "bridge",
  getStatus: bridge.getStatus,
  openLogin: (account) => bridge.openLogin(account),
  logout: bridge.logout,
  fetchReceipts: bridge.fetchReceipts,
};

export async function detectConnector(): Promise<Connector | null> {
  if (await ext.isInstalled()) return extension;
  try {
    await bridge.getStatus("");
    return localBridge;
  } catch {
    return null;
  }
}
