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
// USER MESSAGE FRAMING
// --------------------------
// The core shape of every RAG prompt: context, then question. Owned here so
// the streaming and non-streaming ask paths can't drift. The context is
// already sanitized by buildContext — no second pass.
export function buildUserMessage(context, question) {
  return `CONTEXT:\n${context}\n\nQUESTION:\n${question}`;
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
