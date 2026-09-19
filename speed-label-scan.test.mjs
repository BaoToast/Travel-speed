/*
 * ══════════════════════════════════════════════════════════════════
 *  X-65：旅行速率／行駛速率是「認標籤」不是「認欄位位置」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：
 *   「如果哪天調查員把這兩項測值反過來放……程式可以判讀出來嗎?
 *     另一種情況，調查員誤植文字 變成有2筆旅行速率或2筆行駛速率
 *     系統可以判別出來，並提出異常警告嗎?」
 *
 * 這支測的是 app.js 裡實際在跑的那幾個函式（透過 parse-harness 取出來），
 * 不是另外抄一份。三件事：
 *   一、A／B 兩欄對調，讀到的數值要跟著標籤走，不可以跟著欄位走。
 *   二、同一個方向裡出現兩筆「平均總旅行速率」→ 要報錯，不可以自己挑一個。
 *   三、同一個方向裡出現兩筆「平均總行駛速率」→ 同樣要報錯。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、第三條要**在物理檢核攔不到的情況下**驗：兩個行駛速率都比旅行速率大、
 *     也都不等於旅行速率，implausibleReason() 完全不會出聲。
 *     若拿一個「明顯不合理」的假資料去驗，就算守門完全沒寫也會紅，
 *     那是物理檢核在紅，不是這條守門在紅。
 * 二、每一條都要有反證：把守門拿掉，這支要真的紅。見檔尾。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fns } from "./parse-harness.mjs";

/**
 * 造一張「沒有旅次編號、也沒有重複標題列」的工作表，
 * 好讓 parsePeakSheet() 走到 parseByTravelAnchors() 這條路。
 * （有旅次編號的那條路由 parseByRecordBlocks() 的 single() 把關，
 *   兩條路都要驗，否則補了一邊另一邊照樣靜默。）
 */
function sheet(rows) {
  return rows.map((r) => r.slice());
}

/** 一個方向的四列：延滯表在上、平均速率在下（實際報告就是這個順序）。 */
function direction(travelLabel, travelValue, runningLabel, runningValue) {
  return [
    ["路段延滯", "交叉口延滯"],
    [12, 8],
    [travelLabel, runningLabel],
    [travelValue, runningValue],
  ];
}

test("A／B 兩欄對調，數值仍然跟著標籤走", () => {
  const normal = sheet([
    ...direction("平均總旅行速率", 21.08, "平均總行駛速率", 35.78),
    ...direction("平均總旅行速率", 24.5, "平均總行駛速率", 33.2),
  ]);
  const swapped = sheet([
    /* 調查員把兩欄對調：行駛速率在左、旅行速率在右。 */
    ...direction("平均總行駛速率", 35.78, "平均總旅行速率", 21.08),
    ...direction("平均總行駛速率", 33.2, "平均總旅行速率", 24.5),
  ]);
  const a = fns.parsePeakSheet(normal, "上午尖峰");
  const b = fns.parsePeakSheet(swapped, "上午尖峰");
  assert.equal(a.issue, "", `正常版面就讀不出來：${a.issue}`);
  assert.equal(b.issue, "", `對調之後讀不出來：${b.issue}`);
  const pick = (r) => r.rows.map((x) => [x.travel, x.running]);
  assert.deepEqual(
    pick(b),
    pick(a),
    "兩欄對調之後讀到的數值變了——代表它其實在認欄位位置，不是認標籤",
  );
  assert.deepEqual(pick(a), [
    [21.08, 35.78],
    [24.5, 33.2],
  ]);
});

test("同一個方向有兩筆「平均總旅行速率」→ 報錯，不自己挑", () => {
  const m = sheet([
    ["路段延滯", "交叉口延滯"],
    [12, 8],
    ["平均總旅行速率", "平均總行駛速率"],
    [21.08, 35.78],
    ["平均總旅行速率", ""],
    [22.4, ""],
    ...direction("平均總旅行速率", 24.5, "平均總行駛速率", 33.2),
  ]);
  const r = fns.parsePeakSheet(m, "上午尖峰");
  assert.equal(r.rows.length, 0, "有三筆旅行速率卻照樣讀出資料");
  assert.match(r.issue, /平均總旅行速率/);
  assert.match(r.issue, /不會猜測|不會自行挑選/);
});

test("同一個方向有兩筆「平均總行駛速率」→ 報錯（物理檢核攔不到的那種）", () => {
  /*
   * ⚠️ 兩個行駛速率（35.78 與 34.9）都大於旅行速率 21.08，也都不等於它，
   *   implausibleReason() 一句話都不會說。守門若沒寫，這裡就會靜靜通過。
   */
  const m = sheet([
    ["路段延滯", "交叉口延滯"],
    [12, 8],
    ["平均總旅行速率", "平均總行駛速率"],
    [21.08, 35.78],
    ["", "平均總行駛速率"],
    ["", 34.9],
    ...direction("平均總旅行速率", 24.5, "平均總行駛速率", 33.2),
  ]);
  const r = fns.parsePeakSheet(m, "上午尖峰");
  assert.equal(
    r.rows.length,
    0,
    "同一個方向有兩筆行駛速率，卻靜靜挑了一個讀出來",
  );
  assert.match(r.issue, /平均總行駛速率/);
  assert.match(r.issue, /不會自行挑選/);
  /* 2026-09-18 F-11：要指到格子、講明不寫入、告訴使用者怎麼修（反面：舊訊息沒有儲存格→紅） */
  assert.match(r.issue, /儲存格 [A-Z]+\d+、[A-Z]+\d+/, "要寫出是哪幾格重複");
  assert.match(r.issue, /不會寫入/, "要明講這一張工作表不會寫入");
  assert.match(r.issue, /重新匯入/, "要告訴使用者修正後怎麼做");
});

test("有旅次編號的版面（區塊解法）同樣不准同名標籤重複", () => {
  const m = sheet([
    ["旅次編號", 1],
    ["路段延滯", "交叉口延滯"],
    [12, 8],
    ["平均總旅行速率", "平均總行駛速率"],
    [21.08, 35.78],
    ["", "平均總行駛速率"],
    ["", 34.9],
    ["旅次編號", 2],
    ["路段延滯", "交叉口延滯"],
    [10, 6],
    ["平均總旅行速率", "平均總行駛速率"],
    [24.5, 33.2],
  ]);
  const r = fns.parsePeakSheet(m, "下午尖峰");
  assert.equal(r.rows.length, 0, "區塊解法也靜靜挑了一個");
  assert.match(r.issue, /平均總行駛速率/);
  assert.match(r.issue, /儲存格 [A-Z]+\d+、[A-Z]+\d+/, "區塊解法也要指到格子");
  assert.match(r.issue, /不會寫入/);
});

/*
 * ── 反證（2026-09-17 實跑）────────────────────────────────────
 * 把 parseByTravelAnchors() 裡新加的那段 runnings 計數整段拿掉，重跑：
 *   ✔ A／B 兩欄對調，數值仍然跟著標籤走
 *   ✔ 同一個方向有兩筆「平均總旅行速率」→ 報錯，不自己挑
 *   ✖ 同一個方向有兩筆「平均總行駛速率」→ 報錯（物理檢核攔不到的那種）
 *       同一個方向有兩筆行駛速率，卻靜靜挑了一個讀出來
 *       expected 0 to equal 2
 *   ✔ 有旅次編號的版面（區塊解法）同樣不准同名標籤重複
 * 只有該紅的那一條紅，其餘三條是既有行為，確定不是恆真。
 */
