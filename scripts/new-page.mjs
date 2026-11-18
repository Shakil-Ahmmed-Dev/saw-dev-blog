import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import {
  buildMarkdownDocument,
  discoverCategories,
  normalizeFolderPath,
  PAGES_CONTENT_DIR,
  parseCliArgs,
  resolvePageTarget,
  serializeFrontmatter,
  slugifyTitle,
} from "./content-cli/helpers.mjs";

function printHelp() {
  process.stdout.write(`Usage: pnpm page [options] [title]

Create a new content page in src/content/pages/ interactively with smart defaults.

Options:
  -q, --quick   Create a content page immediately using defaults (no prompts)
  -h, --help    Show this help message

Examples:
  pnpm page
  pnpm page "Uses"
  pnpm page --quick "Projects"
`);
}

function abortIfCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Cancelled. No files were created.");
    process.exit(0);
  }
  return value;
}

function buildPageEntries(data) {
  const entries = [["title", data.title]];

  if (data.description) entries.push(["description", data.description]);
  if (data.ogImage) entries.push(["ogImage", data.ogImage]);
  if (data.canonicalURL) entries.push(["canonicalURL", data.canonicalURL]);

  return entries;
}

function writePageFile(target, markdownContent) {
  mkdirSync(path.dirname(target.filePath), { recursive: true });
  writeFileSync(target.filePath, markdownContent, "utf8");
}

async function promptForUniquePageSlug({
  rootDir,
  folder,
  initialSlug,
  format,
  message,
}) {
  const rawSlug = abortIfCancelled(
    await p.text({
      message,
      initialValue: initialSlug,
      validate(value) {
        const candidate = slugifyTitle(value);
        if (!candidate) return "Please enter a valid file slug.";
        const check = resolvePageTarget({
          rootDir,
          folder,
          slug: candidate,
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

async function runQuickMode(cliTitle, rootDir) {
  const title = cliTitle || "Untitled Page";
  const slug = slugifyTitle(title);

  if (!slug) {
    p.log.error("Could not generate a valid slug from the provided title.");
    process.exit(1);
  }

  const target = resolvePageTarget({
    rootDir,
    folder: "",
    slug,
    format: "md",
  });

  if (target.exists) {
    p.log.error(`A page already exists at ${target.collisionPath}.`);
    process.exit(1);
  }

  const entries = buildPageEntries({ title });
  writePageFile(target, buildMarkdownDocument(entries));

  p.log.success(`Created: ${target.relativePath}`);
  p.log.info(`Collection entry ID: ${target.entryId}`);
}

async function runInteractiveMode(cliTitle, rootDir) {
  p.intro("Create a new content page");

  const title = abortIfCancelled(
    await p.text({
      message: "Page title",
      placeholder: "e.g. Uses, Projects, Now",
      initialValue: cliTitle || undefined,
      validate(value) {
        if (!value?.trim()) return "Please enter a title for your page.";
        if (!slugifyTitle(value)) {
          return "Title must include at least one letter or number.";
        }
        return undefined;
      },
    })
  ).trim();

  const pagesAbsDir = path.join(rootDir, PAGES_CONTENT_DIR);
  const existingFolders = discoverCategories(pagesAbsDir);

  const folderChoice = abortIfCancelled(
    await p.select({
      message: "Where should this page live?",
      options: [
        { value: "", label: "(root)", hint: "src/content/pages/" },
        ...existingFolders.map(folder => ({
          value: folder,
          label: folder,
        })),
        { value: "__new__", label: "+ Create a new folder..." },
      ],
    })
  );

  let folder = folderChoice;
  if (folderChoice === "__new__") {
    const newFolder = abortIfCancelled(
      await p.text({
        message: "New folder path (relative to src/content/pages/)",
        placeholder: "e.g. docs or legal",
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

  const format = abortIfCancelled(
    await p.select({
      message: "File format",
      options: [
        { value: "md", label: "Markdown (.md)", hint: "Standard" },
        {
          value: "mdx",
          label: "MDX (.mdx)",
          hint: "Use Astro components inside the page",
        },
      ],
    })
  );

  let slug = slugifyTitle(title);
  let target = resolvePageTarget({ rootDir, folder, slug, format });

  if (target.exists) {
    p.log.warn(
      `A page already exists at ${target.collisionPath}. Please choose a different slug.`
    );
    slug = await promptForUniquePageSlug({
      rootDir,
      folder,
      initialSlug: `${slug}-2`,
      format,
      message: "File slug",
    });
    target = resolvePageTarget({ rootDir, folder, slug, format });
  }

  const description = abortIfCancelled(
    await p.text({
      message: "Short description (optional)",
      placeholder: "Press Enter to skip",
    })
  ).trim();

  const showAdvanced = abortIfCancelled(
    await p.confirm({
      message:
        "Configure advanced options? (custom slug, OG image, canonical URL)",
      initialValue: false,
    })
  );

  let ogImage = "";
  let canonicalURL = "";

  if (showAdvanced) {
    slug = await promptForUniquePageSlug({
      rootDir,
      folder,
      initialSlug: slug,
      format,
      message: "Custom file slug",
    });
    target = resolvePageTarget({ rootDir, folder, slug, format });

    ogImage = abortIfCancelled(
      await p.text({
        message: "Custom OG image path or URL (optional)",
        placeholder: "Leave blank to skip",
      })
    ).trim();

    canonicalURL = abortIfCancelled(
      await p.text({
        message: "Canonical URL (optional)",
        placeholder: "https://example.com/page",
      })
    ).trim();
  }

  const frontmatterEntries = buildPageEntries({
    title,
    description,
    ogImage,
    canonicalURL,
  });

  const summaryLines = [
    `File:     ${target.relativePath}`,
    `Entry ID: ${target.entryId}`,
    "",
    serializeFrontmatter(frontmatterEntries),
  ];

  p.note(summaryLines.join("\n"), "Page summary");

  const shouldCreate = abortIfCancelled(
    await p.confirm({
      message: "Create this page?",
      initialValue: true,
    })
  );

  if (!shouldCreate) {
    p.cancel("Cancelled. No files were created.");
    process.exit(0);
  }

  writePageFile(target, buildMarkdownDocument(frontmatterEntries));

  p.log.success(`File created: ${target.relativePath}`);
  p.log.info(`Collection entry ID: ${target.entryId}`);
  p.outro("Page ready!");
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const rootDir = process.cwd();

  if (cli.quick) {
    await runQuickMode(cli.title, rootDir);
  } else {
    await runInteractiveMode(cli.title, rootDir);
  }
}

await main();
