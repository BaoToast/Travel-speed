/*
 * ══════════════════════════════════════════════════════════════════════
 *  W-0：檔案編號是流水號；判定期別、判定「是不是同一份資料」一律看調查日期
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29（兩則，合起來才是完整的裁示）：
 *
 *  ①「那串數字記的是第幾季，不一定是指第幾季的，單純是給使用者知道這是
 *     不同季別的資料就是了，對使用者來說是流水編號，主要還是看資料裡面的
 *     日期，才能做為判定這是哪一季……檔案編號哪怕一樣，使用者都不會在意。
 *     這一點情況，三支程式都可能發生。」
 *
 *  ②「我比較擔心程式會因為檔案編號一樣，例如 115Q1 檔案編號 T15-01，
 *     115Q4 檔案編號也是 T15-01，後者資料卻覆蓋掉了前者，但明明檔案裡面
 *     顯示的是不同監測日期，只要裡面資料是不同監測日期，那麼檔案就是
 *     不一樣的。」
 *
 * 這一支守三件事：
 *   A. 身分鍵含期別 ── 兩季同號不會互相覆蓋（她擔心的那個情境不會發生）
 *   B. 沒有任何地方從檔名編號推期別
 *   C. 真的會撞上時（期別選錯）要在動資料之前問，而且訊息要說出日期不一樣
 *
 * ⚠️ 這一支刻意**不用任何真實站號**（與全日交通量的
 *   tests/dependency-manifest.test.mjs 同一條界線）：範例一律用
 *   A00T00-01、999996～999999 這一類不存在的編號。
 *
 * ⚠️ 反證都寫在各段的註解裡，而且是**真的跑過**的，不是推論。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.js"), "utf8");
const periodDateSource = readFileSync(join(here, "period-date.js"), "utf8");

const box = { console };
box.window = box;
box.self = box;
box.globalThis = box;
new Function("window", "self", "globalThis", periodDateSource).call(box, box, box, box);
const { overwriteDateConflictPrompt } = box.PeriodDate;

/* ══════════════════════════════════════════════════════════════════════
 *  A. 身分鍵含期別：兩季同號不覆蓋
 * ══════════════════════════════════════════════════════════════════════ */

test("A-1 明細的 id 含年度與季度——兩季同號不會撞成同一個鍵", () => {
  /*
   * 反證：把 r.year 或 `Q${r.quarter}` 從 join 裡拿掉，這一條立刻紅。
   * 這正是使用者擔心的那個機制——鍵少了期別，115Q4 就會蓋掉 115Q1。
   *
   * ⚠️ 組鍵的寫法是**跨行**的陣列，不可以逐行比對：
   *   逐行比對會把 `moved.id = [` 這種只有開頭的那一行當成「少了年度」，
   *   那是假的紅。這裡把 `xxx.id = [ … ]` 整段抓出來再看。
   */
  const blocks = [...appSource.matchAll(/\w+\.id\s*=\s*\[([\s\S]{0,400}?)\]\s*\.join/g)].map(
    (hit) => hit[1],
  );
  assert.ok(
    blocks.length > 0,
    "前置：找不到任何 `X.id = [...].join(...)` 的組鍵寫法——寫法改了就要跟著改這一條，不可以讓它安靜地變成恆真",
  );
  for (const block of blocks) {
    assert.match(
      block,
      /year/,
      `這一段組出來的 id 少了年度，兩年同號會互相覆蓋：${block.replace(/\s+/g, " ").trim()}`,
    );
    assert.match(
      block,
      /quarter/,
      `這一段組出來的 id 少了季度，兩季同號會互相覆蓋：${block.replace(/\s+/g, " ").trim()}`,
    );
  }
});

test("A-2 同季重匯只刪同季的列（刪整個計畫是另一回事，刻意不比期別）", () => {
  /*
   * 這一條要分清楚兩種刪除，混在一起看一定會誤判：
   *   ・重匯某一季 → 條件要同時比對計畫**與期別**，否則會把別季一起刪掉。
   *   ・刪整個計畫 → 條件**只比對計畫**，那是對的（整個計畫都要走）。
   *
   * 反證：把重匯那一條的 `&& x.period === period` 拿掉，這一條紅；
   *   把刪計畫那一條加上期別，計畫會刪不乾淨——所以兩邊都要各自鎖住。
   */
  const reimport = appSource.includes(
    "state.details = state.details.filter((x) => !(x.projectCode === p.code && x.period === period));",
  );
  assert.ok(
    reimport,
    "找不到「重匯某一季時只刪那一季」的條件——少了期別的話，重匯一季會把整個計畫清掉",
  );
  const purge = appSource.includes(
    "state.details = state.details.filter((x) => x.projectCode !== code);",
  );
  assert.ok(
    purge,
    "找不到「刪整個計畫」的條件——它刻意不比期別，改掉的話計畫會刪不乾淨",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  B. 沒有任何地方從檔名編號推期別
 * ══════════════════════════════════════════════════════════════════════ */

test("B-1 期別只從使用者選的期別與檔案裡的調查日期來，不從檔名編號推", () => {
  /*
   * 檔名編號在這一支只有一個用途：把路段名稱前面的案號前綴剝掉。
   * 一旦有人寫出「從檔名數字算季別」的程式碼，這一條就要紅。
   *
   * 判準寫成「檔名／案號相關的變數不可以出現在指派 quarter／period 的那一行」，
   * 而不是列舉某幾個函式名字——列舉法在下一個人換個名字時就失效了。
   */
  const bad = appSource.split("\n").filter((line) => {
    const assignsPeriod = /\b(quarter|period)\s*[:=]\s*[^=]/.test(line);
    const usesFileName = /\b(fileName|file\.name|item\.file|rawName|案號)\b/.test(line);
    return assignsPeriod && usesFileName && !line.trim().startsWith("*");
  });
  assert.deepEqual(
    bad.map((line) => line.trim()),
    [],
    "有地方拿檔名去決定期別——依使用者裁示，編號是流水號，期別一律看檔案裡的調查日期",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  C. 覆蓋前的日期把關
 * ══════════════════════════════════════════════════════════════════════ */

test("C-1 舊新日期不同才算衝突", () => {
  const message = overwriteDateConflictPrompt([
    { label: "115Q1・甲路・平日", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /會蓋掉 1 筆/);
  assert.match(message, /原本是 2026-01-14，這一批是 2026-10-21/);
});

test("C-2 日期相同不算衝突——那是同一次調查的重匯，本來就該覆蓋", () => {
  /*
   * ⚠️ 這一條就是反證。第一版如果寫成「只要會覆蓋就問」，
   *   使用者每一次修正同一季的資料重匯都會被問一次，
   *   問到最後一定變成無腦按確定——那比不問更糟。
   */
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "115Q1・甲路・平日", oldDate: "2026-01-14", newDate: "2026-01-14" },
    ]),
    "",
  );
});

test("C-3 只有一邊讀得出日期不算衝突——沒有證據就擋是假的紅", () => {
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "115Q1・甲路・平日", oldDate: "", newDate: "2026-10-21" },
    ]),
    "",
  );
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "115Q1・甲路・平日", oldDate: "2026-01-14", newDate: "" },
    ]),
    "",
  );
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "115Q1・甲路・平日", oldDate: null, newDate: undefined },
    ]),
    "",
  );
});

test("C-4 訊息要說出「編號一樣不代表是同一份資料」", () => {
  /*
   * 這句話是使用者裁示的核心。訊息裡沒有它的話，使用者看到的仍然是
   * 一個「日期不一樣」的技術訊息，看不懂為什麼要關心。
   */
  const message = overwriteDateConflictPrompt([
    { label: "115Q1・甲路・平日", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /檔案編號一樣不代表是同一份資料/);
  assert.match(message, /判斷依據一律是檔案裡的調查日期/);
  assert.match(message, /兩次不同的調查/);
});

test("C-5 訊息裡舉的例子不可以用真實站號", () => {
  const message = overwriteDateConflictPrompt([
    { label: "A00T00-01", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  /* 使用者自己舉的 T15-01 是允許的（那是她原話裡的例子，不是真實站號的完整寫法）。 */
  assert.doesNotMatch(
    message,
    /\b1[1-4]\d{3}T/,
    "訊息裡出現了真實案號格式（5 碼＋T），範例一律用 A00T00-01 或 999996～999999",
  );
});

test("C-6 沒有衝突時回空字串——呼叫端才不會跳一個空視窗", () => {
  assert.equal(overwriteDateConflictPrompt([]), "");
  assert.equal(overwriteDateConflictPrompt(null), "");
  assert.equal(overwriteDateConflictPrompt(undefined), "");
});

test("C-7 各支自己的復原說明要接得進去，而且不寫就沒有那一行", () => {
  const withNote = overwriteDateConflictPrompt(
    [{ label: "甲", oldDate: "2026-01-14", newDate: "2026-10-21" }],
    "（測試用的復原說明）",
  );
  assert.match(withNote, /（測試用的復原說明）/);
  const withoutNote = overwriteDateConflictPrompt([
    { label: "甲", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.doesNotMatch(withoutNote, /（測試用的復原說明）/);
  /*
   * ⚠️ 三支的復原機制不一樣（這一支是匯入紀錄的批次復原，另兩支是還原點），
   *   所以復原說明一定要由呼叫端給。寫死成同一句的話，一定有兩支在說謊。
   */
});

test("C-8 把關要擋在 upsert() 之前，不是之後", () => {
  /*
   * ⚠️ 這一條守的是**順序**。擋在寫入之後，使用者按「取消」時資料已經被蓋掉了，
   *   那不是把關，是事後通知——而畫面上看起來一模一樣。
   */
  const guardAt = appSource.indexOf("overwriteDateConflictPrompt(");
  const upsertAt = appSource.indexOf("upsert(write);");
  assert.ok(guardAt > 0, "前置：找不到覆蓋把關的呼叫");
  assert.ok(upsertAt > 0, "前置：找不到 upsert(write)");
  assert.ok(
    guardAt < upsertAt,
    "覆蓋把關被排到 upsert(write) 後面了——那時候舊資料已經被蓋掉，按取消也救不回來",
  );
});

test("C-9 舊日期要走 effectiveSurveyDate（畫面上顯示的那一個）", () => {
  /*
   * 反證：改成 old.surveyDate，使用者指定過日期的那幾筆，
   * 訊息裡的日期就和畫面上不一樣——而訊息本身會變成新的困惑來源。
   */
  const block = appSource.slice(
    appSource.indexOf("overwriteDateConflicts.push({"),
    appSource.indexOf("overwriteDateConflicts.push({") + 400,
  );
  assert.match(block, /effectiveSurveyDate\(old\)/);
  assert.match(block, /effectiveSurveyDate\(row\)/);
});
