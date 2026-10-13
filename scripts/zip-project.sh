#!/bin/bash

# --------------------------
# 🔹 CONFIG
# --------------------------
# Anchor to the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."
ZIP_NAME="cloudflare-rag.zip"

# --------------------------
# 🔹 REMOVE OLD ZIP
# --------------------------
rm -f "$ZIP_NAME"

# --------------------------
# 🔹 CREATE ZIP
# --------------------------
# NOTE: zip matches -x patterns against the full relative path, so
# "node_modules/*" alone would NOT exclude web/node_modules — use *node_modules/*.
# *.md excludes docs/wiki; .env.example intentionally SHIPS (no secrets —
# it documents the required vars).
zip -r "$ZIP_NAME" . \
  -x "*node_modules/*" \
  -x ".git/*" \
  -x "content/*" \
  -x "logs/*" \
  -x "db/*" \
  -x "backup/*" \
  -x "archive-*/*" \
  -x ".crush/*" \
  -x ".vscode/*" \
  -x ".claude/*" \
  -x "*.obsidian/*" \
  -x ".scratch/*" \
  -x "playwright/*" \
  -x "test-results/*" \
  -x "processed/*" \
  -x "*.tar.gz" \
  -x "*.mjs.tmp" \
  -x ".env" \
  -x ".env.local" \
  -x ".env.production" \
  -x "web/.env.local" \
  -x "web/.env.local.*" \
  -x ".gitignore" \
  -x "processed*.json" \
  -x "*.zip" \
  -x "*.log" \
  -x "*.sh" \
  -x "*.md" \
  -x "$ZIP_NAME"

# --------------------------
# 🔹 DONE
# --------------------------
echo "✅ Created $ZIP_NAME"
