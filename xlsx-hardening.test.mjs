/*
 * xlsx（SheetJS 0.18.5）上游安全警示的防禦措施。
 *
 * npm 上沒有修好的版本可以升（修正版只發在 SheetJS 自己的 CDN），
 * 所以在我們自己的邊界做兩件事：關掉用不到的解析路徑、偵測原型污染就中止。
 * 這支測試用 parse-harness 的做法直接從 app.js 取出那幾個函式來測，
 * 測到的就是網站上實際跑的那一份，不是另外抄一份。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "app.js"), "utf8");

/** 把 SAFE_XLSX_READ_OPTIONS 那個常數宣告整段取出來。 */
function extractConst(name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `app.js 裡找不到 const ${name}`);
  const end = source.indexOf("\n};", start);
  assert.notEqual(end, -1, `const ${name} 沒有收尾`);
  return source.slice(start, end + 3);
}

const sandbox = new Function(
  [
    extractConst("SAFE_XLSX_READ_OPTIONS"),
    extractFunction("prototypeFingerprint", source),
    extractFunction("detectPrototypePollution", source),
    extractFunction("assertNoPrototypePollution", source),
    "return { SAFE_XLSX_READ_OPTIONS, prototypeFingerprint, detectPrototypePollution, assertNoPrototypePollution };",
  ].join("\n"),
)();

test("解析選項關掉了公式、內嵌 HTML 與 VBA", () => {
  assert.equal(sandbox.SAFE_XLSX_READ_OPTIONS.cellFormula, false);
  assert.equal(sandbox.SAFE_XLSX_READ_OPTIONS.cellHTML, false);
  assert.equal(sandbox.SAFE_XLSX_READ_OPTIONS.bookVBA, false);
  assert.equal(sandbox.SAFE_XLSX_READ_OPTIONS.type, "array");
});

test("匯入真的走的是那一組安全解析選項", () => {
  assert.match(
    source,
    /XLSX\.read\(await file\.arrayBuffer\(\),\s*SAFE_XLSX_READ_OPTIONS\)/,
    "parseFile 必須用 SAFE_XLSX_READ_OPTIONS，不能又寫回一組臨時選項",
  );
  assert.match(
    source,
    /assertNoPrototypePollution\(fingerprint, file\.name\)/,
    "解析完必須立刻檢查原型有沒有被污染",
  );
});

test("原型被污染時會被抓出來、清乾淨並中止", () => {
  const before = sandbox.prototypeFingerprint();
  Object.defineProperty(Object.prototype, "__speedInjected", {
    value: 1,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  assert.throws(
    () => sandbox.assertNoPrototypePollution(before, "惡意檔案.xlsx"),
    /惡意檔案\.xlsx/,
  );
  assert.equal(Object.prototype.__speedInjected, undefined);
  assert.deepEqual(sandbox.prototypeFingerprint(), before);
});

test("沒有被污染時什麼都不做", () => {
  const before = sandbox.prototypeFingerprint();
  assert.deepEqual(sandbox.detectPrototypePollution(before), []);
  assert.doesNotThrow(() =>
    sandbox.assertNoPrototypePollution(before, "正常檔案.xlsx"),
  );
});
