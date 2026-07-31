export function chunkMarkdown(md) {
  // Fix #3: move seen Set inside the function so it doesn't leak across calls
  const seen = new Set();

  const lines = md.split("\n");

  let title = "";
  let section = "";
  let buffer = [];

  const chunks = [];

  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.replace("# ", "").trim();
      continue;
    }

    if (
      line.startsWith("## ") ||
      line.startsWith("### ") ||
      line.startsWith("#### ")
    ) {
      if (buffer.length > 0) {
        const chunk = buildChunk(title, section, buffer);
        if (chunk) chunks.push(chunk);
      }

      section = normalizeSection(line.replace(/^#+\s*/, "").trim());
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  // Last chunk
  if (buffer.length > 0) {
    const chunk = buildChunk(title, section, buffer);
    if (chunk) chunks.push(chunk);
  }

  // Fallback if no chunks created
  if (chunks.length === 0 && md.length > 500) {
    const { service, country } = extractMetadata(title);

    const paragraphs = md
      .split("\n\n")
      .map(p => p.trim())
      .filter(p => p.length > 80);

    return paragraphs.map(p => ({
      title,
      service,
      country,
      section: "content",
      content: p,
    }));
  }

  return chunks
    .flat()
    .filter(Boolean)
    .map(cleanChunk)
    .filter(c => c && c.content && c.content.length > 30)
    .filter(c => {
      // Fix #3: dedup scoped to this call
      const key = c.content.slice(0, 200);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}


function buildChunk(title, section, buffer) {
  const { service, country } = extractMetadata(title);

  if (!section) section = "overview";

  let content = buffer.join("\n").trim();
  content = content.replace(/^#+\s*/gm, "");

  if (!content || content.length < 30) return null;

  const base = { title, service, country, section };

  if (section === "faq") {
    return splitFAQ(content, base);
  }

  return { ...base, content };
}


// Fix #2: single canonical extractMetadata (metadata.js consolidated here)
export function extractMetadata(title) {
  const isoMatch = title.match(/ISO\s*\d+\s*Certification/i);
  const service = isoMatch ? isoMatch[0].trim() : title.split(" in ")[0]?.trim() || title;

  const countryMatch = title.match(/in\s+([A-Za-z\s]+)$/i);
  const country = countryMatch ? countryMatch[1].trim() : "";

  return { service, country };
}


function normalizeSection(section) {
  const s = section.toLowerCase();

  if (s.includes("what") || s.includes("overview")) return "overview";
  if (s.includes("why") || s.includes("benefit"))   return "benefits";
  if (s.includes("how") || s.includes("process") || s.includes("step")) return "process";
  if (s.includes("requirement"))                     return "requirements";
  if (s.includes("cost") || s.includes("price"))    return "cost";
  if (s.includes("faq") || s.includes("question"))  return "faq";

  return section;
}


function cleanChunk(chunk) {
  let content = chunk.content;

  content = content.replace(/!\[.*?\]\(.*?\)/g, "");
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  content = content.replace(/^#+\s*/gm, "");
  content = content.replace(/get free consultation now/gi, "");
  content = content.replace(/download brochure/gi, "");
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  return { ...chunk, content };
}


function splitFAQ(content, base) {
  const lines = content.split("\n");

  let question = "";
  let answer = [];
  const faqs = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.endsWith("?")) {
      if (question) {
        faqs.push({
          ...base,
          section: "faq",
          question,
          content: answer.join("\n").trim(),
        });
      }

      question = trimmed;
      answer = [];
    } else {
      answer.push(line);
    }
  }

  if (question) {
    faqs.push({
      ...base,
      section: "faq",
      question,
      content: answer.join("\n").trim(),
    });
  }

  return faqs;
}
