// --------------------------
// FILE SOURCE ADAPTER
// Reads uploaded text files (txt, md, html) from a staging directory and
// returns items in the WP format the ingestion pipeline expects.
//
// Files are stored under content/<companyName>/uploads/ by the upload
// endpoint and cleaned up after ingestion.
//
// Usage:
//   const source = createFileSource({ files: ["path/to/file.txt"], companyName });
//   const items = await source.fetchPage(1, companyName);
// --------------------------

import fs from "fs";
import path from "path";
import { load as cheerioLoad } from "cheerio";
import mammoth from "mammoth";

// pdf-parse v2 is an ESM module exporting a PDFParse class (no default export,
// and the old v1 `pdfParse(buffer)` call API is gone) — lazy-import so this
// module loads with zero dependencies and parse errors stay local.
let PDFParseClass;
async function loadPdfParse() {
  if (!PDFParseClass) {
    const mod = await import("pdf-parse");
    PDFParseClass = mod.PDFParse || mod.default;
  }
  return PDFParseClass;
}

const UPLOAD_DIR = "content";

/**
 * Create a file source adapter.
 * @param {Object} opts
 * @param {string[]} opts.files         Absolute paths to uploaded files
 * @param {string}   opts.companyName   Company key (for content/ path)
 * @returns {{ fetchPage, fetchPost, fetchWpByIds }}
 */
export function createFileSource({ files = [], companyName = "" } = {}) {
  if (!files.length) {
    throw new Error("createFileSource requires at least one file");
  }

  async function fetchFilePage(page) {
    if (page > 1) return null;

    const items = [];
    for (const filePath of files) {
      try {
        const item = await readFileAsItem(filePath, companyName);
        if (item) items.push(item);
      } catch (err) {
        console.error(`❌ Failed to read ${filePath}: ${err.message}`);
      }
    }

    return items.length > 0 ? items : null;
  }

  return {
    fetchPage: fetchFilePage,
    fetchPost: async () => null,
    fetchWpByIds: async () => [],
  };
}

/**
 * Read a file and convert it to a WP-format item.
 * Supports .txt, .md, .html, .pdf, and .docx files.
 * @param {string} filePath   Absolute path to the file
 * @param {string} companyName
 * @returns {Promise<Object|null>}
 */
async function readFileAsItem(filePath, companyName) {
  if (!fs.existsSync(filePath)) return null;

  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath, ext);

  let title = basename.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let contentHtml;

  switch (ext) {
    case ".pdf": {
      // PDF → extract text using pdf-parse v2 (`new PDFParse({ data }).getText()`)
      const buffer = fs.readFileSync(filePath);
      const PDFParse = await loadPdfParse();
      const parser = new PDFParse({ data: buffer });
      let pdfData;
      try {
        pdfData = await parser.getText();
      } finally {
        try { await parser.destroy(); } catch { /* best-effort worker cleanup */ }
      }
      title = pdfData.info?.Title || title;
      // Convert extracted text to HTML paragraphs
      contentHtml = textToHtml(pdfData.text);
      break;
    }
    case ".docx": {
      // DOCX → extract HTML using mammoth
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      contentHtml = result.value || "<p>No content extracted.</p>";
      // Extract title from first heading if present
      const headingMatch = contentHtml.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
      if (headingMatch) title = headingMatch[1].trim();
      break;
    }
    case ".html":
    case ".htm": {
      // Parse HTML: extract title + body content
      const raw = fs.readFileSync(filePath, "utf-8");
      const $ = cheerioLoad(raw);
      $("script, style, noscript").remove();
      title = $("title").text().trim() || title;
      contentHtml = $("body").html() || raw;
      break;
    }
    case ".md": {
      // Markdown → HTML (simple conversion for the pipeline)
      const raw = fs.readFileSync(filePath, "utf-8");
      contentHtml = markdownToHtml(raw);
      // Extract first heading as title
      const mdHeading = raw.match(/^#\s+(.+)$/m);
      if (mdHeading) title = mdHeading[1].trim();
      break;
    }
    case ".txt":
    default: {
      // Plain text → wrap in paragraphs
      const raw = fs.readFileSync(filePath, "utf-8");
      contentHtml = textToHtml(raw);
      break;
    }
  }

  // Build a slug from filename
  const slug = basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Get file modification time
  const stats = fs.statSync(filePath);
  const modified = stats.mtime.toISOString();

  // Copy file into the content directory for the store adapter
  const contentDir = path.join(UPLOAD_DIR, companyName, "uploads");
  fs.mkdirSync(contentDir, { recursive: true });
  const dest = path.join(contentDir, path.basename(filePath));
  if (filePath !== dest) {
    fs.copyFileSync(filePath, dest);
  }

  return {
    title: { rendered: title },
    content: { rendered: contentHtml },
    slug,
    link: `file:///${path.basename(filePath)}`,
    modified,
    _source: "file",
  };
}

/**
 * Convert plain text to HTML paragraphs.
 * @param {string} text
 * @returns {string}
 */
function textToHtml(text) {
  if (!text) return "<p>No content extracted.</p>";
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * Minimal markdown-to-HTML converter.
 * Handles headings, bold, italic, links, lists, and paragraphs.
 * @param {string} md
 * @returns {string}
 */
function markdownToHtml(md) {
  let html = md
    // Headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Unordered lists
    .replace(/^[*-] (.+)$/gm, "<li>$1</li>")
    // Paragraphs (double newline)
    .replace(/\n\s*\n/g, "</p><p>")
    // Single newlines → <br>
    .replace(/\n/g, "<br>");

  // Wrap in paragraphs
  html = "<p>" + html + "</p>";
  // Clean up empty paragraphs and nested tags
  html = html.replace(/<p>\s*<\/p>/g, "").replace(/<p>(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)<\/p>/g, "$1");
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>").replace(/<\/ul>\s*<ul>/g, "");

  return html;
}
