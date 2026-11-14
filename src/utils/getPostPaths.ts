import { getRelativeLocaleUrl } from "astro:i18n";
import { slugifyStr } from "./slugify";
import config from "@/config";

function getNormalizedPathParts(filePath: string | undefined): string[] {
  if (!filePath) return [];
  const normalized = filePath.replace(/\\/g, "/");
  const relative = normalized.replace(/^.*src\/content\/posts\/?/, "");
  return relative.split("/").filter(Boolean);
}

function getPostSlugPath(id: string, filePath: string | undefined): string {
  const parts = getNormalizedPathParts(filePath);
  if (parts.length === 0) {
    const postId = id.split("/");
    return postId.length > 0 ? String(postId[postId.length - 1]) : id;
  }

  const fileName = parts[parts.length - 1];
  const baseName = fileName.replace(/\.(md|mdx)$/, "");
  const dirParts = parts
    .slice(0, -1)
    .filter(segment => !segment.startsWith("_"))
    .map(segment => slugifyStr(segment));

  // If the file is inside a directory and is named "post" or "index",
  // or if its name matches the parent folder, the folder itself represents the post slug.
  if (
    dirParts.length > 0 &&
    (baseName === "post" ||
      baseName === "index" ||
      baseName === dirParts[dirParts.length - 1])
  ) {
    return dirParts.join("/");
  }

  return dirParts.length > 0
    ? [...dirParts, slugifyStr(baseName)].join("/")
    : slugifyStr(baseName);
}

/**
 * Returns the slug-only path for use as a route param in `getStaticPaths`.
 * No base prefix, no locale — Astro handles those at a higher level.
 * e.g. `/examples/my-post`
 */
export function getPostSlug(id: string, filePath: string | undefined): string {
  return `/${getPostSlugPath(id, filePath)}`;
}

/**
 * Returns a fully navigable URL for use in `<a href>` and RSS links.
 * Applies both locale routing and the configured Astro base via
 * `getRelativeLocaleUrl`.
 * e.g. `/posts/my-post` or `/en/posts/my-post`
 */
export function getPostUrl(
  id: string,
  filePath: string | undefined,
  locale: string | undefined = config.site.lang
): string {
  return getRelativeLocaleUrl(locale, `posts/${getPostSlugPath(id, filePath)}`);
}
