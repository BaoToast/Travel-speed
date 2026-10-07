/*
 * `test-call-count.mjs` 的守門（v2.20.83 新增）。
 *
 * 背景：`check-version.mjs` 有一條守門在比「文件宣稱某支 .test.mjs 有 N 條」與
 *   「那支檔案實際有幾條」。v2.20.82 之前那個計數器是
 *   「正規式刪註解 ＋ 行首錨點」，有兩個已知會數錯的情形（見 test-call-count.mjs 檔頭）。
 *
 * ⚠️ 這一支最重要的設計：**第 1 條把舊寫法本身當成比較基準**。
 *   只要有人把 `countTestCalls` 改回正規式版，新舊兩邊就會變成同值，第 1 條立刻紅。
 *   **所以這支守門在結構上不可能變成恆綠**——這是為了避開姊妹系統路口轉向
 *   2026-10-05 踩到的坑：那一支的第一條反證因為 fixture 擺法，舊寫法也剛好數對，
 *   換回舊版並不會紅（GPT 複查時抓到的）。
 *
 * ⚠️ 判準 5 是正控；判準 4 的同列呼叫新舊不同，是反證。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countTestCalls, legacyRegexCount } from "./test-call-count.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/* 字串裡的 `/*` 會讓舊寫法一路吃到下一個真註解的收尾，吞掉中間的 test。 */
const FX_STRING = [
  'test("a", () => {});',
  'const s = "/*";',
  'test("b", () => {});',
  "/* 真的註解 */",
  'test("c", () => {});',
].join("\n");

/* 樣板字串同理。 */
const FX_TEMPLATE = [
  'test("a", () => {});',
  "const s = `/*`;",
  'test("b", () => {});',
  "/* 真的註解 */",
  'test("c", () => {});',
].join("\n");

/* 舊寫法用行首錨點，數不到寫在同一行的第二個。 */
const FX_SAME_LINE = 'test("a", () => {});test("b", () => {});';

test("前置防恆綠：舊的正規式寫法在這三組 fixture 上必須數出不一樣的結果", () => {
  /*
   * 這一條就是「換回舊寫法會紅」的反證本體。
   * 它不是在測 legacyRegexCount 好不好，而是在釘住「新寫法真的改掉了行為」。
   */
  for (const [label, fixture] of [
    ["字串裡的 /*", FX_STRING],
    ["樣板字串裡的 /*", FX_TEMPLATE],
    ["});test( 同一行", FX_SAME_LINE],
  ]) {
    assert.notEqual(
      countTestCalls(fixture, "fixture.mjs"),
      legacyRegexCount(fixture),
      `${label}：新舊數法數出一樣的結果——是不是有人把 countTestCalls 改回正規式版了？`,
    );
  }
});

test("字串裡的 /* 不可以吞掉後面的 test 呼叫", () => {
  assert.equal(countTestCalls(FX_STRING, "fixture.mjs"), 3);
  assert.equal(legacyRegexCount(FX_STRING), 2, "舊寫法本來就會少數一條（這是它的病）");
});

test("樣板字串裡的 /* 也不可以", () => {
  assert.equal(countTestCalls(FX_TEMPLATE, "fixture.mjs"), 3);
  assert.equal(legacyRegexCount(FX_TEMPLATE), 2);
});

test("寫成 });test( 同一行的也要數到", () => {
  assert.equal(countTestCalls(FX_SAME_LINE, "fixture.mjs"), 2);
  assert.equal(legacyRegexCount(FX_SAME_LINE), 1);
});

test("正控：真的註解、行註解裡的 test 不算，latest( 也不算", () => {
  /* ⚠️ 這一條新舊都該是同值——它防的是「改了之後數過頭」，不是反證。 */
  const fx = [
    '/* test("x", () => {}) */',
    '// test("y", () => {})',
    "const latest = () => 1;",
    "latest();",
    'test("z", () => {});',
  ].join("\n");
  assert.equal(countTestCalls(fx, "fixture.mjs"), 1);
  assert.equal(legacyRegexCount(fx), 1);
});

test("樣板字串的 ${} 裡面是真程式碼，不可以被當成字串整段吞掉", () => {
  /*
   * ⚠️ 這裡要把判準的**界線**釘清楚，不要高估自己的掃描器：
   *   判準是「行首／`;`／`{`／`}` 之後的 test(」，所以
   *     ・`${ (() => { test("a", …); })() }`  → 裡面的 test( 在 `{` 之後 → **算**（舊寫法數不到）
   *     ・`${test("a", …)}`                   → 它在運算式位置 → **不算**（舊寫法也不算，兩邊同值）
   *   第二種刻意維持與舊寫法一致，因為真實測試檔不會這樣寫；
   *   真要改成全部都算，就得整支換成語法樹，那要引入新依賴（本專案刻意不引）。
   */
  const insideBlock = 'const x = `${ (() => { test("a", () => {}); })() }`;\ntest("b", () => {});';
  assert.equal(countTestCalls(insideBlock, "fixture.mjs"), 2);
  assert.equal(legacyRegexCount(insideBlock), 1, "舊寫法把整個樣板字串當文字，數不到裡面那一條");

  const expressionPosition = 'const x = `${test("a", () => {})}`;\ntest("b", () => {});';
  assert.equal(countTestCalls(expressionPosition, "fixture.mjs"), 1);
  assert.equal(legacyRegexCount(expressionPosition), 1, "這一種刻意與舊寫法同值，不是漏抓而是判準如此");
});

test("前置：本專案真的還有「字串裡含註解符號」的測試檔（引線存在才需要這支守門）", () => {
  /*
   * ⚠️ 這一條是現況紀錄＋絆索：那幾支是在測「專案自己的註解／標記規範」，
   *   所以字串裡帶註解符號是刻意的、會長期存在。
   *   哪天這一條紅了，代表風險樣貌變了，要回來重讀本檔檔頭再決定守門還要不要留。
   */
  const risky = [];
  for (const file of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
    const source = readFileSync(join(here, file), "utf8");
    if (countTestCalls(source, file) !== legacyRegexCount(source)) continue; /* 真的數錯另外由下一條管 */
    /* 粗篩：舊寫法「吃掉」的區塊明顯比真註解長，就代表被字串騙了。 */
    const eaten = (source.match(/\/\*[\s\S]*?\*\//g) || []).join("");
    if (/["'`][^"'`\n]{0,40}\/\*/.test(source) && eaten.length > 0) risky.push(file);
  }
  assert.ok(
    risky.length >= 1,
    "一支都掃不到「字串裡含 /*」的測試檔——是掃法壞了，還是那幾支被改掉了？",
  );
});

test("所有現行測試檔都要解析得動，而且新數法不可以比舊的少", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();
  assert.ok(files.length >= 50, `只掃到 ${files.length} 支測試檔——glob 或檔名規則改了？`);
  const shrunk = [];
  for (const file of files) {
    const source = readFileSync(join(here, file), "utf8");
    const now = countTestCalls(source, file); /* 解析不動會丟錯，不會安靜回 0 */
    if (now < legacyRegexCount(source)) shrunk.push(`${file}：新 ${now} ＜ 舊 ${legacyRegexCount(source)}`);
  }
  assert.deepEqual(shrunk, [], "新數法在真實檔案上反而數得比舊的少，那是掃描器寫壞了：\n  " + shrunk.join("\n  "));
});
