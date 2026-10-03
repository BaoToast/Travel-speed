/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-47：混批（一批檔案的日期指向兩個以上期別）一律擋死
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 裁示：「混入別季混批不擋，三支程式請同步」。
 *
 * 現況（2026-09-29 查證）：
 *   ・路口轉向 ── 本來就擋死（逐檔解析季別，預覽裡兩種以上就停用按鈕＋紅底）。
 *   ・交通服務水準與全日交通量 ── 原本**只有一個 confirm()**，按確定就寫進去。
 *
 * ⚠️ 判準刻意**不是**「日期與所選期別對不上就擋」。
 *   季末跨月調查、廠商延後幾天補測都會對不上，那些是真的要匯進去的，
 *   擋死就是製造假的紅。二次確認（periodMismatchPrompt）要保留。
 *
 * ⚠️ 要擋的是「同一批指向兩個以上不同期別」：無論寫進哪一個都一定有一批是錯的，
 *   沒有正確答案，所以不該讓使用者「確認」。
 *
 * 反證（2026-09-29 實際跑過，寫在各段）。
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
const { mixedPeriodBlock, periodMismatchPrompt } = box.PeriodDate;

/** 一份檔案的日期比對結果（只留這幾支真的會讀的欄位）。 */
function check(file, status, dateLabel) {
  return {
    file,
    status,
    dateLabel,
    date: "2026-05-08",
    periodLabel: "115Q1",
    source: "表頭",
    raw: "115/05/08",
    detail: `${file}：檔案裡屬 ${dateLabel}`,
  };
}

test("前置：mixedPeriodBlock 真的掛出來了", () => {
  assert.equal(
    typeof mixedPeriodBlock,
    "function",
    "period-date.js 沒有掛出 mixedPeriodBlock——底下每一條都會變成空轉",
  );
});

test("① 全部指向同一個別季 → 不擋（那是二次確認要處理的情形）", () => {
  /* 三份都指向 115Q2，使用者把季別改成 115Q2 就對了——這種不可以擋死。 */
  const blocked = mixedPeriodBlock([
    check("甲路-平日.xlsx", "mismatch", "115Q2"),
    check("甲路-假日.xlsx", "mismatch", "115Q2"),
    check("乙路-平日.xlsx", "mismatch", "115Q2"),
  ]);
  assert.equal(
    blocked,
    "",
    "三份都指向 115Q2，使用者把季別改成 115Q2 就對了——這種不可以擋死",
  );
  assert.ok(
    periodMismatchPrompt([check("甲路-平日.xlsx", "mismatch", "115Q2")]),
    "同一個別季的情形二次確認必須還在（不可以連它一起拔掉）",
  );
});

test("② 指向兩個以上不同期別 → 一定要擋，而且訊息要把哪一份屬哪一季列出來", () => {
  const blocked = mixedPeriodBlock([
    check("甲路-平日.xlsx", "mismatch", "115Q1"),
    check("乙路-平日.xlsx", "mismatch", "115Q2"),
  ]);
  assert.ok(blocked, "指向 115Q1 與 115Q2 兩個期別，一定要擋下來");
  assert.ok(blocked.includes("115Q1"), `訊息要寫出 115Q1，實際：${blocked}`);
  assert.ok(blocked.includes("115Q2"), `訊息要寫出 115Q2，實際：${blocked}`);
  assert.ok(
    blocked.includes("甲路-平日.xlsx") && blocked.includes("乙路-平日.xlsx"),
    `訊息要指名是哪幾份檔案，實際：${blocked}`,
  );
  assert.ok(
    /2 個不同的期別/.test(blocked),
    `訊息要說清楚是幾個期別，實際：${blocked}`,
  );
});

test("③ 訊息不可以留「確認無誤」這種出口（混批沒有對的選項）", () => {
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "mismatch", "115Q1"),
    check("乙.xlsx", "mismatch", "115Q2"),
  ]);
  for (const word of ["仍要以這個期別匯入", "按「確定」"])
    assert.ok(
      !blocked.includes(word),
      `混批的訊息不該出現「${word}」——它會讓人以為按下去就能過。實際：${blocked}`,
    );
  assert.ok(
    blocked.includes("已阻擋"),
    `訊息要講明已經擋下來了，實際：${blocked}`,
  );
  assert.ok(
    blocked.includes("沒有「確認無誤」這個選項"),
    `訊息要說明為什麼沒有確認這條路，實際：${blocked}`,
  );
  assert.ok(
    blocked.includes("分批匯入"),
    `訊息要給使用者下一步該做什麼，實際：${blocked}`,
  );
});

test("④ 讀不到日期的（unknown）不參與計票，不可以憑空湊出混批", () => {
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "mismatch", "115Q2"),
    check("乙.xlsx", "unknown", "115Q3"),
    check("丙.xlsx", "unknown", "115Q4"),
  ]);
  assert.equal(
    blocked,
    "",
    "只有一份真的指向別季，另外兩份讀不到日期——拿 unknown 去湊「兩個以上」是假的擋",
  );
});

test("⑤ 最常見的混批：一部分相符、一部分指向別季 → 一定要擋", () => {
  /*
   * ⚠️ 這一條是第一版漏掉的那一種，而它正好是**最常見**的：
   *   選 115Q1、甲乙兩檔是 1 月（match）、丙檔是 8 月（mismatch）。
   *   只算 mismatch 的話只數到一個期別（115Q3），於是不擋——
   *   而這一批真的橫跨 115Q1 與 115Q3。
   *   判準要問的是「這一批一共指向幾個期別」，與使用者選了哪一個無關。
   *
   * ⚠️ `check()` 的第二個參數一定要用 `match`，不是 `ok`。
   *   checkPeriodAgainstDate() 回的是 match／mismatch／unknown 三種；
   *   寫 `ok` 的話它落在「三種都不是」，這一條會變成恆綠。
   */
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "match", "115Q1"),
    check("乙.xlsx", "match", "115Q1"),
    check("丙.xlsx", "mismatch", "115Q3"),
  ]);
  assert.ok(
    blocked,
    "一批裡有 115Q1 與 115Q3 兩種日期，不管使用者選了哪一個都一定要擋",
  );
  assert.ok(
    blocked.includes("115Q1") && blocked.includes("115Q3"),
    `兩個期別都要列出來，實際：${blocked}`,
  );
  assert.ok(
    blocked.includes("甲.xlsx") && blocked.includes("丙.xlsx"),
    `訊息要指名是哪幾份，實際：${blocked}`,
  );
});

test("⑤-2 全部相符（同一個期別）→ 不擋", () => {
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "match", "115Q1"),
    check("乙.xlsx", "match", "115Q1"),
    check("丙.xlsx", "match", "115Q1"),
  ]);
  assert.equal(blocked, "", "三份都是 115Q1，這是正常的一批，擋了就是假的紅");
});

test("⑤-3 前置：check() 用的 status 字面值真的是程式在用的那三種", () => {
  /*
   * ⚠️ 這一條防的是「測資寫錯字面值 → 上面幾條全部恆綠」。
   *   直接拿真的 checkPeriodAgainstDate() 跑一次，確認它回的就是
   *   match／mismatch／unknown。
   */
  const { checkPeriodAgainstDate } = box.PeriodDate;
  const matched = checkPeriodAgainstDate(
    "115Q1",
    { iso: "2026-01-26", labelled: true, raw: "115年01月26日", sheet: "上午尖峰", cell: "AB3" },
    "甲.xlsx",
  );
  assert.equal(matched.status, "match", "相符的狀態字面值變了");
  assert.equal(matched.dateLabel, "115Q1", "相符的那一份也要帶 dateLabel，否則計不到票");
  const missed = checkPeriodAgainstDate(
    "115Q1",
    { iso: "2026-08-05", labelled: true, raw: "115年08月05日", sheet: "上午尖峰", cell: "AB3" },
    "乙.xlsx",
  );
  assert.equal(missed.status, "mismatch", "不一致的狀態字面值變了");
  assert.equal(missed.dateLabel, "115Q3");
  assert.equal(
    checkPeriodAgainstDate("115Q1", null, "丙.xlsx").status,
    "unknown",
    "讀不到日期的狀態字面值變了",
  );
});

test("⑥ 沒有 dateLabel 的不參與計票（不可以把空值算成一個期別）", () => {
  const blocked = mixedPeriodBlock([
    { file: "甲.xlsx", status: "mismatch", dateLabel: "" },
    { file: "乙.xlsx", status: "mismatch", dateLabel: "115Q2" },
  ]);
  assert.equal(blocked, "", "空的 dateLabel 不是一個期別");
});

test("⑦ 空陣列、null、非陣列都不可以炸", () => {
  for (const input of [[], null, undefined, 0, "x", {}])
    assert.equal(
      mixedPeriodBlock(input),
      "",
      `mixedPeriodBlock(${JSON.stringify(input)}) 應該安靜回空字串`,
    );
});

/* ────────────────────────────────────────────────────────────────────
 *  app.js 的三個呼叫點必須共用同一支範圍計算
 *
 *  ⚠️ 這一段是**原始碼守門**，不是行為測試，理由寫在下面。
 *    畫面說明、按鈕停用、寫入路徑三處一旦各自算一次範圍，就會出現
 *    「畫面說按鈕停用了、按鈕其實按得下去」——而那比沒有擋更糟。
 *    行為測試抓不到「兩處算法不同但這一筆資料剛好一樣」，
 *    所以這裡直接釘住「三處都呼叫 pendingMixedPeriodBlock()」。
 * ──────────────────────────────────────────────────────────────────── */

test("⑧ app.js 只有一支在算混批範圍，而且三個地方都呼叫它", () => {
  const defs = appSource.match(/function pendingMixedPeriodBlock\(/g) || [];
  assert.equal(
    defs.length,
    1,
    `pendingMixedPeriodBlock() 應該只有一份定義，實際 ${defs.length} 份`,
  );
  const calls = appSource.match(/pendingMixedPeriodBlock\(\)/g) || [];
  assert.ok(
    calls.length >= 3,
    `畫面說明、按鈕停用、寫入路徑三處都要呼叫它，實際只找到 ${calls.length} 處`,
  );
  /*
   * 除了 pendingMixedPeriodBlock 自己那一行，app.js 不可以再直接呼叫
   * PeriodDate.mixedPeriodBlock——那就是「各自算一次」的長相。
   */
  const direct = appSource.match(/PeriodDate\.mixedPeriodBlock\(/g) || [];
  assert.equal(
    direct.length,
    1,
    `app.js 只能有一處直接呼叫 PeriodDate.mixedPeriodBlock（在 pendingMixedPeriodBlock 裡），實際 ${direct.length} 處`,
  );
});

test("⑨ 混批要擋在二次確認**之前**", () => {
  const blockAt = appSource.indexOf("const mixedBlock = pendingMixedPeriodBlock();");
  const confirmAt = appSource.indexOf("PeriodDate.periodMismatchPrompt(dateProblems)");
  assert.ok(blockAt > 0, "寫入路徑裡找不到混批阻擋");
  assert.ok(confirmAt > 0, "寫入路徑裡找不到二次確認");
  assert.ok(
    blockAt < confirmAt,
    "混批阻擋排在二次確認後面的話，使用者會先被問「確認無誤嗎」、按了確定才被擋下來——" +
      "那等於讓他先做一個不存在的選擇",
  );
});

test("⑩ 預覽結束時算出來的停用條件裡真的有混批這一項", () => {
  /*
   * ⚠️ 不可以用「第一個 $("commit").disabled =」去找。
   *   app.js 裡另有一處 `if ($("commit")) $("commit").disabled = true;`
   *   （切換計畫時無條件停用），它排在前面，抓到它這一條就永遠綠。
   *   要找的是 renderPreview() 結尾那一處**有條件**的計算。
   */
  const lines = appSource.split("\n");
  const at = lines.findIndex((text) =>
    /\$\("commit"\)\.disabled =\s*$/.test(text),
  );
  assert.ok(
    at > 0,
    "找不到 renderPreview() 結尾那一處有條件的 commit 停用計算",
  );
  const block = lines.slice(at, at + 3).join("\n");
  assert.ok(
    /mixedNow/.test(block),
    `commit 的停用條件沒有帶混批，實際：\n${block}`,
  );
  assert.ok(
    /pending\.some\(\(x\) => x\.ok\)/.test(block) && /unchecked > 0/.test(block),
    `原本的兩個條件不可以被換掉，實際：\n${block}`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #45／#46「假分裂」的另外兩處（2026-09-29）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29：「請同步交通服務水準也修正 字串比對正規化的問題」。
 * 清單上的 #45／#46 指名兩處：
 *   ① `conclusion.js` 的「方向顯示名稱與報告文字相同就不補括號」比原字串
 *      → 使用者命名時多一個空白，草稿會把同一個名稱印兩次，
 *        而那一段是要貼進正式報告的。
 *   ② `quality-extension.js` 的結論範本同名覆寫比原字串
 *      → 多一個空白就多出一個看起來一模一樣的範本，
 *        使用者以為自己在覆寫舊的那一個。
 *
 * ⚠️ 這是**原始碼守門**：兩處都在 DOM 事件處理器裡（`onclick`、模板字串），
 *   抽出來單獨跑的成本遠高於它能多驗到的東西。
 *   真正的行為由 `direction-text-noise.test.mjs`（`directionTextKey` 的語意）
 *   與 `direction-pair.test.mjs`（吸收／不吸收什麼）釘住。
 */

test("⑪ conclusion.js 的方向文字比對走 directionTextKey，不比原字串", () => {
  const conclusion = readFileSync(join(here, "conclusion.js"), "utf8");
  assert.ok(
    !/row\.directionText !== dirLabel\(row\)/.test(conclusion),
    "還在拿原字串比——使用者命名時多一個空白，草稿就會把同一個名稱印兩次",
  );
  assert.ok(
    /directionTextKey\(row\.directionText\) !== directionTextKey\(dirLabel\(row\)\)/.test(
      conclusion,
    ),
    "兩邊都要走 directionTextKey；只正規化其中一邊等於沒有比對",
  );
  /*
   * ⚠️ 而且 directionTextKey 必須來自 direction-pair，不可以在這裡再抄一份。
   *   conclusion.js 在 node 下是被 require() 單獨載入的（既有測試就是這樣測的），
   *   所以它要自己 require 一次；兩邊都拿不到時**直接丟例外**，
   *   不可以悄悄退回「比原字串」——那樣假分裂會在某些環境下復活而沒有人發現。
   */
  assert.ok(
    /require\("\.\/direction-pair\.js"\)\.directionTextKey/.test(conclusion),
    "conclusion.js 沒有在 node 環境下取得共用的 directionTextKey",
  );
  /*
   * ⚠️ conclusion.js 裡**可以**有一個叫 directionTextKey 的薄包裝
   *   （它要處理「瀏覽器讀全域、node 讀 require」兩種載入方式，
   *   而且刻意在**呼叫時**才解析——載入時就解析的話，
   *   那幾支拿 new Function 造假 globalThis 的沙箱會在載入 conclusion.js 時就炸）。
   *   要擋的是「自己又抄一份正規化」，所以驗的是**它不含正規化的實作**。
   */
  const wrapper = conclusion.slice(
    conclusion.indexOf("function directionTextKey(value)"),
    conclusion.indexOf("var CONCLUSION_METRICS"),
  );
  assert.ok(wrapper.length > 100, "找不到 conclusion.js 裡取得共用比對鍵的那一段");
  for (const forbidden of ["normalize(\"NFKC\")", "replace(/["]) {
    assert.ok(
      !wrapper.includes(forbidden),
      `conclusion.js 自己又抄了一份正規化（看到 ${forbidden}）——` +
        "同一件事兩份實作就是漂移的起點",
    );
  }
  assert.ok(
    !/typeof directionKeyCache !== "function"[\s\S]{0,200}?return value/.test(conclusion),
    "拿不到共用函式時不可以悄悄退回原字串——那樣假分裂會在某些環境下復活",
  );
});

test("⑫ quality-extension.js 的範本同名覆寫走 normalize，不比原字串", () => {
  const quality = readFileSync(join(here, "quality-extension.js"), "utf8");
  assert.ok(
    !/templates\.findIndex\(\(t\) => t\.name === name\)/.test(quality),
    "還在拿原字串比——多一個空白就會多出一個看起來一模一樣的範本",
  );
  assert.ok(
    /const nameKey = normalize\(name\);/.test(quality) &&
      /templates\.findIndex\(\(t\) => normalize\(t\.name\) === nameKey\)/.test(quality),
    "兩邊都要正規化",
  );
  /*
   * ⚠️ 存進去的 name 必須還是**使用者打的原字串**。
   *   把它換成正規化後的字是另一件事，而使用者會發現自己的名字被動過。
   */
  const at = quality.indexOf("const nameKey = normalize(name);");
  const block = quality.slice(at, at + 700);
  assert.ok(
    /\n\s+name,\n/.test(block),
    `entry 存的應該是原字串 name，不是 nameKey：\n${block.slice(0, 400)}`,
  );
});

test("⑬ 表格數字是等寬數字（#16 的另一半），而且只套 td", () => {
  const css = readFileSync(join(here, "styles.css"), "utf8");
  assert.ok(
    /td\{font-variant-numeric:tabular-nums\}/.test(css),
    "另外兩支都做了，只有這一支沒有",
  );
  /*
   * ⚠️ 不可以套到 th 上：表頭是文字標題，等寬數字對它沒有意義，
   *   而且 `1` 變寬之後標題排版會跟著鬆掉。
   *
   * ⚠️ 判斷方式是「找出每一條含 tabular-nums 的規則，看它的選擇器」，
   *   不是在整份字串上用一條寬鬆的正規表示式。
   *   我第一版寫 `/th[^{]*\{[^}]*tabular-nums/`，而 `max-width` 裡就有 "th"，
   *   於是它在**正確的**樣式表上也會紅——那是一個恆紅的假守門。
   */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) =>
    /tabular-nums/.test(rule[2]),
  );
  assert.equal(
    rules.length,
    1,
    `應該只有一條規則設等寬數字，實際 ${rules.length} 條：` +
      rules.map((r) => r[1].trim().split("\n").pop().trim()).join(" / "),
  );
  const selector = rules[0][1].trim().split("\n").pop().trim();
  assert.equal(selector, "td", `等寬數字的選擇器應該是 td，實際是「${selector}」`);
});

/* ══════════════════════════════════════════════════════════════════════
 *  交付包不可以夾帶探針／e2e 產生的截圖（2026-09-29，三支同步）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-28：本支的交付包夾帶了 `scripts/manual/point-labels-few.png`
 * （一張 e2e 截圖，沒有任何程式讀它），GPT 把它刪掉是對的。
 * 2026-09-29：姊妹系統路口轉向的包裡掃到**同一類的 6 個**
 * （`scripts/manual/` 底下的探針截圖）。
 * 一次是意外，兩次就該有守門，所以三支同步加這一條。
 *
 * ⚠️ 擋的是「**交付包裡**有這種檔」，不是「探針不可以產生截圖」。
 *   探針照樣會在本機寫出 .png（那是它證明事情的方式），
 *   只是那些檔案不該跟著交付包走。
 */
test("交付包裡不可以有 .png（探針與 e2e 的輸出，不是交付內容）", async () => {
  const { readdirSync, statSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const root = fileURLToPath(new URL(".", import.meta.url));
  if (!existsSync(root)) return;
  const found = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      /*
       * ⚠️ `.probe-shots/` 是**本機探針的暫存目錄**，從來沒有進過交付包
       *   （2026-09-29 實測：三包裡 0 個）。把它一起掃的話，
       *   這條守門會在一個**正確的**工作樹上變紅——那是假的紅，
       *   而假的紅比沒有守門更貴。要擋的是「跟著交付包走的截圖」。
       */
      if (name === "node_modules" || name === ".git" || name === ".probe-shots")
        continue;
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.png$/i.test(name)) found.push(`${prefix}${name}`);
    }
  };
  walk(root, "");
  assert.deepEqual(
    found,
    [],
    "交付包裡夾帶了截圖：\n- " +
      found.join("\n- ") +
      "\n這些是探針或 e2e 寫出來的，沒有任何程式讀它們。打包前要清掉。",
  );
});
