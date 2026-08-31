/*
 * ── 計算口徑的黃金值鎖 ──
 *
 * 這支測試補上兩個在此之前完全沒有保護的地方：
 *
 * 一、`DEFAULT_LOS_RULE`。既有的 los-rules-per-project.test.mjs 在自己的
 *    sandbox 裡**另寫了一份常數副本**，比對的是副本而不是 app.js 裡那一份。
 *    把 app.js 的 0.8 改成 0.9，65 項測試會全數照樣通過，而系統每一筆
 *    服務水準都會變。
 *
 * 二、代表紀錄的選取規則（先取 LOS 最差、再取速限比最低、再取旅行速率最低）。
 *    這是首頁「新版代表值規則」與整個系統存在的理由，但唯一碰到 rebuild()
 *    的測試只做正則檢查，**完全沒有測「給定 4 筆，挑出哪一筆」**。
 *    排序鍵順序寫反、哨兵值被改、losRank 反向，都測不出來。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");

function evalConst(name) {
  const re = new RegExp(`const ${name}\\s*=\\s*(\\{[\\s\\S]*?\\});`);
  const match = source.match(re);
  assert.ok(match, `找不到常數 ${name}`);
  return new Function(`return (${match[1]});`)();
}

test("LOS 門檻不得變動", () => {
  assert.deepEqual(evalConst("DEFAULT_LOS_RULE"), {
    A: 0.8,
    B: 0.6,
    C: 0.5,
    D: 0.4,
    E: 0.2,
  });
});

test("LOS 排序權重不得變動", () => {
  /*
   * 數字**越大代表服務水準越好**（A:6 … F:1），而 rebuild() 的排序是
   * 由小到大取第一筆，所以挑到的是數字最小＝服務水準最差的那一筆。
   * 這個方向一旦寫反，代表紀錄會變成挑「最好」的那一筆，而畫面上
   * 看不出任何異常。
   */
  assert.deepEqual(evalConst("losRank"), { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 });
});

test("代表紀錄：先取 LOS 最差", () => {
  const { pick } = harness();
  const chosen = pick([
    { los: "B", ratio: 0.7, travel: 30, tag: "好" },
    { los: "E", ratio: 0.9, travel: 40, tag: "最差LOS" },
    { los: "C", ratio: 0.2, travel: 10, tag: "速限比低但LOS較好" },
  ]);
  assert.equal(chosen.tag, "最差LOS", "LOS 最差的那一筆優先，不看其他欄位");
});

test("代表紀錄：LOS 相同時取速限比最低", () => {
  const { pick } = harness();
  const chosen = pick([
    { los: "C", ratio: 0.55, travel: 10, tag: "速限比高" },
    { los: "C", ratio: 0.51, travel: 40, tag: "速限比低" },
  ]);
  assert.equal(chosen.tag, "速限比低");
});

test("代表紀錄：LOS 與速限比都相同時取旅行速率最低", () => {
  const { pick } = harness();
  const chosen = pick([
    { los: "C", ratio: 0.5, travel: 30, tag: "快" },
    { los: "C", ratio: 0.5, travel: 22, tag: "慢" },
  ]);
  assert.equal(chosen.tag, "慢");
});

test("代表紀錄：缺值的哨兵值不得讓缺值那筆被誤選", () => {
  const { pick } = harness();
  /* ratio 為 null 時哨兵值是 9，應排在有值者之後 */
  const chosen = pick([
    { los: "C", ratio: null, travel: null, tag: "缺值" },
    { los: "C", ratio: 0.55, travel: 30, tag: "有值" },
  ]);
  assert.equal(chosen.tag, "有值", "缺值的那一筆不應被當成最差");
});

/** 把 app.js 裡的排序規則原樣取出來執行，不重寫一份。 */
function harness() {
  const losRank = evalConst("losRank");
  const sortSnippet = source.match(
    /const sorted = \[\.\.\.rows\]\.sort\(\s*\(a, b\) =>([\s\S]*?)\);/,
  );
  assert.ok(sortSnippet, "找不到 rebuild() 裡的代表紀錄排序規則");
  const body = sortSnippet[1].trim().replace(/,$/, "");
  const compare = new Function("losRank", `return (a, b) => (${body});`)(losRank);
  return { pick: (rows) => [...rows].sort(compare)[0] };
}

/*
 * ── 延滯讀取：碰到下一個文字標籤就要停 ──
 *
 * `metricAt()` 早就有這道防護（註解寫著「舊寫法會把 35.78 當成旅行速率讀進來」），
 * 但 `delayPart()` / `valueBelowLabel()` 漏掉了：路段延滯格填「N/A」「-」「休」
 * **或空白**時，掃描會越過「交叉口延滯」這個標籤列，撿到它下面的值——
 * 同一個數字被算兩次、導致總延滯被高估，而且 issue 為空、ok=true、靜靜寫入。
 */
test("兩條延滯解析路徑：讀不到自己的值時都要回 null，不可以撿到下一欄", () => {
  const numSrc =
    'const num = (v) => { if (v == null || String(v).trim() === "") return null;' +
    " const n = Number(v); return Number.isFinite(n) ? n : null; };";
  const scope = {};
  new Function(
    numSrc +
      extractFn("normalize") +
      extractFn("findLabels") +
      extractFn("delayPart") +
      extractFn("valueBelowLabel") +
      "this.delayPart = delayPart;" +
      "this.valueBelowLabel = valueBelowLabel;",
  ).call(scope);
  const sheet = (roadDelay) => [
    ["", ""],
    ["路段延滯", ""],
    [roadDelay, ""],
    ["交叉口延滯", ""],
    [48.33, ""],
  ];
  const readers = {
    "舊版型 delayPart": (v) =>
      scope.delayPart(sheet(v), 0, "路段延滯", { from: 0, to: 5 }),
    "分塊版型 valueBelowLabel": (v) =>
      scope.valueBelowLabel(sheet(v), { r: 1, c: 0 }, { from: 0, to: 5 }),
  };
  for (const [name, read] of Object.entries(readers)) {
    assert.equal(read(80), 80, `${name}：正常值照舊讀得到`);
    for (const bad of ["N/A", "-", "休", "", null])
      assert.equal(
        read(bad),
        null,
        `${name}：路段延滯為 ${JSON.stringify(bad)} 時必須回 null，不可以回 48.33`,
      );
  }
});

/** 取出 app.js 裡的具名函式原始碼。 */
function extractFn(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `找不到 ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} 括號不成對`);
}
