import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import kebabcase from "lodash.kebabcase";
import slugify from "slugify";

export const POSTS_DIR = path.join("src", "content", "posts");
export const PAGES_CONTENT_DIR = path.join("src", "content", "pages");

const HAS_NON_LATIN = /[^\x00-\x7F]/;

/**
 * Mirrors `src/utils/slugify.ts` so generated filenames and preview URLs
 * always match AstroPaper's runtime routing.
 */
export function slugifyTitle(str) {
  const trimmed = String(str ?? "").trim();
  if (!trimmed) return "";
  if (HAS_NON_LATIN.test(trimmed)) {
    const cleaned = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ");
    return kebabcase(cleaned);
  }
  return slugify(trimmed, { lower: true, strict: true });
}

/**
 * Reads default author and timezone from `astro-paper.config.ts`.
 */
export function loadSiteDefaults(rootDir = process.cwd()) {
  const defaults = {
    author: "Shakil Ahmmed",
    timezone: "Asia/Dhaka",
  };

  const configPath = path.join(rootDir, "astro-paper.config.ts");
  if (!existsSync(configPath)) return defaults;

  const content = readFileSync(configPath, "utf8");
  const siteBlockMatch = content.match(/site\s*:\s*\{([\s\S]*?)\}/);
  const scope = siteBlockMatch ? siteBlockMatch[1] : content;

  const authorMatch = scope.match(/author\s*:\s*["'`]([^"'`]+)["'`]/);
  const timezoneMatch = scope.match(/timezone\s*:\s*["'`]([^"'`]+)["'`]/);

  return {
    author: authorMatch?.[1]?.trim() || defaults.author,
    timezone: timezoneMatch?.[1]?.trim() || defaults.timezone,
  };
}

/**
 * Validates an IANA timezone string (e.g. "Asia/Dhaka", "UTC").
 */
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a Date as an ISO 8601 timestamp in the given IANA timezone,
 * e.g. "2026-11-18T21:15:00+06:00".
 */
export function formatIsoInTimezone(date = new Date(), timezone = "UTC") {
  const safeTz = isValidTimezone(timezone) ? timezone : "UTC";

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );

  const localAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  // Truncate source date milliseconds so offset math is exact to the minute
  const sourceTruncatedMs = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((localAsUtcMs - sourceTruncatedMs) / 60000);

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offMins = String(absMinutes % 60).padStart(2, "0");
  const offsetStr = offsetMinutes === 0 && safeTz === "UTC"
    ? "Z"
    : `${sign}${offHours}:${offMins}`;

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offsetStr}`;
}

/**
 * Checks whether a user-entered date string parses to a valid Date.
 */
export function parseDateInput(input, timezone = "UTC") {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;

  // Accept "YYYY-MM-DD" by expanding to start of day in configured timezone
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const base = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) return null;
    const offset = formatIsoInTimezone(base, timezone).slice(19);
    return `${trimmed}T00:00:00${offset}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  // If the string already contains a timezone offset or Z, preserve ISO shape
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    return trimmed;
  }

  return formatIsoInTimezone(parsed, timezone);
}

/**
 * Normalizes a relative category folder path (preserving leading "_" for
 * organization-only folders that AstroPaper excludes from URLs).
 */
export function normalizeFolderPath(rawFolder) {
  const trimmed = String(rawFolder ?? "").trim();
  if (!trimmed || trimmed === "." || trimmed === "/") return "";

  return trimmed
    .replace(/\\/g, "/")
    .split("/")
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith("_")) {
        const rest = slugifyTitle(segment.slice(1));
        return rest ? `_${rest}` : "";
      }
      return slugifyTitle(segment);
    })
    .filter(Boolean)
    .join("/");
}

/**
 * Checks if a directory looks like an existing single-post bundle folder
 * (contains `post.md(x)`, `index.md(x)`, or `<dirName>.md(x)`).
 */
function isPostBundleDir(dirPath, dirName) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const bundleNames = new Set([
    "post.md",
    "post.mdx",
    "index.md",
    "index.mdx",
    `${dirName}.md`,
    `${dirName}.mdx`,
  ]);
  return entries.some(
    entry => entry.isFile() && bundleNames.has(entry.name.toLowerCase())
  );
}

/**
 * Discovers existing category folders under `src/content/posts`, excluding
 * asset folders and post-bundle folders.
 */
export function discoverCategories(postsDir) {
  if (!existsSync(postsDir)) return [];

  const categories = [];

  function walk(currentDir, relPrefix) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "assets") continue;

      const fullPath = path.join(currentDir, entry.name);
      if (isPostBundleDir(fullPath, entry.name)) continue;

      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      categories.push(relPath);
      walk(fullPath, relPath);
    }
  }

  walk(postsDir, "");
  return categories.sort((a, b) => a.localeCompare(b));
}

/**
 * Extracts frontmatter block text from markdown/MDX content.
 */
function extractFrontmatterBlock(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : "";
}

/**
 * Parses YAML tags from a frontmatter string (supports block lists and inline arrays).
 */
export function parseTagsFromFrontmatter(frontmatter) {
  if (!frontmatter) return [];

  const lines = frontmatter.split(/\r?\n/);
  const tags = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineMatch = line.match(/^tags\s*:\s*\[([^\]]*)\]/);
    if (inlineMatch) {
      inlineMatch[1]
        .split(",")
        .map(item => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .forEach(tag => tags.push(tag));
      break;
    }

    if (/^tags\s*:\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const itemMatch = lines[j].match(/^\s+-\s+(.+)$/);
        if (!itemMatch) break;
        const cleaned = itemMatch[1].trim().replace(/^["']|["']$/g, "");
        if (cleaned) tags.push(cleaned);
      }
      break;
    }
  }

  return tags;
}

/**
 * Scans all existing posts to collect unique tags sorted by frequency, then alphabetically.
 */
export function discoverExistingTags(postsDir) {
  if (!existsSync(postsDir)) return [];

  const counts = new Map();

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "assets") continue;
        walk(fullPath);
      } else if (
        entry.isFile() &&
        !entry.name.startsWith("_") &&
        /\.(md|mdx)$/i.test(entry.name)
      ) {
        const content = readFileSync(fullPath, "utf8");
        const fm = extractFrontmatterBlock(content);
        for (const tag of parseTagsFromFrontmatter(fm)) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
  }

  walk(postsDir);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Splits and normalizes comma-separated custom tags and merges with selected tags.
 */
export function mergeTags(selectedTags = [], customInput = "") {
  const customTags = String(customInput ?? "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);

  const unique = [];
  const seen = new Set();

  for (const tag of [...selectedTags, ...customTags]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(tag);
    }
  }

  return unique.length > 0 ? unique : ["others"];
}

/**
 * Resolves the target file path, optional assets directory, live URL preview,
 * and collision status for a new post.
 */
export function resolvePostTarget({
  rootDir = process.cwd(),
  postsDir = POSTS_DIR,
  folder = "",
  slug,
  layout = "single",
  format = "md",
}) {
  const normalizedFolder = normalizeFolderPath(folder);
  const safeSlug = slugifyTitle(slug);
  const baseDir = normalizedFolder
    ? path.join(rootDir, postsDir, ...normalizedFolder.split("/"))
    : path.join(rootDir, postsDir);

  let filePath;
  let assetsDir = null;
  let collisionPath = null;

  if (layout === "bundle") {
    const bundleDir = path.join(baseDir, safeSlug);
    filePath = path.join(bundleDir, `post.${format}`);
    assetsDir = path.join(bundleDir, "assets", "img");

    if (existsSync(bundleDir)) {
      collisionPath = bundleDir;
    } else if (existsSync(path.join(baseDir, `${safeSlug}.md`))) {
      collisionPath = path.join(baseDir, `${safeSlug}.md`);
    } else if (existsSync(path.join(baseDir, `${safeSlug}.mdx`))) {
      collisionPath = path.join(baseDir, `${safeSlug}.mdx`);
    }
  } else {
    filePath = path.join(baseDir, `${safeSlug}.${format}`);
    const altExt = format === "md" ? "mdx" : "md";

    if (existsSync(filePath)) {
      collisionPath = filePath;
    } else if (existsSync(path.join(baseDir, `${safeSlug}.${altExt}`))) {
      collisionPath = path.join(baseDir, `${safeSlug}.${altExt}`);
    } else if (existsSync(path.join(baseDir, safeSlug))) {
      collisionPath = path.join(baseDir, safeSlug);
    }
  }

  const urlSegments = normalizedFolder
    ? normalizedFolder
        .split("/")
        .filter(segment => !segment.startsWith("_"))
        .map(segment => slugifyTitle(segment))
    : [];
  const urlPath = `/posts/${[...urlSegments, safeSlug].join("/")}`;

  return {
    filePath,
    relativePath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    assetsDir,
    relativeAssetsDir: assetsDir
      ? path.relative(rootDir, assetsDir).replace(/\\/g, "/")
      : null,
    urlPath,
    exists: Boolean(collisionPath),
    collisionPath: collisionPath
      ? path.relative(rootDir, collisionPath).replace(/\\/g, "/")
      : null,
  };
}

/**
 * Resolves target path and collision status for a new content page in `src/content/pages/`.
 */
export function resolvePageTarget({
  rootDir = process.cwd(),
  pagesContentDir = PAGES_CONTENT_DIR,
  folder = "",
  slug,
  format = "md",
}) {
  const normalizedFolder = normalizeFolderPath(folder);
  const safeSlug = slugifyTitle(slug);
  const baseDir = normalizedFolder
    ? path.join(rootDir, pagesContentDir, ...normalizedFolder.split("/"))
    : path.join(rootDir, pagesContentDir);

  const filePath = path.join(baseDir, `${safeSlug}.${format}`);
  const altExt = format === "md" ? "mdx" : "md";
  const altFilePath = path.join(baseDir, `${safeSlug}.${altExt}`);

  let collisionPath = null;
  if (existsSync(filePath)) {
    collisionPath = filePath;
  } else if (existsSync(altFilePath)) {
    collisionPath = altFilePath;
  }

  const entryId = normalizedFolder
    ? `${normalizedFolder}/${safeSlug}`
    : safeSlug;

  return {
    slug: safeSlug,
    entryId,
    filePath,
    relativePath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    exists: Boolean(collisionPath),
    collisionPath: collisionPath
      ? path.relative(rootDir, collisionPath).replace(/\\/g, "/")
      : null,
  };
}

/**
 * Safely formats a scalar string for YAML frontmatter, quoting whenever
 * special YAML syntax or ambiguous scalars are present.
 */
export function formatYamlString(value) {
  const str = String(value ?? "");
  const needsQuotes =
    str === "" ||
    /^\s|\s$/.test(str) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(str) ||
    /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str) ||
    /^\d{4}-\d{2}-\d{2}/.test(str) ||
    /[:#[\]{}&*!|>'"%@`?\n\r]/.test(str) ||
    /^-(\s|$)/.test(str);

  if (!needsQuotes) return str;
  return JSON.stringify(str);
}

/**
 * Serializes a list of `[key, value, options?]` frontmatter entries into YAML.
 * Entries with `undefined` values are skipped cleanly.
 */
export function serializeFrontmatter(entries) {
  const lines = ["---"];

  for (const [key, value, options = {}] of entries) {
    if (value === undefined) continue;

    if (options.raw) {
      lines.push(`${key}: ${value}`);
      continue;
    }

    if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatYamlString(item)}`);
      }
      continue;
    }

    if (value && typeof value === "object") {
      const subEntries = Object.entries(value).filter(
        ([, subVal]) => subVal !== undefined
      );
      if (subEntries.length === 0) continue;
      lines.push(`${key}:`);
      for (const [subKey, subVal] of subEntries) {
        lines.push(`  ${subKey}: ${formatYamlString(subVal)}`);
      }
      continue;
    }

    lines.push(`${key}: ${formatYamlString(value)}`);
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Builds a complete Markdown/MDX document with clean empty body below frontmatter.
 */
export function buildMarkdownDocument(frontmatterEntries) {
  return `${serializeFrontmatter(frontmatterEntries)}\n`;
}

/**
 * Parses minimal CLI flags (`--quick` / `-q`, `--help` / `-h`) and optional title text.
 */
export function parseCliArgs(argv = []) {
  let quick = false;
  let help = false;
  const titleParts = [];

  for (const arg of argv) {
    if (arg === "--quick" || arg === "-q") {
      quick = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (!arg.startsWith("-")) {
      titleParts.push(arg);
    }
  }

  return {
    quick,
    help,
    title: titleParts.join(" ").trim(),
  };
}
