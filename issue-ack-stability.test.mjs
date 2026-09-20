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

const trendIssue = (los, travel) => ({
  code: "trend-change",
  type: "異常變化",
  fromPeriod: "115Q2",
  period: "115Q3",
  road: "台1(甲路～乙路)",
  day: "平日",
  item: "台1(甲路～乙路)／平日",
  detail: `相較 115Q2：LOS D→${los}，旅行速率 30.0→${travel} km/h，請確認資料或現地變化。`,
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

test("四、每一個 issues.push 都帶著固定代碼（少一個就會與別人撞鑰匙）", () => {
  const pushes = app.match(/issues\.push\(\{/g) || [];
  const codes = app.match(/^\s+code: "[a-z-]+",$/gm) || [];
  assert.ok(pushes.length >= 9, `只找到 ${pushes.length} 個 issues.push——正規表示式壞了`);
  assert.equal(
    codes.length,
    pushes.length,
    `有 ${pushes.length} 個 issues.push，但只有 ${codes.length} 個 code`,
  );
  /* 代碼不可以重複——重複等於沒有代碼。 */
  const unique = new Set(codes.map((c) => c.trim()));
  assert.equal(unique.size, codes.length, "有重複的 code");
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
  const at = ext.indexOf("重點路段總覽");
  assert.notEqual(at, -1, "quality-extension.js 找不到「重點路段總覽」");
  /* 只看這一塊的抬頭附近，不要掃到整份檔案而變成恆真。 */
  const block = ext.slice(at, at + 1200);
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
  const writeAt = app.indexOf("toast(`寫入完成：新增");
  assert.notEqual(writeAt, -1, "找不到匯入寫入完成那一段");
  const remindAt = app.indexOf("提醒（不影響這次匯入）", writeAt);
  assert.notEqual(remindAt, -1, "匯入完成之後沒有方向名稱提醒");
  assert.ok(
    remindAt > writeAt,
    "提醒排在寫入之前——那等於變相阻擋匯入",
  );
  /* 那一段裡不可以出現會擋路的東西。 */
  const block = app.slice(writeAt, remindAt + 900);
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
