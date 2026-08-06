import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("keeps the Windows PowerShell 5.1 example builder ASCII-safe", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "build-example.ps1"));

  assert.equal(
    script.some((byte) => byte > 0x7f),
    false,
    "build-example.ps1 must remain ASCII-only unless it is deliberately saved with a UTF-8 BOM",
  );

  const source = script.toString("ascii");
  assert.match(source, /\[char\]0x7FFB \+ \[char\]0x8BD1/);
  assert.match(source, /\[char\]0x81EA \+ \[char\]0x5B9A \+ \[char\]0x4E49/);
});
