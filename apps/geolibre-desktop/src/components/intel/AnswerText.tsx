import { cn } from "@geolibre/ui";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "../../lib/intel/contracts";

/**
 * Renders a model answer as real, formatted Markdown -- headings, bold,
 * lists, tables -- with News's inline `[C1]`, `[C2]`, … citation markers
 * turned into interactive references.
 *
 * The service documents `answer` as Markdown (headings/bold/lists show up in
 * real answers -- e.g. `### Security Situation`, `**Senapati District:**`),
 * and an earlier version of this component deliberately rendered it as plain
 * text instead, because an answer is model-generated text built from
 * retrieved third-party documents -- untrusted input -- and a naive Markdown
 * renderer piping into `dangerouslySetInnerHTML` is a real XSS vector, worse
 * than usual here because a successful injection could also forge or rewrite
 * the citation provenance an analyst is relying on.
 *
 * `react-markdown` is the renderer that resolves that tradeoff rather than
 * reopening it: it parses Markdown to a plain React element tree and never
 * touches `innerHTML` internally, and -- this is the part that must never
 * change -- it does **not** interpret raw HTML embedded in the answer text
 * by default. `rehype-raw` is the plugin that would turn that raw-HTML
 * passthrough back on; do not add it here. If GFM autolinking or another
 * remark/rehype plugin is added later, verify it does not introduce an HTML
 * passthrough path before merging.
 *
 * ## Citation markers: the doc id join, not the marker number
 *
 * `answer` already ends with an appended `Sources` block, itself a list of
 * working Markdown links (`MEDIA_SERVICE_FRONTEND_INTEGRATION_GUIDE.md`
 * §11.2) -- rendering the Markdown as-is would already give clickable
 * sources for free. This component instead turns each inline `[Cn]` into a
 * small interactive chip, because `IntelChatPanel` wants a click to scroll to
 * and highlight the matching entry in its own citation list below, which a
 * plain Markdown link cannot drive.
 *
 * The guide is explicit that **`citations[n-1]` is not `[Cn]`**:
 * `ChatResponse.citations` is projected from `evidence_doc_ids` (prompt
 * order, the full evidence pool a synthesis prompt was given), not marker
 * order, so indexing it by the marker's number mis-attributes sources. The
 * reliable join is the doc id, and the `Sources` block is where marker and
 * doc id actually meet -- each line reads `- [Cn] [title](url) — chunks
 * <doc_id>[, <doc_id>…]`. So this parses that block once into a marker →
 * citation lookup (`buildMarkerCitations`) and only then rewrites the inline
 * markers in the body *above* it -- the `Sources` block itself is left
 * untouched, since it is already valid, working Markdown and rewriting its
 * own `[Cn]` prefixes a second time would just double the same information.
 *
 * Cases this handles, all of which occur in real answers (guide §11.2):
 * a marker with no matching `Sources` line (left as inert literal text, not a
 * dead chip), no `Sources` block at all (nothing is rewritten, so the answer
 * still renders correctly as Markdown, just without chips), and one marker
 * whose `Sources` line lists several doc ids for the same source (one chip,
 * bound to whichever of those ids is actually present in `citations`).
 */
export interface AnswerTextProps {
  text: string;
  citations: readonly Citation[];
  /** Called with a citation id when its marker is activated. */
  onCitationClick?: (id: string) => void;
  className?: string;
}

const CITATION_URI_SCHEME = "citation:";

/** A bare `Sources` paragraph -- the appended block's own heading line, per the guide's example. Not a `##` heading; matched as its own full line. */
const SOURCES_LINE_RE = /^Sources[ \t]*$/m;

/** One `Sources` bullet: `- [C3] [title](url) — chunks doc-a, doc-b`. Captures the marker number and the trailing comma-separated doc id list. */
const SOURCE_ENTRY_RE = /^-\s*\[C(\d+)\].*?—\s*chunks\s+(.+)$/gim;

const INLINE_MARKER_RE = /\[C(\d+)\]/g;

/** Splits `answer` at its first bare `Sources` line so the marker rewrite below only ever touches the prose above it, never the Sources block itself. */
function splitAtSourcesBlock(text: string): { body: string; sourcesBlock: string } {
  const match = SOURCES_LINE_RE.exec(text);
  if (!match) return { body: text, sourcesBlock: "" };
  return { body: text.slice(0, match.index), sourcesBlock: text.slice(match.index) };
}

/** Parses a `Sources` block into marker number -> the doc ids on that line, per `SOURCE_ENTRY_RE`. */
function parseSourceDocIds(sourcesBlock: string): Map<string, string[]> {
  const markerDocIds = new Map<string, string[]>();
  for (const match of sourcesBlock.matchAll(SOURCE_ENTRY_RE)) {
    const docIds = match[2]
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    markerDocIds.set(match[1], docIds);
  }
  return markerDocIds;
}

/**
 * Resolves each inline marker to a citation via the `Sources` block's doc id
 * list, keyed by the marker number as it appears in the *body* (e.g. `"1"`
 * for `[C1]`) -- this is the lookup `withCitationLinks` rewrites against, and
 * the same one a caller could use to pre-validate which markers actually
 * resolve before rendering.
 */
function buildMarkerCitations(
  sourcesBlock: string,
  citations: readonly Citation[],
): Map<string, Citation> {
  const citationsById = new Map(citations.map((citation) => [citation.id, citation]));
  const markerDocIds = parseSourceDocIds(sourcesBlock);
  const markerCitations = new Map<string, Citation>();
  for (const [marker, docIds] of markerDocIds) {
    const citation = docIds.map((id) => citationsById.get(id)).find((found) => found !== undefined);
    if (citation) markerCitations.set(marker, citation);
  }
  return markerCitations;
}

/**
 * Rewrites `[Cn]` into `[n](citation:<citationId>)` for every marker that
 * resolves to a citation via `buildMarkerCitations`, so plain Markdown link
 * parsing does the rest; an unresolved marker is left as literal text (guide
 * §11.2's "a marker with no Sources line: render the marker inertly").
 * Applied to `body` only -- see this module's docstring for why the
 * `Sources` block itself is excluded.
 */
function withCitationLinks(body: string, markerCitations: ReadonlyMap<string, Citation>): string {
  if (markerCitations.size === 0) return body;
  return body.replace(INLINE_MARKER_RE, (match, marker: string) => {
    const citation = markerCitations.get(marker);
    return citation ? `[${marker}](${CITATION_URI_SCHEME}${encodeURIComponent(citation.id)})` : match;
  });
}

function CitationButton({
  marker,
  onClick,
}: {
  marker: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Source ${marker}`}
      className="intel-numeral mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25"
    >
      {marker}
    </button>
  );
}

export function AnswerText({ text, citations, onCitationClick, className }: AnswerTextProps) {
  const { body, sourcesBlock } = splitAtSourcesBlock(text);
  const markerCitations =
    citations.length > 0 ? buildMarkerCitations(sourcesBlock, citations) : new Map<string, Citation>();
  const renderedText = withCitationLinks(body, markerCitations) + sourcesBlock;

  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith(CITATION_URI_SCHEME)) {
        const citationId = decodeURIComponent(href.slice(CITATION_URI_SCHEME.length));
        // `children` is the marker text `withCitationLinks` set as the link
        // label (e.g. `"3"` for `[C3]`) -- reused as-is rather than looked up
        // again, since it is already exactly what the chip should display.
        return (
          <CitationButton
            marker={String(children)}
            onClick={() => onCitationClick?.(citationId)}
          />
        );
      }
      // A real link in the answer body (not a citation marker) -- rare, but
      // handled safely rather than assumed away.
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-xs font-semibold text-foreground first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-semibold text-foreground first:mt-0">{children}</h4>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-2 ms-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 ms-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    code: ({ children }) => (
      <code className="intel-numeral rounded bg-background/60 px-1 py-0.5 text-[11px]">{children}</code>
    ),
    blockquote: ({ children }) => (
      <blockquote className="intel-hairline my-2 border-s-2 ps-2 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="intel-hairline my-2 border-t" />,
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="intel-hairline border-b px-1.5 py-1 text-start font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }) => <td className="intel-hairline border-b px-1.5 py-1 align-top">{children}</td>,
  };

  return (
    <div className={cn("text-xs leading-relaxed text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}
