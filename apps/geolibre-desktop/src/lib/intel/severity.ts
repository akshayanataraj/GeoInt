/**
 * S2 tier → class-name mapping.
 *
 * A lookup table rather than string interpolation (`intel-tier-${tier}`)
 * because Tailwind's scanner only sees class names that appear literally in
 * the source. An interpolated name is not emitted into the stylesheet at all,
 * so the colour silently disappears in a production build while working in
 * dev.
 *
 * Chat's own `EventSeverity` (`info`/`warning`/`critical`, in
 * `ChatMapPlayback.tsx`) is a different, coarser vocabulary and keeps its own
 * inline mapping -- not reused here even though both ultimately land on the
 * same `--status-*` tokens, per that file's own docstring on why the two
 * domain concepts stay separate.
 */

import type { S2Tier } from "./s2-contracts";

const TEXT: Readonly<Record<S2Tier, string>> = {
  green: "intel-tier-green",
  yellow: "intel-tier-yellow",
  red: "intel-tier-red",
};

const BG: Readonly<Record<S2Tier, string>> = {
  green: "intel-tier-bg-green",
  yellow: "intel-tier-bg-yellow",
  red: "intel-tier-bg-red",
};

export function tierText(tier: S2Tier): string {
  return TEXT[tier];
}

export function tierBg(tier: S2Tier): string {
  return BG[tier];
}

/** Sentence-case label for display. */
export function tierLabel(tier: S2Tier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
