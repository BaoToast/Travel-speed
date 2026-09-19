/*
 * ══════════════════════════════════════════════════════════════════════
 *  服務水準門檻的適用範圍：解析順位與「沒有覆寫時完全無感」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：「新增一個依照每季和各路段／路口，當衝突發生時，
 *   **以每季優先**（和另外兩程式一致的判斷方式）」。
 *
 * ⚠️ A 段守的是**最重要的那一條不變量**：沒有任何覆寫時，回傳的必須是
 *   原本那一組計畫預設門檻（而且是**同一個物件參考**）。
 *   這一條不成立的話，這個改版就會動到每一個既有使用者的數字。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scope = {};
new Function(readFileSync(join(here, "los-rule-scope.js"), "utf8")).call(scope);
const LRS = scope.LosRuleScope || globalThis.LosRuleScope;

const DEFAULT = { A: 0.8, B: 0.7, C: 0.6, D: 0.5, E: 0.4 };
const seasonRule = { A: 0.9, B: 0.8, C: 0.7, D: 0.6, E: 0.5 };
const roadRule = { A: 0.75, B: 0.65, C: 0.55, D: 0.45, E: 0.35 };
const bothRule = { A: 0.95, B: 0.85, C: 0.75, D: 0.65, E: 0.55 };

test("A・沒有任何覆寫時，回傳的就是計畫預設（同一個物件參考）", () => {
  const got = LRS.resolveLosRule(DEFAULT, [], "115Q1", "A路段");
  assert.equal(got.rules, DEFAULT, "必須是同一個物件參考，不是複製一份");
  assert.equal(got.tier, "project-default");
});

test("A・空的／壞掉的覆寫清單也一律落回計畫預設", () => {
  for (const bad of [null, undefined, [], [null], [{ period: "*" }]])
    assert.equal(
      LRS.resolveLosRule(DEFAULT, bad, "115Q1", "A路段").rules,
      DEFAULT,
    );
});

test("B・季別 × 路段 最優先", () => {
  const scopes = [
    { period: "*", road: "A路段", rules: roadRule },
    { period: "115Q1", road: "*", rules: seasonRule },
    { period: "115Q1", road: "A路段", rules: bothRule },
  ];
  const got = LRS.resolveLosRule(DEFAULT, scopes, "115Q1", "A路段");
  assert.equal(got.rules, bothRule);
  assert.equal(got.tier, "period-road");
});

test("⚠️ C・季別優先：同一季的全路段設定**蓋過**路段專屬設定", () => {
  /*
   * 這是使用者指定的順位（「當衝突發生時，以每季優先」），
   * 也是三支程式共用的規則。
   * ⚠️ 這一條寫反的話，畫面不會有任何異常——只是等級會悄悄變成另一組。
   */
  const scopes = [
    { period: "*", road: "A路段", rules: roadRule },
    { period: "115Q1", road: "*", rules: seasonRule },
  ];
  assert.equal(
    LRS.resolveLosRule(DEFAULT, scopes, "115Q1", "A路段").rules,
    seasonRule,
  );
  /* 不是那一季的話，才輪到路段專屬。 */
  assert.equal(
    LRS.resolveLosRule(DEFAULT, scopes, "115Q2", "A路段").rules,
    roadRule,
  );
  /* 兩個都不符時落回預設。 */
  assert.equal(
    LRS.resolveLosRule(DEFAULT, scopes, "115Q2", "B路段").rules,
    DEFAULT,
  );
});

test("D・重疊要挑得出來（不可以默默套用）", () => {
  const scopes = [
    { period: "*", road: "A路段", rules: roadRule },
    { period: "115Q1", road: "*", rules: seasonRule },
  ];
  const hits = LRS.conflictsIn(scopes);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].winnerLabel, "這一季 × 全路段");
  assert.equal(hits[0].loserLabel, "全季別 × 這一路段");
});

test("D・沒有重疊時不可以亂報", () => {
  assert.equal(
    LRS.conflictsIn([
      { period: "115Q1", road: "A路段", rules: bothRule },
      { period: "115Q2", road: "B路段", rules: roadRule },
    ]).length,
    0,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  季別**區間**覆寫（2026-09-15 使用者定案：「季別功能擴增為季別區間」）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一段的每一條都直接決定「這一筆資料用哪一組門檻」——
 *   錯一次，畫面、Excel、報告草稿、歷季趨勢會一起錯，而且錯得很安靜。
 */
const S = globalThis.LosRuleScope;

test("區間：起與迄都含在內（closed interval）", () => {
  const fallback = { A: 0.9 };
  const scopes = [
    { periodFrom: "115Q1", periodTo: "115Q3", road: S.ANY, rules: { A: 0.5 } },
  ];
  for (const period of ["115Q1", "115Q2", "115Q3"])
    assert.equal(
      S.resolveLosRule(fallback, scopes, period, "甲").rules.A,
      0.5,
      `${period} 應該命中`,
    );
  assert.equal(
    S.resolveLosRule(fallback, scopes, "115Q4", "甲").rules.A,
    0.9,
    "115Q4 在區間外，要退回計畫預設",
  );
  assert.equal(
    S.resolveLosRule(fallback, scopes, "114Q4", "甲").rules.A,
    0.9,
    "114Q4 在區間外，要退回計畫預設",
  );
});

test("區間：只設起（迄不限）＝「從這一季開始一直有效」", () => {
  /*
   * ⚠️ 這正是速限最常見的情形：「某一季改了速限，之後都用新的」。
   *   只設一邊時另一邊必須當成不限，不可以當成「只有那一季」。
   */
  const fallback = { A: 0.9 };
  const scopes = [
    { periodFrom: "115Q2", periodTo: S.ANY, road: S.ANY, rules: { A: 0.4 } },
  ];
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q1", "甲").rules.A, 0.9);
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q2", "甲").rules.A, 0.4);
  assert.equal(S.resolveLosRule(fallback, scopes, "116Q4", "甲").rules.A, 0.4);
});

test("同一層有多條命中時，取**涵蓋季數最少**的那一條", () => {
  /*
   * ⚠️ 季別改成區間之後這一定會發生：大區間與單季例外同時存在。
   *   取第一個命中的話，後來補設的單季例外會被早就存在的大區間蓋掉——
   *   使用者看到的是「我設了卻沒用」。
   */
  const fallback = { A: 0.9 };
  const scopes = [
    { periodFrom: "115Q1", periodTo: "115Q4", road: S.ANY, rules: { A: 0.5 } },
    { periodFrom: "115Q2", periodTo: "115Q2", road: S.ANY, rules: { A: 0.2 } },
  ];
  assert.equal(
    S.resolveLosRule(fallback, scopes, "115Q2", "甲").rules.A,
    0.2,
    "單季例外要贏過大區間",
  );
  assert.equal(
    S.resolveLosRule(fallback, scopes, "115Q3", "甲").rules.A,
    0.5,
    "例外之外仍然用大區間",
  );
});

test("順位不變：季別優先於路段（跨層的順位不受區間影響）", () => {
  const fallback = { A: 0.9 };
  const scopes = [
    { periodFrom: S.ANY, periodTo: S.ANY, road: "甲", rules: { A: 0.3 } },
    { periodFrom: "115Q1", periodTo: "115Q4", road: S.ANY, rules: { A: 0.6 } },
  ];
  assert.equal(
    S.resolveLosRule(fallback, scopes, "115Q2", "甲").rules.A,
    0.6,
    "季別區間要蓋過全季別的路段設定",
  );
});

test("舊資料（單一 period）要讀得回來，等價於起＝迄", () => {
  /*
   * ⚠️ 使用者已經存過的覆寫是單一季別。直接改欄位名會讓那些設定
   *   **安靜地失效**——畫面上每一格都還在，只是全部退回計畫預設。
   */
  const fallback = { A: 0.9 };
  const scopes = [{ period: "115Q2", road: S.ANY, rules: { A: 0.1 } }];
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q2", "甲").rules.A, 0.1);
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q3", "甲").rules.A, 0.9);
});

test("方向：沒指定方向的覆寫，兩個方向都適用", () => {
  const fallback = { v: 0 };
  const scopes = [
    { periodFrom: S.ANY, periodTo: S.ANY, road: "甲", rules: { v: 50 } },
  ];
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q2", "甲", "方向1").rules.v, 50);
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q2", "甲", "方向2").rules.v, 50);
});

test("方向：指定了方向的覆寫，只對那個方向生效", () => {
  const fallback = { v: 0 };
  const scopes = [
    {
      periodFrom: S.ANY,
      periodTo: S.ANY,
      road: "甲",
      direction: "方向1",
      rules: { v: 40 },
    },
  ];
  assert.equal(S.resolveLosRule(fallback, scopes, "115Q2", "甲", "方向1").rules.v, 40);
  assert.equal(
    S.resolveLosRule(fallback, scopes, "115Q2", "甲", "方向2").rules.v,
    0,
    "另一個方向要退回預設，不可以被帶走",
  );
});

test("重疊偵測：兩個有交集的區間要被挑出來講", () => {
  const hits = S.conflictsIn([
    { periodFrom: "115Q2", periodTo: "115Q2", road: "甲", rules: { A: 1 } },
    { periodFrom: "115Q1", periodTo: "115Q4", road: S.ANY, rules: { A: 2 } },
  ]);
  assert.ok(hits.length > 0, "有交集就要報出來，不可以默默吃掉");
});

test("重疊偵測：沒有交集的兩個區間不可以誤報", () => {
  const hits = S.conflictsIn([
    { periodFrom: "115Q1", periodTo: "115Q2", road: "甲", rules: { A: 1 } },
    { periodFrom: "115Q3", periodTo: "115Q4", road: "甲", rules: { A: 2 } },
  ]);
  assert.deepEqual(hits, [], "沒交集卻報重疊＝守門在製造噪音");
});

test("⚠️ 季別索引全站只有一份：別的檔案不可以自己再寫一次", () => {
  /*
   * 三份各寫各的一旦漂移，同一季在不同地方會得到不同答案——
   * 那是直接影響數字的錯，而且畫面上每一格看起來都很合理。
   */
  const files = ["./app.js", "./main-toolbar.js", "./main-filters.js"];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = readFileSync(new URL(file, import.meta.url), "utf8");
    } catch {
      continue;
    }
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    if (/\(\\d\{2,4\}\)Q\(\[1-4\]\)/.test(stripped)) bad.push(file);
  }
  assert.deepEqual(
    bad,
    [],
    "這些檔案自己又寫了一份季別索引，請改成轉呼叫 LosRuleScope.periodIndex：\n" +
      bad.join("\n"),
  );
});
