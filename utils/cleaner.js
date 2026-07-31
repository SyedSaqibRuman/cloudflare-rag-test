import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
});

turndown.remove([
  "script",
  "style",
  "noscript",
  "iframe",
  "form",
]);

export function cleanContent(html) {
  let md = turndown.turndown(html);

  // ONLY minimal cleaning (IMPORTANT)
  md = md.replace(/!\[.*?\]\(.*?\)/g, ""); // images

  // DO NOT remove links completely (keep structure)
  // DO NOT remove bullets
  // DO NOT remove headings aggressively

  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}
