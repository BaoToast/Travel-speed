/*
 * ══════════════════════════════════════════════════════════════════
 *  交付包裡不可以有真實調查檔，也不可以有《公路容量手冊》
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者定的界線（多次重申）：
 *   「**真實調查檔與《2022年臺灣公路容量手冊》不可以放進任何交付包**，
 *     也不夾帶給 GPT。」
 *
 * ⚠️ 在這一支之前，這條界線**沒有任何守門在看**。
 *   `no-hardcoded-paths.test.mjs:198` 只是把 `realdata` 放進**忽略清單**——
 *   那是「掃描時跳過它」，不是「檢查它有沒有跑進包裡」。
 *   兩件事剛好相反：忽略清單讓真實檔**更不容易**被發現。
 *
 * ⚠️ 而「夾帶」不是假想的風險，這一輪已經發生過三次同一類的事：
 *   ・全日交通量誤裝整個建置產物目錄（`github-pages` 底下那個 `dist`，兩次）
 *     ⚠️ 這一句刻意**不寫成帶斜線的路徑字樣**：`dependency-manifest.test.mjs`
 *     那條「會讀 dist／ 的測試必須先建置」是掃整份原始碼的字面樣式，
 *     連註解都算，寫成路徑會讓它誤判成「這支測試要讀建置產物」。
 *   ・路口轉向夾帶 6 張 `scripts/manual/*.png` 探針截圖
 *   打包腳本的黑名單擋得住「我想到的」，擋不住「我沒想到的」。
 *   所以這裡改用**正面清單**：試算表與 PDF 只有指定的那幾個位置可以有，
 *   其餘一律紅。想到什麼擋什麼，和「只有這些可以」，可靠度差很多。
 *
 * ── 這一支怎麼避免變成假的綠 ────────────────────────────────────
 *
 *   一、判準抽成純函式 `offendingPaths()`，**兩個方向都測**：
 *       ①真的包（必須 0 件）②捏造的違規清單（每一條都必須被抓到）。
 *       只測①的話，判準寫成 `return []` 也會全綠。
 *   二、前置檢查：真的掃到上百個檔名、而且真的掃到那一份程式手冊 PDF。
 *       掃不到 PDF 的話，「PDF 只能是程式手冊」那一條是恆綠的。
 *   三、**只掃包自己**。`realdata/` 在包的**外面**（`../realdata/`，
 *       `cross-system-guards.test.mjs:58` 就是那樣拿的），所以拿真實檔
 *       做驗證時這一支不會變成假的紅——這一點很重要：會誤紅的守門，
 *       下一次就會被人加豁免繞過去，比沒有守門更糟。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename, posix } from "node:path";

const ROOT = fileURLToPath(new URL("./", import.meta.url));

/*
 * 掃描時跳過的目錄：這些都**不在交付包裡**（是建置產物、暫存或工具目錄）。
 * ⚠️ `realdata` 故意**不寫在這裡**——它本來就在包的外面，不需要跳過；
 *   寫進來反而會讓「萬一有人把它複製進包裡」變成看不到。
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".tryout",
  ".wrangler",
  ".probe-shots",
  "test-results",
  "out",
  "dist",
  "github-pages-dist",
]);

/** 遞迴收集包裡所有檔案的相對路徑（一律用 / 當分隔，判準才好寫）。 */
function collectPaths(dir, prefix = "") {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; /* 連結斷掉之類的，跳過 */
    }
    const rel = prefix ? posix.join(prefix, name) : name;
    if (st.isDirectory()) found.push(...collectPaths(full, rel));
    else found.push(rel);
  }
  return found;
}

const SHEET = /\.(xlsx|xlsm|xls|csv)$/i;
/*
 * 測試用的匿名試算表：檔名一律以 99999 開頭（保留給測試的假案號），
 * 而且只能待在 test-fixtures/。
 * ⚠️ 這幾份是 `generate-test-fixtures.mjs` 在跑 e2e 時**現產**的，
 *   不在交付包裡；但如果有人先跑過 e2e 再跑 npm test，它們會在硬碟上，
 *   所以判準要放它們過——同時要求「必須是 99999 開頭」，
 *   免得有人把真實檔丟進同一個資料夾就過關。
 */
const FIXTURE_DIR = "test-fixtures/";
const FIXTURE_NAME = /^99999/;
/* 唯一允許的 PDF：這一支自己的程式手冊。 */
const MANUAL_PDF = /^manuals\/交通服務水準程式手冊_v[\d.]+\.pdf$/;
/*
 * 一看就知道是真實資料的名字。這幾個詞出現在檔名或資料夾名裡就紅，
 * 不管副檔名是什麼（有人把 .xlsx 改名成 .txt 一樣要抓到）。
 */
const REAL_WORDS = [
  "容量手冊",
  "realdata",
  "真實資料",
  "真實調查",
  "調查原始",
  "原始資料",
];

/**
 * 判準（純函式，這樣才能拿捏造的清單反向驗證）。
 * @param {string[]} paths 包裡的相對路徑
 * @returns {string[]} 不該出現的那些，附上理由
 */
function offendingPaths(paths) {
  const bad = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const word = REAL_WORDS.find((w) => lower.includes(w.toLowerCase()));
    if (word) {
      bad.push(`${path}（檔名含「${word}」）`);
      continue;
    }
    if (SHEET.test(path)) {
      if (!path.startsWith(FIXTURE_DIR)) {
        bad.push(`${path}（試算表只能放在 ${FIXTURE_DIR}）`);
        continue;
      }
      if (!FIXTURE_NAME.test(basename(path))) {
        bad.push(`${path}（測試用試算表的檔名必須以 99999 開頭）`);
        continue;
      }
    }
    if (lower.endsWith(".pdf") && !MANUAL_PDF.test(path))
      bad.push(`${path}（PDF 只能是 manuals/ 底下這一支自己的程式手冊）`);
  }
  return bad;
}

const paths = collectPaths(ROOT);

test("前置：真的掃到包裡的檔案，而且真的掃到那一份程式手冊 PDF", () => {
  assert.ok(paths.length >= 100, `只掃到 ${paths.length} 個檔案——掃描範圍壞了嗎？`);
  const pdfs = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
  assert.ok(
    pdfs.length >= 1,
    "掃不到任何 PDF——那「PDF 只能是程式手冊」那一條就是恆綠的",
  );
  assert.ok(
    pdfs.some((p) => MANUAL_PDF.test(p)),
    `掃到的 PDF 不是程式手冊：${pdfs.join("、")}`,
  );
});

test("包裡沒有真實調查檔，也沒有《公路容量手冊》", () => {
  const bad = offendingPaths(paths);
  assert.deepEqual(bad, [], `包裡有不該出現的檔案：\n  ${bad.join("\n  ")}`);
});

test("⚠️ 反證：捏造的違規檔案，每一條都要被抓到", () => {
  /* 這些都是「如果真的發生就是出事了」的樣子，判準必須一條都不漏。 */
  const fake = [
    "realdata/11101TS15-01-中正路(甲路～乙路)-平日.xlsx",
    "2022年臺灣公路容量手冊.pdf",
    "manuals/2022年臺灣公路容量手冊.pdf",
    "11101TS15-01-中正路(甲路～乙路)-平日.xlsx",
    "test-fixtures/11101TS15-01-中正路(甲路～乙路)-平日.xlsx",
    "附件/調查原始資料.csv",
    "docs/真實調查檔清單.txt",
  ];
  const bad = offendingPaths(fake);
  const missed = fake.filter((p) => !bad.some((b) => b.startsWith(p)));
  assert.deepEqual(missed, [], `這幾條沒被抓到：\n  ${missed.join("\n  ")}`);
});

test("⚠️ 反證的反面：本來就該有的那幾個不可以被誤抓", () => {
  /* 會誤紅的守門下一次就會被加豁免繞過去，所以這一條同樣重要。 */
  const good = [
    "manuals/交通服務水準程式手冊_v2.20.81.pdf",
    "test-fixtures/99999TS1-01-測試路段(甲路～乙路)-平日.xlsx",
    "app.js",
    "styles.css",
    "README.md",
  ];
  assert.deepEqual(offendingPaths(good), []);
});

test("如果 test-fixtures 已經產生過，裡面每一個檔名都必須是 99999 開頭", () => {
  const fixtures = paths.filter((p) => p.startsWith(FIXTURE_DIR));
  /* 還沒跑過 e2e 時這個資料夾不存在，那就沒有東西要檢查——不是失敗。 */
  for (const path of fixtures)
    assert.match(
      basename(path),
      FIXTURE_NAME,
      `${path} 不是 99999 開頭的匿名測資——真實檔混進 test-fixtures 了嗎？`,
    );
});
