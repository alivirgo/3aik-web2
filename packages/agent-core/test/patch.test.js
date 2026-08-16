import test from "node:test";
import assert from "node:assert/strict";
import { applyUnifiedPatch } from "../src/index.js";

test("applies multiple unified diff operations", () => {
  const source = "one\ntwo\nthree\n";
  const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 one
-two
+TWO
 three
+four`;
  assert.equal(applyUnifiedPatch(source, patch), "one\nTWO\nthree\nfour\n");
});

test("rejects context mismatches and malformed hunks", () => {
  assert.throws(() => applyUnifiedPatch("one\n", "@@ -1 +1 @@\n-wrong\n+right"), { code: "patch_mismatch" });
  assert.throws(() => applyUnifiedPatch("one\n", "not a patch"), { code: "invalid_patch" });
  assert.throws(() => applyUnifiedPatch("one\n", "@@ -1,2 +1 @@\n-one"), { code: "invalid_patch" });
});
