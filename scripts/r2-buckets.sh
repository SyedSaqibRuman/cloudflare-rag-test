#!/usr/bin/env bash
# ============================================================
# R2 DATA FETCHER — dump every R2 bucket (and optionally every
# object inside each bucket) on a Cloudflare account through the
# REST API with curl + jq. Follows every cursor page, so it gets
# ALL data, not just the first page.
#
#   CF_ACCOUNT_ID=... CF_API_TOKEN=... scripts/r2-buckets.sh [--objects]
#
#   --objects   also enumerate the objects inside each bucket
#
# Env vars:
#   CF_ACCOUNT_ID  dash.cloudflare.com → account home (the id after /accounts/)
#   CF_API_TOKEN   My Profile → API Tokens — needs "Workers R2 Storage"
#                  (Read is enough to fetch; Edit to also create/delete).
#
# Errors surface Cloudflare's own codes, e.g.:
#   CF error 10042: Please enable R2 through the Cloudflare Dashboard.
# ============================================================
set -euo pipefail

CF_API_TOKEN="${CF_API_TOKEN:?Set CF_API_TOKEN (My Profile → API Tokens, needs 'Workers R2 Storage' permission)}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID (dash.cloudflare.com → account home after /accounts/)}"
# Test override only — leave unset to hit api.cloudflare.com.
CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"

LIST_OBJECTS=0
[ "${1:-}" = "--objects" ] && LIST_OBJECTS=1

BASE="${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/r2/buckets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------------------
# page_collect <out-file> <url> <result-key>
# Follows the cursor-paginated endpoint, appending one JSON item
# per line to <out-file>. Result arrays live under .result.<key>
# (buckets / objects) and the cursor under .result.cursor.
# ------------------------------------------------------------
page_collect() {
  local out="$1" url="$2" key="$3" resp page cursor=""
  while :; do
    page="${url}${cursor:+&cursor=${cursor}}"
    resp="$(curl -sS -H "Authorization: Bearer ${CF_API_TOKEN}" "$page")"
    if [ "$(jq -r '.success' <<<"$resp")" != "true" ]; then
      jq -r '.errors[]? | "CF error \(.code): \(.message)"' <<<"$resp" >&2
      return 1
    fi
    jq -c ".result.${key}[]?" <<<"$resp" >> "$out"
    cursor="$(jq -r '.result.cursor // empty' <<<"$resp")"
    [ -n "$cursor" ] || break
  done
}

BUCKETS="$TMP/buckets.jsonl"
: > "$BUCKETS"
page_collect "$BUCKETS" "${BASE}?per_page=1000" "buckets" || exit 1

if [ "$LIST_OBJECTS" = "0" ]; then
  jq -s '{ success: true, account: $ENV.CF_ACCOUNT_ID, buckets: . }' "$BUCKETS"
else
  WITH_OBJ="$TMP/with-objects.jsonl"
  : > "$WITH_OBJ"
  while IFS= read -r bucket; do
    name="$(jq -r '.name' <<<"$bucket")"
    encoded="$(printf '%s' "$name" | jq -sRr @uri)"
    OBJ="$TMP/objects.jsonl"
    : > "$OBJ"
    page_collect "$OBJ" "${BASE}/${encoded}/objects?per_page=1000" "objects" || exit 1
    # jq -s: slurp all object rows into the array (also yields [] for an
    # empty bucket) — [inputs] would skip the first row on a single-line file.
    jq -s -c --arg name "$name" '{ name: $name, objects: . }' "$OBJ"
  done < "$BUCKETS" >> "$WITH_OBJ"
  jq -s '{ success: true, account: $ENV.CF_ACCOUNT_ID, buckets: . }' "$WITH_OBJ"
fi
