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
import { validationFileName } from "./validation-file.mjs";

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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K46：LOS 圖說明的分界要逐列問，不可以用最新一季那一把尺量全部季別
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊寫法 `bandHitFor(last, road, code)` 只解析**最新一季**，卻拿它去數
 * `withLos`（全部季別）有幾筆落在壅塞段，然後把那把尺的名字寫進句子。
 * 三段分法自 2026-09-15 起可以依「季別區間 × 路段」覆寫，所以同一條路
 * 不同季可以有不同的壅塞起始等級——那句話會對早期季別說錯的分界。
 *
 * 2026-09-24 F6 獨立複查抓到（它只拿到打包好的檔案與規則）。
 *
 * ⚠️ 這裡守的是**兩件事**，缺一不可：
 *   一、逐列問分界（不可以再出現 bandHitFor(last, …)）；
 *   二、混用分界時整段不寫（mixedRules），與三段分法圖同一套做法。
 * 只守第一件的話，混用時仍會硬挑一個分界寫進句子。
 */
test("K46：LOS 圖說明不可以用單一季別的分界去數全部季別", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const start = source.indexOf("function losCardScript");
  assert.ok(start > 0, "找不到 losCardScript——改名的話這一支要跟著改");
  const body = source
    .slice(start, source.indexOf("\nfunction ", start + 10))
    /* 先剝註解：說明文字裡本來就會寫到舊寫法，不剝會比對到註解。 */
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.doesNotMatch(
    body,
    /bandHitFor\(\s*last\b/,
    "還在用最新一季的分界；要改成逐列 bandHitFor(r.period, r.road, code)",
  );
  assert.match(
    body,
    /bandHitFor\(\s*r\.period\s*,\s*r\.road/,
    "沒有逐列問分界",
  );
  assert.match(
    body,
    /mixedRules/,
    "沒有處理「同一張圖裡不只一組分界」——那時候不可以硬寫一個分界出來",
  );
  assert.match(
    body,
    /&&\s*!mixedRules/,
    "mixedRules 時仍然會產生那一句統計；應該整段不寫",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K47：歷季趨勢圖的壅塞佔比也要逐列問分界
 * ══════════════════════════════════════════════════════════════════════
 *
 * K46 修了 LOS 卡，這一支修的是**歷季趨勢圖**——最後一處還在用計畫預設
 * 一把尺量全部列的地方。舊寫法只把 `bandsFor().congestedStart` 這個純量
 * 傳進 `buildTrendSeries`，於是同一頁上「三段分法圖」（buildBandSeries，
 * 早就逐列問）與「X 級以下路段佔比」對同一季給出**不同的壅塞條數**。
 *
 * 2026-09-24 F6 獨立複查抓到。
 *
 * ⚠️ 這一支守的是**接線**（app.js 有沒有把逐列解析器交出去）；
 *   逐列判定本身的行為與「沒有覆寫時不可以變」的反證在 trend.test.mjs。
 *   兩邊缺一不可：只有行為測試的話，app.js 忘了接線照樣全綠。
 */
test("K47：趨勢圖的兩個 buildTrendSeries 呼叫都要交出逐列分界解析器", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  /* 先剝註解：這一段的說明文字裡本來就會寫到舊寫法。 */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  /* 前置檢查：解析器本體真的存在，而且真的走 bandHitFor（不是自己寫一套） */
  const helper = /function trendCongestedStartOf\(row\)\s*\{([^}]*)\}/.exec(code);
  assert.ok(helper, "找不到 trendCongestedStartOf——改名的話這一支要跟著改");
  assert.match(
    helper[1],
    /bandHitFor\(\s*row\.period\s*,\s*row\.road/,
    "逐列解析器必須走 bandHitFor(row.period, row.road)，不可以自己寫一套判定",
  );

  /* 前置檢查：呼叫點的數量。多了一處而沒接線，下面的計數就會對不上。 */
  const calls = code.match(/buildTrendSeries\(/g) || [];
  assert.equal(calls.length, 2, "buildTrendSeries 的呼叫點數量變了，請一併檢查接線");
  const wired = code.match(/congestedStartOf:\s*trendCongestedStartOf/g) || [];
  assert.equal(
    wired.length,
    2,
    "每一個 buildTrendSeries 呼叫都要傳 congestedStartOf，少一處那一張圖就會用錯的尺",
  );

  /*
   * 勾選框的名稱也不可以在有覆寫時指名錯的等級。
   * ⚠️ 2026-09-25：第一版守的是 `trendMixedRules()`，而那一支本身有兩個錯
   *   （把全部日別掃在一起、用計畫預設當要指名的那一級），已改成
   *   `trendCongestedLabelOpts(list)` —— 直接問圖。細節與反證在下面的 K49。
   */
  assert.match(
    code,
    /function trendCongestedLabelOpts\(list\)/,
    "找不到 trendCongestedLabelOpts——指標勾選框的名稱會與圖上的名稱不一致",
  );
  assert.match(
    code,
    /trendMetricLabel\(metric\.key,\s*congestedOpts\)/,
    "指標勾選框的名稱沒有走 trendCongestedLabelOpts 的結果",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K48：使用者看得到的文件不可以再保證「永遠只有一條分界線」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 補了「依季別區間／路段套用不同分界」之後，這句保證就不成立了，
 * 但手冊、畫面、README、結論草稿一共五處還留著它（2026-09-24 F6 抓到）。
 * 它不只是過期——它會讓使用者**不去查覆寫清單**，然後拿計畫預設那把尺
 * 去驗算圖上的數字，怎麼算都對不起來。
 *
 * ⚠️ 這一支刻意**不比對整句**。改幾個字繞過去太容易了，
 *   所以守的是「一條／同一條 分界／紅線」這個**說法**。
 *   要講一致性請寫「永遠套用同一組分界」——那句話在有覆寫時仍然成立
 *   （四處都是逐筆各自套用，所以條數一致），沒有騙人。
 */
test("K48：文件不可以保證「只有一條分界線」（覆寫功能讓這句話變成假的）", () => {
  /*
   * ⚠️ 2026-09-25 補上後三個（F6 第三輪抓到覆蓋缺口）：
   *   使用者拿到的那句「五處保證已更正」的宣告寫在 `【更新說明】`，
   *   而那份文件本身、`VALIDATION_*`、以及交接給下一個人照著做的
   *   `PROJECT_HANDOFF.md` 都不在守備範圍——下一次有人在更新說明裡
   *   再寫一次那句保證，不會紅。
   * ⚠️ 這三份目前是乾淨的，所以這一次不是修缺陷，是補守門的覆蓋範圍。
   */
  const files = [
    "manual-src/manual.html",
    "index.html",
    "README.md",
    "conclusion.js",
    "app.js",
    "trend.js",
    "【更新說明】請先讀我.txt",
    "PROJECT_HANDOFF.md",
  ];
  /*
   * ⚠️ 一定要連「永遠／一律／全系統」那個**保證詞**一起抓。
   *   只抓「一條分界」會連「已新增一條分界覆寫」這種正常的 toast 都掃到，
   *   那是在講「一筆覆寫」，不是在保證全系統只有一把尺。
   */
  const banned =
    /(永遠|一律|全系統)[^。\n]{0,12}(只有|是)[^。\n]{0,6}(一條|同一條)\s*(分界線?|紅線|線)/;
  for (const file of files) {
    let text = readFileSync(new URL("./" + file, import.meta.url), "utf8");
    /* .js 的註解裡本來就會寫到這個舊說法（那是在記錄病灶），先剝掉。 */
    if (file.endsWith(".js"))
      text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const hit = banned.exec(text);
    assert.equal(
      hit,
      null,
      `${file} 還在說「${hit ? hit[0] : ""}」；有季別區間／路段覆寫時這句話是假的，` +
        "請改寫成「永遠套用同一組分界」或講明覆寫時的做法",
    );
  }

  /* 前置檢查：這個正規式真的抓得到那五句的寫法，否則它會安靜地變成恆真。 */
  for (const sample of [
    "永遠只有一條分界線，不會出現同一頁上兩條不一樣的紅線",
    "兩者永遠是同一條線的分界線",
    "全系統永遠只有一條分界線",
  ])
    assert.match(sample, banned, "正規式抓不到已知的舊寫法，這一支等於沒在守");

  /*
   * ⚠️ 驗證報告裡寫的「掃 N 個檔案」必須等於上面這個陣列的長度
   *   （2026-09-25 第六輪抓到：陣列補到八個，報告還寫「六個」）。
   *   這種數字沒有人會回去數，而讀的人會信它。
   */
  const validation = readFileSync(
    new URL(`./${validationFileName(here)}`, import.meta.url),
    "utf8",
  );
  const CJK = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const claim = validation.match(/K48 掃([0-9三四五六七八九十]+)個檔案/);
  assert.ok(claim, "驗證報告裡找不到「K48 掃 N 個檔案」這句——它改寫了就要同步改這裡");
  const claimed = CJK[claim[1]] ?? Number(claim[1]);
  assert.equal(
    claimed,
    files.length,
    `驗證報告寫「掃${claim[1]}個檔案」，實際掃 ${files.length} 個`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K49：覆寫「涵蓋全部列」時，圖說與勾選框的文字也要跟著那一組
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-25 F6 第三輪抓到 K47 的兩個漏網情形。共同成因：
 * **`mixedRules` 只有「同一張圖裡出現兩種以上分界」時才是 true**，
 * 所以只要覆寫涵蓋了那張圖的全部列，`mixedRules` 就是 false，
 * 而任何仍然拿 `bandsFor()`（計畫預設）去組文字的地方就會寫錯。
 *
 *   ① `trendDescriptions` 的 `bandText` 原本是
 *      `bandLabels().congested.replace(...)`——永遠是計畫預設那一組。
 *      → 同一頁上三段分法圖圖例寫「壅塞 C、D、E、F」、趨勢圖圖說寫「E、F」。
 *   ② 指標勾選框的名稱原本自己掃一套 `trendMixedRules()`，而且
 *      **把全部日別掃在一起**——但一個日別就是一張圖。平日全套 E、
 *      假日全套 C 時，勾選框寫「（分界不只一組）」而兩張圖各自指名一個等級。
 *      它還用 `bandsFor()` 當要指名的那一級，覆寫涵蓋全部列時也會寫錯。
 *
 * 守法：文字一律**由圖算出來的結果**決定，不可以再出現
 * 「拿 bandsFor()／bandLabels() 去組趨勢圖文字」這個寫法。
 */
test("K49：趨勢圖的圖說與勾選框不可以拿計畫預設去組文字", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  /* ── ① 圖說的 bandText ── */
  const descBody = /function trendDescriptions\(list\)\s*\{[\s\S]*?\n\}/.exec(code);
  assert.ok(descBody, "找不到 trendDescriptions——改名的話這一支要跟著改");
  assert.doesNotMatch(
    descBody[0],
    /bandLabels\(|bandsFor\(/,
    "trendDescriptions 還在拿計畫預設（bandLabels／bandsFor）組文字；" +
      "覆寫涵蓋全部列時那組文字就是錯的",
  );
  assert.match(
    descBody[0],
    /bandText:[\s\S]{0,120}series\.congestedStart/,
    "bandText 沒有改成用 series 自己那一組分界組出來",
  );
  /* 前置檢查：那個組文字的小工具真的存在，而且會算速限比門檻。 */
  const helper = /function bandCongestedTextFor\(congestedStart[^)]*\)\s*\{[\s\S]*?\n\}/.exec(code);
  assert.ok(helper, "找不到 bandCongestedTextFor");
  assert.match(helper[0], /rulesFor\(/, "bandCongestedTextFor 沒有把速限比門檻算進去");

  /* ── ② 勾選框的名稱 ── */
  assert.doesNotMatch(
    code,
    /function trendMixedRules\(/,
    "trendMixedRules 回來了。它把全部日別掃在一起，而一個日別就是一張圖——" +
      "請改用 trendCongestedLabelOpts(list)，直接問圖",
  );
  const optsBody = /function trendCongestedLabelOpts\(list\)\s*\{[\s\S]*?\n\}/.exec(code);
  assert.ok(optsBody, "找不到 trendCongestedLabelOpts");
  assert.match(
    optsBody[0],
    /series\.mixedRules/,
    "trendCongestedLabelOpts 沒有讀每一張圖自己的 mixedRules",
  );
  assert.match(
    optsBody[0],
    /series\.congestedStart/,
    "trendCongestedLabelOpts 沒有讀每一張圖實際套用的分界",
  );
  assert.match(
    code,
    /trendMetricLabel\(metric\.key,\s*congestedOpts\)/,
    "勾選框的名稱沒有走 trendCongestedLabelOpts 的結果",
  );
  /* ⚠️ 名稱一定要在圖算出來**之後**才組，否則又變成另寫一套判斷。 */
  const renderIdx = code.indexOf("$(\"trendMetricBoxes\").innerHTML");
  const listIdx = code.lastIndexOf("var list = trendSeriesList();", renderIdx);
  assert.ok(
    listIdx > 0 && listIdx < renderIdx,
    "勾選框的名稱是在 trendSeriesList() 之前組的——那就沒有圖可以問",
  );
  /*
   * ⚠️ 畫面那一段裡**同一個 list** 要同時餵給勾選框名稱與說明文字，
   *   不可以為了組名稱另外再算一次（另算一次就有兩套結果可以互相矛盾）。
   *   其他呼叫點（匯出、下載）各自重算是正常的，不在這一條的範圍內。
   */
  const renderBlock = code.slice(listIdx, code.indexOf("trendDescriptions(list)", listIdx) + 40);
  assert.ok(
    renderBlock.includes("trendCongestedLabelOpts(list)") &&
      renderBlock.includes("trendDescriptions(list)"),
    "畫面那一段沒有把同一個 list 同時給勾選框名稱與說明文字",
  );
  assert.equal(
    (renderBlock.match(/trendSeriesList\(\)/g) || []).length,
    1,
    "畫面那一段算了兩次 trendSeriesList()——名稱與圖可能出自不同的結果",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K50：不可以寫成「只要加了覆寫，文字就不指名等級」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-25 F6 第四輪抓到，這是 K49 的**文件面**漏網。
 *
 * 程式的規則是**兩段**的：
 *   ・那張圖涵蓋的範圍只套到**一組**分界 → 指名**那一組**
 *     （即使那一組來自覆寫，例如覆寫涵蓋了全部季別與路段）
 *   ・套到**不只一組** → 不指名任何等級
 *
 * 而三處文件寫成「**有覆寫時**文字不再指名單一等級」，把條件整個吃掉：
 *   `index.html` 判定標準頁的說明、`manual-src/manual.html`、`README.md`。
 *
 * ⚠️ 後果：使用者在「判定標準」頁加了一條涵蓋全部季別與路段的覆寫，
 *   圖上仍然寫「C 級以下路段佔比」——他照那段文字會以為程式錯了。
 *   而那一頁正是他加覆寫的地方，是最容易被讀到的一段。
 * ⚠️ `manual.html` 更嚴重：它與**同一份手冊**另一處寫對的規則直接相反。
 *
 * 守法：凡是在同一句裡把「有覆寫」與「不指名等級／改成不指名」連起來的寫法都擋。
 * 正確的寫法必須把「只套到一組」與「不只一組」兩種情形都寫出來。
 */
test("K50：文件不可以把「有覆寫」等同於「文字不指名等級」", () => {
  const files = [
    "index.html",
    "manual-src/manual.html",
    "README.md",
    "conclusion.js",
    "app.js",
  ];
  /*
   * 「有覆寫…不指名／不再指名」出現在同一句（句號之間）就算違規。
   * ⚠️ 允許「不只一組…不指名」——那才是對的條件。
   */
  const bad = /(有(?:加)?(?:季別區間／路段)?覆寫|加了覆寫)[^。\n]{0,60}(不(?:再)?指名|改成不指名)/;
  const offenders = [];
  for (const file of files) {
    let text = readFileSync(new URL("./" + file, import.meta.url), "utf8");
    if (file.endsWith(".js"))
      text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const sentence of text.split(/[。\n]/)) {
      if (!bad.test(sentence)) continue;
      /* 同一句裡也寫了「不只一組」的條件，就是對的寫法。 */
      if (/不只一組/.test(sentence)) continue;
      offenders.push(`${file}｜${sentence.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "這些地方把「有覆寫」等同於「不指名等級」，而程式只有在**不只一組**時才不指名：\n  " +
      offenders.join("\n  "),
  );

  /* 前置檢查：正規式真的抓得到那三種已知寫法，否則它會安靜地變成恆真。 */
  for (const sample of [
    "有加季別區間／路段覆寫時，兩張圖也都是逐筆用各自的分界判定，只是文字不再指名單一等級",
    "在「依季別區間／路段套用不同分界」加了覆寫時，趨勢圖的指標名稱也會改成不指名等級的",
    "有覆寫時四處都改成逐筆用各自的分界判定，只是文字不再指名單一等級",
  ])
    assert.match(sample, bad, "正規式抓不到已知的寫法，這一支等於沒在守");

  /* 正面斷言：三份使用者文件都要真的寫出「只套到一組」那一半。 */
  for (const file of ["index.html", "manual-src/manual.html", "README.md"]) {
    const text = readFileSync(new URL("./" + file, import.meta.url), "utf8");
    assert.match(
      text,
      /只套到(?:<b>|<strong>)?一組|只套到一組/,
      `${file} 沒有寫出「只套到一組分界時要指名那一組」這一半規則`,
    );
  }
});
