/*
 * ══════════════════════════════════════════════════════════════════════
 *  改「計畫編號」要整批搬，不可以安靜新建一個空計畫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 指名修正（我在大檢查時查出來、他裁示要修）。
 *
 * 舊版 `saveProject` 是這樣找既有計畫的：
 *   `const i = state.projects.findIndex((p) => p.code === code);`
 * 所以**改了編號就找不到**，於是走 `push`——畫面上多出一個同名但空的計畫、
 * 原本那個還在，而且訊息只寫「新計畫已建立」。
 *
 * ⚠️ 這不是「多一筆資料」而已。計畫編號是**全系統的主鍵**：
 *   速限 `limits["code|road|direction"]`、速限版本 `speedVersions[同上]`、
 *   別名 `aliases["code|road"]`、方向名稱 `roadMeta["code|road"]`、
 *   異常門檻／LOS 門檻／覆寫／三段分法／結論範本／報告草稿／已確認異常
 *   `[code]`，以及每一筆尖峰明細的 `projectCode` 與
 *   `id = "code|year|Qq|road|day|peak|direction"`。
 *   改了編號等於把上面全部一次性孤兒化，而使用者完全不知道。
 *
 * ── 這一支守什麼 ──
 *
 * 一、改名之後，**整棵 state 裡一個舊編號都不可以剩**。
 *     （這一條刻意寫成「掃整棵樹」而不是逐一列舉儲存區——
 *       逐一列舉的話，每加一個以 code 為鍵的新儲存區就會漏掉一個，
 *       而漏掉的症狀是「資料安靜消失」。）
 * 二、資料**不可以在搬移中被弄丟**：明細筆數、速限、別名、方向名稱等
 *     都要原封不動地出現在新編號底下。
 * 三、**不可以覆蓋**已經存在的目標鍵（那會把另一份資料無聲吃掉）。
 * 四、`activeCode` 要跟著走。
 * 五、UI 那一層：改名路徑要由「要編輯的計畫」下拉決定，而且撞名要擋下來
 *     （原始碼層級檢查，因為這一段要開瀏覽器才跑得到）。
 *
 * ⚠️ 前置檢查：測資裡真的含有舊編號（否則第一條變成恆真）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

function loadRename() {
  const src = app.match(
    /function renameProjectCode\(root, oldCode, newCode\) \{[\s\S]*?\n\}/,
  );
  assert.ok(src, "app.js 取不到 renameProjectCode——改名了嗎？");
  // eslint-disable-next-line no-new-func
  return new Function(`${src[0]}; return renameProjectCode;`)();
}

const OLD = "115-A01";
const NEW = "11017-RKC02";

function sampleState() {
  return {
    activeCode: OLD,
    projects: [{ code: OLD, name: "示範計畫" }, { code: "115-B02", name: "別的計畫" }],
    details: [
      {
        id: `${OLD}|115|Q3|甲路(乙街～丙街)|平日|上午尖峰|方向1`,
        projectCode: OLD,
        road: "甲路(乙街～丙街)",
        travel: 30,
      },
      {
        id: `${OLD}|115|Q3|甲路(乙街～丙街)|平日|上午尖峰|方向2`,
        projectCode: OLD,
        road: "甲路(乙街～丙街)",
        travel: 28,
      },
      { id: "115-B02|115|Q3|丁路|平日|上午尖峰|方向1", projectCode: "115-B02", travel: 40 },
    ],
    summaries: [{ projectCode: OLD, road: "甲路(乙街～丙街)", los: "D" }],
    limits: { [`${OLD}|甲路(乙街～丙街)|方向1`]: 50, "115-B02|丁路|方向1": 60 },
    limitConfirmed: { [`${OLD}|甲路(乙街～丙街)|方向1`]: true },
    aliases: { [`${OLD}|甲路`]: "甲路(乙街～丙街)" },
    roadMeta: {
      [`${OLD}|甲路(乙街～丙街)`]: { directionA: "北上", directionB: "南下", directionConfirmed: true },
    },
    speedVersions: { [`${OLD}|甲路(乙街～丙街)|方向1`]: [{ start: "115Q1", speed: 50 }] },
    anomalyRules: { [OLD]: { speedDrop: 20 } },
    losRules: { [OLD]: { A: 0.9 } },
    losRuleScopes: { [OLD]: [{ period: "*", road: "*", rules: { A: 0.9 } }] },
    bandRules: { [OLD]: { smooth: 0.8 } },
    bandRuleScopes: { [OLD]: [] },
    conclusionTemplates: { [OLD]: [{ name: "範本一" }] },
    reportDrafts: { [OLD]: "草稿內容" },
    ackedIssues: { [OLD]: { '["direction-mismatch"]': { at: "2026-09-19" } } },
    imports: [{ projectCode: OLD, at: "2026-09-19" }],
  };
}

/** 整棵樹裡還找不找得到舊編號（鍵或值）。 */
function mentionsOldCode(node, oldCode) {
  const prefix = oldCode + "|";
  const hits = [];
  const walk = (n, path) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === oldCode || k.startsWith(prefix)) hits.push(`${path}.${k}（鍵）`);
      if (typeof v === "string" && (v === oldCode || v.startsWith(prefix)))
        hits.push(`${path}.${k} = ${v}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(node, "state");
  return hits;
}

test("前置：測資裡真的含有舊編號（否則第一條會變成恆真）", () => {
  const hits = mentionsOldCode(sampleState(), OLD);
  assert.ok(
    hits.length >= 15,
    `測資只提到舊編號 ${hits.length} 次，太少，驗不出東西`,
  );
});

test("一、改名之後整棵 state 裡一個舊編號都不可以剩", () => {
  const rename = loadRename();
  const state = sampleState();
  rename(state, OLD, NEW);
  const left = mentionsOldCode(state, OLD);
  assert.deepEqual(left, [], `還有 ${left.length} 處指著舊編號：\n  ${left.join("\n  ")}`);
});

test("二、資料不可以在搬移中被弄丟，也不可以動到別的計畫", () => {
  const rename = loadRename();
  const before = sampleState();
  const state = sampleState();
  rename(state, OLD, NEW);

  assert.equal(state.details.length, before.details.length, "明細筆數變了");
  assert.equal(
    state.details.filter((x) => x.projectCode === NEW).length,
    2,
    "這個計畫的明細沒有全部搬過去",
  );
  assert.equal(state.limits[`${NEW}|甲路(乙街～丙街)|方向1`], 50, "速限沒搬過去");
  assert.equal(state.limitConfirmed[`${NEW}|甲路(乙街～丙街)|方向1`], true, "速限確認沒搬過去");
  assert.equal(state.aliases[`${NEW}|甲路`], "甲路(乙街～丙街)", "別名沒搬過去");
  assert.equal(
    state.roadMeta[`${NEW}|甲路(乙街～丙街)`]?.directionConfirmed,
    true,
    "方向名稱與『已確認』沒搬過去",
  );
  assert.equal(state.speedVersions[`${NEW}|甲路(乙街～丙街)|方向1`]?.length, 1, "速限版本沒搬過去");
  for (const store of [
    "anomalyRules",
    "losRules",
    "losRuleScopes",
    "bandRules",
    "bandRuleScopes",
    "conclusionTemplates",
    "reportDrafts",
    "ackedIssues",
  ])
    assert.ok(state[store][NEW] !== undefined, `${store} 沒搬過去`);
  assert.equal(
    state.details[0].id,
    `${NEW}|115|Q3|甲路(乙街～丙街)|平日|上午尖峰|方向1`,
    "明細的 id 前綴沒跟著改",
  );

  /* 別的計畫一格都不可以動。 */
  assert.equal(state.limits["115-B02|丁路|方向1"], 60, "動到別的計畫的速限");
  assert.equal(
    state.details.filter((x) => x.projectCode === "115-B02").length,
    1,
    "動到別的計畫的明細",
  );
  assert.equal(state.projects.find((x) => x.code === "115-B02")?.name, "別的計畫");
});

test("三、目標鍵已經存在時不可以覆蓋（那會把另一份資料無聲吃掉）", () => {
  const rename = loadRename();
  const state = {
    activeCode: OLD,
    projects: [{ code: OLD, name: "甲" }],
    limits: { [`${OLD}|路A|方向1`]: 50, [`${NEW}|路A|方向1`]: 80 },
  };
  rename(state, OLD, NEW);
  assert.equal(
    state.limits[`${NEW}|路A|方向1`],
    80,
    "把已經存在的那一筆覆蓋掉了——舊的那一份資料被無聲吃掉",
  );
});

test("四、activeCode 要跟著走", () => {
  const rename = loadRename();
  const state = sampleState();
  rename(state, OLD, NEW);
  assert.equal(state.activeCode, NEW, "改完之後作用中計畫還指著舊編號");
});

test("五、UI：改名由「要編輯的計畫」下拉決定，而且撞名要擋下來", () => {
  /*
   * ⚠️ 判斷依據**不可以**是「輸入的編號存不存在」——那分不出
   *   「改成一個新編號」與「本來就想建一個新計畫」。
   */
  assert.match(
    app,
    /const editing = \(\$\("projectPicker"\)\?\.value \|\| ""\)\.trim\(\);/,
    "saveProject 沒有用「要編輯的計畫」下拉判斷這是不是改名",
  );
  assert.match(app, /const renaming =\s*\n?\s*editing && editing !== code/, "缺少改名判斷");
  /* 撞名要擋下來、不可以自行合併。 */
  const at = app.indexOf("const renaming =");
  const block = app.slice(at, at + 2000);
  assert.ok(
    block.includes("系統不會把兩個計畫合併"),
    "撞名時沒有擋下來（或訊息沒說清楚不會合併）",
  );
  assert.ok(block.includes("confirm("), "改名前沒有要求二次確認");
  assert.ok(
    block.includes("renameProjectCode(state, editing, code)"),
    "改名路徑沒有真的呼叫 renameProjectCode",
  );
});

/*
 * ⚠️ 這一條是被自己踩到之後補的。
 *
 *   我第一版在改名成功之後寫了 `render();`——**這個函式在這支程式裡不存在**
 *   （它叫 `renderAll()`）。單元測試全綠，因為沒有一條會真的執行那一行；
 *   使用者按下去才會看到 `render is not defined`，而且資料其實已經改好了，
 *   畫面卻停在舊的——最難查的那一種。
 *
 *   所以這裡把改名這一段裡呼叫到的每一個函式，都拿去和 app.js 的宣告對一次。
 *   ⚠️ 不做全檔掃描：那會掃到瀏覽器內建與第三方全域，誤報一堆而被迫放寬，
 *   最後變成沒有效力的檢查。只掃這一段，抓得準。
 */
test("六之二、改名這一段呼叫到的函式，在 app.js 裡都要真的存在", () => {
  const at = app.indexOf("const renaming =");
  assert.notEqual(at, -1, "找不到改名那一段");
  /*
   * ⚠️ 區塊的結尾要抓到**改名分支的最後一行**。
   *   我第一版用 `const i = state.projects.findIndex` 當結尾，
   *   但改名分支**裡面也有一行一模一樣的**，於是區塊在 `renderAll()` 之前
   *   就被切斷了——這一條當場變成恆真，而它正是為了那一行寫的。
   *   （實測：把 renderAll() 改回不存在的 render()，這一條照樣綠。）
   *   改用分支最後那一句 toast 當結尾，並加一條前置檢查確認真的含到它。
   */
  const endMark = "相關資料一併搬移完成";
  const endAt = app.indexOf(endMark, at);
  assert.notEqual(endAt, -1, "找不到改名分支的結尾");
  const block = app.slice(at, endAt);
  assert.ok(block.length > 300, `改名區塊只抓到 ${block.length} 字元，正規表示式可能壞了`);
  assert.ok(
    block.includes("renderAll(") || block.includes("render("),
    "改名區塊沒有含到成功之後重畫畫面那一行——區塊邊界又被切斷了",
  );

  /* 這一段裡出現的 `foo(` 形式呼叫。 */
  const called = new Set(
    [...block.matchAll(/(?<![.\w$])([a-z][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]),
  );
  /* 瀏覽器內建與語言關鍵字不算。 */
  for (const builtin of ["if", "for", "while", "return", "confirm", "alert", "Number", "String"])
    called.delete(builtin);

  const missing = [];
  for (const name of called) {
    const declared =
      new RegExp(`function ${name}\\s*\\(`).test(app) ||
      new RegExp(`(?:const|let|var) ${name}\\s*=`).test(app) ||
      new RegExp(`${name}\\s*=\\s*(?:async\\s*)?\\(`).test(app);
    if (!declared) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `改名這一段呼叫了 app.js 裡不存在的函式：${missing.join("、")}` +
      `——按下去會 ReferenceError，而且資料其實已經改好了、畫面卻停在舊的`,
  );
});
