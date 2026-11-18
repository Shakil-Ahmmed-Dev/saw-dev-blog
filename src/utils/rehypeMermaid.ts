import { createHash } from "node:crypto";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration, AstroIntegrationLogger } from "astro";
import { renderMermaidSVG } from "beautiful-mermaid";
import { fromHtml } from "hast-util-from-html";

interface MermaidRuntimeState {
  rootDir: string;
  command: "dev" | "build" | "preview" | "sync";
  logger?: AstroIntegrationLogger;
}

const runtimeState: MermaidRuntimeState = {
  rootDir: process.cwd(),
  command: "build",
};

export interface RehypeMermaidOptions {
  /**
   * Throw an error when a Mermaid diagram fails to render (syntax error or
   * unsupported diagram type). Defaults to `true` during `astro build` and
   * `false` during `astro dev` (which renders an inline error banner instead).
   */
  strict?: boolean;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface VFileLike {
  path?: string;
  history?: string[];
}

function formatRelPath(vfile: VFileLike): string {
  const raw = vfile.path ?? vfile.history?.[0];
  if (!raw) return "<unknown file>";
  const fsPath = raw.startsWith("file://") ? fileURLToPath(raw) : raw;
  return relative(runtimeState.rootDir, fsPath).replace(/\\/g, "/");
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (!Array.isArray(node.children)) return "";
  return node.children.map(textOf).join("");
}

function getProperty(
  props: Record<string, unknown> | undefined,
  ...keys: string[]
): unknown {
  if (!props) return undefined;
  for (const key of keys) {
    if (props[key] !== undefined) return props[key];
  }
  return undefined;
}

function isMermaidPre(node: HastNode): boolean {
  if (node.type !== "element" || node.tagName !== "pre") return false;

  const lang = getProperty(node.properties, "dataLanguage", "data-language");
  if (lang === "mermaid") return true;

  const code = node.children?.find(
    child => child.type === "element" && child.tagName === "code"
  );
  const classes = code?.properties?.className;
  if (Array.isArray(classes) && classes.includes("language-mermaid")) {
    return true;
  }

  return false;
}

function extractCaption(pre: HastNode): string | undefined {
  const props = pre.properties;
  if (!props) return undefined;

  const raw = getProperty(props, "dataMermaidCaption", "data-mermaid-caption");
  delete props.dataMermaidCaption;
  delete props["data-mermaid-caption"];

  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function makePrefix(source: string, index: number): string {
  const hash = createHash("sha1").update(source).digest("hex").slice(0, 6);
  return `mmd-${index}-${hash}-`;
}

function prefixSvgIds(node: HastNode, prefix: string): void {
  const props = node.properties;
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (typeof val !== "string") continue;
      if (key === "id") {
        props[key] = `${prefix}${val}`;
      } else if (val.includes("url(#")) {
        props[key] = val.replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`);
      } else if (
        (key === "href" || key === "xlinkHref" || key === "xlink:href") &&
        val.startsWith("#")
      ) {
        props[key] = `#${prefix}${val.slice(1)}`;
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      prefixSvgIds(child, prefix);
    }
  }
}

function prepareSvgHast(
  svgString: string,
  prefix: string,
  caption?: string
): HastNode {
  const fragment = fromHtml(svgString, {
    fragment: true,
    space: "svg",
  }) as unknown as HastNode;

  const svgNode = fragment.children?.find(
    child => child.type === "element" && child.tagName === "svg"
  );

  if (!svgNode) {
    throw new Error("beautiful-mermaid returned empty SVG output.");
  }

  // Strip the per-SVG <style> block injected by beautiful-mermaid:
  // 1) avoids external Google Fonts @import requests (site already self-hosts Google Sans Code)
  // 2) avoids unscoped global `svg { ... }` / `text { ... }` rules leaking outside diagrams
  // All derived CSS variables and typography rules live scoped under `.mermaid-diagram-svg`
  // in src/styles/typography.css.
  if (Array.isArray(svgNode.children)) {
    svgNode.children = svgNode.children.filter(
      child => !(child.type === "element" && child.tagName === "style")
    );
  }

  prefixSvgIds(svgNode, prefix);

  svgNode.properties ??= {};
  const existingClass = svgNode.properties.className;
  const classes = Array.isArray(existingClass)
    ? [...existingClass, "mermaid-diagram-svg"]
    : typeof existingClass === "string"
      ? [existingClass, "mermaid-diagram-svg"]
      : ["mermaid-diagram-svg"];
  svgNode.properties.className = classes;
  svgNode.properties.role = "img";
  svgNode.properties.ariaLabel = caption
    ? `Mermaid diagram: ${caption}`
    : "Mermaid diagram";

  return svgNode;
}

function svgIcon(paths: HastNode[], className: string): HastNode {
  return {
    type: "element",
    tagName: "svg",
    properties: {
      xmlns: "http://www.w3.org/2000/svg",
      width: 16,
      height: 16,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ariaHidden: "true",
      className: [className],
    },
    children: paths,
  };
}

function buildCopyButton(): HastNode {
  const copyIcon = svgIcon(
    [
      {
        type: "element",
        tagName: "rect",
        properties: { x: 8, y: 8, width: 12, height: 12, rx: 2 },
        children: [],
      },
      {
        type: "element",
        tagName: "path",
        properties: {
          d: "M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2",
        },
        children: [],
      },
    ],
    "mermaid-icon-copy"
  );

  const checkIcon = svgIcon(
    [
      {
        type: "element",
        tagName: "path",
        properties: { d: "M5 12l5 5l10 -10" },
        children: [],
      },
    ],
    "mermaid-icon-check"
  );

  return {
    type: "element",
    tagName: "button",
    properties: {
      type: "button",
      className: ["mermaid-copy-btn"],
      dataMermaidCopy: "",
      ariaLabel: "Copy Mermaid source",
      title: "Copy Mermaid source",
    },
    children: [copyIcon, checkIcon],
  };
}

function markSourcePre(pre: HastNode): HastNode {
  pre.properties ??= {};
  pre.properties.dataMermaidSource = "";
  pre.properties.tabIndex = 0;
  return pre;
}

function buildDiagramFigure(
  svgNode: HastNode,
  sourcePre: HastNode,
  caption?: string
): HastNode {
  const children: HastNode[] = [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-header"],
        dataPagefindIgnore: "",
      },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["mermaid-label"] },
          children: [{ type: "text", value: "mermaid" }],
        },
        {
          type: "element",
          tagName: "div",
          properties: {
            className: ["mermaid-toggle"],
            role: "group",
            ariaLabel: "Mermaid view mode",
          },
          children: [
            {
              type: "element",
              tagName: "button",
              properties: {
                type: "button",
                className: ["mermaid-toggle-btn"],
                dataMermaidTab: "diagram",
                ariaPressed: "true",
              },
              children: [{ type: "text", value: "Diagram" }],
            },
            {
              type: "element",
              tagName: "button",
              properties: {
                type: "button",
                className: ["mermaid-toggle-btn"],
                dataMermaidTab: "source",
                ariaPressed: "false",
              },
              children: [{ type: "text", value: "Source" }],
            },
          ],
        },
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-panel-diagram"],
        tabIndex: 0,
      },
      children: [svgNode],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-panel-source"],
        hidden: true,
        dataPagefindIgnore: "",
      },
      children: [buildCopyButton(), markSourcePre(sourcePre)],
    },
  ];

  if (caption) {
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: { className: ["mermaid-caption"] },
      children: [{ type: "text", value: caption }],
    });
  }

  return {
    type: "element",
    tagName: "figure",
    properties: {
      className: ["mermaid-diagram"],
      dataMermaidView: "diagram",
    },
    children,
  };
}

function buildDevErrorFigure(
  errorMessage: string,
  sourcePre: HastNode,
  caption?: string
): HastNode {
  const children: HastNode[] = [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-error-banner"],
        role: "alert",
      },
      children: [
        {
          type: "element",
          tagName: "strong",
          properties: {},
          children: [{ type: "text", value: "Mermaid render error: " }],
        },
        { type: "text", value: errorMessage },
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-panel-source"],
      },
      children: [buildCopyButton(), markSourcePre(sourcePre)],
    },
  ];

  if (caption) {
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: { className: ["mermaid-caption"] },
      children: [{ type: "text", value: caption }],
    });
  }

  return {
    type: "element",
    tagName: "figure",
    properties: {
      className: ["mermaid-diagram", "mermaid-error"],
      dataPagefindIgnore: "",
    },
    children,
  };
}

/**
 * Astro integration that captures project config (`root`, `command`, `logger`)
 * for `rehypeMermaid`, enabling strict build-time failures in production and
 * inline error banners during `astro dev`.
 */
export function mermaidIntegration(): AstroIntegration {
  return {
    name: "astro-paper:mermaid",
    hooks: {
      "astro:config:setup": ({ config, command, logger }) => {
        runtimeState.rootDir = fileURLToPath(config.root);
        runtimeState.command = command;
        runtimeState.logger = logger;
      },
    },
  };
}

/**
 * Rehype plugin that renders fenced ```mermaid blocks at build time using
 * `beautiful-mermaid` into CSS-variable-themed inline SVGs with a
 * Diagram / Source toggle and floating copy icon button.
 */
export function rehypeMermaid(options: RehypeMermaidOptions = {}) {
  return (tree: HastNode, vfile: VFileLike) => {
    const strict = options.strict ?? runtimeState.command === "build";
    const relPath = formatRelPath(vfile);
    let diagramIndex = 0;

    const transform = (node: HastNode) => {
      if (!Array.isArray(node.children)) return;

      node.children = node.children.map(child => {
        if (!isMermaidPre(child)) {
          transform(child);
          return child;
        }

        const codeNode = child.children?.find(
          c => c.type === "element" && c.tagName === "code"
        );
        const source = (codeNode ? textOf(codeNode) : textOf(child)).trim();
        const caption = extractCaption(child);

        if (!source) {
          return child;
        }

        try {
          const svgString = renderMermaidSVG(source, {
            bg: "var(--background)",
            fg: "var(--foreground)",
            accent: "var(--accent)",
            muted: "var(--muted-foreground)",
            surface: "color-mix(in srgb, var(--muted) 40%, var(--background))",
            border:
              "color-mix(in srgb, var(--foreground) 24%, var(--background))",
            font: "Google Sans Code",
            transparent: true,
          });

          const prefix = makePrefix(source, diagramIndex++);
          const svgNode = prepareSvgHast(svgString, prefix, caption);
          return buildDiagramFigure(svgNode, child, caption);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const msg = `Mermaid diagram failed in ${relPath}: ${reason}`;
          if (strict) {
            throw new Error(msg, { cause: err });
          }
          runtimeState.logger?.warn(msg);
          return buildDevErrorFigure(reason, child, caption);
        }
      });
    };

    transform(tree);
  };
}
