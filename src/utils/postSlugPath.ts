import { slugifyStr } from "./slugify";

export const POSTS_CONTENT_DIR = "src/content/posts";

function getNormalizedPathParts(filePath: string | undefined): string[] {
  if (!filePath) return [];
  const normalized = filePath.replace(/\\/g, "/");
  const relative = normalized.replace(/^.*src\/content\/posts\/?/, "");
  return relative.split("/").filter(Boolean);
}

/**
 * Pure slug-path helper shared between runtime routing (`getPostPaths.ts`)
 * and build-time markdown plugins (`rehypePostLinks.ts`).
 *
 * Keeps no Astro virtual-module imports so it can be loaded inside
 * `astro.config.ts` as well as in Astro pages/components.
 */
export function getPostSlugPath(
  id: string | undefined,
  filePath: string | undefined
): string {
  const parts = getNormalizedPathParts(filePath);
  if (parts.length === 0) {
    if (!id) return "";
    const postId = id.split("/");
    return postId.length > 0 ? String(postId[postId.length - 1]) : id;
  }

  const fileName = parts[parts.length - 1];
  const baseName = fileName.replace(/\.(md|mdx)$/i, "");
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
