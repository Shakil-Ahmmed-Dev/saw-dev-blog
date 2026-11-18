import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import type { AstroIntegration, AstroIntegrationLogger } from "astro";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { getPostSlugPath, POSTS_CONTENT_DIR } from "./postSlugPath";
import { resolveTimezone } from "./resolveTimezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const POSTS_ALIAS_PREFIX = "@/posts/";
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const MARKDOWN_EXT_RE = /\.mdx?$/i;
const MDX_LINK_COMPONENTS = new Set(["a", "Link"]);

interface PostLinksRuntimeState {
  rootDir: string;
  base: string;
  trailingSlash: "always" | "never" | "ignore";
  localePrefix: string;
  command: "dev" | "build" | "preview" | "sync";
  siteTimezone: string;
  logger?: AstroIntegrationLogger;
}

const runtimeState: PostLinksRuntimeState = {
  rootDir: process.cwd(),
  base: "/",
  trailingSlash: "ignore",
  localePrefix: "",
  command: "build",
  siteTimezone: "UTC",
};

export interface PostLinksIntegrationOptions {
  /** Site timezone from `astro-paper.config.ts` for scheduled-post checks. */
  siteTimezone?: string;
}

export interface RehypePostLinksOptions {
  /**
   * Throw an error on broken post links instead of logging a warning.
   * Defaults to `true` during `astro build` and `false` during `astro dev`.
   */
  strict?: boolean;
  /**
   * Warn when a published post links to a draft or future-scheduled post.
   * Defaults to `true`.
   */
  warnOnUnpublished?: boolean;
}

interface MdxJsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

interface HastNode {
  type: string;
  tagName?: string;
  name?: string;
  properties?: Record<string, unknown>;
  attributes?: MdxJsxAttribute[];
  children?: HastNode[];
}

interface VFileLike {
  path?: string;
  history?: string[];
  data?: {
    astro?: {
      frontmatter?: Record<string, unknown>;
    };
  };
}

function toFilesystemPath(
  raw: string | URL | undefined,
  rootDir: string
): string | undefined {
  if (!raw) return undefined;
  if (raw instanceof URL) return fileURLToPath(raw);
  if (raw.startsWith("file://")) return fileURLToPath(raw);
  return isAbsolute(raw) ? raw : resolve(rootDir, raw);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isInsideDir(dir: string, filePath: string): boolean {
  const rel = relative(dir, filePath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function buildPostUrl(slugPath: string, suffix: string): string {
  const cleanBase = runtimeState.base.replace(/^\/+|\/+$/g, "");
  const basePrefix = cleanBase ? `/${cleanBase}` : "";
  const localePrefix = runtimeState.localePrefix;
  const trailing = runtimeState.trailingSlash === "never" ? "" : "/";
  return `${basePrefix}${localePrefix}/posts/${slugPath}${trailing}${suffix}`;
}

function readPostFrontmatter(
  filePath: string
): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(filePath, "utf8");
    return parseFrontmatter(raw).frontmatter;
  } catch {
    return undefined;
  }
}

function isScheduledFuturePost(frontmatter: Record<string, unknown>): boolean {
  const pub = frontmatter.pubDatetime;
  if (!pub) return false;
  const parsedDate = pub instanceof Date ? pub : new Date(String(pub));
  if (Number.isNaN(parsedDate.getTime())) return false;

  const postTz =
    typeof frontmatter.timezone === "string" && frontmatter.timezone
      ? frontmatter.timezone
      : runtimeState.siteTimezone;
  const tz = resolveTimezone(postTz);
  const publishDay = dayjs(parsedDate).tz(tz).startOf("day");
  const buildDay = dayjs().tz(tz).startOf("day");

  return publishDay.isAfter(buildDay);
}

function formatRelPath(filePath: string | undefined): string {
  if (!filePath) return "<unknown file>";
  return relative(runtimeState.rootDir, filePath).replace(/\\/g, "/");
}

function isSourceDraft(
  vfile: VFileLike,
  sourcePath: string | undefined
): boolean {
  const vfDraft = vfile.data?.astro?.frontmatter?.draft;
  if (typeof vfDraft === "boolean") return vfDraft;
  if (!sourcePath) return false;
  const fm = readPostFrontmatter(sourcePath);
  return fm?.draft === true;
}

function resolvePostHref(
  href: string,
  vfile: VFileLike,
  sourcePath: string | undefined,
  options: Required<RehypePostLinksOptions>
): string | undefined {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("?") ||
    href.startsWith("//") ||
    SCHEME_RE.test(href)
  ) {
    return undefined;
  }

  const parts = /^([^?#]+)([?#].*)?$/.exec(href);
  if (!parts) return undefined;

  const rawPathname = parts[1];
  const suffix = parts[2] ?? "";

  if (!MARKDOWN_EXT_RE.test(rawPathname)) {
    return undefined;
  }

  const isAlias = rawPathname.startsWith(POSTS_ALIAS_PREFIX);
  // Ignore root-relative site paths like "/posts/foo.md"
  if (!isAlias && rawPathname.startsWith("/")) {
    return undefined;
  }

  const postsDir = resolve(runtimeState.rootDir, POSTS_CONTENT_DIR);
  const decodedPathname = safeDecodeURIComponent(rawPathname);

  let targetPath: string;
  if (isAlias) {
    targetPath = resolve(
      postsDir,
      decodedPathname.slice(POSTS_ALIAS_PREFIX.length)
    );
  } else {
    if (!sourcePath) return undefined;
    targetPath = resolve(dirname(sourcePath), decodedPathname);
  }

  const insidePostsDir = isInsideDir(postsDir, targetPath);
  if (!insidePostsDir) {
    if (!isAlias) {
      // Relative link to a markdown file outside src/content/posts/ — leave untouched.
      return undefined;
    }
    const msg =
      `Invalid post link "${href}" in ${formatRelPath(sourcePath)}: ` +
      `target escapes ${POSTS_CONTENT_DIR}.`;
    if (options.strict) throw new Error(msg);
    runtimeState.logger?.warn(msg);
    return undefined;
  }

  const targetExists = existsSync(targetPath) && statSync(targetPath).isFile();
  const isIgnoredFile = basename(targetPath).startsWith("_");

  if (!targetExists || isIgnoredFile) {
    const reason = isIgnoredFile
      ? `files starting with "_" are excluded from the posts collection`
      : `file does not exist`;
    const msg =
      `Broken post link "${href}" in ${formatRelPath(sourcePath)} ` +
      `(resolved to ${formatRelPath(targetPath)}: ${reason}).`;
    if (options.strict) throw new Error(msg);
    runtimeState.logger?.warn(msg);
    return undefined;
  }

  if (options.warnOnUnpublished && !isSourceDraft(vfile, sourcePath)) {
    const targetFm = readPostFrontmatter(targetPath);
    if (targetFm?.draft === true) {
      runtimeState.logger?.warn(
        `Post link "${href}" in ${formatRelPath(sourcePath)} points to draft post ` +
          `${formatRelPath(targetPath)}.`
      );
    } else if (
      targetFm &&
      runtimeState.command === "build" &&
      isScheduledFuturePost(targetFm)
    ) {
      runtimeState.logger?.warn(
        `Post link "${href}" in ${formatRelPath(sourcePath)} points to scheduled future post ` +
          `${formatRelPath(targetPath)} (not yet published in this build).`
      );
    }
  }

  const slugPath = getPostSlugPath(undefined, targetPath);
  return buildPostUrl(slugPath, suffix);
}

/**
 * Astro integration that captures project config (`root`, `base`, `i18n`,
 * `trailingSlash`, `command`, `logger`) for `rehypePostLinks`.
 */
export function postLinksIntegration(
  options: PostLinksIntegrationOptions = {}
): AstroIntegration {
  return {
    name: "astro-paper:post-links",
    hooks: {
      "astro:config:setup": ({ config, command, logger }) => {
        runtimeState.rootDir = fileURLToPath(config.root);
        runtimeState.base = config.base ?? "/";
        runtimeState.trailingSlash = config.trailingSlash ?? "ignore";
        runtimeState.command = command;
        runtimeState.logger = logger;
        runtimeState.siteTimezone = options.siteTimezone ?? "UTC";

        const i18n = config.i18n;
        const prefixDefault =
          typeof i18n?.routing === "object" &&
          i18n.routing.prefixDefaultLocale === true;
        runtimeState.localePrefix =
          prefixDefault && i18n?.defaultLocale ? `/${i18n.defaultLocale}` : "";
      },
    },
  };
}

/**
 * Rehype plugin that rewrites relative `.md`/`.mdx` and `@/posts/...` links
 * to their final AstroPaper post URLs, preserving query/hash fragments and
 * validating targets at build time.
 */
export function rehypePostLinks(options: RehypePostLinksOptions = {}) {
  return (tree: HastNode, vfile: VFileLike) => {
    const resolvedOptions: Required<RehypePostLinksOptions> = {
      strict: options.strict ?? runtimeState.command === "build",
      warnOnUnpublished: options.warnOnUnpublished ?? true,
    };

    const rawSource = vfile.path ?? vfile.history?.[0];
    const sourcePath = toFilesystemPath(rawSource, runtimeState.rootDir);

    const walk = (node: HastNode) => {
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        typeof node.properties?.href === "string"
      ) {
        const rewritten = resolvePostHref(
          node.properties.href,
          vfile,
          sourcePath,
          resolvedOptions
        );
        if (rewritten) {
          node.properties.href = rewritten;
        }
      } else if (
        (node.type === "mdxJsxTextElement" ||
          node.type === "mdxJsxFlowElement") &&
        node.name &&
        MDX_LINK_COMPONENTS.has(node.name) &&
        Array.isArray(node.attributes)
      ) {
        for (const attr of node.attributes) {
          if (
            attr.type === "mdxJsxAttribute" &&
            attr.name === "href" &&
            typeof attr.value === "string"
          ) {
            const rewritten = resolvePostHref(
              attr.value,
              vfile,
              sourcePath,
              resolvedOptions
            );
            if (rewritten) {
              attr.value = rewritten;
            }
          }
        }
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child);
        }
      }
    };

    walk(tree);
  };
}
