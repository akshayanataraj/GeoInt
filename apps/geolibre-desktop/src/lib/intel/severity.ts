/**
 * Severity → class-name mapping.
 *
 * A lookup table rather than string interpolation (`intel-sev-${severity}`)
 * because Tailwind's scanner only sees class names that appear literally in the
 * source. An interpolated name is not emitted into the stylesheet at all, so the
 * colour silently disappears in a production build while working in dev.
 */

import type { Severity } from "./s2-contracts";

const TEXT: Readonly<Record<Severity, string>> = {
  routine: "intel-sev-routine",
  elevated: "intel-sev-elevated",
  high: "intel-sev-high",
  critical: "intel-sev-critical",
};

const BG: Readonly<Record<Severity, string>> = {
  routine: "intel-sev-bg-routine",
  elevated: "intel-sev-bg-elevated",
  high: "intel-sev-bg-high",
  critical: "intel-sev-bg-critical",
};

export function severityText(severity: Severity): string {
  return TEXT[severity];
}

export function severityBg(severity: Severity): string {
  return BG[severity];
}

/** Sentence-case label for display. */
export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
