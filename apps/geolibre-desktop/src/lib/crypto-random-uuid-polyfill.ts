/**
 * `crypto.randomUUID` is a secure-context-only convenience method: browsers
 * expose `crypto` everywhere but only attach `randomUUID` on https/localhost
 * origins. A self-hosted GeoLibre served over plain http on a LAN address is
 * not a secure context, yet bundled dependencies (e.g. `@strands-agents/sdk`,
 * used by the AI Assistant's tool-calling loop) call `globalThis.crypto.
 * randomUUID()` unconditionally, so this must run before anything that could
 * reach that code — hence the import order in main.tsx. `crypto.
 * getRandomValues` has no such restriction, so it can build a spec-shaped
 * v4 UUID as the fallback rather than just a session-unique string.
 */
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: (): string => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
      ].join("-");
    },
  });
}
