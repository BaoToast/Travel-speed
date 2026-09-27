/*
 * ══════════════════════════════════════════════════════════════════════
 *  季度改名必須把「鍵裡帶著季別」的設定全部搬走（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * 2026-09-24 的獨立複查發現，季度改名只搬了四樣
 * （details.period、imports.period、losRuleScopes、bandRuleScopes），
 * 而下面四組設定的鍵也帶著季別，全部沒搬：
 *
 *   ① state.speedVersions[*][].start / .end   ← **最嚴重：會改變服務水準**
 *   ② state.surveyDateOverrides[計畫][季別|檔名]
 *   ③ state.reportDrafts[計畫|季別區間…]
 *   ④ state.ackedIssues[計畫][…季別…]
 *
 * 其中 ① 的後果是：speedFor() 是
 * `periodKey(row.period) >= periodKey(v.start)`，改名之後版本速限不再命中
 * → d.limit 退回基準或 50 → d.ratio 變 → **d.los 變**。
 * 也就是「只改一個季度名稱，服務水準就變了」，而畫面只說「季度已改為…」。
 * 同一支程式的路段改名（applyRoadChange）早就搬了速限版本，
 * 還在那裡寫著「否則整組速限設定會變成孤兒、速限悄悄退回預設值」。
 *
 * ⚠️ 原本的守門 e2e-rename-quarter.mjs 對 speedVersions／
 *   surveyDateOverrides／reportDrafts 三個字串**各 0 次命中**，
 *   所以這個缺陷完全沒有保護。
 *
 * ⚠️ 反證：把 app.js 裡新加的那四段搬移（renameKeyedByPeriod 與
 *   speedVersions 那個迴圈）拿掉，這一支就會紅。已驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "app.js"), "utf8");
const periodIndexForTest = (value) => {
  const match = String(value || "").match(/^(\d{2,4})Q([1-4])$/);
  return match ? Number(match[1]) * 4 + Number(match[2]) : -1;
};

/**
 * 把 renameQuarter 的 onclick 本體切出來，在一個假的 state 上重現它的搬移邏輯。
 *
 * ⚠️ 這裡故意**不另外抄一份搬移程式**：抄一份就變成「測試自己的副本」，
 *   app.js 改壞了測試照樣綠。做法是把真正那一段原始碼切出來 eval。
 */
function migrationFrom(appSource) {
  const start = appSource.indexOf('$("renameQuarter").onclick');
  assert.notEqual(start, -1, "找不到季度改名的 onclick——它被改名或刪掉了");
  const end = appSource.indexOf("\n};", start);
  assert.notEqual(end, -1, "季度改名的 onclick 括號不成對");
  const body = appSource.slice(start, end);

  /* 只取「確認之後」到 rebuild() 之前那一段，也就是真正在搬東西的部分。 */
  const afterConfirm = body.indexOf("for (const row of state.details)");
  assert.notEqual(afterConfirm, -1, "找不到搬移段的起點");
  const beforeRebuild = body.indexOf("rebuild();", afterConfirm);
  assert.notEqual(beforeRebuild, -1, "找不到搬移段的終點（rebuild()）");
  const migration = body.slice(afterConfirm, beforeRebuild);

  for (const must of [
    "state.speedVersions",
    "state.surveyDateOverrides",
    "state.reportDrafts",
    "state.ackedIssues",
  ])
    assert.ok(
      migration.includes(must),
      `季度改名沒有處理 ${must}——那一組設定的鍵帶著季別，改名後會變成孤兒`,
    );

  const run = new Function(
    "state",
    "p",
    "from",
    "next",
    "periodIndex",
    migration +
      "\nreturn { movedSpeedVersions, movedSurveyDates, movedDrafts, movedAcks };",
  );
  return (state, p, from, next) => run(state, p, from, next, periodIndexForTest);
}

const migrate = migrationFrom(source);

function freshState() {
  return {
    activeCode: "P1",
    details: [
      { projectCode: "P1", period: "115Q1", road: "甲路", direction: "方向1" },
      { projectCode: "P1", period: "115Q2", road: "甲路", direction: "方向1" },
      { projectCode: "P2", period: "115Q1", road: "乙路", direction: "方向1" },
    ],
    imports: [
      { projectCode: "P1", period: "115Q1" },
      { projectCode: "P2", period: "115Q1" },
    ],
    losRuleScopes: { P1: [{ periodFrom: "115Q1", periodTo: "115Q1" }] },
    bandRuleScopes: { P1: [{ period: "115Q1" }] },
    speedVersions: {
      "P1|甲路|方向1": [{ id: "v1", speed: 90, start: "115Q1", end: "" }],
      "P1|甲路|方向2": [{ id: "v2", speed: 60, start: "115Q1", end: "115Q1" }],
      "P2|乙路|方向1": [{ id: "v3", speed: 70, start: "115Q1", end: "" }],
    },
    surveyDateOverrides: {
      P1: { "115Q1|甲路.xlsx": "2026-05-08", "115Q2|甲路.xlsx": "2026-08-01" },
      P2: { "115Q1|乙路.xlsx": "2026-05-01" },
    },
    reportDrafts: {
      "P1|115Q1": "第一季草稿",
      "P1|115Q1-115Q2": "跨季草稿",
      "P1|115Q1|方向1|上午尖峰": "細分草稿",
      "P2|115Q1": "別的計畫的草稿",
    },
    ackedIssues: {
      P1: { "速限未確認|115Q1|甲路": true, "速限未確認|115Q2|甲路": true },
      P2: { "速限未確認|115Q1|乙路": true },
    },
  };
}

const P = { code: "P1", name: "測試計畫" };

test("① 速限版本的季別區間會跟著改名（這一項會改變服務水準）", () => {
  const state = freshState();
  const moved = migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.speedVersions["P1|甲路|方向1"][0].start,
    "114Q4",
    "版本速限的開始季別沒有跟著改 → speedFor() 不再命中 → LOS 會無聲變動",
  );
  assert.equal(
    state.speedVersions["P1|甲路|方向2"][0].start,
    "114Q4",
    "同一個計畫的另一個路段方向也要搬",
  );
  assert.equal(
    state.speedVersions["P1|甲路|方向2"][0].end,
    "114Q4",
    "結束季別也要搬（只搬 start 會讓區間反過來）",
  );
  assert.ok(moved.movedSpeedVersions >= 3, "搬移筆數要回報得出來");
});

test("① 別的計畫的速限版本不可以被動到", () => {
  const state = freshState();
  migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.speedVersions["P2|乙路|方向1"][0].start,
    "115Q1",
    "改 P1 的季度卻動到 P2 的速限版本——計畫之間不可以互相干擾",
  );
});

test("② 調查日期覆寫會跟著改名，且不動到別季與別的計畫", () => {
  const state = freshState();
  migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.surveyDateOverrides.P1["114Q4|甲路.xlsx"],
    "2026-05-08",
    "使用者指定的調查日期沒有跟著改 → 靜靜退回系統判讀值",
  );
  assert.ok(
    !("115Q1|甲路.xlsx" in state.surveyDateOverrides.P1),
    "舊鍵要刪掉，不可以兩個鍵並存",
  );
  assert.equal(
    state.surveyDateOverrides.P1["115Q2|甲路.xlsx"],
    "2026-08-01",
    "沒有被改名的那一季不可以被動到",
  );
  assert.equal(
    state.surveyDateOverrides.P2["115Q1|乙路.xlsx"],
    "2026-05-01",
    "別的計畫不可以被動到",
  );
});

test("③ 報告文字草稿會跟著改名，單季與跨季區間都要處理", () => {
  const state = freshState();
  migrate(state, P, "115Q1", "114Q4");
  assert.equal(state.reportDrafts["P1|114Q4"], "第一季草稿", "單季草稿沒搬");
  assert.equal(
    state.reportDrafts["P1|114Q4-115Q2"],
    "跨季草稿",
    "跨季區間的草稿沒搬（區間是 `起-訖` 兩段，只換其中一段也算沒搬對）",
  );
  assert.equal(
    state.reportDrafts["P1|114Q4|方向1|上午尖峰"],
    "細分草稿",
    "帶方向與尖峰的草稿沒搬",
  );
  assert.equal(
    state.reportDrafts["P2|115Q1"],
    "別的計畫的草稿",
    "別的計畫的草稿不可以被動到",
  );
});

test("④ 已人工確認的異常會跟著改名", () => {
  const state = freshState();
  migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.ackedIssues.P1["速限未確認|114Q4|甲路"],
    true,
    "已按過「已人工確認」的異常沒搬 → 改完名之後會重新跳出來",
  );
  assert.equal(
    state.ackedIssues.P1["速限未確認|115Q2|甲路"],
    true,
    "沒有被改名的那一季不可以被動到",
  );
  assert.equal(
    state.ackedIssues.P2["速限未確認|115Q1|乙路"],
    true,
    "別的計畫不可以被動到",
  );
});

test("④-b 真實 JSON 指紋鍵會跟著改名（不是只驗不存在的 pipe 假鍵）", () => {
  const state = freshState();
  const oldKey = JSON.stringify([
    "trend-change",
    "115Q1",
    "115Q2",
    "甲路",
    "平日",
    "甲路／平日",
    "相較 115Q1：旅行速率下降 30.0%",
  ]);
  state.ackedIssues.P1 = { [oldKey]: { at: "2026-09-26T00:00:00.000Z" } };
  migrate(state, P, "115Q1", "114Q4");
  const expected = JSON.stringify([
    "trend-change",
    "114Q4",
    "115Q2",
    "甲路",
    "平日",
    "甲路／平日",
    "相較 114Q4：旅行速率下降 30.0%",
  ]);
  assert.deepEqual(
    state.ackedIssues.P1[expected],
    { at: "2026-09-26T00:00:00.000Z" },
    "正式指紋是 JSON 陣列；用 split('|') 會讓真實確認紀錄一筆都搬不到",
  );
  assert.equal(state.ackedIssues.P1[oldKey], undefined, "搬完仍殘留舊季度的 JSON 指紋");
});

test("①-b 改名會使速限／判定區間倒置時必須在寫入前擋下", () => {
  const start = source.indexOf("function quarterRenameInvalidRanges");
  assert.notEqual(start, -1, "找不到季度改名的區間預檢");
  const end = source.indexOf("\n}\n\n$(\"renameQuarter\")", start) + 2;
  assert.ok(end > start, "切不出季度改名的區間預檢函式");
  const fnSource = source.slice(start, end);
  const state = freshState();
  state.speedVersions["P1|甲路|方向1"] = [
    { id: "bad-after-rename", speed: 50, start: "115Q1", end: "115Q2" },
  ];
  state.losRuleScopes.P1 = [{ periodFrom: "115Q1", periodTo: "115Q2" }];
  const inspect = new Function(
    "state",
    "periodIndex",
    `${fnSource}; return quarterRenameInvalidRanges;`,
  )(state, periodIndexForTest);
  const invalid = inspect("P1", "115Q1", "115Q3");
  assert.deepEqual(
    invalid.sort(),
    ["服務水準判定門檻覆寫", "速限版本"].sort(),
    "115Q1–115Q2 改成 115Q3–115Q2 會使設定失效，卻沒有被完整攔下",
  );
  assert.match(source, /本次沒有變更任何資料/, "攔截訊息沒有明說這次未寫入資料");
});

test("⑤ 目標季別已經有內容時不覆蓋（使用者在新名稱下另外存過的東西不可以弄丟）", () => {
  const state = freshState();
  state.reportDrafts["P1|114Q4"] = "新名稱下本來就有的草稿";
  migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.reportDrafts["P1|114Q4"],
    "新名稱下本來就有的草稿",
    "目標鍵已經有內容卻被舊鍵蓋掉了——那會弄丟使用者寫過的東西",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⑦ 撞鍵時「舊的那一份」也不可以消失（2026-09-25 第五輪獨立複查抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⑤ 只驗了「目標鍵沒有被蓋掉」，**沒有驗舊鍵還在不在**——而原本的實作是
 *   `if (!(newKey in bag)) bag[newKey] = bag[oldKey];` 之後**無條件**
 *   `delete bag[oldKey]`，所以撞鍵時舊的那一份直接消失、沒有提示，
 *   而回傳值仍然把它算進「一併搬移 N 份」。⑤ 在這個實作上是綠的。
 *
 * 撞名檢查擋不到：它看的是 projectPeriods()（單一季別），
 * 而草稿與已人工確認的鍵帶的是**季別區間**。
 *
 * ⚠️ 反證（2026-09-25 實測）：把 app.js 的 renameKeyedByPeriod 改回
 *   「撞鍵也 delete」，這一支的第一個斷言就紅。
 */
test("⑦ 撞鍵時舊的那一份要原地留著，而且要單獨回報、不可以算進「已搬移」", () => {
  const state = freshState();
  state.reportDrafts["P1|114Q4"] = "新名稱下本來就有的草稿";
  const result = migrate(state, P, "115Q1", "114Q4");
  assert.equal(
    state.reportDrafts["P1|115Q1"],
    "第一季草稿",
    "撞鍵時舊鍵被 delete 掉了——使用者寫過的草稿靜靜消失，畫面上還說「已搬移」",
  );
  assert.equal(
    result.movedDrafts.kept,
    1,
    "撞鍵的那一筆要算進 kept（原地留著），這樣提示才講得出來",
  );
  assert.ok(
    result.movedDrafts.moved >= 1,
    "沒有撞鍵的那幾筆還是要照搬（`P1|115Q1-115Q2` 等）",
  );
  /* 沒有撞鍵的鍵一定要真的搬走，否則上面那條會被「什麼都不搬」蒙混過去。 */
  assert.equal(
    state.reportDrafts["P1|114Q4-115Q2"],
    "跨季草稿",
    "沒有撞鍵的鍵沒有搬走——那就變成「為了不弄丟而什麼都不做」",
  );
  assert.equal(
    state.reportDrafts["P1|115Q1-115Q2"],
    undefined,
    "搬走之後舊鍵要清掉，否則同一份草稿會在兩個季別名稱下各有一份",
  );
});

test("⑦-b 撞鍵留下來的那幾筆，提示訊息一定要講出來", () => {
  /*
   * 「搬了什麼」與「沒搬什麼」是兩件事，不可以混在同一句裡：
   * 混在一起時使用者會以為全部都搬好了。
   */
  assert.match(
    source,
    /沒有搬走/,
    "提示沒有講出「撞鍵所以留在原本季度名稱下」的那幾筆",
  );
  assert.match(
    source,
    /請自行確認要留哪一份/,
    "沒有告訴使用者接下來要做什麼（這是解決方式，不是只報異常）",
  );
});

test("⑥ 確認對話框與面板說明都要講出速限版本會一起搬", () => {
  /*
   * ⚠️ 這一條在防「搬對了但不說」。速限版本會改變服務水準，
   *   使用者必須知道它有沒有跟著走——靜靜搬對了和靜靜沒搬，畫面上一樣。
   */
  assert.match(
    source,
    /速限版本的季別區間/,
    "確認對話框或面板說明沒有提到速限版本會一起改名",
  );
  assert.match(
    source,
    /一併搬移：/,
    "改完之後的提示沒有回報實際搬了什麼",
  );
});

test("⑧ 三處使用者看得到的說明，都不可以承諾「全部一起改名」", () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到：程式已經改成「撞鍵就原地保留、不蓋掉」，
   *   但三處講給使用者聽的文字還停在舊承諾——
   *   ①`confirm()` 對話框、②「資料維護」面板的季度改名說明、③手冊的操作表。
   *   使用者按下確認時看到的是「都會一起改名」，事後卻有幾項沒搬走：
   *   **畫面在說謊**，而且是在唯一那個「按下去就回不來」的時機說的。
   *
   * 守法：三段文字各自都必須把「有可能沒搬走」講出來。
   *   刻意逐段檢查、不用整檔 `includes`——整檔檢查時只要**任何一處**寫到就綠，
   *   那正是這次漏掉兩處的原因。
   */
  const manual = readFileSync(join(here, "manual-src", "manual.html"), "utf8");
  const confirmText = source.match(/確定把「\$\{p\.code\}[\s\S]{0,600}?`,\n\s*\)/);
  assert.ok(confirmText, "找不到季度改名的 confirm() 文字——選擇器要跟著改");
  const panelText = source.match(/<h3>季度改名<\/h3>[\s\S]{0,1400}?<\/article>/);
  assert.ok(panelText, "找不到「資料維護」面板的季度改名說明");
  const manualText = manual.match(/<td class="k">季度打錯了<\/td>[\s\S]{0,1600}?<\/tr>/);
  assert.ok(manualText, "找不到手冊裡「季度打錯了」那一列");

  /* 任一種講法都算：重點是使用者知道「可能有幾項留在原處」。 */
  const SAYS_IT = /沒搬走|沒有搬走|原地保留|不被蓋掉/;
  for (const [name, text] of [
    ["confirm() 對話框", confirmText[0]],
    ["「資料維護」面板", panelText[0]],
    ["手冊「季度打錯了」", manualText[0]],
  ])
    assert.match(
      text,
      SAYS_IT,
      `${name}只講「都會一起改名」，沒有講「撞鍵的那幾項會原地保留」——` +
        "使用者按下去之前必須知道這件事",
    );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⑦-c 兩個舊鍵搬到同一個新鍵時，也不可以互相覆蓋（2026-09-26 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⑦ 只擋了第一種撞鍵：「新名稱底下**本來就有**」（比對改名前的鍵快照）。
 * 第二種是這一次改名自己造成的：季別區間鍵的**頭尾都會被換掉**，所以
 *
 *     P1|115Q1-115Q1   ──改名 115Q1→114Q4──▶   P1|114Q4-114Q4
 *     P1|115Q1-114Q4   ──同一次改名────────▶   P1|114Q4-114Q4
 *
 * 兩個不同的舊鍵落到同一個新鍵，而那個新鍵**改名前並不存在**，
 * 所以 ⑦ 的 `before` 快照放行 → 第二筆直接覆蓋第一筆、舊鍵也被刪掉，
 * 而回傳值把兩筆都算進 `moved`，提示還說「一併搬移 N 份」。
 * 使用者寫過的草稿靜靜消失，畫面上看不出來。
 *
 * ⚠️ 反證（2026-09-26 實測）：把 app.js 的 `claimed` 那一組拿掉
 *   （回到只看 `before`），這一支的第一個斷言就紅。
 */
test("⑦-c 兩個舊鍵會搬到同一個新鍵時，先遇到的搬走、後面那一份原地留著", () => {
  const state = freshState();
  /* 這兩個鍵在 115Q1→114Q4 之後都會變成 `P1|114Q4-114Q4`。 */
  state.reportDrafts["P1|115Q1-115Q1"] = "單季區間草稿";
  state.reportDrafts["P1|115Q1-114Q4"] = "跨到新名稱的草稿";
  const result = migrate(state, P, "115Q1", "114Q4");

  assert.equal(
    state.reportDrafts["P1|114Q4-114Q4"],
    "單季區間草稿",
    "第二筆把第一筆蓋掉了——兩個舊鍵搬到同一個新鍵時不可以覆蓋，" +
      "先遇到的那一份才是搬走的那一份",
  );
  assert.equal(
    state.reportDrafts["P1|115Q1-114Q4"],
    "跨到新名稱的草稿",
    "撞鍵的那一筆連舊鍵都被刪掉了——它必須原地留著，讓使用者自己決定要留哪一份",
  );
  assert.ok(
    result.movedDrafts.kept >= 1,
    "撞鍵的那一筆要算進 kept，否則提示會說「全部搬好了」",
  );
  /*
   * 前置檢查：沒有撞鍵的鍵一定要真的搬走。
   * 少了這一條，「什麼都不搬」也會讓上面兩條通過。
   */
  assert.equal(
    state.reportDrafts["P1|114Q4-115Q2"],
    "跨季草稿",
    "沒有撞鍵的鍵沒有搬走——那就變成「為了不弄丟而什麼都不做」",
  );
  assert.equal(
    state.reportDrafts["P1|115Q1-115Q1"],
    undefined,
    "搬走的那一份要清掉舊鍵，否則同一份草稿會在兩個名稱下各有一份",
  );
});

/*
 * ⑧-b 三處說明都要把**第二種**撞鍵講出來（2026-09-26 新增）
 *
 * ⑧ 的樣式（沒搬走｜原地保留｜不被蓋掉）對第一種撞鍵已經成立，
 * 所以修好第二種之後 ⑧ 照樣綠——它抓不到「只講了一種」。
 * 這一支逐段要求三處都寫出第二種，否則使用者只會提防「新名稱下已經有東西」，
 * 不會想到「我這一次改名自己造成兩份撞在一起」。
 */
test("⑧-b 三處說明都要講出「這一次改名有兩份會變成同一個名稱」", () => {
  const manual = readFileSync(join(here, "manual-src", "manual.html"), "utf8");
  const confirmText = source.match(/確定把「\$\{p\.code\}[\s\S]{0,900}?`,\n\s*\)/);
  assert.ok(confirmText, "找不到季度改名的 confirm() 文字——選擇器要跟著改");
  const panelText = source.match(/<h3>季度改名<\/h3>[\s\S]{0,2200}?<\/article>/);
  assert.ok(panelText, "找不到「資料維護」面板的季度改名說明");
  const manualText = manual.match(
    /<td class="k">季度打錯了<\/td>[\s\S]{0,2400}?<\/tr>/,
  );
  assert.ok(manualText, "找不到手冊裡「季度打錯了」那一列");

  const SAYS_SECOND = /這一次改名有兩份會變成同一個名稱/;
  for (const [name, text] of [
    ["confirm() 對話框", confirmText[0]],
    ["「資料維護」面板", panelText[0]],
    ["手冊「季度打錯了」", manualText[0]],
  ])
    assert.match(
      text,
      SAYS_SECOND,
      `${name}只講了「新名稱底下本來就有」那一種撞鍵，` +
        "沒有講「這一次改名自己造成兩份撞在一起」那一種",
    );
});
