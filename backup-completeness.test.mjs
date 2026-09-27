/*
 * 備份／專案包必須帶走使用者自己設定的每一樣東西。
 *
 * 起因：使用者問「結論草稿的條件範本存好之後，換一台電腦還在嗎？」
 * 查證結果是**不在**——範本存在 state.conclusionTemplates[計畫代碼]，
 * 本機有存，但匯出的專案包與個人全部計畫包**都沒有收**。
 * 使用者在 A 電腦存了好幾組常用條件，帶到 B 電腦匯入之後一組都沒有，
 * 而畫面只會說匯入成功。那些條件是一項一項勾出來的，重建很花時間。
 *
 * 這一支的作法是「清單比對」：把 state 裡屬於使用者設定的鍵列出來，
 * 逐一確認匯出時有收、匯入時有還原。日後新增設定卻忘了收進備份，
 * 這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("app.js", import.meta.url), "utf8");
/*
 * ⚠️ 2026-09-25 新增：惰性建立的 state 鍵有一部分寫在 quality-extension.js
 *   （例如 `state.conclusionTemplates = state.conclusionTemplates || {}`），
 *   只讀 app.js 會漏掉它們。見 stateKeys() 裡的說明。
 */
const extensionSource = await readFile(
  new URL("quality-extension.js", import.meta.url),
  "utf8",
);

/**
 * 使用者會自己調整、換電腦時應該一起帶走的東西。
 * 純衍生資料（summaries 之類可由 details 重算的）不列在這裡。
 */
const MUST_TRAVEL = [
  "details",
  "summaries",
  "imports",
  "limits",
  "limitConfirmed",
  "aliases",
  "roadMeta",
  "speedVersions",
  "reportDrafts",
  "conclusionTemplates",
  /*
   * 「同一份檔案有兩個日期，哪一個才對」的指定（使用者 2026-09-20）。
   * 不帶走的話，換一台電腦匯入之後系統會退回自己判讀的那一個日期，
   * 明細上的調查日期與期別顯示的調查月份當場變成另一天。
   */
  "surveyDateOverrides",
];

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `app.js 裡找不到 ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${startMarker} 之後找不到 ${endMarker}`);
  return source.slice(start, end);
}

test("單一計畫的專案包收齊了使用者的設定", () => {
  const pack = block("function projectPackage()", "function downloadProjectPackage");
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(pack),
      `projectPackage() 沒有收 ${key}——換一台電腦匯入之後這一項會消失`,
    );
});

test("個人全部計畫包收齊了使用者的設定", () => {
  const pack = block('kind: "TLM_PORTFOLIO_PACKAGE"', "交通服務水準_個人全部計畫包.json");
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(pack),
      `個人全部計畫包沒有收 ${key}`,
    );
});

test("匯入專案包時會把條件範本還原回來", () => {
  assert.match(
    source,
    /state\.conclusionTemplates\[x\.project\.code\]\s*=\s*x\.conclusionTemplates/,
    "匯入專案包時沒有把 conclusionTemplates 寫回 state",
  );
});

test("舊版專案包沒有條件範本時，不可以把這台電腦既有的範本清掉", () => {
  /*
   * 只有在備份裡「確實有」那個欄位時才覆蓋。
   * 無條件指派的話，匯入一個舊版專案包就會把使用者已經存好的範本抹成
   * undefined——那比不還原更糟。
   */
  assert.match(
    source,
    /if \(Array\.isArray\(x\.conclusionTemplates\)\)\s*\n?\s*state\.conclusionTemplates\[x\.project\.code\]/,
    "還原條件範本前必須先確認備份裡真的有這個欄位",
  );
});

/*
 * 三段分法（順暢／尚可／壅塞）也必須跟著備份走。
 *
 * 它是使用者自己調的，而且會直接改變圖上的分段與趨勢圖指標的名稱
 *（分界設 E 就叫「E 級以下路段佔比」）。換一台電腦匯入之後不見的話，
 * 同一份資料會畫出不一樣的圖、指標名稱也不一樣，而畫面不會有任何提示。
 *
 * 這一項單獨寫，不放進 MUST_TRAVEL：單一計畫的專案包用單數 bandRule
 *（就這一個計畫的設定），個人全部計畫包用複數 bandRules（整包字典），
 * 兩邊的鍵值本來就不同名，硬塞進同一份清單會比對不到。
 * losRule／losRules 也是同樣的情形。
 */
test("三段分法要跟著兩種備份走", () => {
  const single = block("function projectPackage()", "function downloadProjectPackage");
  assert.ok(
    /\bbandRule\b/.test(single),
    "projectPackage() 沒有收 bandRule——換電腦之後三段分法會回到預設，圖會變樣",
  );
  const portfolio = block('kind: "TLM_PORTFOLIO_PACKAGE"', "交通服務水準_個人全部計畫包.json");
  assert.ok(
    /\bbandRules\b/.test(portfolio),
    "個人全部計畫包沒有收 bandRules",
  );
});

test("匯入專案包時要把三段分法還原回來；舊包沒有時要回到預設而不是沿用別的計畫", () => {
  const restore = block('x.kind === "TLM_PROJECT_PACKAGE"', "TLM_PORTFOLIO_PACKAGE");
  assert.ok(
    /state\.bandRules\[x\.project\.code\] = x\.bandRule/.test(restore),
    "匯入時沒有把 bandRule 寫回 state.bandRules",
  );
  assert.ok(
    /delete state\.bandRules\[x\.project\.code\]/.test(restore),
    "舊版專案包沒有 bandRule 時要刪掉，回到預設值；沿用舊值會讓兩個計畫的分法混在一起",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 清單不可以用手維護——這一支自己就是被那樣繞過去的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那份 MUST_TRAVEL 是**人工維護**的，於是 2026-09-23 的獨立複查發現：
 * `bandRuleScopes`（三段分法的「季別區間 × 路段」覆寫）與 `ackedIssues`
 * （按過的「已人工確認」）**都沒有進單一計畫的專案包**，而這一支
 * 「備份收齊了使用者的設定」照樣全綠——因為它們不在清單裡。
 *
 * 檔頭寫著「日後新增設定卻忘了收進備份，這裡就會失敗」，實際上失敗的
 * 前提是「有人記得同時把它加進清單」。**忘了加進備份的人，也會忘了加進清單。**
 *
 * 所以這一支改成從 `emptyState()` **反推**：
 *   state 裡的每一個鍵，不是進備份，就是必須列在下面的例外表裡並寫明理由。
 * 新增一個鍵而兩邊都沒做的話，這裡就會紅——而且訊息會指名那個鍵。
 */
function stateKeys() {
  const start = source.indexOf("const emptyState = () => ({");
  assert.notEqual(start, -1, "app.js 裡找不到 emptyState()");
  const end = source.indexOf("\n});", start);
  const body = source.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const declared = [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map(
    (m) => m[1],
  );

  /*
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 2026-09-25：只從 emptyState() 反推**抓不到惰性建立的設定**
   * ══════════════════════════════════════════════════════════════════
   *
   * 上面那段說明宣稱「state 裡的每一個鍵」都會被這一支檢查到，
   * 但有一整類設定不是在 emptyState() 裡宣告的，而是用
   *   `state.xxx = state.xxx || {}`
   * 惰性建立的。`conclusionTemplates` 就是活生生的例子——
   * **而它沒進備份正是這一支測試最初的起因**（見檔頭）。
   * 實測：emptyState() 抽到 24 個鍵，裡面沒有 conclusionTemplates。
   *
   * 於是下一個用同樣寫法新增設定的人，兩個「反推」測試都不會抓到他。
   * 這裡把那一類也一起掃進來（app.js 與 quality-extension.js 兩支都掃）。
   */
  const lazy = new Set();
  for (const text of [source, extensionSource])
    for (const m of text.matchAll(
      /state\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*state\.\1\s*\|\|/g,
    ))
      lazy.add(m[1]);

  assert.ok(
    lazy.size > 0,
    "一個惰性建立的 state 鍵都沒掃到——" +
      "掃描樣式可能過期了（原本至少掃得到 conclusionTemplates）",
  );
  assert.ok(
    lazy.has("conclusionTemplates"),
    "掃不到 conclusionTemplates——它是這一支測試的起因，" +
      "掃不到它就表示這個掃描方式失效了",
  );

  return [...new Set([...declared, ...lazy])];
}

/**
 * 刻意**不**跟著備份走的鍵，每一個都要寫理由。
 * ⚠️ 想讓這一支變綠而把一個鍵加到這裡時，請先問自己：
 *   使用者換一台電腦之後，這一項不見了他會不會覺得是 bug？
 *   會的話就是要收進備份，不是加到這張表。
 */
const DELIBERATELY_NOT_IN_PACK = {
  version: "備份格式的版本號，由匯出端自己寫，不是使用者的設定",
  projects: "專案包帶的是單數的 project（就這一個計畫）；個人全部計畫包才有複數",
  activeCode: "「目前開著哪一個計畫」是這台電腦此刻的狀態，不是設定",
  last: "上一次用的畫面選擇（暫存），換電腦沿用別人的選擇只會干擾",
  periodDisplay:
    "顯示偏好（期別要顯示成季別還是調查月份）：**跟人走**（瀏覽器儲存＋個人全部計畫包），刻意不進單一計畫的專案包——那一包是要給別人的",
  yearStyle:
    "顯示偏好（民國／西元）：**跟人走**（瀏覽器儲存＋個人全部計畫包），刻意不進單一計畫的專案包——那一包是要給別人的",
  showSurveyDate:
    "顯示偏好：**跟人走**（瀏覽器儲存＋個人全部計畫包），刻意不進單一計畫的專案包" +
    "——那一包是要給別人的（never-revert-contract 第 22 條）",
};

test("⚠️ state 裡的每一個鍵，不是進專案包就是列在例外表裡（清單由程式反推）", () => {
  const pack = block(
    "function projectPackage()",
    "function downloadProjectPackage",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const missing = [];
  for (const key of stateKeys()) {
    if (key in DELIBERATELY_NOT_IN_PACK) continue;
    /*
     * 專案包用單數（losRule／bandRule／anomalyRule），state 用複數，
     * 兩種寫法都算收到了。
     */
    const singular = key.replace(/Rules$/, "Rule");
    if (new RegExp(`\\b(${key}|${singular})\\b`).test(pack)) continue;
    missing.push(key);
  }
  assert.deepEqual(
    missing,
    [],
    "這幾個使用者設定沒有進單一計畫的專案包，也沒有寫明為什麼不進：\n  " +
      missing.join("、") +
      "\n換一台電腦或把計畫交接給別人之後，它們會靜默消失。" +
      "\n確定不該進備份的話，請加進 DELIBERATELY_NOT_IN_PACK 並寫明理由。",
  );
});

test("⚠️ state 裡的每一個鍵，不是進個人全部計畫包就是列在例外表裡", () => {
  const pack = block(
    'kind: "TLM_PORTFOLIO_PACKAGE"',
    "交通服務水準_個人全部計畫包.json",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  /*
   * ⚠️ 個人全部計畫包是**整份 state**，所以「跟人走」那一類偏好在這裡
   *   **必須**有——它們不進單一計畫的專案包（那一包要給別人），
   *   但一定要進自己這一包，否則換電腦就被翻回預設。
   *
   * ⚠️ 原本這裡只特例了 `showSurveyDate`，於是 `periodDisplay`、`yearStyle`
   *   這兩個**理由一字不差**的鍵被例外表擋掉、漏出備份而沒有人發現
   *   （2026-09-24 F6 抓到）。改成用**理由**認人：例外表裡寫著「跟人走」的，
   *   一律要在這一包裡。這樣下一個同類的鍵加進來時不必再改這一支。
   */
  const personal = Object.keys(DELIBERATELY_NOT_IN_PACK).filter((key) =>
    /跟人走/.test(DELIBERATELY_NOT_IN_PACK[key]),
  );
  /* 前置檢查：真的認到人了，否則理由改寫之後這一支會安靜地變回只驗一半。 */
  assert.ok(
    personal.length >= 3 && personal.includes("showSurveyDate"),
    `「跟人走」的偏好只認到 ${personal.length} 個（${personal.join("、")}）——` +
      "例外表的理由寫法改了嗎？這一支靠那四個字認人",
  );
  const missing = [];
  for (const key of stateKeys()) {
    if (key in DELIBERATELY_NOT_IN_PACK && !personal.includes(key)) continue;
    if (new RegExp(`\\b${key}\\b`).test(pack)) continue;
    missing.push(key);
  }
  assert.deepEqual(
    missing,
    [],
    "這幾個使用者設定沒有進個人全部計畫包：\n  " + missing.join("、"),
  );
});

test("⚠️ 例外表裡不可以有已經進了備份的鍵（免得理由與事實對不上）", () => {
  const pack = block("function projectPackage()", "function downloadProjectPackage");
  /*
   * ⚠️ 註解一定要先剝掉，而且只認 `鍵:` 的寫法。
   *   第一版是整段文字搜尋，於是有人在註解裡寫了一句
   *   「check-version.mjs 會…」，那個字串裡的 `version` 就讓這一條變紅——
   *   守門認得註解裡的字，就等於在守「有沒有人寫過說明」，不是守程式。
   *   （同一個錯在姊妹專案路口轉向上也踩過一次。）
   */
  const body = pack.replace(/\/\*[\s\S]*?\*\//g, "");
  /*
   * ⚠️ 2026-09-25 拿掉 `key !== "showSurveyDate"` 這個豁免（F6 第三輪抓到）。
   *   它已經是**死條件**：`projectPackage()` 裡 `showSurveyDate`、`periodDisplay`、
   *   `yearStyle` 三個鍵一個都沒有（那是刻意的，never-revert 第 22 條），
   *   所以這個豁免現在不會擋掉任何東西。
   *   但留著它就等於「同一條規則對三個理由一字不差的鍵給不同待遇」：
   *   哪天有人真的把 `showSurveyDate:` 加進單一計畫的專案包（正是不可以做的事），
   *   這一支不會紅，而另外兩個會紅。
   * ⚠️ `projects` 的豁免要留——那是單複數差異（專案包帶單數的 project），
   *   不是同類的顯示偏好。
   */
  const stale = Object.keys(DELIBERATELY_NOT_IN_PACK).filter(
    (key) => key !== "projects" && new RegExp(`\\b${key}:`).test(body),
  );
  assert.deepEqual(
    stale,
    [],
    "例外表說這幾個不進備份，但專案包裡找得到它們：" + stale.join("、"),
  );
});

test("⚠️ 這幾個鍵真的被還原回來（只驗匯出端等於只驗了一半）", () => {
  const restore = block('x.kind === "TLM_PROJECT_PACKAGE"', "TLM_PORTFOLIO_PACKAGE");
  for (const [key, why] of [
    ["bandRuleScopes", "三段分法的季別區間 × 路段覆寫"],
    ["ackedIssues", "按過的「已人工確認」"],
    ["losRuleScopes", "判定門檻的季別 × 路段覆寫"],
    ["surveyDateOverrides", "使用者指定的調查日期"],
  ])
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(restore),
      `匯入專案包時沒有還原 ${key}（${why}）——匯出有帶、匯入沒讀，等於沒帶`,
    );
});

test("⚠️ 還原點快照留得住「備份帶得走的東西」（判準寫在 quality-extension.js 的註解裡）", async () => {
  const qe = await readFile(
    new URL("quality-extension.js", import.meta.url),
    "utf8",
  );
  const start = qe.indexOf("function operationSnapshot()");
  assert.notEqual(start, -1, "找不到 operationSnapshot()");
  const snapshot = qe.slice(start, qe.indexOf("\n  }", start));
  for (const [key, why] of [
    ["losRuleScopes", "復原之後判定門檻的覆寫會停在操作後的值"],
    ["bandRuleScopes", "復原之後三段分法的覆寫會停在操作後的值"],
    ["surveyDateOverrides", "復原之後調查日期的指定會停在操作後的值"],
    ["ackedIssues", "復原之後按過的確認會停在操作後的狀態"],
  ])
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(snapshot),
      `還原點快照沒有存 ${key}——${why}，` +
        "復原出來會是一個兩邊拼起來、從來沒有存在過的狀態",
    );
});
