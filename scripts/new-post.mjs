import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import {
  buildMarkdownDocument,
  discoverCategories,
  discoverExistingTags,
  formatIsoInTimezone,
  isValidTimezone,
  loadSiteDefaults,
  mergeTags,
  normalizeFolderPath,
  parseCliArgs,
  parseDateInput,
  POSTS_DIR,
  resolvePostTarget,
  serializeFrontmatter,
  slugifyTitle,
} from "./content-cli/helpers.mjs";

function printHelp() {
  process.stdout.write(`Usage: pnpm post [options] [title]

Create a new blog post interactively with smart defaults.

Options:
  -q, --quick   Create a draft post immediately using defaults (no prompts)
  -h, --help    Show this help message

Examples:
  pnpm post
  pnpm post "Getting Started with Astro"
  pnpm post --quick "Quick Draft Idea"
`);
}

function abortIfCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Cancelled. No files were created.");
    process.exit(0);
  }
  return value;
}

function buildPostEntries(data, siteDefaults) {
  const entries = [
    ["author", data.author && data.author !== siteDefaults.author ? data.author : undefined],
    ["pubDatetime", data.pubDatetime, { raw: true }],
    ["title", data.title],
    ["featured", data.featured],
    ["draft", data.draft],
    ["tags", data.tags],
    ["description", data.description],
  ];

  if (data.coverImageSrc) {
    entries.push([
      "coverImage",
      {
        src: data.coverImageSrc,
        alt: data.coverImageAlt || `${data.title} cover image`,
      },
    ]);
  }

  if (data.ogImage) entries.push(["ogImage", data.ogImage]);
  if (data.canonicalURL) entries.push(["canonicalURL", data.canonicalURL]);
  if (data.hideEditPost) entries.push(["hideEditPost", true]);
  if (data.hideToc) entries.push(["hideToc", true]);
  if (data.timezone && data.timezone !== siteDefaults.timezone) {
    entries.push(["timezone", data.timezone]);
  }

  return entries;
}

function writePostFiles(target, content) {
  mkdirSync(path.dirname(target.filePath), { recursive: true });
  if (target.assetsDir) {
    mkdirSync(target.assetsDir, { recursive: true });
  }
  writeFileSync(target.filePath, content, "utf8");
}

async function runQuickMode(cliTitle, rootDir, siteDefaults) {
  const title = cliTitle || "Untitled Post";
  const slug = slugifyTitle(title);

  if (!slug) {
    p.log.error("Could not generate a valid slug from the provided title.");
    process.exit(1);
  }

  const target = resolvePostTarget({
    rootDir,
    folder: "_drafts",
    slug,
    layout: "single",
    format: "md",
  });

  if (target.exists) {
    p.log.error(`A post already exists at ${target.collisionPath}.`);
    process.exit(1);
  }

  const entries = buildPostEntries(
    {
      title,
      pubDatetime: formatIsoInTimezone(new Date(), siteDefaults.timezone),
      featured: false,
      draft: true,
      tags: ["others"],
      description: `Draft post about ${title}.`,
    },
    siteDefaults
  );

  writePostFiles(target, buildMarkdownDocument(entries));
  p.log.success(`Created: ${target.relativePath}`);
  p.log.info(`Preview URL: ${target.urlPath}`);
}

async function promptForUniqueSlug({
  rootDir,
  folder,
  initialSlug,
  layout,
  format,
  message,
}) {
  const rawSlug = abortIfCancelled(
    await p.text({
      message,
      initialValue: initialSlug,
      validate(value) {
        const candidate = slugifyTitle(value);
        if (!candidate) return "Please enter a valid URL slug.";
        const check = resolvePostTarget({
          rootDir,
          folder,
          slug: candidate,
          layout,
          format,
        });
        if (check.exists) {
          return `Already exists at ${check.collisionPath}. Choose a different slug.`;
        }
        return undefined;
      },
    })
  );

  return slugifyTitle(rawSlug);
}

async function runInteractiveMode(cliTitle, rootDir, siteDefaults) {
  p.intro("Create a new blog post");

  const title = abortIfCancelled(
    await p.text({
      message: "Post title",
      placeholder: "e.g. Getting Started with Astro",
      initialValue: cliTitle || undefined,
      validate(value) {
        if (!value?.trim()) return "Please enter a title for your post.";
        if (!slugifyTitle(value)) {
          return "Title must include at least one letter or number.";
        }
        return undefined;
      },
    })
  ).trim();

  const postsAbsDir = path.join(rootDir, POSTS_DIR);
  const categories = discoverCategories(postsAbsDir);

  const folderChoice = abortIfCancelled(
    await p.select({
      message: "Where should this post live?",
      options: [
        { value: "", label: "(root)", hint: "src/content/posts/" },
        ...categories.map(cat => ({
          value: cat,
          label: cat,
          hint: cat.startsWith("_")
            ? "organization only (excluded from URL)"
            : undefined,
        })),
        { value: "__new__", label: "+ Create a new folder..." },
      ],
    })
  );

  let folder = folderChoice;
  if (folderChoice === "__new__") {
    const newFolder = abortIfCancelled(
      await p.text({
        message: "New folder path (relative to src/content/posts/)",
        placeholder: "e.g. web-dev or cyber-security/writeups",
        validate(value) {
          if (!normalizeFolderPath(value)) {
            return "Please enter a valid folder name.";
          }
          return undefined;
        },
      })
    );
    folder = normalizeFolderPath(newFolder);
  }

  const layout = abortIfCancelled(
    await p.select({
      message: "Post structure",
      options: [
        {
          value: "single",
          label: "Single file",
          hint: "Best for text-focused posts (<slug>.md)",
        },
        {
          value: "bundle",
          label: "Folder with assets/img/",
          hint: "Best for posts with screenshots or cover images (<slug>/post.md)",
        },
      ],
    })
  );

  const format = abortIfCancelled(
    await p.select({
      message: "File format",
      options: [
        { value: "md", label: "Markdown (.md)", hint: "Standard" },
        {
          value: "mdx",
          label: "MDX (.mdx)",
          hint: "Use Astro components inside the post",
        },
      ],
    })
  );

  let slug = slugifyTitle(title);
  let target = resolvePostTarget({ rootDir, folder, slug, layout, format });

  if (target.exists) {
    p.log.warn(
      `A post already exists at ${target.collisionPath}. Please choose a different slug.`
    );
    slug = await promptForUniqueSlug({
      rootDir,
      folder,
      initialSlug: `${slug}-2`,
      layout,
      format,
      message: "URL slug",
    });
    target = resolvePostTarget({ rootDir, folder, slug, layout, format });
  }

  const defaultDescription = `Draft post about ${title}.`;
  const rawDescription = abortIfCancelled(
    await p.text({
      message: "Short description (for previews & SEO)",
      placeholder: `Press Enter for default: "${defaultDescription}"`,
    })
  );
  const description = rawDescription?.trim() || defaultDescription;

  const existingTags = discoverExistingTags(postsAbsDir);
  let selectedTags = [];

  if (existingTags.length > 0) {
    selectedTags = abortIfCancelled(
      await p.multiselect({
        message: "Pick from existing tags (optional — Space to select, Enter to continue)",
        options: existingTags.map(({ tag, count }) => ({
          value: tag,
          label: tag,
          hint: count === 1 ? "1 post" : `${count} posts`,
        })),
        required: false,
      })
    );
  }

  const customTagsInput = abortIfCancelled(
    await p.text({
      message: "Add new tags (comma-separated, optional)",
      placeholder:
        selectedTags.length > 0
          ? "Press Enter to skip"
          : 'e.g. astro, tutorial (defaults to "others")',
    })
  );
  const tags = mergeTags(selectedTags, customTagsInput);

  const draft = abortIfCancelled(
    await p.confirm({
      message: "Save as a draft? (hidden from the live site until draft: false)",
      initialValue: true,
    })
  );

  const featured = abortIfCancelled(
    await p.confirm({
      message: "Feature this post on the homepage?",
      initialValue: false,
    })
  );

  const showAdvanced = abortIfCancelled(
    await p.confirm({
      message:
        "Configure advanced options? (custom slug, author, date, images, canonical URL, ToC)",
      initialValue: false,
    })
  );

  let author = siteDefaults.author;
  let timezone = siteDefaults.timezone;
  let pubDatetime = formatIsoInTimezone(new Date(), siteDefaults.timezone);
  let coverImageSrc = "";
  let coverImageAlt = "";
  let ogImage = "";
  let canonicalURL = "";
  let hideToc = false;
  let hideEditPost = false;

  if (showAdvanced) {
    slug = await promptForUniqueSlug({
      rootDir,
      folder,
      initialSlug: slug,
      layout,
      format,
      message: "Custom URL slug",
    });
    target = resolvePostTarget({ rootDir, folder, slug, layout, format });

    const authorInput = abortIfCancelled(
      await p.text({
        message: "Author",
        placeholder: `Press Enter for site default (${siteDefaults.author})`,
      })
    );
    if (authorInput?.trim()) {
      author = authorInput.trim();
    }

    const tzInput = abortIfCancelled(
      await p.text({
        message: "Timezone override (IANA format, optional)",
        placeholder: `Press Enter for site default (${siteDefaults.timezone})`,
        validate(value) {
          if (value?.trim() && !isValidTimezone(value.trim())) {
            return "Invalid IANA timezone (e.g. Asia/Dhaka, UTC, America/New_York).";
          }
          return undefined;
        },
      })
    );
    if (tzInput?.trim()) {
      timezone = tzInput.trim();
      pubDatetime = formatIsoInTimezone(new Date(), timezone);
    }

    const dateInput = abortIfCancelled(
      await p.text({
        message: "Publish date/time (optional)",
        placeholder: `Press Enter for now (${pubDatetime})`,
        validate(value) {
          if (value?.trim() && !parseDateInput(value, timezone)) {
            return "Enter a valid date (e.g. 2026-11-20 or 2026-11-20T14:30:00+06:00).";
          }
          return undefined;
        },
      })
    );
    if (dateInput?.trim()) {
      pubDatetime = parseDateInput(dateInput, timezone);
    }

    coverImageSrc = abortIfCancelled(
      await p.text({
        message: "Cover image path or URL (optional)",
        placeholder:
          layout === "bundle"
            ? "e.g. ./assets/img/thumb.png (leave blank to skip)"
            : "Relative path or URL (leave blank to skip)",
      })
    ).trim();

    if (coverImageSrc) {
      coverImageAlt = abortIfCancelled(
        await p.text({
          message: "Cover image alt text",
          placeholder: `${title} cover image`,
        })
      ).trim();
    }

    ogImage = abortIfCancelled(
      await p.text({
        message: "Custom OG image path or URL (optional)",
        placeholder: "Leave blank to use automatic OG image",
      })
    ).trim();

    canonicalURL = abortIfCancelled(
      await p.text({
        message: "Canonical URL (optional)",
        placeholder: "https://example.com/original-post",
      })
    ).trim();

    hideToc = abortIfCancelled(
      await p.confirm({
        message: "Hide table of contents on this post?",
        initialValue: false,
      })
    );

    hideEditPost = abortIfCancelled(
      await p.confirm({
        message: 'Hide the "Edit post" link on this post?',
        initialValue: false,
      })
    );
  }

  const frontmatterEntries = buildPostEntries(
    {
      author,
      pubDatetime,
      title,
      featured,
      draft,
      tags,
      description,
      coverImageSrc,
      coverImageAlt,
      ogImage,
      canonicalURL,
      hideEditPost,
      hideToc,
      timezone,
    },
    siteDefaults
  );

  const summaryLines = [
    `File: ${target.relativePath}`,
    ...(target.relativeAssetsDir ? [`Assets: ${target.relativeAssetsDir}/`] : []),
    `URL: ${target.urlPath}`,
    "",
    serializeFrontmatter(frontmatterEntries),
  ];

  p.note(summaryLines.join("\n"), "Post summary");

  const shouldCreate = abortIfCancelled(
    await p.confirm({
      message: "Create this post?",
      initialValue: true,
    })
  );

  if (!shouldCreate) {
    p.cancel("Cancelled. No files were created.");
    process.exit(0);
  }

  writePostFiles(target, buildMarkdownDocument(frontmatterEntries));

  p.log.success(`File created: ${target.relativePath}`);
  if (target.relativeAssetsDir) {
    p.log.info(`Assets folder: ${target.relativeAssetsDir}/`);
  }
  p.log.info(`Preview URL: ${target.urlPath}`);
  p.outro("Happy writing!");
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const rootDir = process.cwd();
  const siteDefaults = loadSiteDefaults(rootDir);

  if (cli.quick) {
    await runQuickMode(cli.title, rootDir, siteDefaults);
  } else {
    await runInteractiveMode(cli.title, rootDir, siteDefaults);
  }
}

await main();
