import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildMarkdownDocument,
  discoverCategories,
  discoverExistingTags,
  formatIsoInTimezone,
  formatYamlString,
  isValidTimezone,
  loadSiteDefaults,
  mergeTags,
  normalizeFolderPath,
  parseCliArgs,
  parseDateInput,
  parseTagsFromFrontmatter,
  resolvePageTarget,
  resolvePostTarget,
  serializeFrontmatter,
  slugifyTitle,
} from "./helpers.mjs";

describe("slugifyTitle", () => {
  it("slugifies Latin titles to lowercase kebab-case and strips unsafe filename chars", () => {
    assert.equal(slugifyTitle("E2E Testing Guide"), "e2e-testing-guide");
    assert.equal(
      slugifyTitle("  Getting Started with Astro  "),
      "getting-started-with-astro"
    );
    assert.equal(
      slugifyTitle("Reconnaissance: Mapping Your Surface? (Part 1)"),
      "reconnaissance-mapping-your-surface-part-1"
    );
  });

  it("preserves non-Latin characters via kebabcase while stripping unsafe chars", () => {
    assert.equal(slugifyTitle("বাংলা ব্লগ: পর্ব ১"), "বাংলা-ব্লগ-পর্ব-১");
  });

  it("returns empty string for blank input", () => {
    assert.equal(slugifyTitle("   "), "");
  });
});

describe("timezone and date helpers", () => {
  it("formats ISO timestamps in configured IANA timezone", () => {
    const fixed = new Date("2026-11-18T15:00:00Z");
    assert.equal(
      formatIsoInTimezone(fixed, "Asia/Dhaka"),
      "2026-11-18T21:00:00+06:00"
    );
    assert.equal(formatIsoInTimezone(fixed, "UTC"), "2026-11-18T15:00:00Z");
    assert.equal(
      formatIsoInTimezone(fixed, "Asia/Kolkata"),
      "2026-11-18T20:30:00+05:30"
    );
  });

  it("validates IANA timezones", () => {
    assert.equal(isValidTimezone("Asia/Dhaka"), true);
    assert.equal(isValidTimezone("UTC"), true);
    assert.equal(isValidTimezone("Not/A_Zone"), false);
  });

  it("parses date-only and ISO inputs", () => {
    assert.equal(
      parseDateInput("2026-11-20", "Asia/Dhaka"),
      "2026-11-20T00:00:00+06:00"
    );
    assert.equal(
      parseDateInput("2026-11-20T14:30:00+06:00", "Asia/Dhaka"),
      "2026-11-20T14:30:00+06:00"
    );
    assert.equal(parseDateInput("not-a-date", "Asia/Dhaka"), null);
  });
});

describe("YAML serialization", () => {
  it("quotes strings with special YAML syntax or ambiguous scalars", () => {
    assert.equal(formatYamlString("Simple Title"), "Simple Title");
    assert.equal(
      formatYamlString("Reconnaissance: Mapping Your Surface"),
      '"Reconnaissance: Mapping Your Surface"'
    );
    assert.equal(formatYamlString("true"), '"true"');
    assert.equal(formatYamlString("42"), '"42"');
    assert.equal(formatYamlString("Post #1"), '"Post #1"');
  });

  it("serializes frontmatter with raw dates, arrays, booleans, and nested objects", () => {
    const doc = buildMarkdownDocument([
      ["author", undefined],
      ["pubDatetime", "2026-11-18T21:00:00+06:00", { raw: true }],
      ["title", "Hello: World"],
      ["featured", false],
      ["draft", true],
      ["tags", ["astro", "cyber-security"]],
      ["description", "A clean, simple description."],
      [
        "coverImage",
        { src: "./assets/img/thumb.png", alt: "Hello: World thumbnail" },
      ],
    ]);

    assert.equal(
      doc,
      `---
pubDatetime: 2026-11-18T21:00:00+06:00
title: "Hello: World"
featured: false
draft: true
tags:
  - astro
  - cyber-security
description: A clean, simple description.
coverImage:
  src: ./assets/img/thumb.png
  alt: "Hello: World thumbnail"
---
`
    );
  });

  it("omits undefined fields cleanly", () => {
    const fm = serializeFrontmatter([
      ["title", "About"],
      ["description", undefined],
    ]);
    assert.equal(fm, "---\ntitle: About\n---");
  });
});

describe("folder normalization, discovery, and target resolution", () => {
  it("normalizes folder paths while keeping leading underscores", () => {
    assert.equal(normalizeFolderPath("Cyber Security/Writeups"), "cyber-security/writeups");
    assert.equal(normalizeFolderPath("_Color Schemes/Drafts"), "_color-schemes/drafts");
    assert.equal(normalizeFolderPath(" / "), "");
  });

  it("discovers categories, tags, and detects collisions in a temp workspace", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "saw-blog-cli-"));
    try {
      const postsDir = path.join(tmp, "src", "content", "posts");
      const pagesContentDir = path.join(tmp, "src", "content", "pages");

      mkdirSync(path.join(postsDir, "cyber-security", "writeups", "my-ctf", "assets", "img"), {
        recursive: true,
      });
      mkdirSync(path.join(postsDir, "_internal"), { recursive: true });
      mkdirSync(pagesContentDir, { recursive: true });

      writeFileSync(
        path.join(postsDir, "cyber-security", "writeups", "my-ctf", "post.md"),
        "---\ntitle: CTF\ntags:\n  - ctf\n  - web\n---\n"
      );
      writeFileSync(
        path.join(postsDir, "cyber-security", "dorking.md"),
        "---\ntitle: Dorking\ntags: [cyber-security, ctf]\n---\n"
      );
      writeFileSync(
        path.join(pagesContentDir, "about.md"),
        "---\ntitle: About\n---\n"
      );

      // Bundle folder `my-ctf` and `assets` are excluded from category suggestions
      assert.deepEqual(discoverCategories(postsDir), [
        "_internal",
        "cyber-security",
        "cyber-security/writeups",
      ]);

      // Tags sorted by count desc, then alphabetically
      assert.deepEqual(discoverExistingTags(postsDir), [
        { tag: "ctf", count: 2 },
        { tag: "cyber-security", count: 1 },
        { tag: "web", count: 1 },
      ]);

      // Post target & URL rules (underscore folder excluded from URL)
      const internalPost = resolvePostTarget({
        rootDir: tmp,
        folder: "_internal",
        slug: "notes-test",
        layout: "single",
        format: "md",
      });
      assert.equal(
        internalPost.relativePath,
        "src/content/posts/_internal/notes-test.md"
      );
      assert.equal(internalPost.urlPath, "/posts/notes-test");
      assert.equal(internalPost.exists, false);

      // Bundle post collision check
      const collidingBundle = resolvePostTarget({
        rootDir: tmp,
        folder: "cyber-security/writeups",
        slug: "my-ctf",
        layout: "bundle",
        format: "md",
      });
      assert.equal(collidingBundle.exists, true);
      assert.equal(
        collidingBundle.urlPath,
        "/posts/cyber-security/writeups/my-ctf"
      );

      // Content page target checks (collision + root + subfolder)
      const existingPage = resolvePageTarget({
        rootDir: tmp,
        slug: "about",
        format: "mdx",
      });
      assert.equal(existingPage.exists, true);

      const newPage = resolvePageTarget({
        rootDir: tmp,
        slug: "uses",
        format: "md",
      });
      assert.equal(newPage.exists, false);
      assert.equal(newPage.relativePath, "src/content/pages/uses.md");
      assert.equal(newPage.entryId, "uses");

      const nestedPage = resolvePageTarget({
        rootDir: tmp,
        folder: "Legal",
        slug: "privacy-policy",
        format: "md",
      });
      assert.equal(
        nestedPage.relativePath,
        "src/content/pages/legal/privacy-policy.md"
      );
      assert.equal(nestedPage.entryId, "legal/privacy-policy");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("tag parsing, merging, CLI args, and site defaults", () => {
  it("parses block and inline YAML tags", () => {
    assert.deepEqual(
      parseTagsFromFrontmatter("tags:\n  - a\n  - \"b-c\"\n"),
      ["a", "b-c"]
    );
    assert.deepEqual(
      parseTagsFromFrontmatter("tags: [one, 'two']\n"),
      ["one", "two"]
    );
  });

  it("merges tags deduplicated and defaults to others when empty", () => {
    assert.deepEqual(mergeTags(["astro"], "Astro, web,  "), ["astro", "web"]);
    assert.deepEqual(mergeTags([], ""), ["others"]);
  });

  it("parses CLI flags and multi-word titles", () => {
    assert.deepEqual(parseCliArgs(["--quick", "My", "New", "Post"]), {
      quick: true,
      help: false,
      title: "My New Post",
    });
    assert.deepEqual(parseCliArgs(["-h"]), {
      quick: false,
      help: true,
      title: "",
    });
  });

  it("reads author and timezone from the workspace astro-paper.config.ts", () => {
    const defaults = loadSiteDefaults(process.cwd());
    assert.equal(defaults.author, "Shakil Ahmmed");
    assert.equal(defaults.timezone, "Asia/Dhaka");
  });
});
