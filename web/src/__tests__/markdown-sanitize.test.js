// --------------------------
// MARKDOWN LINK SANITIZER TESTS — pure ESM, no node_modules needed.
// Locks the scheme allowlist behind the portal's markdown renderers
// (pages/KbDetail.jsx renderMarkdown + components/Markdown.jsx): KB content
// and LLM answers are untrusted, so javascript:/data: links must never render.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeLinkUrl, safeLinkUrl } from "../markdown-sanitize.js";

describe("isSafeLinkUrl — allowed", () => {
  it("allows http and https absolute URLs", () => {
    assert.equal(isSafeLinkUrl("https://example.com/page"), true);
    assert.equal(isSafeLinkUrl("http://example.com"), true);
    assert.equal(isSafeLinkUrl("HTTPS://EXAMPLE.COM"), true);
  });

  it("allows mailto", () => {
    assert.equal(isSafeLinkUrl("mailto:info@example.com"), true);
    assert.equal(isSafeLinkUrl("MAILTO:info@example.com"), true);
  });

  it("allows site-relative shapes (resolve in an http(s) context, cannot execute)", () => {
    assert.equal(isSafeLinkUrl("/docs/page"), true);
    assert.equal(isSafeLinkUrl("./relative"), true);
    assert.equal(isSafeLinkUrl("../up/one"), true);
    assert.equal(isSafeLinkUrl("#section-anchor"), true);
    assert.equal(isSafeLinkUrl("//cdn.example.com/lib.js"), true); // protocol-relative
  });

  it("allows scheme-less text — no colon means no scheme is possible (inherently relative)", () => {
    assert.equal(isSafeLinkUrl("plain-old-text"), true);
    assert.equal(isSafeLinkUrl("www.example.com/page"), true);
    assert.equal(isSafeLinkUrl("some/path/here"), true);
  });
});

describe("isSafeLinkUrl — blocked", () => {
  it("blocks javascript: in every case form", () => {
    assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
    assert.equal(isSafeLinkUrl("JavaScript:alert(1)"), false);
    assert.equal(isSafeLinkUrl("JAVASCRIPT:alert(1)"), false);
    assert.equal(isSafeLinkUrl("JaVaScRiPt:alert(1)"), false);
  });

  it("blocks data:, vbscript:, file:, and other schemes", () => {
    assert.equal(isSafeLinkUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isSafeLinkUrl("vbscript:msgbox(1)"), false);
    assert.equal(isSafeLinkUrl("file:///etc/passwd"), false);
    assert.equal(isSafeLinkUrl("ftp://example.com/x"), false);
    assert.equal(isSafeLinkUrl("tel:+123456"), false); // not on the allowlist
  });

  it("blocks control-character scheme smuggling (browsers strip these before URL parsing)", () => {
    assert.equal(isSafeLinkUrl("jav\tascript:alert(1)"), false);
    assert.equal(isSafeLinkUrl("java\u0000script:alert(1)"), false);
    assert.equal(isSafeLinkUrl("\u0001https://example.com"), false);
    assert.equal(isSafeLinkUrl("java\nscript:alert(1)"), false);
  });

  it("blocks whitespace-padded schemes (trimmed before the scheme check)", () => {
    assert.equal(isSafeLinkUrl("  javascript:alert(1)  "), false);
  });

  it("entity-encoded colons are inert, not executable (pinned behavior)", () => {
    // "javascript&#58;x" carries no literal colon, so it classifies as
    // relative — and it genuinely is: in the raw-HTML renderer the line is
    // HTML-escaped BEFORE markup assembly (the entity cannot decode back
    // into a live scheme:), and React setAttribute never decodes entities,
    // so the browser URL-parses a scheme-less string → relative navigation.
    assert.equal(isSafeLinkUrl("javascript&#58;alert(1)"), true);
    assert.equal(safeLinkUrl("javascript&#58;alert(1)"), "javascript&#58;alert(1)");
    // The literal-colon form — the one that actually executes — is blocked.
    assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
  });
});

describe("isSafeLinkUrl — degenerate input", () => {
  it("rejects empty, null, and undefined", () => {
    assert.equal(isSafeLinkUrl(""), false);
    assert.equal(isSafeLinkUrl("   "), false);
    assert.equal(isSafeLinkUrl(null), false);
    assert.equal(isSafeLinkUrl(undefined), false);
  });

  it("bare scheme prefixes are harmless (empty resource — nothing navigable)", () => {
    // Not dangerous: an href of "https:" resolves to nothing. They pass the
    // allowlist by construction; documented here so the behavior is pinned.
    assert.equal(isSafeLinkUrl("https:"), true);
    assert.equal(isSafeLinkUrl("mailto:"), true);
    assert.equal(isSafeLinkUrl("javascript:"), false); // still blocked — not on the allowlist
  });
});

describe("safeLinkUrl", () => {
  it("returns the trimmed URL when safe", () => {
    assert.equal(safeLinkUrl("  https://example.com/a  "), "https://example.com/a");
    assert.equal(safeLinkUrl("/relative/path"), "/relative/path");
  });

  it("returns null when unsafe so callers can downgrade the link to text", () => {
    assert.equal(safeLinkUrl("javascript:alert(1)"), null);
    assert.equal(safeLinkUrl("data:text/html,<b>x</b>"), null);
    assert.equal(safeLinkUrl(null), null);
  });

  it("is consistent with isSafeLinkUrl", () => {
    const samples = [
      "https://example.com",
      "javascript:x",
      "#a",
      "//host/p",
      "mailto:a@b.c",
      "vbscript:x",
      "",
    ];
    for (const s of samples) {
      assert.equal(safeLinkUrl(s) !== null, isSafeLinkUrl(s), `mismatch for ${JSON.stringify(s)}`);
    }
  });

  it("guards external metadata URLs (KbDetail 'Open source page', catalog provider links)", () => {
    // Chunk metadata / catalog rows are stored, not literal — a poisoned
    // payload must never become a clickable footer anchor. Unsafe URLs return
    // null so the JSX renders nothing (KbDetail hides the button entirely).
    assert.equal(safeLinkUrl("https://maxicert.com/iso-9001"), "https://maxicert.com/iso-9001");
    assert.equal(safeLinkUrl("javascript:alert(document.domain)"), null);
    assert.equal(safeLinkUrl("data:text/html,<script>1</script>"), null);
    assert.equal(safeLinkUrl("jav\tascript:alert(1)"), null);
    // assembleDocumentPreview maps a missing first-chunk url to null — no link.
    assert.equal(safeLinkUrl(null), null);
  });
});
