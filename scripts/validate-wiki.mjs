// --------------------------
// WIKI VALIDATOR (ad-hoc dev tool)
// 1) every Obsidian wikilink in wiki/**/*.md resolves to an existing note
//    (wikilinks inside fenced code blocks are ignored, like Obsidian does);
// 2) every back-ticked source path points at a real file: exact rel-path,
//    else basename match, else repo-wide suffix match (contextual shorthands).
// Run: node scripts/validate-wiki.mjs
// --------------------------
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const WIKI = path.join(ROOT, "wiki");
if (!fs.existsSync(WIKI)) {
  console.error("❌ wiki/ directory not found");
  process.exit(1);
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "logs", "archive-N5fulZ", "archive-Vwej06", ".graphify", ".crush", "backup"]);
const CODE_EXT = /\.(js|mjs|cjs|jsx|json|sql|sh)$/;

// ---- gather vault notes ----
const notes = new Set();
const noteFiles = [];
(function walkWiki(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".obsidian") continue;
      walkWiki(full);
    } else if (entry.name.endsWith(".md")) {
      noteFiles.push(full);
      notes.add(entry.name.replace(/\.md$/, ""));
    }
  }
})(WIKI);

// ---- gather repo source index for shorthand resolution ----
const allRepoFiles = [];
(function walkRepo(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkRepo(full);
    else if (CODE_EXT.test(entry.name)) allRepoFiles.push(path.relative(ROOT, full));
  }
})(ROOT);
const basenames = new Map();
for (const f of allRepoFiles) {
  const base = path.basename(f);
  if (!basenames.has(base)) basenames.set(base, f);
}

let brokenLinks = [];
let badPaths = [];

for (const file of noteFiles) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  // Walk lines tracking fenced-code state so we can honor Obsidian semantics
  // (links & code-ref checks skip fences entirely).
  let fenced = false;
  const lines = src.split("\n");
  for (const rawLine of lines) {
    const trimmedStart = rawLine.trimStart();
    if (/^```/.test(trimmedStart)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = rawLine;

    // --- wikilinks ---
    const linkRe = /\[\[([^\]\n]+)\]\]/g;
    let m;
    while ((m = linkRe.exec(line))) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      if (!target) continue;
      if (!notes.has(target)) brokenLinks.push({ file: rel, target });
    }

    // --- source-code refs ---
    const codeRe = /`([^`\n]+?\.(?:js|mjs|cjs|jsx|json|sql|sh))`/g;
    while ((m = codeRe.exec(line))) {
      let cand = m[1].trim().replace(/^\/+/, "");
      cand = cand.split(" ")[0].replace(/[)\]},.;]+$/, "").replace(/:\d+(?:-\d+)?$/, "").replace(/\.md$/, ".md").trim();
      // tolerate "file.ext" vs "dir/file.ext"; reject templates/globs outright
      if (!cand || /[*{}<>$]/.test(cand) || cand.includes("//")) continue;
      if (CODE_EXT.test(cand) === false) continue;
      if (fs.existsSync(path.join(ROOT, cand))) continue;
      const base = path.basename(cand);
      if (basenames.has(base)) continue; // shorthand mentions a real file name
      if (allRepoFiles.some((f) => f.endsWith("/" + cand))) continue; // suffix context
      badPaths.push({ file: rel, candidate: m[1].trim() });
    }
  }
}

console.log(`🔎 Scanned ${noteFiles.length} wiki notes · ${notes.size} link targets · ${allRepoFiles.length} repo source files indexed`);
if (brokenLinks.length) {
  console.log(`\n❌ Broken wikilinks (${brokenLinks.length}):`);
  for (const b of brokenLinks) console.log(`   ${b.file} → [[${b.target}]]`);
}
if (badPaths.length) {
  console.log(`\n⚠️  Source paths not found (${badPaths.length}):`);
  for (const b of badPaths) console.log(`   ${b.file} → \`${b.candidate}\``);
}
if (!brokenLinks.length && !badPaths.length) {
  console.log("✅ All wikilinks resolve · all referenced source paths verified");
}
process.exit(brokenLinks.length ? 1 : 0);