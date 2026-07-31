import fs from "fs";
import path from "path";

const OUTPUT_DIR = "content";

export function saveContent(slug, data, type = "json") {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  const dir = path.join(OUTPUT_DIR, type);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  // Fix #9: extension ternary was backwards — json → .json, anything else → .md
  const ext = type === "json" ? "json" : "md";
  const filePath = path.join(dir, `${slug}.${ext}`);

  if (type === "json") {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } else {
    fs.writeFileSync(filePath, data);
  }

  console.log(`Saved: ${filePath}`);
}
