const CAPTION_RE = /(?:^|\s)caption=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/;

interface MermaidCaptionContext {
  options: {
    lang?: string;
    meta?: {
      __raw?: string;
    };
  };
}

interface HastElementLike {
  properties: Record<string, unknown>;
}

/**
 * Shiki transformer that extracts an optional `caption="..."` attribute from
 * ```mermaid fenced code block metadata and stores it on `<pre>` as
 * `data-mermaid-caption` before Shiki discards raw meta.
 */
export const transformerMermaidCaption = () => ({
  name: "astro-paper:mermaid-caption",
  pre(this: MermaidCaptionContext, node: HastElementLike) {
    if (this.options.lang !== "mermaid") return;
    const rawMeta = this.options.meta?.__raw;
    if (!rawMeta) return;

    const match = CAPTION_RE.exec(rawMeta);
    const caption = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
    if (!caption) return;

    node.properties["data-mermaid-caption"] = caption;
  },
});
