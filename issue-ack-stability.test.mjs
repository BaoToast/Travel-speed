/*
 * ══════════════════════════════════════════════════════════════════════
 *  「已人工確認」不可以因為又匯入一季就自動失效
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 回報：
 *   「我將路段車流方向手動修正為 北上/南下，導致我每季匯入資料，
 *     每一次都抓出車流方向不一致的問題。
 *     怎會把我手動修改這件事當作異常來回報給我呢?」
 *
 * 根因不是他改了方向名稱，而是 `issueFingerprint()` 把**整段說明文字**
 * 算進指紋裡，而「方向對應不一致」的說明是
 *   「不同報告把這個方向寫成：A--->B、B--->A」
 * ——**目前所有季度出現過的寫法全部列出來**。於是：
 *   ・又匯入一季、多一種寫法 → 說明變 → 指紋變 → 他按過的確認對不上
 *   ・甚至同樣內容、只是匯入順序不同 → Set 排列順序不同 → 指紋一樣會變
 *
 * ⚠️ **不可以把 detail 從指紋裡整個拿掉。** 原本的註解寫得很清楚，而且是對的：
 *   「異常變化」的說明帶著數字（總延滯增加 30.7%），數字一變就該重新提醒，
 *   否則使用者會在不知情的情況下，把後來更嚴重的變化一起按掉。
 *   所以正確解是**逐類別決定**（`ackScope: "identity"`），不是一刀砍掉。
 *
 * ── 這一支守什麼 ──
 *
 * 一、方向對應不一致：說明文字怎麼長、怎麼換順序，指紋都要**不變**。
 * 二、異常變化：說明文字裡的數字變了，指紋就要**變**（這是刻意保留的行為）。
 * 三、同一列資料上的兩種「數值異常」不可以撞成同一把鑰匙。
 * 四、孤兒確認紀錄要清得掉，而且**只清孤兒**。
 *
 * ⚠️ 刻意迴避的假通過：
 *   ・只驗第一條會讓「把 detail 整個拿掉」也全綠——那會弄壞異常變化，
 *     所以第二條是**對照組**，它必須維持「會變」。
 *   ・前置檢查：真的從 app.js 取到了那幾支函式，取不到就紅，
 *     不可以因為函式改名而安靜變成恆真。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

/** 把 app.js 裡那一份 issueFingerprint 原樣取出來求值，不另外寫一份。 */
function loadFingerprint() {
  const src = app.match(/function issueFingerprint\(issue\) \{[\s\S]*?\n\}/);
  assert.ok(src, "app.js 取不到 issueFingerprint——改名了嗎？");
  // eslint-disable-next-line no-new-func
  return new Function(`${src[0]}; return issueFingerprint;`)();
}

const directionIssue = (texts) => ({
  code: "direction-mismatch",
  ackScope: "identity",
  type: "方向對應不一致",
  period: "全部",
  item: "台1(甲路～乙路)／方向1",
  detail: `不同報告把這個方向寫成：${texts.join("、")}。請確認各季報告的旅次順序是否一致，否則跨季比較會拿相反方向互比。`,
  resolution: { kind: "人工確認" },
});

const trendIssue = (los, travel, shownPeriod = "115Q2") => ({
  code: "trend-change",
  type: "異常變化",
  fromPeriod: "115Q2",
  period: "115Q3",
  road: "台1(甲路～乙路)",
  day: "平日",
  item: "台1(甲路～乙路)／平日",
  fingerprintDetail: `LOS D→${los}，旅行速率 30.0→${travel} km/h`,
  detail: `相較 ${shownPeriod}：LOS D→${los}，旅行速率 30.0→${travel} km/h，請確認資料或現地變化。`,
  resolution: { kind: "人工確認" },
});

test("前置：取得 app.js 裡的 issueFingerprint，而且它真的算得出東西", () => {
  const fp = loadFingerprint();
  const out = fp(directionIssue(["A--->B"]));
  assert.ok(typeof out === "string" && out.length > 20, `指紋長度異常：${out}`);
});

test("一、方向對應不一致：多一種寫法，確認不可以失效", () => {
  const fp = loadFingerprint();
  const first = fp(directionIssue(["A--->B", "B--->A"]));
  const afterNewQuarter = fp(directionIssue(["A--->B", "B--->A", "A--->C"]));
  assert.equal(
    afterNewQuarter,
    first,
    "又匯入一季、報告多了一種寫法，指紋就變了——使用者按過的確認會失效",
  );
});

test("一、方向對應不一致：同樣的寫法只是順序不同，確認也不可以失效", () => {
  const fp = loadFingerprint();
  assert.equal(
    fp(directionIssue(["B--->A", "A--->B"])),
    fp(directionIssue(["A--->B", "B--->A"])),
    "Set 的排列順序換了指紋就變——重新匯入同一批檔案就會讓確認失效",
  );
});

/*
 * ⚠️ 這一條是**對照組**，不是附帶的。
 *   少了它，「把 detail 從指紋裡整個拿掉」這種錯誤修法也會全綠。
 */
test("二、對照組：異常變化的數字變了，指紋就必須變（刻意保留的行為）", () => {
  const fp = loadFingerprint();
  assert.notEqual(
    fp(trendIssue("E", "22.0")),
    fp(trendIssue("F", "15.0")),
    "異常變化的指紋沒跟著數字變——使用者會在不知情下把後來更嚴重的變化一起按掉",
  );
});

test("二-b、只切換民國／西元年份顯示時，異常確認不可以失效", () => {
  const fp = loadFingerprint();
  assert.equal(
    fp(trendIssue("E", "22.0", "115Q2")),
    fp(trendIssue("E", "22.0", "2026Q2")),
    "只改畫面年份寫法就讓指紋改變——顯示偏好不可以使已人工確認失效",
  );
});

test("三、同一列資料上的兩種「數值異常」不可以撞成同一把鑰匙", () => {
  const fp = loadFingerprint();
  const base = {
    type: "數值異常",
    period: "115Q3",
    road: "台1(甲路～乙路)",
    day: "平日",
    item: "台1(甲路～乙路)／平日／上午尖峰／方向1",
  };
  assert.notEqual(
    fp({ ...base, code: "value-missing", detail: "旅行速率、行駛速率、總延滯或速限包含空白、零值或無效數值。" }),
    fp({ ...base, code: "value-travel-gt-running", detail: "旅行速率 40.0 km/h 大於行駛速率 30.0 km/h…" }),
    "兩種不同的數值異常撞成同一把鑰匙了",
  );
});

/*
 * ⚠️ 2026-09-25 第六輪獨立複查：這一支原本只掃 `app.js`，
 *   而 `quality-extension.js` **把 app.js 那一筆「異常變化」整類濾掉**，
 *   實際送進畫面的是它自己 `extra.push` 的那一筆——那一筆當時沒有 `code`。
 *   也就是「每一筆都要有 code」這條保證在**唯一真正會跑的那一條路徑上
 *   沒有成立**，而守門是綠的。兩個檔案一起掃。
 *
 * ⚠️ 代碼刻意允許跨檔重複一次：`quality-extension.js` 覆寫掉 app.js 的
 *   「異常變化」時，兩邊必須用**同一個** code（同一件事不可以有兩把鑰匙，
 *   否則使用者按過的「已人工確認」會在兩者之間對不上）。所以重複檢查
 *   改成「同一個檔案裡不可以重複」。
 */
test("四、每一個 issues.push 都帶著固定代碼（少一個就會與別人撞鑰匙）", () => {
  const extension = readFileSync(
    new URL("./quality-extension.js", import.meta.url),
    "utf8",
  );
  const check = (label, source, pushPattern, minimum) => {
    const pushes = source.match(pushPattern) || [];
    const codes = source.match(/^\s+code: "[a-z-]+",$/gm) || [];
    assert.ok(
      pushes.length >= minimum,
      `${label}：只找到 ${pushes.length} 個 push——正規表示式壞了`,
    );
    assert.equal(
      codes.length,
      pushes.length,
      `${label}：有 ${pushes.length} 個 push，但只有 ${codes.length} 個 code`,
    );
    const unique = new Set(codes.map((c) => c.trim()));
    assert.equal(unique.size, codes.length, `${label}：同一個檔案裡有重複的 code`);
    return codes.map((c) => c.trim());
  };
  check("app.js", app, /issues\.push\(\{/g, 9);
  const extraCodes = check("quality-extension.js", extension, /extra\.push\(\{/g, 1);
  /*
   * 正面斷言：`quality-extension.js` 覆寫的那一筆，code 必須與 app.js
   * 同一種異常用的那一個相同（否則「已人工確認」在兩邊對不上）。
   */
  assert.ok(
    extraCodes.includes('code: "trend-change",'),
    "quality-extension.js 覆寫的「異常變化」沒有沿用 app.js 的 code（trend-change）",
  );
});

test("五、孤兒確認紀錄清得掉，而且只清孤兒", () => {
  const src = app.match(/function pruneOrphanAcks\(issues\) \{[\s\S]*?\n\}/);
  assert.ok(src, "app.js 取不到 pruneOrphanAcks");
  const fpSrc = app.match(/function issueFingerprint\(issue\) \{[\s\S]*?\n\}/)[0];
  const canAck = "function issueCanAck(issue){return issue?.resolution?.kind === '人工確認';}";
  const alive = directionIssue(["A--->B", "B--->A"]);
  // eslint-disable-next-line no-new-func
  const run = new Function(
    "state",
    "aliveIssues",
    `${fpSrc}\n${canAck}\n${src[0]}\nreturn pruneOrphanAcks(aliveIssues);`,
  );
  const fp = loadFingerprint();
  const state = {
    activeCode: "115-A01",
    ackedIssues: {
      "115-A01": {
        [fp(alive)]: { at: "2026-09-19T00:00:00.000Z" },
        '["orphan","","","","","",""]': { at: "2026-09-01T00:00:00.000Z" },
      },
    },
  };
  const changed = run(state, [alive]);
  assert.equal(changed, true, "有孤兒卻回報沒有變動");
  const kept = state.ackedIssues["115-A01"];
  assert.equal(Object.keys(kept).length, 1, "應該只剩下還活著的那一筆");
  assert.ok(kept[fp(alive)], "把還活著的那一筆誤殺了");

  /* 沒有孤兒時不可以宣稱有變動（否則每次檢查都會多寫一次儲存）。 */
  assert.equal(run(state, [alive]), false, "沒有孤兒時不該回報變動");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「重點路段總覽」必須講清楚它不是待辦清單
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 問：
 *   「想問重點路段總覽用意是什麼呢?他告訴了我哪些路段有異常變化嗎?
 *     那我看完後我要怎麼點選確認，讓之後不會一直出現?不然資料會累積越來越多」
 *
 * 它其實是**排序**不是清單：每次重算、只看每條路段最新一季與前一季的變化，
 * 下一季不再惡化就自己掉出榜單，所以**不需要也沒有「已確認」**。
 *
 * ⚠️ 但它長得和上面那張「檢查結果」一模一樣（同樣是表格、同樣在資料維護頁），
 *   而畫面上一個字都沒說它不用確認 —— 使用者因此以為漏了一顆鈕、
 *   而且會擔心資料累積。**會誤導使用者的就要修**。
 *
 * ⚠️ 這一支刻意**不**驗「有沒有確認鈕」：驗那個等於把「現在沒有鈕」釘死，
 *   哪天真的要加鈕反而被自己的測試擋住。驗的是**畫面有沒有把話講清楚**。
 */
test("六、重點路段總覽要在畫面上說明它不需確認、不會累積", () => {
  const ext = readFileSync(
    new URL("./quality-extension.js", import.meta.url),
    "utf8",
  );
  /*
   * ⚠️ 2026-09-30（#33）：原本拿標題文字「重點路段總覽」定位。
   *   改成釘那一塊自己的 DOM id——`priority.id = "priorityPanel"` 是它的宣告，
   *   標題怎麼改都不影響定位。
   *
   * ⚠️ 第一版我改成釘 `id="refreshPriority"` 然後往後取 1200 個字元，
   *   當場就紅了：那顆按鈕在 HTML 裡排在說明文字**後面**，往後取抓不到說明。
   *   教訓：換錨點的時候，要順便確認**方向**也還是對的。
   */
  const at = ext.indexOf('priority.id = "priorityPanel"');
  assert.notEqual(at, -1, 'quality-extension.js 找不到 priorityPanel 的宣告');
  /* 只看這一塊自己的 innerHTML，不要掃到整份檔案而變成恆真。 */
  const blockEnd = ext.indexOf('q("maintenance").append(priority)', at);
  assert.ok(blockEnd > at, "找不到 priorityPanel 那一段的結尾");
  const block = ext.slice(at, blockEnd);
  for (const [needle, why] of [
    ["不是待辦清單", "沒有講清楚它是排序不是清單"],
    ["最新一季", "沒有講清楚它只比最新一季與前一季"],
    ["已確認", "沒有講清楚它不需要（也沒有）已確認"],
    ["不會累積", "沒有回答使用者「會不會累積」這一題"],
  ])
    assert.ok(block.includes(needle), `重點路段總覽的說明${why}`);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  方向名稱不成對：要進異常檢查，而且匯入時只提醒不阻擋
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 指定：
 *   「如果出現不成對的話，請在異常檢查中檢查出來（匯入時也可以做異常提醒，
 *     但不阻擋匯入），由使用者手動去按確認（堅持是對的話），
 *     或自行修正資料後，重新匯入」
 *
 * ⚠️ 「不阻擋」這一條特別要守：一個擋路的提醒，在使用者急著匯入十幾份檔案時
 *   會被無腦按掉，那比不提醒更糟。所以提醒必須在**寫入完成之後**，
 *   而且不可以是需要按確認的視窗。
 */
test("七、方向名稱不成對要進異常檢查，而且可以人工確認", () => {
  assert.ok(
    app.includes('code: "direction-not-paired"'),
    "異常檢查裡找不到方向名稱不成對",
  );
  const at = app.indexOf('code: "direction-not-paired"');
  const block = app.slice(at - 200, at + 1400);
  assert.ok(block.includes('type: "方向名稱不成對"'), "缺少類型名稱");
  assert.ok(block.includes('kind: "人工確認"'), "不能人工確認——使用者堅持是對的時候沒有出路");
  assert.ok(block.includes('ackScope: "identity"'), "確認會因為說明文字變動而失效");
  assert.ok(
    block.includes("DirectionPair.judgeDirectionPair"),
    "沒有走三支共用的判定（自己寫一份會讓三支結論不同）",
  );
  assert.ok(
    block.includes("不影響任何計算") || block.includes("不會阻擋"),
    "解決方式沒有講清楚這一項不阻擋、也不影響計算",
  );
});

test("八、匯入時的方向提醒必須在寫入完成之後，而且不是擋路的視窗", () => {
  /*
   * ⚠️ 2026-09-30（#33）：這一條原本拿**畫面文案**當錨點
   *   （`app.indexOf("toast(\`寫入完成：新增")` 與 `indexOf("提醒（不影響這次匯入）")`）。
   *
   *   那是錯的定位方式，而且錯的方向很討厭：改一個字（例如把「略過」
   *   換成「跳過」）就會讓這一條**紅**，而程式其實一點問題都沒有。
   *   紅了又不是真的壞掉，下一個人只會把錯的那個字串改成新的文案，
   *   於是這一條變成「文案的複本」，永遠測不到它本來要測的事。
   *
   *   改成釘**結構**：
   *     ・寫入這件事＝ `state.imports.unshift(batch)` ＋ `await save()`
   *     ・提醒這件事＝ 呼叫三支共用的 `DirectionPair.judgeDirectionPair(`
   *   兩個都是程式結構，改文案不會動到它們；而真的把提醒搬到寫入之前，
   *   或把它改成擋路的確認視窗，這一條就會紅——那正是它該紅的時候。
   */
  const writeAt = app.indexOf("state.imports.unshift(batch)");
  assert.notEqual(writeAt, -1, "找不到把這一批寫進匯入紀錄的那一行");
  const savedAt = app.indexOf("await save();", writeAt);
  assert.notEqual(savedAt, -1, "寫入之後沒有存檔");
  const remindAt = app.indexOf("DirectionPair.judgeDirectionPair(", savedAt);
  assert.notEqual(remindAt, -1, "匯入完成之後沒有方向名稱提醒");
  assert.ok(
    remindAt > savedAt,
    "提醒排在存檔之前——那等於變相阻擋匯入",
  );
  /* 那一段裡不可以出現會擋路的東西。 */
  const block = app.slice(savedAt, remindAt + 900);
  for (const blocker of ["confirm(", "return;", "throw "])
    assert.ok(
      !block.includes(blocker),
      `匯入提醒那一段出現了會阻擋的寫法：${blocker}`,
    );
  /* 只看這一批寫進去的路段，不是全部。 */
  assert.ok(
    block.includes("pending.map((r) => r.road)"),
    "提醒掃的不是這一批寫進去的路段——使用者每匯一次都會被提醒早就看過的那幾條",
  );
});

test("⚠️ #33：守門不可以再拿畫面文案當定位錨點", async () => {
  /*
   * 這一條是上面那一件的**制度化**：不是修好一處就算了，而是擋住同一種寫法再出現。
   *
   * 判準：`indexOf(...)`／`slice(...indexOf(...))` 這類**定位**用的字串，
   * 不可以是「看得到的中文句子」。定位要釘結構（函式名、變數名、共用模組的呼叫）。
   *
   * ⚠️ 只擋**定位**，不擋斷言。`assert.ok(app.includes("某句話"))`
   *   ——「畫面上必須有這句話」——是完全正當的，而且這一支系統有一堆
   *   手冊與畫面一致性的守門就是那樣寫的。兩者的差別是
   *   「拿它找位置」與「檢查它在不在」。
   *
   * 判斷「是不是畫面文案」的方式：字串裡有中文，而且**不是**程式結構的一部分
   *（函式／變數宣告、屬性存取、共用模組呼叫都允許中文以外的形式）。
   *   實務上的規則：`indexOf("…")` 的內容含中文就不允許，除非它同時含有
   *   `function `／`const `／`state.`／`.` 這類結構線索。
   */
  const { readdirSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const here = fileURLToPath(new URL("./", import.meta.url));
  const files = readdirSync(here).filter((name) => name.endsWith(".test.mjs"));
  /* 前置：真的掃到一批測試檔，否則這一條恆綠。 */
  assert.ok(files.length >= 20, `只掃到 ${files.length} 個測試檔——掃描範圍壞了`);
  /*
   * ⚠️ 唯一的例外，而且必須寫出理由。
   *
   *   `page-pointer-and-w-items.test.mjs` 釘的是 README 裡一句**歷史原文**：
   *   規矩是「歷史段落要加向前指標，不是改掉」，所以那一句**依規定不可以被改寫**，
   *   而那一條守門要驗的正是「那一句還在，而且後面接著向前指標」。
   *   那個字串就是它的**測試對象**，不是拿來找位置的替代品——
   *   它如果紅了，代表歷史段落真的被改寫了，那正是該紅的時候。
   *
   * ⚠️ 例外清單本身也要被檢查（見下面）：清單裡的東西如果已經不存在，
   *   就要從清單移除，否則過期的豁免會愈積愈多，最後變成一張沒人看得懂的白名單。
   */
  const ALLOWED = new Map([
    [
      "page-pointer-and-w-items.test.mjs",
      "網站「新手說明」頁可下載 PDF 與可編輯 Word。",
    ],
  ]);
  const offenders = [];
  const allowedSeen = new Set();
  let checkedAnchors = 0;
  for (const name of files) {
    const source = readFileSync(join(here, name), "utf8");
    /* 去掉註解：註解裡會寫著「以前這裡是 indexOf("寫入完成…")」這種說明。 */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const match of code.matchAll(/indexOf\(\s*"([^"]*)"/g)) {
      const text = match[1];
      if (!/[一-鿿]/.test(text)) continue;
      checkedAnchors += 1;
      const structural = /function |const |let |var |state\.|globalThis\.|\w\.\w/.test(
        text,
      );
      if (ALLOWED.get(name) === text) {
        allowedSeen.add(name);
        continue;
      }
      if (!structural) offenders.push(`${name}｜indexOf("${text.slice(0, 30)}")`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "這幾處拿畫面文案當定位錨點（改一個字就會紅，而程式沒問題）：\n  " +
      offenders.join("\n  "),
  );
  /*
   * ⚠️ 前置：這個掃描真的看得到含中文的 indexOf。看不到的話，
   *   它有可能是因為正規式壞了而恆綠——而不是因為真的沒有人這樣寫。
   *   （目前這一支系統裡有含中文的定位錨點，但它們都帶結構線索。）
   */
  assert.ok(
    checkedAnchors >= 1,
    "整個專案掃不到任何含中文的 indexOf——正規式是不是壞了？",
  );
  /* ⚠️ 過期的豁免要清掉，否則白名單會愈積愈多。 */
  assert.deepEqual(
    [...ALLOWED.keys()].filter((name) => !allowedSeen.has(name)),
    [],
    "例外清單裡有已經不存在的項目，請從 ALLOWED 移除",
  );
});
