/*
 * 服務水準門檻必須「每個計畫各自獨立」。
 *
 * 使用者問的情境：A 計畫用預設門檻，B 計畫改成特殊門檻，
 * B 的設定會不會影響到 A？畫面上「服務水準判定方式」那一區寫著
 * 「門檻依目前計畫分別保存」——**寫了就必須是真的**。
 *
 * 這一支之所以存在：同一套系統的車種當量、轉向當量都曾經是
 * 「畫面說各計畫獨立、程式其實共用一份」，換一個委託案之後每一張報表的
 * 數字都用到別人的係數，而畫面沒有任何警示。服務水準門檻是同一類東西
 * （每個計畫的判定標準可能依委託單位而不同），所以用測試釘住。
 *
 * 測的是 app.js 裡實際跑的那幾個函式，不是另外抄一份。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunction } from "./parse-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "app.js"), "utf8");

/** 用一份假的 state 把 rulesFor / losOf 拉出來跑。 */
function sandbox(losRules, activeCode) {
  return new Function(
    "state",
    [
      "const DEFAULT_LOS_RULE = { A: 0.8, B: 0.6, C: 0.5, D: 0.4, E: 0.2 };",
      extractFunction("rulesFor", source),
      extractFunction("losOf", source),
      "return { rulesFor, losOf };",
    ].join("\n"),
  )({ losRules, activeCode });
}

/* A 計畫沿用預設；B 計畫把門檻整組調嚴。 */
const RULES = {
  "A-PROJ": undefined, // 沒有自訂 → 預設
  "B-PROJ": { A: 0.95, B: 0.9, C: 0.85, D: 0.8, E: 0.7 },
};
const losRules = { "B-PROJ": RULES["B-PROJ"] };

test("同一個速限比，在兩個計畫可以判成不同等級", () => {
  const { losOf } = sandbox(losRules, "A-PROJ");
  /* 速限比 0.82：預設門檻是 A（≥0.8）；B 計畫的門檻下只到 D（≥0.8 但 <0.85） */
  assert.equal(losOf(0.82, "A-PROJ"), "A");
  assert.equal(losOf(0.82, "B-PROJ"), "D");
});

test("B 計畫設定了門檻，不會影響 A 計畫", () => {
  const before = sandbox({}, "A-PROJ").rulesFor("A-PROJ");
  const after = sandbox(losRules, "A-PROJ").rulesFor("A-PROJ");
  assert.deepEqual(
    after,
    before,
    "B 計畫存了自訂門檻之後，A 計畫拿到的門檻必須完全沒變",
  );
  assert.deepEqual(after, { A: 0.8, B: 0.6, C: 0.5, D: 0.4, E: 0.2 });
});

test("沒有自訂門檻的計畫拿到的是系統預設，不是別人的設定", () => {
  const { rulesFor } = sandbox(losRules, "B-PROJ");
  /* 就算目前開著的是 B 計畫，問 A 計畫仍然要回預設 */
  assert.deepEqual(rulesFor("A-PROJ"), {
    A: 0.8,
    B: 0.6,
    C: 0.5,
    D: 0.4,
    E: 0.2,
  });
  assert.deepEqual(rulesFor("B-PROJ"), RULES["B-PROJ"]);
});

test("自訂門檻只覆蓋有給的等級，其餘沿用預設", () => {
  const { rulesFor } = sandbox({ "C-PROJ": { A: 0.9 } }, "C-PROJ");
  assert.deepEqual(rulesFor("C-PROJ"), {
    A: 0.9,
    B: 0.6,
    C: 0.5,
    D: 0.4,
    E: 0.2,
  });
});

/*
 * 上面測的是「查表正確」。真正會出事的地方是**重算**：
 * 如果重算時對每一列都套用「目前開著的計畫」的門檻，那麼在 B 計畫底下
 * 按一次「套用並重新計算」，A 計畫的每一列都會被 B 的門檻改寫，
 * 而畫面只會說「已重新計算」。所以這裡直接釘住那一行的寫法。
 */
test("重算時每一列用的是自己計畫的門檻，不是目前開著的計畫", () => {
  const rebuild = extractFunction("rebuild", source);
  assert.match(
    rebuild,
    /losOf\(d\.ratio,\s*d\.projectCode\)/,
    "rebuild() 必須傳入每一列自己的 projectCode",
  );
  assert.doesNotMatch(
    rebuild,
    /losOf\(d\.ratio\)(?!\s*,)/,
    "rebuild() 裡不可以有省略 projectCode 的呼叫",
  );
});

test("跨計畫比較（Manager）顯示時也用各自計畫的門檻", () => {
  /*
   * Manager 會同時列出多個計畫的資料，是最容易套錯門檻的畫面。
   * 這裡確認凡是處理「可能來自不同計畫」的列，都有把 projectCode 傳進去。
   */
  const calls = [...source.matchAll(/(?<!function )losOf\(([^)]*)\)/g)]
    .map((m) => m[0])
    /* 排除函式定義本身（losOf(r, code = state.activeCode)） */
    .filter((call) => !call.includes("state.activeCode"));
  const withoutCode = calls.filter(
    (call) => !/,\s*(d\.projectCode|r\.projectCode|code|p\.code)\)/.test(call),
  );
  /*
   * 允許省略計畫代碼的只有「一定發生在目前計畫」的三處：
   *   1. 匯入解析（parseFile，寫進去的就是目前計畫）
   *   2. 匯入預覽重新指定路段（remapPending，同上）
   *   3. 路段尾碼清理（cleanSuffix，已先用 projectCode === 目前計畫篩選過）
   * 這三處省略之後會落到預設值 state.activeCode，剛好正確。
   *
   * 數量若增加，代表有人在新的地方省略了計畫代碼，而那個地方**不一定**
   * 保證是目前計畫——那就會是「B 計畫的門檻套到 A 計畫的資料上」。
   * 請回來確認新增的那一處，不要直接把數字改大。
   */
  assert.ok(
    withoutCode.length <= 3,
    `有 ${withoutCode.length} 處 losOf() 沒有傳計畫代碼（允許 3 處）：${withoutCode.join(" / ")}`,
  );
});

test("刪除計畫時會一併清掉它的門檻設定", () => {
  assert.match(
    source,
    /delete state\.losRules\[code\]/,
    "刪除計畫必須清掉 losRules，否則同代碼的新計畫會沿用舊門檻",
  );
});

test("備份與還原會帶著每個計畫自己的門檻", () => {
  /* 單一計畫的專案包 */
  assert.match(source, /losRule:\s*rulesFor\(p\.code\)/);
  /* 還原時寫回該計畫，沒有就刪掉（不能留著別人的） */
  assert.match(source, /state\.losRules\[x\.project\.code\]\s*=\s*x\.losRule/);
  assert.match(source, /delete state\.losRules\[x\.project\.code\]/);
  /* 全機備份 */
  assert.match(source, /losRules:\s*state\.losRules/);
});
