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
zip -r "$ZIP_NAME" . \
  -x ".git/*" \
  -x "content/*" \
  -x "logs/*" \
  -x "node_modules/*" \
  -x ".env" \
  -x ".gitignore" \
  -x "processed.json" \
  -x "*.sh" \
  -x "*.md" \
  -x "$ZIP_NAME"

# --------------------------
# 🔹 DONE
# --------------------------
echo "✅ Created $ZIP_NAME"
