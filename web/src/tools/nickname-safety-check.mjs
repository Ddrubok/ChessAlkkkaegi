import assert from "node:assert/strict";
import { escapeHtml } from "../html.ts";

// Exercise the production encoder, including quoted-attribute breakout and entities.
assert.equal(escapeHtml('\"><svg/onload=alert(1)>'), "&quot;&gt;&lt;svg/onload=alert(1)&gt;");
assert.equal(escapeHtml("O'Connor & <친구>"), "O&#39;Connor &amp; &lt;친구&gt;");
assert.equal(escapeHtml("&lt;img&gt;"), "&amp;lt;img&amp;gt;");
assert.equal(escapeHtml(null), "");
assert.equal(escapeHtml(undefined), "");
assert.equal(escapeHtml(123), "123");
assert.equal(escapeHtml("체스 친구"), "체스 친구");
console.log("PASS: production HTML encoder preserves text and blocks tag/attribute injection");
