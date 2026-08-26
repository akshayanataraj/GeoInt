import { cn } from "@geolibre/ui";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "../../lib/intel/contracts";

/**
 * Renders a model answer as real, formatted Markdown -- headings, bold,
 * lists, tables -- with `[n]` citation markers turned into interactive
 * references.
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
 * Citation markers are handled by pre-rewriting bare `[n]` markers into real
 * Markdown links (`[n](citation:n)`) before parsing, then intercepting the
 * `citation:` scheme in the `a` component override below -- this reuses
 * Markdown's own link syntax and `react-markdown`'s own extension point
 * instead of a custom remark plugin. Only markers whose number matches a
 * citation in `citations` are rewritten; anything else is left as literal
 * `[n]` text, so a hallucinated `[9]` with no ninth source shows up as
 * exactly that instead of a dead link.
 */
export interface AnswerTextProps {
  text: string;
  citations: readonly Citation[];
  /** Called with a citation id when its marker is activated. */
  onCitationClick?: (id: string) => void;
  className?: string;
}

const CITATION_URI_SCHEME = "citation:";

/**
 * Rewrites `[n]` into `[n](citation:n)` for every `n` that matches a known
 * citation id, so plain Markdown link parsing does the rest. The negative
 * lookahead (`(?!\()`) skips a marker already followed by `(` -- an answer
 * that happens to already contain a real Markdown link shaped like `[1](https://…)`
 * is left alone rather than double-wrapped.
 *
 * Known limitation: this is a string-level rewrite done *before* Markdown
 * parsing, so it does not know about fenced/inline code spans -- a literal
 * `[1]` inside a code block would also be rewritten. Not worth a full
 * Markdown-aware tokenizer for citation markers that only ever appear in
 * prose in practice.
 */
function withCitationLinks(text: string, citations: readonly Citation[]): string {
  if (citations.length === 0) return text;
  const knownIds = new Set(citations.map((citation) => citation.id));
  return text.replace(/\[(\d+)\](?!\()/g, (match, id: string) =>
    knownIds.has(id) ? `[${id}](${CITATION_URI_SCHEME}${id})` : match,
  );
}

function CitationButton({ id, onCitationClick }: { id: string; onCitationClick?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCitationClick?.(id)}
      aria-label={`Source ${id}`}
      className="intel-numeral mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary/15 px-1 align-baseline text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25"
    >
      {id}
    </button>
  );
}

export function AnswerText({ text, citations, onCitationClick, className }: AnswerTextProps) {
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith(CITATION_URI_SCHEME)) {
        return <CitationButton id={href.slice(CITATION_URI_SCHEME.length)} onCitationClick={onCitationClick} />;
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
        {withCitationLinks(text, citations)}
      </ReactMarkdown>
    </div>
  );
}
