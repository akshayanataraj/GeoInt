import { cn } from "@geolibre/ui";
import type { ReactNode } from "react";
import type { Citation } from "../../lib/intel/contracts";

/**
 * Renders a model answer as text, with `[n]` citation markers turned into
 * interactive references.
 *
 * The service documents `answer` as Markdown, and this deliberately does not
 * render it as such. An answer is model-generated text built from retrieved
 * third-party documents, so it is untrusted input: putting it through a Markdown
 * renderer into `innerHTML` is a cross-site-scripting vector, and doing that
 * with a *citation-carrying intelligence answer* is worse than usual, because a
 * successful injection could also forge or rewrite the provenance the analyst is
 * relying on. There is no Markdown dependency in this repository today and
 * adding one is not a decision to make silently.
 *
 * So: paragraphs are split on blank lines, everything else is rendered as plain
 * text through React (which escapes it), and no HTML is ever constructed. When
 * real Markdown is wanted, it needs a renderer that produces a sanitised node
 * tree -- never an HTML string -- with an allowlist that excludes raw HTML.
 *
 * Citation markers are parsed out of the text rather than taken from a separate
 * offset list, because the contract provides no offsets. Only markers whose
 * number matches a citation in `citations` become references; anything else is
 * left as literal text, so a hallucinated `[9]` with no ninth source shows up as
 * exactly that instead of a dead link.
 */
export interface AnswerTextProps {
  text: string;
  citations: readonly Citation[];
  /** Called with a citation id when its marker is activated. */
  onCitationClick?: (id: string) => void;
  className?: string;
}

export function AnswerText({ text, citations, onCitationClick, className }: AnswerTextProps) {
  const paragraphs = text.split(/\n{2,}/).filter((block) => block.trim().length > 0);

  return (
    <div className={cn("space-y-2 text-xs leading-relaxed text-foreground", className)}>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{linkifyCitations(paragraph, citations, onCitationClick)}</p>
      ))}
    </div>
  );
}

/**
 * Splits a paragraph into text runs and citation-marker buttons.
 *
 * `[12]` is matched before `[1]` naturally because the pattern is greedy on
 * digits, so a two-digit marker is never truncated into a one-digit one.
 */
function linkifyCitations(
  paragraph: string,
  citations: readonly Citation[],
  onCitationClick?: (id: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[(\d+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(paragraph)) !== null) {
    const id = match[1];
    const known = citations.some((citation) => citation.id === id);
    if (match.index > cursor) {
      nodes.push(paragraph.slice(cursor, match.index));
    }
    if (known) {
      nodes.push(
        <button
          key={`${id}-${match.index}`}
          type="button"
          onClick={() => onCitationClick?.(id)}
          aria-label={`Source ${id}`}
          className="intel-numeral mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25"
        >
          {id}
        </button>,
      );
    } else {
      // Unmatched marker: keep it verbatim so an answer citing a source it did
      // not return is visible as such rather than quietly cleaned up.
      nodes.push(match[0]);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < paragraph.length) {
    nodes.push(paragraph.slice(cursor));
  }
  return nodes;
}
