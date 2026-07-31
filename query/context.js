// --------------------------
// CONFIGURATION
// --------------------------
const MAX_CONTEXT_CHARS = 4000;

// --------------------------
// SANITIZATION
// --------------------------
export function sanitizeText(text = "") {
  return text
    .replace(/ignore previous instructions|system prompt|developer instructions/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------
// CONTEXT BUILDER
// --------------------------
export function buildContext(chunks = []) {
  if (!chunks || !chunks.length) return "";
  let context = "",
    count = 1;
  for (const c of chunks) {
    if (!c?.content) continue;
    const section = `\n[Source ${count}]\nTitle: ${sanitizeText(c.title || "Untitled")}\nContent: ${sanitizeText(c.content)}\n`;
    if ((context + section).length > MAX_CONTEXT_CHARS) break;
    context += section;
    count++;
  }
  return context.trim();
}
