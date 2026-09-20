/*
 * ══════════════════════════════════════════════════════════════════════
 *  說明文字裡的分頁名稱，必須就是側欄上的那個名稱
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者定的規矩（大檢查規則 4.5）：
 *   「各功能要如同手冊裡所寫的，如果有不一致，看是系統是最新正確資訊要修正
 *     手冊內容，還是系統遺漏了，要重新補上功能，這樣搭配大檢查才能檢查出問題」
 *
 * 2026-09-20 大檢查實際抓到：`titles.setup` 早就依使用者 2026-09-13 的指定
 * 改成「建立與管理計畫」（三支統一），但**兩處說明文字沒跟著改**——
 *   ・app.js 內嵌手冊第一章：「進入『計畫設定』，輸入公司計畫編號與完整名稱。」
 *   ・index.html 新手操作順序第 1 步標題：「計畫設定」
 * 使用者照說明去側欄找「計畫設定」，找不到。
 *
 * ⚠️ 後果比「文件過期」嚴重：手冊是使用者唯一的權威說明，它和畫面互相矛盾時
 *   兩邊都變得不可信——而且這一類錯**不會有任何測試失敗**，所以只會愈積愈多。
 *
 * ── 這一支守什麼 ──
 *
 * 只守一件事、但守得死：**說明文字裡若用「」框起一個分頁名稱，那個名稱
 * 必須真的存在於 `titles`（或是明確的例外）**。
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、**只驗「新名字有出現」不算數**——舊名字同時還留著照樣過。
 *       這裡驗的是**舊名字一個都不可以剩**。
 *   二、**只驗 app.js 不算數**——index.html 也有一份說明。兩份都掃。
 *   三、**前置檢查**：`titles` 真的讀得到而且抓得到那幾個名字，
 *       否則正規表示式改壞之後這一支會安靜地變成恆真。
 *
 * ⚠️ 為什麼用「已經改過名的舊名單」而不是「反向掃所有「」」：
 *   說明文字裡的「」也用在欄位名、按鈕名、檔名上，全掃會誤報一堆。
 *   改名是**有紀錄的事件**，把每一次改名的舊名字加進下面這張表，
 *   成本低而且抓得到真正會出事的那一類。
 *   ⚠️ 以後再改任何分頁名稱，**一定要把舊名字加進 RENAMED**。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");

/** 歷次改名：舊名字 → 現在的名字。改名時要往這裡加一列。 */
const RENAMED = [
  {
    old: "計畫設定",
    now: "建立與管理計畫",
    when: "2026-09-13（使用者指定，三支統一）",
  },
  {
    old: "健康檢查",
    now: "資料異常檢查",
    when: "2026-09-13（使用者指定）",
  },
];

/**
 * 「儲存計畫設定」是**按鈕**的名字，不是分頁名字，而且沒有改過。
 * 它含有「計畫設定」四個字，所以掃描時要先把它整串拿掉，
 * 否則永遠誤報。
 *
 * ⚠️ 這個豁免清單不可以變成萬用貼紙：每一條都要是
 *   「確實不是分頁名稱」的具體字串，不可以寫成通配。
 */
const NOT_A_PAGE_NAME = [
  "儲存計畫設定", // 建立與管理計畫頁上的按鈕
  "計畫設定已更新", // toast 訊息
  "請先完成計畫設定", // toast 訊息
];

function titlesMap() {
  const start = appSource.indexOf("const titles = {");
  assert.notEqual(start, -1, "app.js 裡找不到 `const titles = {`");
  const end = appSource.indexOf("\n};", start);
  assert.ok(end > start, "`const titles` 的結尾找不到");
  const block = appSource.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*"([^"]+)"/gm))
    out[m[1]] = m[2];
  return out;
}

test("前置：titles 讀得到，而且含有本次要守的那幾個名字", () => {
  const titles = titlesMap();
  assert.ok(
    Object.keys(titles).length >= 8,
    `titles 只讀到 ${Object.keys(titles).length} 筆——正規表示式可能壞了，` +
      `再往下驗會全部恆真`,
  );
  const names = new Set(Object.values(titles));
  for (const { now } of RENAMED)
    assert.ok(
      names.has(now) ||
        appSource.includes(now) ||
        indexHtml.includes(now),
      `改名後的名稱「${now}」在程式裡一個字都找不到——RENAMED 這張表過期了`,
    );
});

test("說明文字裡不可以再用改名前的分頁名稱", () => {
  const titles = titlesMap();
  const current = new Set(Object.values(titles));

  for (const { old, now, when } of RENAMED) {
    assert.ok(
      !current.has(old),
      `「${old}」還在 titles 裡——RENAMED 這張表把還在用的名字當成舊名字了`,
    );

    for (const [label, source] of [
      ["app.js", appSource],
      ["index.html", indexHtml],
    ]) {
      let text = source;
      for (const exempt of NOT_A_PAGE_NAME) text = text.split(exempt).join("");

      /*
       * 只抓「」或 <h3> 框起來的——那才是「指路到某一個分頁」的寫法。
       * 註解裡的歷史說明（例如「原本叫『四　圖表與比較』」）不算，
       * 所以要求前後緊貼引號或標籤，不做寬鬆的子字串比對。
       */
      const patterns = [
        new RegExp(`「${old}」`, "g"),
        new RegExp(`<h3>${old}</h3>`, "g"),
        new RegExp(`進入${old}`, "g"),
      ];
      const hits = [];
      for (const re of patterns)
        for (const m of text.matchAll(re)) {
          /*
           * 註解裡的歷史敘述放行——它不是使用者看得到的文字。
           * 區塊註解：往前找最近的開頭與結尾比大小。
           * 單行註解：看這一行在命中處之前有沒有 `//`。
           */
          const before = text.slice(0, m.index);
          const openAt = before.lastIndexOf("/*");
          const closeAt = before.lastIndexOf("*/");
          if (openAt > closeAt) continue;
          const lineStart = before.lastIndexOf("\n") + 1;
          if (before.slice(lineStart).includes("//")) continue;
          hits.push(m[0]);
        }
      assert.deepEqual(
        hits,
        [],
        `${label} 的說明文字還寫著「${old}」，但畫面上那一頁叫「${now}」` +
          `（${when} 改的）——使用者照說明去側欄找會找不到`,
      );
    }
  }
});
