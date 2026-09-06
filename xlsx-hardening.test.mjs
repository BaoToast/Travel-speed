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

/*
 * ⚠️ 這一支原本只讀 app.js。
 *
 * 但 quality-extension.js 為了抓來源儲存格位置，會對同一個檔案做**第二次**
 * XLSX.read；舊版那一次用的是自己寫的一組較弱選項、而且解析後沒有比對原型。
 * 因為守門測試看不到那個檔案，這個缺口一直是綠燈——實測讓第二次解析污染
 * Object.prototype，匯入照常完成、畫面寫「新增 4，重複 0」，零警告。
 *
 * 所以改成掃描**所有會解析活頁簿的檔案**，逐一要求它們走同一組安全選項。
 */
const PARSING_FILES = ["app.js", "quality-extension.js", "excel-export.js"];
const sources = PARSING_FILES.map((name) => [
  name,
  readFileSync(join(here, name), "utf8"),
]);

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

test("每一個會解析活頁簿的檔案都走同一組安全選項，而且解析後有比對原型", () => {
  for (const [name, text] of sources) {
    /*
     * 用「整行」比對而不是括號內容：arrayBuffer() 自己就有一個右括號，
     * 用 [^)]* 會在那裡就斷掉，變成永遠比不到選項名稱的假失敗。
     */
    const lines = text.split("\n");
    const reads = lines.filter((line) => line.includes("XLSX.read("));
    if (!reads.length) continue;
    for (const line of reads) {
      assert.match(
        line,
        /SAFE_XLSX_READ_OPTIONS/,
        `${name} 的 XLSX.read 必須用 SAFE_XLSX_READ_OPTIONS，不能自己寫一組臨時選項：${line.trim()}`,
      );
    }
    assert.match(
      text,
      /assertNoPrototypePollution\(/,
      `${name} 解析完必須比對原型有沒有被污染`,
    );
  }
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
