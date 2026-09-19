const DB = "TrafficLOSWebV2",
  STORE = "app",
  KEY = "state";
document.head.insertAdjacentHTML(
  "beforeend",
  "<style>.project-switch{margin-left:auto;margin-right:10px;max-width:310px;border:1px solid #dce5ea;border-radius:7px;background:#fff;padding:8px 10px;font:inherit;color:#17354d}@media(max-width:650px){.project-switch{max-width:145px}.blank-badge{display:none}}</style>",
);
const DEFAULT_LOS_RULE = { A: 0.8, B: 0.6, C: 0.5, D: 0.4, E: 0.2 };
/**
 * 把 A～F 六級收成三段：順暢／尚可／壅塞。
 *
 * ── 為什麼要有這個設定 ────────────────────────────────────────
 * 給業主看的圖上，六種顏色排在一起色盲讀者幾乎一定會有兩段分不出來
 *（實測六段配色過不了對比檢核，三段可以）。但「哪幾級算壅塞」不是
 * 系統可以替使用者決定的事——會被質疑，所以做成**看得見、可以改**的設定。
 *
 * 預設值取自本系統手冊第 8 章自己的白話說明，不是我另外編的：
 *   A 幾乎不受干擾／B **順暢**，偶爾要減速
 *   C 還算穩定／D 明顯變慢，開始有壓迫感
 *   E 接近飽和，走走停停／F **壅塞**，時常完全停止
 * 所以預設 順暢＝A、B；尚可＝C、D；壅塞＝E、F。
 *
 * ⚠️ 這一組設定同時決定兩件事，**不可以拆成兩個各自獨立的設定**：
 *   一、三段圖的分段
 *   二、趨勢圖那個「X 級以下路段佔比」指標的 X
 * 拆開的話同一頁上會出現兩條不一樣的紅線，那才是真的會被質疑的地方。
 * congestedStart 是 "E" 時，指標就叫「E 級以下路段佔比」，一定對得起來。
 */
const LOS_GRADES = ["A", "B", "C", "D", "E", "F"];
const DEFAULT_BAND_RULE = { smoothEnd: "B", congestedStart: "E" };
const emptyState = () => ({
  version: 10,
  projects: [],
  activeCode: "",
  details: [],
  summaries: [],
  limits: {},
  limitConfirmed: {},
  aliases: {},
  roadMeta: {},
  speedVersions: {},
  anomalyRules: {},
  reportDrafts: {},
  operations: [],
  losRules: {},
  /*
   * 判定門檻的「季別 × 路段」覆寫，依計畫分別保存
   *（使用者 2026-09-15：「比照全日交通量和路口轉向程式的參數設定」）。
   * 形狀：{ 計畫代碼: [{ period, road, rules:{A..E} }] }，"*" 代表全部。
   * ⚠️ 空的（或整個不存在）＝完全沒有覆寫＝與改版前逐格相同。
   */
  losRuleScopes: {},
  /* 三段分界（順暢／尚可／壅塞）依計畫分別保存，見 DEFAULT_BAND_RULE。 */
  bandRules: {},
  /*
   * 三段分法的「季別區間 × 路段」覆寫（依計畫代碼分組）。
   * 使用者 2026-09-15：「交通服務水準的三段分法我一直都有同意要補呀」。
   * ⚠️ 與 losRuleScopes 走**同一個解析器**（los-rule-scope.js），
   *   順位與衝突提示的規則完全一致——兩套規則遲早會互相矛盾。
   */
  bandRuleScopes: {},
  /*
   * ══════════════════════════════════════════════════════════════════
   *  已經人工確認過、下次檢查不再提醒的異常（使用者 2026-09-17）
   * ══════════════════════════════════════════════════════════════════
   *
   * 「如果已經回報了，要怎麼按確認，來讓這項問題，在下次異常檢查時，
   *   不會再次回報異常呢?」
   *
   * 形狀：{ 計畫代碼: { 指紋: { at: "確認時間" } } }
   *
   * ⚠️ 指紋**一定要包含那一筆的說明文字**（裡面有數字）。
   *   只用「類型＋季別＋路段＋日別」當鍵的話，確認過「總延滯增加 30.7%」
   *   之後，下一季變成「增加 200%」會被同一把鑰匙一起消音——
   *   那是把一個更嚴重的問題藏起來，比沒有這個功能糟得多。
   *   數字變了 → 指紋變了 → 重新出現，這是刻意的。
   * ⚠️ 只有「人工確認」類的異常可以確認。「重新匯入」是原始檔真的有錯，
   *   按掉它等於把一個資料錯誤藏起來；「畫面修正」處理完本來就會自己消失。
   * ⚠️ 確認**只影響畫面**：匯出與交付的專案包一律仍然輸出全部項目，
   *   只是多標一欄「已確認」。交出去的檔案少東西，比畫面上多幾列嚴重得多。
   */
  ackedIssues: {},
  imports: [],
  last: { year: "", quarter: "2", time: "" },
  /*
   * 期別要顯示成「季別」還是「實際調查月份」。
   * **只影響畫面上的文字**——分組、排序、鍵值、計算與匯出的數值一律仍以
   * period（115Q1）為準。存進 state 是為了重新整理後還記得使用者的選擇。
   */
  periodDisplay: "quarter",
  /*
   * 年份要顯示成民國年（115Q1）還是西元年（2026Q1）。
   * 與 periodDisplay 一樣**只影響畫面與匯出檔上的文字**——資料一律以民國年
   * 寫法儲存（見 normalizeSurveyPeriod），分組、排序、鍵值與計算都走儲存值。
   */
  yearStyle: "roc",
});
let state = emptyState(),
  pending = [],
  /**
   * 匯入預覽裡被勾選要「批次確認」的 pending 索引。
   * 宣告在這裡而不是靠近 UI，是因為 clearPendingPreview() 位置更前面；
   * let 在 TDZ 內連 typeof 都會丟例外，用 typeof 當防護是沒有用的。
   */
  roadPicks = new Set(),
  /** 預覽當下的民國年／季度／計畫，確認寫入時一律以這一份為準 */
  pendingContext = null,
  /** 本次預覽的調查日期／期別比對結果；只作提示，不影響寫入的任何數值 */
  pendingPeriodChecks = [],
  healthIssues = [];
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const num = (v) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },
  fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d).replace(/\.00$/, ""));
const activeProject = () => state.projects.find((p) => p.code === state.activeCode) || null;
/*
 * 「儲存空間被瀏覽器封鎖」與「資料讀不出來」是兩件完全不同的事，搶救畫面
 * 要講的話正好相反：後者原始資料還在、該先備份；前者根本沒有資料可備份，
 * 該做的是去改瀏覽器設定，而且按下「下載原始資料備份」只會再失敗一次。
 *
 * 實測（把 window.indexedDB 改成存取即拋錯，也就是瀏覽器設定成
 * 「封鎖所有 Cookie／網站資料」時的實際行為）：舊版顯示的是
 *   「儲存在瀏覽器裡的資料有一部分格式不符…您的原始資料仍然完整保留在
 *     瀏覽器裡。」
 * 兩句話都不成立，而且按下下載鈕會跳「備份下載失敗：IndexedDB 已被停用」。
 * 使用者完全不知道真正的原因，也不知道怎麼解。
 *
 * 這個旗標讓 showLoadError() 挑對的那一套說法。
 */
let storageBlocked = false;
function isStorageBlockedError(error) {
  const name = error?.name || "";
  return name === "SecurityError" || name === "NotAllowedError" || name === "InvalidStateError";
}
function openDB() {
  return new Promise((ok, no) => {
    storageBlocked = false;
    let factory;
    let r;
    try {
      /* 存取 indexedDB 這個屬性本身就可能丟 SecurityError，要包起來 */
      factory = globalThis.indexedDB;
      if (!factory || typeof factory.open !== "function") {
        storageBlocked = true;
        no(new Error("IndexedDB 無法使用"));
        return;
      }
      /* 沿用現有版本；固定指定 1 會把較高版本資料庫誤判成 VersionError。 */
      r = factory.open(DB);
    } catch (error) {
      storageBlocked = isStorageBlockedError(error) || error instanceof TypeError;
      no(error);
      return;
    }
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => {
      /* 只把明確的權限／狀態錯誤判成封鎖；其他錯誤仍保留資料搶救流程。 */
      storageBlocked = isStorageBlockedError(r.error);
      no(r.error);
    };
  });
}
function isLegacyLosRule(x) {
  return x && x.A === 0.9 && x.B === 0.7 && x.C === 0.5 && x.D === 0.4 && x.E === 0.3;
}
function migrateLosRules() {
  state.losRules = state.losRules || {};
  /* 舊存檔沒有這一格；補成空物件就是「沒有任何覆寫」。 */
  state.losRuleScopes = state.losRuleScopes || {};
  state.bandRuleScopes = state.bandRuleScopes || {};
  state.roadMeta = state.roadMeta || {};
  state.limitConfirmed = state.limitConfirmed || {};
  state.speedVersions = state.speedVersions || {};
  state.anomalyRules = state.anomalyRules || {};
  state.reportDrafts = state.reportDrafts || {};
  state.operations = state.operations || [];
  // 只在「從舊版本升上來」時清掉那組舊預設值。舊版是看數值判斷，
  // 使用者若真的想用 A.9/B.7/C.5/D.4/E.3（這是實務上存在的門檻表），
  // 每次載入都會被當成舊資料清掉，整個計畫的服務水準悄悄變樣。
  if ((Number(state.version) || 0) < 10)
    for (const [code, rule] of Object.entries(state.losRules))
      if (isLegacyLosRule(rule)) delete state.losRules[code];
  /*
   * ── 「路段有效期間」已於 2026-09-15 整組移除 ────────────────────
   *
   * 使用者原話：「不管是哪個程式，其實都是從檔案中匯入去抓取，
   *   **沒抓到＝沒資料了**……我偏向程式直接以有沒匯入去判斷就好，
   *   沒匯入＝沒資料，篩選某季時，沒資料的路段就不顯示……
   *   三份程式都已經有『前季有但本季沒有的路段』的異常提醒了，
   *   就足夠應付狀況了。」
   *
   * ⚠️ 舊資料裡可能還留著 roadMeta.startPeriod／endPeriod。
   *   **刻意不刪掉那兩個欄位**：它們現在沒有任何地方會讀，留著不影響行為，
   *   而主動改寫使用者的備份內容風險大於收益（還原舊備份時也不會炸）。
   *   roadMeta 現在只負責方向顯示名稱（directionA／directionB）。
   */
  state.version = 10;
}
function assertLoadableState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("本機資料根格式不符");
  const current = Array.isArray(value.projects);
  const legacy = value.project && typeof value.project === "object" && !Array.isArray(value.project);
  if (!current && !legacy) throw new Error("本機資料缺少計畫結構");
}
async function load() {
  try {
    const db = await openDB();
    state = await new Promise((ok, no) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => ok(r.result === undefined ? emptyState() : r.result);
      r.onerror = () => no(r.error);
    });
    assertLoadableState(state);
    if (state.project && !state.projects) {
      state.projects = state.project.code ? [state.project] : [];
      state.activeCode = state.project.code;
      delete state.project;
    }
    state = { ...emptyState(), ...state };
    migrateLosRules();
    rebuild();
  } catch (error) {
    /*
     * ⚠️ 讀不出來時**絕對不可以**靜靜換成空白 state。
     *
     * 舊版就是 `state = emptyState()` 然後照常 renderAll()：畫面變成
     * 「尚未建立計畫」，沒有 toast、沒有例外、沒有任何訊息。使用者以為資料
     * 沒了，於是重建計畫或重新匯入——那個動作會呼叫 save()，把空白 state
     * 寫回 IndexedDB，**原始資料這時候才真的消失**，而且救不回來。
     *
     * 實測（種入一筆會讓 rebuild() 丟例外的壞紀錄）：
     *   重新載入後 → 計畫選單「尚未建立計畫」、toast 空白、無頁面錯誤
     *   此時 DB 裡原始計畫其實還在
     *   使用者按一次「儲存計畫設定」→ DB 只剩新計畫，原始計畫消失
     *
     * 路口轉向已經修過同一個缺陷（loadError ＋ 整頁搶救指引）。這裡比照：
     * 鎖住存檔、換成搶救畫面，讓原始資料留在瀏覽器裡等使用者備份。
     */
    loadError = error?.message || String(error) || "未知錯誤";
    state = emptyState();
    showLoadError();
    return;
  }
  renderAll();
}
/** 讀取失敗時鎖住存檔——存檔會覆蓋掉還留在瀏覽器裡的原始資料。 */
let loadError = "";
/*
 * 搶救畫面會把整個 .app 換掉，但 index.html 在 app.js 之後還載入了
 * conclusion.js 與 quality-extension.js，那兩支在頂層就會去找主畫面裡的
 * 節點（例如 quality-extension.js 的 `q("roadAlert").after(importPanel)`）。
 * 換得太早，它們拿到 null 就丟例外——實測舊版在搶救畫面出現時
 * 主控台就有一則未捕捉的「Cannot read properties of null (reading 'after')」。
 * 那是「畫面已經在講救援步驟、底下卻有東西壞掉」，本身也是要修的。
 *
 * 解法是等頁面所有腳本都跑完再換：readyState 還在 loading 就掛一次
 * DOMContentLoaded，否則直接換。
 */
function showLoadError() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showLoadError, { once: true });
    return;
  }
  const shell = document.querySelector(".app") || document.body;
  const panel = document.createElement("div");
  panel.className = "load-error";
  if (storageBlocked) {
    /* 儲存空間根本用不了：沒有資料可備份，不要給一個必定失敗的下載鈕。 */
    panel.innerHTML =
      '<div class="load-error-card"><h1>瀏覽器不允許這個網站儲存資料</h1>' +
      "<p>這個系統把資料存在您自己的瀏覽器裡，目前瀏覽器擋住了這項功能，" +
      "所以<b>資料讀不出來、也存不進去</b>。這不是資料損壞——" +
      "這台電腦上目前沒有本系統的資料。</p>" +
      '<p class="load-error-reason">錯誤訊息：' +
      esc(loadError) +
      "</p><p>常見原因與處理方式：</p><ul class=\"load-error-list\">" +
      "<li>瀏覽器設定成「封鎖所有 Cookie／網站資料」——請對本網站開放。</li>" +
      "<li>使用了會阻擋本機儲存的無痕或隱私模式——請改用一般視窗。</li>" +
      "<li>擴充套件（隱私或廣告阻擋類）擋下了本網站——請將本站加入例外。</li></ul>" +
      '<div class="load-error-actions">' +
      '<button class="primary" id="rescueReload">調整設定後，重新載入</button></div>' +
      '<p class="load-error-note">在這個狀態下請不要匯入資料——' +
      "畫面上看起來會成功，但關掉分頁就會全部消失。</p></div>";
    shell.replaceChildren(panel);
    const reload = document.getElementById("rescueReload");
    if (reload) reload.onclick = () => location.reload();
    return;
  }
  panel.innerHTML =
    '<div class="load-error-card"><h1>無法讀取這台電腦上的資料</h1>' +
    "<p>儲存在瀏覽器裡的資料有一部分格式不符，系統為了避免把它覆蓋掉，" +
    "這次<b>沒有載入、也沒有寫入任何東西</b>。您的原始資料仍然完整保留在瀏覽器裡。</p>" +
    '<p class="load-error-reason">錯誤訊息：' +
    esc(loadError) +
    "</p><p>請先按「下載原始資料備份」把原始資料存成檔案（那是一份完整的備份），" +
    "再把檔案提供給維護人員；確認之後可以用「備份與淨空」還原回來。</p>" +
    '<p><b>在備份完成之前，請不要在這個畫面重新建立計畫或重新匯入</b>——' +
    "那會把還留在瀏覽器裡的原始資料覆蓋掉。</p>" +
    '<div class="load-error-actions"><button class="primary" id="rescueDownload">下載原始資料備份</button></div></div>';
  shell.replaceChildren(panel);
  const button = document.getElementById("rescueDownload");
  if (button)
    button.onclick = async () => {
      try {
        const db = await openDB();
        const raw = await new Promise((ok, no) => {
          const r = db.transaction(STORE).objectStore(STORE).get(KEY);
          r.onsuccess = () => ok(r.result);
          r.onerror = () => no(r.error);
        });
        const blob = new Blob([JSON.stringify(raw ?? null, null, 2)], {
          type: "application/json",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `交通服務水準_原始資料備份_${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        /* 連結一定要掛進頁面，否則部分瀏覽器會忽略指定的檔名 */
        document.body.append(link);
        link.click();
        link.remove();
      } catch (error) {
        alert("備份下載失敗：" + (error?.message || error));
      }
    };
}
// 存檔失敗（無痕模式、容量已滿、磁碟已滿）若無聲無息，
// 畫面看起來一切正常，實際上什麼都沒寫進去。這裡統一攔下來提醒使用者。
addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || String(event.reason || "");
  toast(`儲存失敗，這次的變更沒有寫入：${message || "請確認瀏覽器儲存空間"}`);
});
async function save() {
  /* 讀取失敗時一律不寫入——寫入就是把原始資料覆蓋掉的那一步。 */
  if (loadError) return;
  const db = await openDB();
  await new Promise((ok, no) => {
    const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(state, KEY);
    r.onsuccess = () => ok();
    r.onerror = () => no(r.error);
  });
  renderAll();
}
function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

/*
 * ── 讓 <input type="file"> 也能用拖曳的方式給檔案 ──
 *
 * 作法刻意繞一圈：把拖進來的 FileList 指派給原本那個 input.files，
 * 再送一個 change 事件，後面就走原本 onchange 的同一條路。
 * 不另外寫一份「拖曳版」的處理邏輯——那種寫法遲早會出現
 * 「用拖的少做了一步檢查」這類只有拖曳才踩得到的錯。
 *
 * 副檔名依 input 自己的 accept 過濾。瀏覽器對 <input> 的 accept
 * 只在「選檔對話框」生效，拖曳完全不受它限制，所以這裡要自己擋，
 * 而且擋掉的要講出來，不能安靜地少匯入幾個檔。
 */
function enableFileDrop(zone, input) {
  if (!zone || !input) return;
  zone.dataset.dropzone = "1";
  let dragDepth = 0;
  const accept = (input.getAttribute("accept") || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const accepted = (name) =>
    !accept.length || accept.some((ext) => name.toLowerCase().endsWith(ext));
  const active = (on) => zone.classList.toggle("drag-active", on);
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    active(true);
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    active(true);
  });
  zone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) active(false);
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    active(false);
    if (input.disabled) return toast("目前正在讀取檔案，請等本批判讀完成後再選取下一批");
    const dropped = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (!dropped.length) return;
    const ok = dropped.filter((f) => accepted(f.name));
    const bad = dropped.filter((f) => !accepted(f.name));
    if (!ok.length)
      return toast(
        `這裡只收 ${accept.join("、")}；拖進來的 ${dropped.length} 個檔案都不是`,
      );
    const keep = input.multiple ? ok : ok.slice(0, 1);
    const dt = new DataTransfer();
    for (const f of keep) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (bad.length)
      toast(`已忽略 ${bad.length} 個不是 ${accept.join("、")} 的檔案`);
    else if (!input.multiple && ok.length > 1)
      toast(`這裡一次只收一個檔，已使用「${keep[0].name}」`);
  });
}

/*
 * 檔案掉在放置區**外面**時，瀏覽器預設會直接開啟那個檔案，
 * 等於把使用者踢出系統頁面。這裡全域擋掉，並讓游標顯示「不可放置」，
 * 使用者就知道要往放置區丟，而不是莫名其妙離開畫面。
 * 放置區內部照常放行，交給上面的 enableFileDrop 處理。
 */
function blockStrayFileDrop(e) {
  /*
   * 只攔「拖檔案」，不要攔一般的文字拖曳。
   *
   * 先前版本少了這一行判斷，於是把使用者在頁面內拖動選取文字
   * 也一起擋掉了——拖一段字到搜尋框、計畫名稱欄或結論草稿的文字框
   * 全都放不下去。實測三個位置都中。
   * dataTransfer.types 含 "Files" 才是拖檔案。
   */
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
  if (!types.includes("Files")) return;
  const el = e.target instanceof Element ? e.target : null;
  if (el && el.closest("[data-dropzone]")) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
}
window.addEventListener("dragover", blockStrayFileDrop);
window.addEventListener("drop", blockStrayFileDrop);

/*
 * 按下按鈕之後，把「剛長出來的結果」帶到看得見的地方。
 *
 * 使用者回報：「路段管理」按下『預覽修改影響』或『顯示合併影響』之後，
 * 畫面停在原地，不知道預覽已經長在下面，會以為程式沒反應。
 * 實測（視窗高 900px）：預覽面板的頂端在 1243px 處——比視窗下緣還低 343px，
 * 使用者完全看不到。結論草稿的 1331px 也一樣。
 *
 * 規則刻意訂得保守，因為「畫面亂跳」比「不跳」更惱人：
 *   ・結果已經看得到 → **完全不動**。按確認鍵、結果就在原地的情況不受影響。
 *   ・結果在視窗外   → 才捲動，而且只捲到剛好看得見。
 *   ・使用者的系統設定要求減少動態效果 → 直接跳過去，不做平滑捲動。
 *
 * 只在「按了才會出現結果」的按鈕呼叫；每次輸入都會重畫的地方不要用，
 * 那會變成打一個字畫面跳一次。
 */
function revealResult(target) {
  const el = typeof target === "string" ? $(target) : target;
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const rect = el.getBoundingClientRect(),
    vh = window.innerHeight || document.documentElement.clientHeight;
  /* 頂端與底端都在視窗內，或者它本來就佔滿整個視窗 → 使用者已經看得到 */
  const fullyVisible = rect.top >= 0 && rect.bottom <= vh;
  const fillsViewport = rect.top <= 0 && rect.bottom >= vh;
  if (fullyVisible || fillsViewport) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  } catch {
    /* 舊瀏覽器不接受設定物件時，退回最陽春的用法 */
    el.scrollIntoView();
  }
}
/**
 * 「四　圖表」底下的四個大分頁（X-62，使用者 2026-09-17）。
 *
 * ⚠️ 順序由使用者 2026-09-13 指定，拆成大分頁之後照抄：
 *   各路段 LOS 圖 → 各路段歷季旅行速率 → 歷季趨勢 → 三段分法。
 * ⚠️ 只寫**一份**。之前那四個名字散在 titles、NAV_ZONES、gotoView 與
 *   renderCharts 四個地方，任何一處漏改都會變成「側欄有、點了空白」
 *   或「切過去卻沒重畫」。
 */
const CHART_VIEWS = ["losChart", "speedTrend", "trendChart", "bandChart"];

const titles = {
  home: "操作首頁",
  setup: "建立與管理計畫",
  import: "尖峰批次匯入",
  detail: "尖峰明細",
  summary: "尖峰彙總",
  roadadmin: "路段管理",
  speed: "路段速限",
  standards: "判定標準",
  /*
   * ⚠️ X-62（使用者 2026-09-17）：「LOS圖表大分頁拿掉，改以4張圖的名稱
   *   命名為4個大分頁，每點一個大分頁，就展示該分頁的圖」。
   *   名稱與每一塊自己的區塊標題**逐字相同**，使用者才不用自己對應。
   */
  losChart: "各路段 LOS 圖",
  speedTrend: "各路段歷季旅行速率",
  trendChart: "歷季趨勢（可勾選指標）",
  bandChart: "三段分法（順暢／尚可／壅塞）",
  conclusion: "結論草稿產生器",
  importlog: "匯入紀錄",
  maintenance: "資料維護",
  backup: "備份與淨空",
  guide: "新手說明",
};
/*
 * ══════════════════════════════════════════════════════════════════════
 *  大分頁底下的小分頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「大分頁下面有小分頁（例如各種圖的名稱作為小分頁名稱），都可以比照
 *     流量核對工作台的格式，小分頁文字比較小這樣。點小分頁一樣有醒目提示
 *     視窗和展開（如果有）跳轉正確位置。這類格式可套用到三個程式中。
 *     利用大小分頁讓人知道各種圖、功能分別在哪。」
 *
 * ⚠️ 三支程式同一套做法：只列**目前這一頁**的小分頁（全部攤開會變成
 *   四十幾列，反而找不到東西）；點了要(1)捲到那一塊(2)把那一塊框起來
 *   (3)收合的要自動展開。
 *
 * ⚠️ 列得出來的每一項，畫面上都要真的找得到——列了卻點不到，使用者看到的
 *   是「這個按鈕壞了」，而且沒有任何訊息告訴他為什麼。所以渲染前一律
 *   用 document.getElementById 確認，找不到就不列。
 */
const NAV_SECTIONS = {
  summary: [{ label: "目前套用的判定標準", anchor: "summary-rule-shortcut" }],
  standards: [
    { label: "服務水準判定方式", anchor: "standards-los" },
    { label: "圖表的三段分法", anchor: "standards-band" },
  ],
  /*
   * ⚠️ 順序由使用者 2026-09-13 指定：
   *   「LOS圖表的順序請幫我調整一下顯示順序：
   *     各路段LOS圖、各路段歷季旅行速率、歷季趨勢(可勾選指標)、三段分法(順暢/尚可/壅塞)」
   *
   * ⚠️ 真正決定側欄順序的是**畫面上區塊由上而下的順序**（sectionsFor 最後會依 DOM 排），
   *   所以 index.html 裡 #chartGrid 也一起搬到 #trendPanel 之前了。
   *   只改這份清單的話，側欄順序會和點下去的跳轉順序對不起來。
   */
  /*
   * ⚠️ X-62：原本這裡有 charts 的四個小分頁（各路段 LOS 圖／各路段歷季旅行速率／
   *   歷季趨勢／三段分法）。四張圖已經各自升格成大分頁，
   *   再列一次小分頁等於同一個名字在側欄出現兩層。
   *   ⚠️ 也不要改成「每一頁列一個同名的小分頁」——sectionsFor 已經加了
   *     「只有一塊而且名字跟大分頁一樣就不列」那條規則。
   */
  backup: [
    { label: "下載目前計畫的專案包", anchor: "backup-one" },
    { label: "載入既有備份", anchor: "backup-restore" },
    { label: "建立全新空白模板", anchor: "backup-clear" },
  ],
};

/** 目前被「點名」的那一塊；換頁時要清掉，否則切回來還留著上一次的外框。 */
let focusedBlock = "";

function focusBlock(anchor) {
  focusedBlock = anchor;
  document
    .querySelectorAll(".is-focused")
    .forEach((el) => el.classList.remove("is-focused"));
  const target = document.getElementById(anchor);
  if (!target) return;
  target.classList.add("is-focused");
  /* 收合的要自動展開——只捲過去而不展開，看到的還是一行收合的標題。 */
  if (target.tagName === "DETAILS") target.open = true;
  /*
   * ⚠️ 不可以用 scrollIntoView({block:"start"})。
   *
   * 使用者 2026-09-13：「我點選 交通服務水準所有的小分頁，右側跳轉的畫面
   * 都是看不到小分頁正確的位置，定位應該有偏」「反而還得往上滑」。
   *
   * 實測（視窗 1500×900、空資料）：只要那一頁捲得動，被點名的區塊
   * **每一次都停在 top=0**——而這一支的 <header> 是 position:sticky、
   * height:72px，所以那一塊最上面 72px 永遠被表頭蓋住，區塊標題正好
   * 在那 72px 裡面。使用者看到的是「內容從中間開始」，只好往上滑。
   *
   * ⚠️ 表頭高度要**當場量**，不可以寫死 72：
   *   視窗變窄時表頭的內距與字級會變，寫死的數字會在某些寬度下又偏掉。
   * ⚠️ 也要確認它真的是吸頂的；不是吸頂就不必扣，扣了反而少捲一段。
   */
  requestAnimationFrame(() => {
    /*
     * ⚠️ 2026-09-15：要扣的**不只表頭**，還有主工具列。
     *   主工具列是這一天才加的，也是 sticky、也浮在上面（黏在表頭底下），
     *   只扣表頭的話，被點名的區塊標題會落在工具列後面——
     *   跟使用者 2026-09-13 回報的「定位應該有偏」是同一個症狀，
     *   只是遮住它的東西換成了新加的工具列。
     *
     * ⚠️ 一樣**當場量**：主工具列可以收合、窄視窗會換行，高度一直在變。
     * ⚠️ 一樣先確認它真的是吸頂的；不是吸頂就不必扣。
     */
    const stickyHeight = (selector) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node).position === "sticky"
        ? node.getBoundingClientRect().height
        : 0;
    };
    const sticky = stickyHeight("header") + stickyHeight(".main-toolbar");
    /* 再留一點呼吸空間，讓標題不是剛好貼著表頭下緣。 */
    const gap = 12;
    const top =
      target.getBoundingClientRect().top + window.scrollY - sticky - gap;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: reduce ? "auto" : "smooth",
    });
  });
}

/**
 * 這一頁底下有哪些小分頁。
 *
 * ⚠️ 2026-09-13 改成**從畫面上長出來**，不再只靠手寫的 NAV_SECTIONS。
 *
 *   原因：手寫清單只涵蓋了 4 個分頁，而逐頁盤點（數畫面上有幾塊、
 *   對照側欄列了幾項）發現路段管理有 7 塊、資料維護 5 塊、成果交付 2 塊…
 *   全部一項都沒列。既有的守門驗的是「**列出來的**點得到」，
 *   驗不到「該列的有沒有漏列」——所以它一直全綠。
 *
 *   手寫清單的問題是它會漂移：新加一塊面板沒有人會記得回來補一行。
 *   改成掃描畫面之後，「漏列」在結構上就不可能發生。
 *
 *   NAV_SECTIONS 保留兩個用途：
 *     (1) 標題不在區塊裡面的（LOS 圖表那幾個 .chart-grid，標題在隔壁的
 *        .title 裡），掃不到，要手動補
 *     (2) 標題太長或不好懂時，用 anchor 當鍵覆寫成比較好的字
 *
 * 沒有 id 的區塊會就地補一個（auto-<分頁>-<序號>）——沒有 id 就沒辦法跳轉。
 */
function sectionsFor(id) {
  const view = document.getElementById(id);
  if (!view) return [];
  const curated = NAV_SECTIONS[id] || [];
  const labelOf = new Map(curated.map((x) => [x.anchor, x.label]));
  const picked = new Map();
  for (const section of curated) picked.set(section.anchor, section.label);
  let serial = 0;
  for (const el of view.querySelectorAll(".panel, .chart-grid")) {
    /* 巢狀在別的面板裡面的不算——那是內層細節，不是這一頁的一塊。 */
    if (el.parentElement && el.parentElement.closest(".panel")) continue;
    /*
     * ⚠️ 純說明的區塊不列成小分頁。
     *
     * 使用者 2026-09-13（附圖）：
     *   「小分頁中，如果那個欄位是**純粹的說明文字、沒有任何功用**的話，
     *     不用特地做成小分頁在左側欄位，三個程式都是如此。
     *     大小分頁都前提是**該項是有實質功能的**（例如確認監測結果、
     *     匯入匯出資料等等），說明文字只是提醒用。」
     *
     * 判準（三支共用）：要列成小分頁，必須至少符合一項——
     *   (1) 裡面有可操作的控制項（按鈕、輸入、下拉、上傳、下載）
     *   (2) 裡面有要使用者確認或核對的資料（表格、清單、檢查結果、圖）
     *
     * ⚠️ data-nav-skip 是**明講出來的豁免**，不是萬用貼紙：
     *   守門會檢查它名副其實（標了純說明卻有按鈕／輸入／表格 → 紅）。
     */
    if (el.closest("[data-nav-skip='explanation']")) continue;
    const heading = el.querySelector(
      ":scope > .panel-head h3, :scope > .panel-head h2, :scope > h3, :scope > h2, :scope > summary",
    );
    if (!heading) continue;
    if (!el.id) el.id = `auto-${id}-${++serial}`;
    if (picked.has(el.id)) continue;
    /*
     * ⚠️ 標題可能很長（例如 <summary> 整句話）。側欄放不下就會被裁掉，
     *   而被裁掉的字使用者看不到——所以先切到 22 個字，並以「…」收尾。
     */
    const raw = (heading.textContent || "").replace(/\s+/g, " ").trim();
    const label = labelOf.get(el.id) || (raw.length > 22 ? raw.slice(0, 21) + "…" : raw);
    if (label) picked.set(el.id, label);
  }
  /*
   * ⚠️ X-62：一個大分頁底下**只有一塊、而且那一塊就叫這個大分頁的名字**時，
   *   不要再列一次。
   *
   *   四張圖各自升格成大分頁之後（各路段 LOS 圖、各路段歷季旅行速率、
   *   歷季趨勢、三段分法），側欄會變成「各路段 LOS 圖 ＞ 各路段 LOS 圖」
   *   這種同名兩層。兩層寫同一個字不會幫任何人找到東西，
   *   只會讓側欄變長——而側欄變長正是這一整套規則在對付的問題。
   *
   * ⚠️ 只有「**恰好一塊**而且**名字相同**」才收掉。
   *   ・兩塊以上 → 照列（那才是小分頁存在的理由）
   *   ・名字不同 → 照列（使用者需要知道這一頁裡那一塊叫什麼）
   */
  if (picked.size === 1) {
    const onlyLabel = [...picked.values()][0];
    if (onlyLabel === titles[id]) return [];
  }
  /* 依畫面上由上而下的順序排，側欄的順序才會和捲動的順序一致。 */
  const order = [...view.querySelectorAll("[id]")].map((el) => el.id);
  return [...picked.entries()]
    .map(([anchor, label]) => ({ anchor, label }))
    .sort((a, b) => order.indexOf(a.anchor) - order.indexOf(b.anchor));
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁可以收合
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「使用者點選了大分頁後，會展開下面的小分頁，那能否做個**可以讓使用者
 *     把小分頁收合**的功能? 如果可以，請把這一點也同步給三個程式。
 *     因為**目前點選大分頁是會有跳轉功能的**，所以如果要做可以收合小分頁的
 *     功能的話，可能要想一下怎麼做」
 *
 * ⚠️ 衝突點是使用者自己先指出來的：大分頁那一列現在的點擊行為是「切到那一頁」。
 *   把它改成「切換收合」會把跳轉弄丟；兩個行為綁在同一個點擊上，
 *   使用者永遠猜不到這一下會發生什麼。
 *
 * 作法：大分頁那一列的**最右側**放一顆獨立的收合鈕（▾／▸），**只**負責收合。
 *   那一列其餘區域的行為一個字都沒改，照樣跳轉。
 *
 * ⚠️ 按鈕不可以巢狀在按鈕裡（HTML 不合法、鍵盤行為也會壞），
 *   所以這裡把大分頁按鈕包進一個 .nav-row，收合鈕是它的兄弟。
 */
/*
 * ⚠️ 這個收合狀態**刻意不寫進 localStorage**。
 *
 *   舊版是寫進去的（key: los-nav-collapsed-v1），結果造成使用者 2026-09-14
 *   回報的那個毛病：按過一次收合鈕之後，「路段管理」永遠是收的，
 *   再怎麼點那個大分頁都不會展開。
 *
 *   而且那份記錄其實**一點用都沒有**：這支程式重新整理一律回到操作首頁，
 *   要回到某一頁就一定得點它一下，而點下去現在就會展開（見 gotoView）。
 *   也就是說「記住收合」唯一做得到的事，就是製造那個毛病。
 *
 *   收合鈕的用途是「我正在看這一頁，側欄先收一下」——那是這一次瀏覽期間的事，
 *   留在記憶體剛剛好。舊的 localStorage 鍵一併清掉，免得老使用者一打開
 *   還是收的（那正是他遇到的情況）。
 */
const NAV_COLLAPSE_KEY = "los-nav-collapsed-v1";
try {
  localStorage.removeItem(NAV_COLLAPSE_KEY);
} catch {
  /* 讀不到 localStorage 也無所謂，這裡只是清掉舊資料。 */
}
const collapsedViewSet = new Set();
function collapsedViews() {
  return collapsedViewSet;
}
function setCollapsed(view, collapsed) {
  if (collapsed) collapsedViewSet.add(view);
  else collapsedViewSet.delete(view);
}
/** 把大分頁按鈕包進一列，並在右側加上收合鈕。 */
function navRow(button) {
  if (button.parentElement?.classList.contains("nav-row"))
    return button.parentElement;
  const row = document.createElement("div");
  row.className = "nav-row";
  button.replaceWith(row);
  row.append(button);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-collapse";
  toggle.dataset.collapseView = button.dataset.view;
  /*
   * ⚠️ **一建立就先藏起來、先寫上符號**。
   *
   *   使用者 2026-09-14 回報（附圖）：「左側分頁這個隱形按鈕是什麼，
   *   按了之後也沒任何反應，且直接消失」——側欄右側整排看不見的空框。
   *
   *   成因：舊版把「藏起來」與「寫符號」全交給 applyNavCollapse()，
   *   而它是在 renderNavSections() 的最後才呼叫的；
   *   那支函式在「這一頁沒有小分頁」時會**提前 return**，
   *   於是首頁（操作首頁沒有小分頁）一載入就沒人去藏、也沒人去寫符號，
   *   每一列都留著一顆空白按鈕。按下去只是切換一個沒有小分頁的收合狀態
   *   （所以沒反應），而那一下觸發的 applyNavCollapse() 才把它藏起來
   *   （所以「直接消失」）。
   *
   *   預設藏起來是安全的一邊：有小分頁時 applyNavCollapse() 會把它打開，
   *   沒有小分頁時它本來就不該出現。
   */
  toggle.hidden = true;
  /*
   * ⚠️ 用箭頭，不是文字。
   *   使用者 2026-09-14 先提了文字標籤，看過全日交通量之後改口：
   *   「這樣顯眼的箭頭，也可以很好表達可以展開收合……
   *     不用改成展開/收合的文字了」。
   *   當初的問題是「太淺」＋「沒被藏起來」，不是「用了箭頭」。
   */
  /*
   * ⚠️ 箭頭只能用 ▼（U+25BC，Big5 A1B9）＋ CSS 轉角度。
   *   原本寫 \u25b8／\u25be（▸／▾）——那兩個字**不在 Big5**，
   *   微軟正黑體畫不出來，某些電腦上會變成空白，看起來像鈕壞掉
   *  （使用者 2026-09-11 就回報過同一個坑）。
   * ⚠️ 而且**不可以寫成 \uXXXX 跳脫**：字形守門掃的是原始碼裡的字元，
   *   跳脫寫法它看不到——這幾顆就是這樣躲過守門的（2026-09-15 查到）。
   *   收合狀態改用 aria-expanded 讓 CSS 去轉角度。
   */
  toggle.textContent = "▼";
  /* ⚠️ 收合鈕要有可讀的名稱，否則螢幕報讀器只會念出一個符號。 */
  toggle.setAttribute("aria-label", `收合或展開「${(button.textContent || "").trim()}」底下的小分頁`);
  toggle.onclick = (event) => {
    /* ⚠️ 一定要擋下來：不擋的話事件會冒泡到 nav 的委派，變成順便換頁。 */
    event.stopPropagation();
    const view = button.dataset.view;
    const now = !collapsedViews().has(view);
    setCollapsed(view, now);
    applyNavCollapse();
  };
  row.append(toggle);
  return row;
}
/** 依目前的收合狀態更新畫面（每次重繪小分頁之後都要呼叫）。 */
function applyNavCollapse() {
  const set = collapsedViews();
  document.querySelectorAll(".nav-row").forEach((row) => {
    const view = row.querySelector("button[data-view]")?.dataset.view;
    const toggle = row.querySelector(".nav-collapse");
    const box = row.nextElementSibling?.classList?.contains("nav-sections")
      ? row.nextElementSibling
      : null;
    const collapsed = set.has(view);
    /*
     * ⚠️ 沒有小分頁的大分頁**不顯示收合鈕**——擺一顆按下去毫無反應的鈕，
     *   和按鈕壞掉沒有分別。
     */
    if (toggle) {
      toggle.hidden = !box;
      /* 箭頭固定是 ▼，收合狀態由 aria-expanded ＋ CSS 轉角度表示（見上面的說明）。 */
      toggle.textContent = "▼";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    }
    if (box) box.hidden = collapsed;
  });
}
globalThis.applyNavCollapse = applyNavCollapse;

function renderNavSections(id) {
  document.querySelectorAll(".nav-sections").forEach((el) => el.remove());
  /*
   * ⚠️ **每一條離開路徑都要呼叫 applyNavCollapse()**，包括「這一頁沒有
   *   小分頁」那幾條提前 return。
   *
   *   舊版只在最後呼叫一次，於是沒有小分頁的分頁（操作首頁、匯入紀錄…）
   *   一進去就沒人去藏收合鈕——使用者看到的就是一排看不見的空框。
   *   把它包成 done()，就不會再有「某一條路徑忘了收尾」這種漏法。
   */
  const done = () => {
    applyNavCollapse();
  };
  const sections = sectionsFor(id);
  if (!sections.length) return done();
  const button = document.querySelector(`nav button[data-view="${id}"]`);
  if (!button) return done();
  /*
   * 找不到、或**畫面上根本沒有高度**的一律不列。
   *
   * ⚠️ 「元素存在」不等於「看得到」。沒有匯入資料時，LOS 圖表那幾個容器
   *   （chartGrid／speedTrendGrid）是存在的空 div，高度 0；bandPanel 則是
   *   hidden。列出來的話，使用者點下去畫面什麼都不會動——那和按鈕壞掉
   *   沒有分別，而且沒有任何訊息告訴他為什麼。
   *   （這一條是 2026-09-12 被強化後的 e2e 抓出來的：原本只檢查 id 存不存在。）
   */
  const usable = sections.filter((section) => {
    const el = document.getElementById(section.anchor);
    if (!el || el.hidden) return false;
    return el.getBoundingClientRect().height > 0;
  });
  if (!usable.length) return done();
  const box = document.createElement("div");
  box.className = "nav-sections";
  for (const section of usable) {
    const item = document.createElement("button");
    item.className = "nav-section";
    item.type = "button";
    item.textContent = section.label;
    item.dataset.anchor = section.anchor;
    item.onclick = () => {
      focusBlock(section.anchor);
      document
        .querySelectorAll(".nav-section")
        .forEach((el) => el.classList.toggle("current", el === item));
      document.querySelector("aside").classList.remove("open");
    };
    box.append(item);
  }
  (button.closest(".nav-row") || button).after(box);
  done();
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  分頁的捲動位置：第一次進去從最上面，回頭再進去接著上次看
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「在我第一次點入 A 分頁時，該分頁的資訊都是從最上面開始展示；……
 *     然後我又跳回 A 分頁時，這不是我第一次來 A 分頁了，所以畫面要停在
 *     我上一次中斷的地方。**這項功能請三個程式都要統一。**」
 *
 * ⚠️ 這一支原本是每次換頁**一律** scrollTo(0, 0)。
 *   「第一次從最上面」是成立的，但「回頭接著上次看」完全沒有——
 *   另外兩支都有（app/view-scroll.ts），三支行為不一致。
 *   2026-09-13 補上，作法與那兩支同一套。
 *
 * ⚠️ 位置要**一邊捲一邊記**，不是「離開分頁時才記」。
 *   離開時才記會踩到：換頁之後文件高度立刻改變，瀏覽器把超出新高度的
 *   捲動位置夾回去，這時候讀到的是被夾過的值——使用者明明停在 2400px，
 *   記下來的卻是 800px。
 *
 * ⚠️ 只活在這一次開著的分頁裡（不寫 localStorage）。重新整理之後每一頁
 *   都算「第一次進來」——重整通常正是「我想重來一次」的意思。
 */
const viewScrollMemory = Object.create(null);
let scrollMemoryView = "";
window.addEventListener(
  "scroll",
  () => {
    if (scrollMemoryView) viewScrollMemory[scrollMemoryView] = window.scrollY;
  },
  { passive: true },
);

function go(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  $("headTitle").textContent = titles[id] || id;
  focusedBlock = "";
  document
    .querySelectorAll(".is-focused")
    .forEach((el) => el.classList.remove("is-focused"));
  document.querySelector("aside").classList.remove("open");
  /*
   * ⚠️ 不可以寫成 `saved || 0`——0 是**合法的記錄**（使用者就停在最上面），
   *   用 || 會把它當成「沒來過」。行為剛好一樣所以看不出來，
   *   但下一個人照抄到別的地方就會出事。用 == null 判斷。
   */
  const saved = viewScrollMemory[id];
  scrollMemoryView = id;
  scrollTo({ top: saved == null ? 0 : saved, behavior: "auto" });
  /*
   * ⚠️ X-62：四張圖各自成一頁之後，**四頁都要重畫**。
   *   只在自己那一頁重畫的話，會踩到一個很難查的坑：
   *   側欄的「有沒有內容」是量高度的，而沒被重畫過的那幾塊高度是 0。
   *   何況這四塊共用同一份彙總，重畫成本一樣。
   */
  if (CHART_VIEWS.includes(id)) {
    renderCharts();
    renderTrendPanel();
    renderBandPanel();
  }
  /* 判定標準頁的兩組設定要在進頁時反映目前計畫的值。 */
  if (id === "standards") {
    renderLosRules?.();
    renderBandRule();
  }
  /*
   * ⚠️ 小分頁要在**畫面切過去之後**才渲染：有些區塊（LOS 圖表那幾塊）是
   *   進頁時才產生或才取消 hidden 的，太早列會因為找不到元素而整組不列。
   */
  requestAnimationFrame(() => renderNavSections(id));
}
/*
 * ⚠️ **點大分頁＝要看那一頁，所以它底下的小分頁一定要展開。**
 *
 *   使用者 2026-09-14（附圖，「路段管理」被選中但小分頁是收的）：
 *     「當我點選 交通服務水準的 大分頁標題(路段管理)時，它並沒有展開
 *       而是保持收合，請修正成自動展開下面的各項小分頁，
 *       如同另外兩個程式一樣的做法」
 *
 *   實測（不是推測）：全新瀏覽器進去是展開的；但只要按過一次那一顆 ▸ 收合鈕，
 *   收合狀態就寫進 localStorage，之後**再怎麼點那個大分頁都不會展開**——
 *   只有再去按一次收合鈕才展得開。使用者當然會以為分頁壞掉了。
 *
 *   所以「切過去」這個動作本身就要把它從收合清單移除。
 *
 * ⚠️ 只掛在**點擊**上，不可以寫進 go() 裡。
 *   go() 在重新整理還原分頁時也會被呼叫，寫進去的話
 *   「重新整理之後還記得收合狀態」（e2e-nav-collapse 第(4)條）就被打掉了。
 *   停在同一頁時按收合鈕照樣收得起來，那才是收合鈕存在的意義。
 */
function gotoView(id) {
  setCollapsed(id, false);
  go(id);
  applyNavCollapse();
}
document
  .querySelectorAll("nav button")
  .forEach((b) => (b.onclick = () => gotoView(b.dataset.view)));
document
  .querySelectorAll("[data-go]")
  .forEach((b) => (b.onclick = () => gotoView(b.dataset.go)));
$("menu").onclick = () => document.querySelector("aside").classList.toggle("open");
document.querySelector(".brand small").textContent = "正式版 v2.20.66";
document.querySelector(".blank-badge").textContent = "瀏覽器本機資料庫";
/*
 * ⚠️ 這裡原本有一顆「列印／另存 PDF」，使用者 2026-09-16 指名移除：
 *   「為何莫名其妙多了這個功能 另存/列印 完全不需要這個」。
 *   新手說明旁邊已經有「下載新手手冊」那一顆，兩顆意思相近、
 *   而瀏覽器本來就有列印功能，不需要程式再放一顆。
 *   ⚠️ 不要再加回來。
 */
/*
 * 完整版新手使用手冊，與網站一起發佈。
 *
 * ⚠️ 這裡原本還有一顆「Word 版」（.docx），2026-09-12 移除。
 *
 *   使用者：「新手手冊只需要做 PDF 檔就好……三個程式都同步，
 *   只需要 PDF 檔就好。」
 *   路口轉向與全日交通量都已經在 2026-09-11 前後改成只出 PDF，
 *   這一支是最後一個還在出 Word 的，現在對齊。
 *
 *   ⚠️ 產生器（manual-src/build-docx.mjs）與 .docx 一併刪除。
 *     只拿掉按鈕、留著檔案的話，包裡會一直帶著一本沒人維護、
 *     內容遲早與 PDF 不一致的手冊。
 *   ⚠️ manual-copies-identical.test.mjs 的意義同時改寫（不是直接刪掉）：
 *     它現在守「只剩 PDF，而且每一份副本同一次產生」，並加了反面守門——
 *     畫面上不可以再冒出 .docx 連結。只刪不守的話，下次照舊樣板補回一顆
 *     按鈕就會連到不存在的檔案（404），而且沒有任何訊息。
 */
const manualLinks = document.createElement("div");
manualLinks.className = "manual-download";
manualLinks.innerHTML =
  /*
   * ⚠️ download 一定要**帶檔名**，不可以只寫 `download`。
   *   沒給值時瀏覽器是從網址推檔名的；單檔試用版把手冊嵌成 data: URI，
   *   那種網址裡沒有檔名，使用者拿到的檔案就叫「下載」。
   *   （使用者 2026-09-14 實際回報過，三支都中。）
   */
  '<a class="primary" href="./manuals/交通服務水準程式手冊_v2.20.66.pdf" download="交通服務水準程式手冊_v2.20.66.pdf" title="手冊是獨立的 PDF，要與本檔放在同一個資料夾">下載新手手冊</a>';
document.querySelector("#guide .title").append(manualLinks);
const manual = document.createElement("div");
manual.className = "manual";
/*
 * ⚠️ 新手說明整頁都是**純說明文字**，依使用者 2026-09-13 的決定不列成小分頁。
 *
 *   我在第四批回報裡把這 12 個小分頁當成「該頁的實質內容」保留，並問了一句
 *   「如果您認為也該拿掉，跟我說一聲我就改」。使用者的回覆是：
 *   「新手使用說明全部小分頁都是說明用的文字，**依照我們說好的，這類不用做成
 *     左側小分頁**」——所以照規則拿掉，我原本的例外不成立。
 *
 * ⚠️ 標記掛在最外層的包裹元素上，裡面每一塊 .panel 都會被 closest() 掃到，
 *   不需要逐塊補；日後手冊加章節也自動涵蓋。
 * ⚠️ 區塊本身**沒有被刪掉**，只是不放進側欄。
 */
manual.setAttribute("data-nav-skip", "explanation");
manual.innerHTML = `<article class="panel manual-intro"><span class="eyebrow">完整工作流程</span><h2>建立計畫 → 匯入核對 → 產出成果</h2><p>每一個計畫的季度資料、速限與判定標準都各自獨立保存，互不影響；換電腦或交接時用專案包帶走。</p></article><div class="manual-grid"><article class="panel"><h3>一、第一次建立 Project</h3><ol><li>進入「計畫設定」，輸入公司計畫編號與完整名稱。</li><li>按「儲存計畫設定」，並確認頁面上方中央顯示正確計畫。</li><li>同一位使用者可建立任意數量計畫，之後從上方選單切換。</li></ol></article><article class="panel"><h3>二、每一季度匯入</h3><ol><li>進入「尖峰批次匯入」，輸入民國年與季度。</li><li>一次選取同一季度的平日、假日 Excel。</li><li>按「讀取並預覽」；每份正常檔案應有4筆。</li><li>確認沒有錯誤或未確認新路段，再按「確認寫入尖峰明細」。</li></ol></article><article class="panel"><h3>三、速限與 LOS</h3><ol><li>進入「路段速限」，核對方向1、方向2的公告速限。</li><li>預設為50 km/h；快慢車道速限不同時，依實際調查車流所使用的道路／車道設定。</li><li>按「套用並重算 LOS」。</li><li>代表值先比較4筆LOS與速限比，再將同一筆紀錄的旅行速率、行駛速率及總延滯一起帶入。</li></ol></article><article class="panel"><h3>四、檢查與圖表判讀</h3><ul><li><b>尖峰明細：</b>查看每路段、日別、上午／下午及兩方向的原始4筆結果。</li><li><b>尖峰彙總：</b>查看每路段日別的最差代表紀錄。</li><li><b>LOS圖表：</b>每路段一張圖，比較歷季平日與假日變化。</li><li><b>資料維護：</b>檢查名稱、4筆資料組、平假日及數值完整性。</li></ul></article><article class="panel"><h3>五、資料錯誤時</h3><ul><li>剛完成的錯誤匯入：到「匯入紀錄」按復原。</li><li>整季需重做：到「資料維護」選擇季度，備份後刪除，再重新匯入。</li><li>路段名稱不一致：到「路段速限」使用「路段名稱修改／合併」。</li><li>疑似新路段：預覽時先判斷是新路段或名稱差異，不確定時不要寫入。</li></ul></article><article class="panel"><h3>六、交出成果</h3><ol><li>確認資料異常檢查通過。</li><li>到「結論草稿產生器」產生分析文字草稿。</li><li>到「LOS 圖表」下載高解析圖片或可編輯的 Excel 圖表。</li><li>到「備份與淨空」下載專案包，做為交付與存檔。</li></ol></article><article class="panel"><h3>七、多人協作方式</h3><p>每位同事在自己的瀏覽器管理任意數量計畫，定期下載專案包交付。要接手別人的計畫時，在「備份與淨空」匯入他的專案包即可；相同計畫編號會被取代，其他計畫不受影響。</p></article><article class="panel"><h3>八、備份與安全</h3><ul><li>每完成一季，下載一次Project專案包。</li><li>換電腦、清除瀏覽器資料或瀏覽器重設前，一定要先備份。</li><li>資料儲存在目前瀏覽器；同一網址在另一台電腦開啟，不會自動看到本機資料。</li><li>專案包支援還原，也可交給同事接手。</li></ul></article><article class="panel"><h3>九、舊版 Excel 相容</h3><p>支援 .xls、.xlsx、.xlsm，以及「上午尖峰／下午尖峰」、「上午／下午」、AM／PM與名稱前後空白。若顯示欄位缺值，先用Excel開啟原始檔、重新計算並儲存，再回網頁預覽。</p></article><article class="panel"><h3>十、每季完成檢核</h3><ol><li>每份檔案4筆且失敗0。</li><li>路段速限已核對並重算。</li><li>資料異常檢查三項為0。</li><li>彙總代表值三項數值來自同一筆。</li><li>圖表路段數正確。</li><li>已下載專案包存檔。</li></ol></article></div>`;
document.querySelector("#guide .warning").before(manual);

/*
 * 「各路段 LOS 圖」的區塊標題。
 *
 * 使用者 2026-09-13：「各路段LOS圖　**標題文字消失了**!!」，
 * 並附上旅行速率那一區的截圖說「**應該要像這樣**有個標題文字才對」。
 *
 * ⚠️ 查下去不是「消失」，是**從來就沒有**：
 *   #chartGrid 在 index.html 裡是一個沒有標題的空 div，
 *   而它的鄰居 #speedTrendGrid 一直都有（下面那一段程式加的）。
 *   同一頁上兩個平行的區塊，一個有標題一個沒有——使用者當然會覺得少了東西。
 *
 * ⚠️ 側欄小分頁列的是「各路段 LOS 圖」，所以這裡的 h2 要用**同一個名字**，
 *   否則點小分頁跳過來會找不到對應的標題。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  相鄰的按鈕一律包進有 gap 的容器
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（附圖）：
 *   「刪除計畫的『刪除單一計畫』和『本機所有計畫』按鍵**黏在一起**了，
 *     請記得用肉眼確認畫面、按鍵是否被裁切或黏住或很接近畫面邊緣等問題。」
 *
 * ⚠️ 他指的那一處只是其中一個。補上守門之後量出來，
 *   「下載目前計畫的專案包／下載個人全部計畫包」與
 *   「下載季度成果包 ZIP／匯出篩選後可編輯 Excel 圖表」也都是 0px——
 *   只是在他的視窗寬度下剛好還沒黏到。
 *
 * ⚠️ 成因都一樣：靠 margin 補間距，而 margin 只補了一個軸。
 *   同一組按鈕在寬視窗並排、窄視窗換行，兩個軸都會用到。
 *   這裡改成**統一由容器的 gap 負責**：掃過每一張卡片，
 *   把相鄰的按鈕包進一個 flex 容器，present 與未來新增的都一體適用。
 */
/*
 * ⚠️ 一定要**重複執行**，不可以只在載入時跑一次：
 *   ・quality-extension.js 比 app.js 晚載入，成果交付那一張卡片當下還不存在
 *   ・renderAll() 會重畫部分卡片，跑一次的話包裝會被洗掉
 *   所以做成冪等的函式（已包好的會被 :closest 濾掉），在載入與每次 renderAll 後各跑一次。
 */
function wrapAdjacentButtons() {
for (const card of document.querySelectorAll(".action-card, .panel.form")) {
  const buttons = [...card.children].filter(
    (el) => el.tagName === "BUTTON" && !el.closest(".card-actions"),
  );
  if (buttons.length < 2) continue;
  /* 只包**連續**的那幾顆；中間隔著說明文字的不要硬併成一列。 */
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const box = document.createElement("div");
      box.className = "card-actions";
      run[0].before(box);
      box.append(...run);
    }
    run = [];
  };
  for (const child of [...card.children]) {
    if (child.tagName === "BUTTON") run.push(child);
    else if (child.className !== "card-actions") flush();
  }
  flush();
}
}
window.addEventListener("load", wrapAdjacentButtons);

const projectLosTitle = document.createElement("div");
projectLosTitle.id = "losChartTitle";
projectLosTitle.className = "title speed-chart-title";
/*
 * ⚠️ 匯出鈕放在**這一塊**的標頭，不放在整頁的主標題旁邊。
 *
 *   使用者 2026-09-14：「右側的『匯出可編輯LOS Excel圖表』，excel 內容是
 *   **只有各路段LOS圖而已**，該匯出按鍵應該做在**與各路段LOS同一區塊**的位置，
 *   而不是放在主標題旁邊，**放主標題旁邊會以為可以下載所有檔案**。
 *   應該要像各路段歷季旅行速率的匯出按鈕位置那樣。」
 *
 *   這是名實相符的問題：擺在主標題旁邊等於宣告「這裡匯出整頁」。
 */
projectLosTitle.innerHTML =
  '<div><span class="eyebrow">LEVEL OF SERVICE</span><h2>各路段 LOS 圖</h2><p>每路段一張圖，平日與假日分色，柱子上方為該季的服務水準等級。</p></div><div class="title-actions"><button class="outline" id="downloadLosPng">下載高解析圖片（PNG）<small>只有圖，不含說明文字</small></button><button class="primary" id="exportProjectLos">匯出可編輯LOS Excel圖表</button></div>';
/*
 * ⚠️ 標題與圖要包成**同一塊**，而且小分頁的錨點指向這一塊。
 *   只把標題插在 #chartGrid 前面的話，點小分頁會捲到 #chartGrid，
 *   標題正好停在畫面上緣之外——那就等於又做了一次「跳轉位置不對」。
 */
const losSection = document.createElement("section");
losSection.id = "losChartSection";
/*
 * ⚠️ 宣告這一塊真的吃哪幾個條件（給守門看）。
 *   它與「各路段歷季旅行速率」走同一支 MT.summariesFor，
 *   季度區間／路段／日別／方向／尖峰五項都會篩——
 *   有時看起來沒動，是因為「先篩再挑最差」之後代表紀錄仍是同一筆，
 *   **不是不適用**。
 */
losSection.dataset.consumes = "periodFrom roads day direction peak";
$("chartGrid").before(losSection);
/*
 * 主工具列的脫離提示與「不適用」說明掛在標題與圖之間。
 * ⚠️ 放在圖**上面**：使用者要先知道「現在看到的是篩過的」，
 *   再看圖；放在圖下面的話他已經先把數字讀進去了。
 */
const losChartNotes = document.createElement("div");
losChartNotes.id = "losChartNotes";
losSection.append(projectLosTitle, losChartNotes, $("chartGrid"));

const projectSpeedTitle = document.createElement("div");
/*
 * ⚠️ 這個 id 是給「沒有資料時要把標題收起來」用的（見 renderTravelCharts）。
 *   側欄的規則是「畫不出高度的一律不列」，標題若永遠留著，
 *   這一塊的高度永遠 > 0，沒有資料時側欄就會列出一個點了什麼都不會動的
 *   小分頁——和按鈕壞掉沒有分別。LOS 那一塊早就這樣處理了，這一塊漏了。
 */
projectSpeedTitle.id = "speedChartTitle";
projectSpeedTitle.className = "title speed-chart-title";
projectSpeedTitle.innerHTML =
  '<div><span class="eyebrow">TRAVEL SPEED</span><h2>各路段歷季旅行速率</h2><p>每路段一張圖，平日與假日分色，數值單位為 km/h。</p></div><div class="title-actions"><button class="outline" id="downloadSpeedPng">下載高解析圖片（PNG）<small>只有圖，不含說明文字</small></button><button class="primary" id="exportProjectCharts">匯出可編輯Excel圖表</button></div>';
const projectSpeedGrid = document.createElement("div");
projectSpeedGrid.id = "speedTrendGrid";
projectSpeedGrid.className = "chart-grid";
/*
 * ⚠️ 要接在 LOS 區塊**後面**，不是接在 #chartGrid 後面——
 *   #chartGrid 現在包在 #losChartSection 裡，用它當基準會把旅行速率
 *   整區塞進 LOS 區塊內部，兩個區塊的標題就對不上自己的圖了。
 */
/*
 * ⚠️ 標題與它的圖要包成**同一塊**（和 LOS 那一塊一樣）。
 *
 *   圖表頁的區塊間距改由父層一個 gap 決定之後，標題與圖若還是兩個
 *   平行的子元素，那個 gap 會插在「各路段歷季旅行速率」的標題與它自己的
 *   圖中間，標題看起來就像跟上一塊黏在一起。包起來就沒有這個問題，
 *   而且小分頁的錨點也才指得到「標題＋圖」整塊。
 */
const speedSection = document.createElement("section");
speedSection.id = "speedTrendSection";
/*
 * ⚠️ 宣告這一塊**真的吃**哪幾個主工具列條件（給守門看，使用者看不到）。
 *
 * 使用者 2026-09-15 的疑問：「上方工具列的尖峰有調整後，歷季旅行速率
 *   趨勢圖並沒有任何說明出現（例如不受尖峰影響），還是其實有受尖峰影響，
 *   只是我沒看出來?」——**是有受影響的**（走 MT.summariesFor →
 *   matchesDetail，季度區間／路段／日別／方向／尖峰五項都篩），
 *   只是「先篩再挑最差」之後代表紀錄有時仍是同一筆，看起來像沒動。
 *
 * ⚠️ 所以這一塊**不可以**掛「不受尖峰影響」——那是讓畫面說謊。
 *   要做的是把目前的口徑標在圖上（見 renderTravelCharts 的抬頭）。
 */
speedSection.dataset.consumes = "periodFrom roads day direction peak";
/*
 * ⚠️ 這一塊要有**自己的**說明容器。
 *
 * 使用者 2026-09-15：「請確保**每個圖表都要有各自的**不適用說明」。
 * 原本兩塊共用掛在 LOS 那一塊裡的一份——捲到旅行速率這一塊時，
 * 說明已經在畫面外，等於沒有。
 */
const speedChartNotes = document.createElement("div");
speedChartNotes.id = "speedChartNotes";
speedSection.append(projectSpeedTitle, speedChartNotes, projectSpeedGrid);
/*
 * ⚠️ X-62：旅行速率已經是自己一個大分頁了，所以掛進 #speedTrend，
 *   不可以再接在 #losChartSection 後面——那會讓它留在 LOS 那一頁上，
 *   而那正是這次要拆掉的「一頁看到別頁的內容」。
 */
$("speedTrend").append(speedSection);
/* 匯出鈕已搬進「各路段 LOS 圖」那一塊的標頭，見上面 projectLosTitle。 */

function setHeaders(selector, labels) {
  document.querySelectorAll(`${selector} thead th`).forEach((th, i) => {
    if (labels[i]) th.textContent = labels[i];
  });
}
setHeaders("#detail", [
  "期間",
  "路段",
  "日別",
  "尖峰",
  "方向",
  "旅行速率（km/h）",
  "行駛速率（km/h）",
  "總延滯（秒）",
  "速限（km/h）",
  "LOS",
]);
setHeaders("#summary", [
  "期間",
  "路段",
  "日別",
  "代表尖峰",
  "代表方向",
  "旅行速率（km/h）",
  "行駛速率（km/h）",
  "總延滯（秒）",
  "速限比",
  "LOS",
]);
/**
 * 這兩顆鈕匯出的資料範圍。
 *
 * ⚠️ 升級前它們直接拿 `state.summaries`——那是**完全沒有篩過**的代表值，
 *   而這兩顆鈕就掛在「各路段 LOS 圖」與「各路段歷季旅行速率」的標題列上，
 *   那兩塊上面白紙黑字寫著「目前畫的是：<主工具列條件>」。
 *   結果是：畫面上只剩 1 條路段、1 季，下載下來的檔案卻是整個計畫的
 *   每一季每一條路段——而且連代表值都可能不同（方向／尖峰縮小時，
 *   「先篩再挑最差」挑出來的那一筆會換人）。
 * ⚠️ 用 "__main__" 而不是那兩塊的 chart id：交出去的檔案一律吃主工具列
 *   （使用者 2026-09-14 的規則），不跟著區塊的脫離跑。
 */
function exportScopeRows() {
  return MT.summariesFor(
    state.details.filter((row) => row.projectCode === state.activeCode),
    "__main__",
    worstOfGroup,
    "range",
  );
}
/** 檔名要寫得出範圍，否則兩種條件下載出來會是同名檔、後者蓋掉前者。 */
function exportScopeSuffix() {
  const f = MT.filtersOf("__main__");
  const roads = f.roads || [];
  return [
    f.periodFrom && f.periodTo
      ? showQuarter(f.periodFrom) +
        (f.periodFrom === f.periodTo ? "" : "至" + showQuarter(f.periodTo))
      : "",
    roads.length === 1 ? roads[0] : roads.length ? roads.length + "條路段" : "",
    f.day === "weekday" ? "平日" : f.day === "holiday" ? "假日" : "",
  ]
    .filter(Boolean)
    .join("_");
}
$("exportProjectCharts").onclick = async () => {
  const p = activeProject(),
    rows = exportScopeRows();
  if (!p || !rows.length) return toast("目前條件下沒有可匯出的旅行速率資料");
  try {
    const suffix = exportScopeSuffix();
    await exportTravelWorkbook(
      rows,
      `${p.code}_${p.name}_旅行速率趨勢圖${suffix ? "_" + suffix : ""}.xlsx`,
    );
    toast("可編輯Excel圖表已下載（依主工具列目前的條件）");
  } catch (e) {
    toast(e.message || "Excel匯出失敗");
  }
};
$("exportProjectLos").onclick = async () => {
  const p = activeProject(),
    rows = exportScopeRows();
  if (!p || !rows.length) return toast("目前條件下沒有可匯出的LOS資料");
  try {
    const suffix = exportScopeSuffix();
    await exportLosWorkbook(
      rows,
      `${p.code}_${p.name}_LOS趨勢圖${suffix ? "_" + suffix : ""}.xlsx`,
    );
    toast("可編輯LOS Excel圖表已下載（依主工具列目前的條件）");
  } catch (e) {
    toast(e.message || "LOS Excel匯出失敗");
  }
};
const logButton = document.createElement("button");
logButton.dataset.view = "importlog";
logButton.textContent = "匯入紀錄";
/*
 * ⚠️ 原本是掛在「Manager 比較」按鈕後面。Manager 於 2026-09-13 依使用者
 *   決定整組移除（「裡面的趨勢圖各計畫已經都有了，Manager 只是畫在同一張
 *   圖而已，沒有實質意義」），那顆按鈕不存在了——沿用舊錨點會讓
 *   querySelector 回 null，整支 app.js 停在這一行，**全站所有功能都不會掛上**
 *   （畫面長得出來，但每一顆按鈕都沒有反應，而且沒有任何錯誤訊息）。
 */
/* ⚠️ X-62：原本接在 data-view="charts" 後面；那顆鈕已拆成四顆，改接最後一顆。 */
document.querySelector('nav button[data-view="bandChart"]').after(logButton);
logButton.onclick = () => gotoView("importlog");
const logSection = document.createElement("section");
logSection.id = "importlog";
logSection.className = "view";
logSection.innerHTML = `<div class="title"><div><span class="eyebrow">AUDIT & ROLLBACK</span><h2>匯入批次紀錄</h2><p>每次正式寫入都保留新增、更新、略過與復原資訊。</p></div></div><div class="panel"><div class="filters"><span id="importLogCount">0 個批次</span></div><div class="table-wrap"><table><thead><tr><th>匯入時間</th><th>計畫</th><th>期間</th><th>檔案</th><th>新增</th><th>更新</th><th>略過</th><th>狀態</th><th>操作</th></tr></thead><tbody id="importLogRows"></tbody></table></div></div>`;
document.querySelector("#backup").before(logSection);
const maintenanceButton = document.createElement("button");
maintenanceButton.dataset.view = "maintenance";
maintenanceButton.textContent = "資料維護";
document.querySelector('nav button[data-view="backup"]').before(maintenanceButton);
maintenanceButton.onclick = () => gotoView("maintenance");
const maintenanceSection = document.createElement("section");
maintenanceSection.id = "maintenance";
maintenanceSection.className = "view";
/*
 * ⚠️ X-59（使用者 2026-09-17）：「執行資料異常檢查 如果也是一個大分頁，
 *   就應該增加在左側欄位，但左側欄位沒有看到這個標題……請三支同步。」
 *
 *   這一支原本把那顆按鈕放在**頁面抬頭那一列**（.title 裡）。抬頭不是一塊
 *   面板，而 sectionsFor 掃的是 `.panel` 與 `.chart-grid`，所以它永遠長不出
 *   小分頁——側欄看不到這一頁的第一步，而沒按它，下面的「資料異常檢查摘要」
 *   與「檢查結果」都是空的。
 *
 *   改成自己一塊 `.panel#quality-run`（id 與另外兩支逐字相同），
 *   按鈕**沿用原本的 id runHealth**，所以 app.js 的 onclick 綁定與
 *   六支 e2e 的 `#runHealth` 選擇器一個字都不必改。
 *
 * ⚠️ 抬頭那一列不可以再留一顆同 id 的按鈕：同一份文件兩個相同 id 是不合法的
 *   HTML，而 `$("runHealth")` 只會拿到第一顆——使用者按到的那一顆可能根本
 *   沒有綁到事件。
 * ⚠️ 列印時要跟著隱藏：原本它吃的是 `@media print` 裡的 `.title button`，
 *   搬出來之後那條規則就管不到它了（styles.css 已一併補上）。
 */
maintenanceSection.innerHTML = `<div class="title"><div><span class="eyebrow">MAINTENANCE</span><h2>資料維護與資料異常檢查</h2><p>匯錯季度可整季刪除重匯；資料異常檢查只列出需要注意的資料。</p></div></div><article class="panel maintenance-run" id="quality-run"><h3>執行資料異常檢查</h3><p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：檢查一律掃這個計畫的全部資料——先篩再檢查的話，被篩掉的地方有問題就永遠檢查不到。</p><p class="muted">按下去才會產生下方的「資料異常檢查摘要」與「檢查結果」。匯入時的即時提醒是另一件事（那是寫入前的預防），這一頁看的是目前資料庫裡的現況。修正問題之後再按一次，就能確認異常是不是真的消掉了。</p><button class="primary" id="runHealth">執行資料異常檢查</button></article><div class="two"><article class="panel form" id="maintenance-rename-quarter"><h3>季度改名</h3><p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：改的是「整個季度」的名稱，不是畫面上篩出來的那一份。</p><p class="muted">季度是匯入時手打的，打錯不必刪掉重匯。改名會一併更新尖峰明細、匯入紀錄、判定門檻與三段分法的季別覆寫。<b>不會</b>把兩季合併：新名稱如果已經存在，系統會擋下來請你自己決定。</p><label>要改名的季度<select id="renamePeriod"></select></label><label>新的季度名稱<input id="renamePeriodInput" placeholder="例如115Q2或2026Q2" autocomplete="off"></label><div class="note" id="renameImpact">目前沒有可改名的季度</div><button class="primary full" id="renameQuarter" disabled>儲存新名稱</button></article><article class="panel form" id="maintenance-delete-quarter"><h3>刪除單一季度</h3><p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：刪除的是「整個季度」的原始資料，不是畫面上篩出來的那一份。</p><p class="muted">執行前會先下載目前 Project 專案包，刪除後可從匯入紀錄還原。</p><label>選擇季度<select id="deletePeriod"></select></label><div class="note" id="deleteImpact">目前沒有可刪除的季度</div><button class="danger-button full" id="deleteQuarter" disabled>備份後刪除此季度</button></article><article class="panel"><h3>資料異常檢查摘要</h3><p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：異常檢查一律掃這個計畫的全部資料——被篩掉的地方有問題就永遠檢查不到。</p><div class="metrics compact"><article><span>異常名稱</span><b id="healthNames">0</b></article><article><span>資料組不完整</span><b id="healthGroups">0</b></article><article><span>數值異常</span><b id="healthValues">0</b></article></div><button class="outline full" id="cleanSuffix" disabled>備份後修正明顯日期尾碼</button></article></div><div class="panel health-panel" id="health-result"><p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：檢查結果列的是全部資料裡需要注意的項目，用下方的類型標籤篩選。</p><div class="panel-head"><div><h3>檢查結果</h3><small>只列出需要注意的資料；可用下方標籤依類型篩選。</small></div><span id="healthCount">尚未檢查</span></div><div class="anomaly-chips" id="healthTypeChips"></div><div class="table-wrap"><table><thead><tr><th>類型</th><th>期間</th><th>路段／項目</th><th>說明</th><th>解決方式</th></tr></thead><tbody id="healthRows"><tr><td colspan="5" class="empty">按「執行資料異常檢查」開始</td></tr></tbody></table></div></div>`;
document.querySelector("#backup").before(maintenanceSection);
const policyBox = document.createElement("label");
/*
 * ⚠️ 版面交給樣式表，**不要寫行內 style**。
 *
 *   使用者 2026-09-14（附圖）：「這裡的確認鍵佔的比例太大了，
 *   會遮擋到資料匯入後使用者確認每筆資料的空間」。
 *
 *   成因是這一段的行內 `display:block` ＋ `width:100%` ＋ `margin:14px 0`：
 *   動作列改成黏在區塊底緣之後，這三樣把它撐成三列、約 250px 高，
 *   等於在預覽表上永遠蓋著四分之一個畫面。
 *   行內 style 還會蓋掉樣式表，從 CSS 那邊怎麼改都沒用——所以拔掉。
 */
policyBox.className = "preview-policy";
policyBox.innerHTML =
  '重複資料處理<select id="duplicatePolicy"><option value="update">更新既有資料（建議）</option><option value="skip">略過既有資料</option></select>';
document.querySelector("#commit").before(policyBox);
const projectSwitch = document.createElement("select");
projectSwitch.id = "projectSwitch";
projectSwitch.className = "project-switch";
document.querySelector("header .blank-badge").before(projectSwitch);
/*
 * 期別顯示切換：季別（115Q1）⇄ 實際調查月份（115年2、3月）。
 * 只換畫面上的文字；分組、排序、計算與匯出的數值一律不受影響。
 */
const periodDisplayButton = document.createElement("button");
periodDisplayButton.type = "button";
periodDisplayButton.id = "periodDisplayToggle";
periodDisplayButton.className = "period-display-toggle";
periodDisplayButton.dataset.testid = "period-display-toggle";
periodDisplayButton.onclick = async () => {
  state.periodDisplay = state.periodDisplay === "month" ? "quarter" : "month";
  renderPeriodDisplayToggle();
  await save();
  renderAll();
};
document.querySelector("header .blank-badge").before(periodDisplayButton);
/*
 * 年份顯示切換：民國年（115Q1）⇄ 西元年（2026Q1）。
 * 同樣只換畫面與匯出檔上的文字；儲存值一律是民國年，切換不會動到任何數字，
 * 也不會影響分組、排序與識別鍵。
 */
const yearStyleButton = document.createElement("button");
yearStyleButton.type = "button";
yearStyleButton.id = "yearStyleToggle";
yearStyleButton.className = "period-display-toggle";
yearStyleButton.dataset.testid = "year-style-toggle";
yearStyleButton.onclick = async () => {
  state.yearStyle = state.yearStyle === "ad" ? "roc" : "ad";
  renderYearStyleToggle();
  await save();
  renderAll();
};
document.querySelector("header .blank-badge").before(yearStyleButton);
/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列（使用者 2026-09-14 指定，三支程式共用同一套三態機制）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一條列在**每一頁**都看得到。升級前這一支程式完全沒有跨頁的條件：
 *   同一組（季度／路段／日別）要在歷季趨勢、三段分法、成果交付、
 *   品質總覽**各設一次**，而「各路段 LOS 圖」與「各路段歷季旅行速率」
 *   根本沒有條件可設，永遠畫全部路段、全部季度（實測 2026-09-14）。
 *
 * ⚠️ 「回歸全部」**只有在真的有區塊脫離時才出現**。
 *   沒有人脫離時擺一顆按下去毫無反應的鈕＝壞掉的鈕，這是我們踩過的雷。
 *   而且字要寫出**有幾塊**——使用者才知道按下去會影響多少東西。
 */
const MT = globalThis.LosMainToolbar;
const MF = globalThis.LosMainFilters;
/**
 * 使用者有沒有自己動過主工具列的季度。
 *
 * ⚠️ 沒動過之前，季度一律跟著「最新一季」走；動過之後就不再自動跟隨
 *  （否則每匯入一季，他設好的區間就被擦掉一次）。
 *   這與匯入表單的 importPeriodTouched 是同一個道理，不是兩套機制。
 */
let mainPeriodTouched = false;
const mainToolbar = document.createElement("div");
mainToolbar.className = "main-toolbar";
mainToolbar.dataset.testid = "main-toolbar";
document.querySelector("main header").after(mainToolbar);
/*
 * ══════════════════════════════════════════════════════════════════════
 *  把主工具列的**實際高度**寫進 CSS 變數 --main-toolbar-h
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼一定要量、不能寫死：
 *   ・主工具列可以收合（收合約 42px、展開 100～140px）
 *   ・視窗窄的時候欄位會換行，高度再往上長
 *   ・條件多寡也會影響（例如「回歸全部（N 塊）」那一顆有時候在、有時候不在）
 *
 * ⚠️ 2026-09-15 查到的既有缺陷：`.figure-row>.trend-figure` 的
 *   `top` 寫死 84px（＝標題列 72 ＋ 12），那是**主工具列還沒加進來之前**
 *   算的。主工具列常駐之後，歷季趨勢圖與三段分法圖捲動時上緣會被它切掉——
 *   與使用者先前回報的「標題文字消失」是同一個症狀。
 *   寫死一個新數字一樣錯：收合時留一大段空白、展開時又被切掉。
 *
 * ⚠️ ResizeObserver 讀不到（很舊的瀏覽器）時**不可以整支壞掉**：
 *   量不到就維持 0px，sticky 只是位置略高，不影響任何資料。
 */
function trackMainToolbarHeight() {
  const write = () => {
    const height = Math.round(mainToolbar.getBoundingClientRect().height);
    document.documentElement.style.setProperty(
      "--main-toolbar-h",
      `${height}px`,
    );
  };
  write();
  try {
    new ResizeObserver(write).observe(mainToolbar);
  } catch {
    /* 沒有 ResizeObserver 就退回「每次重畫時量一次」，見 renderMainToolbar()。 */
  }
  /* 視窗寬度變了會換行，高度跟著變——ResizeObserver 會收到，這裡是雙保險。 */
  globalThis.addEventListener?.("resize", write);
  return write;
}
const writeMainToolbarHeight = trackMainToolbarHeight();
/*
 * ⚠️ 只呼叫 renderAll——它自己第一行就會重畫主工具列。
 *   兩邊都畫的話會畫兩次（無害但浪費），而且日後只改其中一邊會分岔。
 */
MT.state.onChange = () => {
  renderAll();
};
/** 目前這個計畫有資料的季度（由小到大）。 */
function mainToolbarPeriods() {
  const own = state.details.filter((x) => x.projectCode === state.activeCode);
  return [...new Set(own.map((x) => x.period))].sort(
    (a, b) => periodIndex(a) - periodIndex(b),
  );
}
/** 目前這個計畫在主工具列季度區間內有資料的路段。 */
function mainToolbarRoads() {
  const own = state.details.filter((x) => x.projectCode === state.activeCode);
  return [...new Set(own.map((x) => x.road))].sort((a, b) =>
    String(a).localeCompare(String(b), "zh-Hant"),
  );
}
/**
 * 主工具列的季度預設值：起＝**最早**一季、迄＝**最新**一季（2026-09-15 起）。
 *
 * ⚠️ 不是「起＝迄＝最新一季」。起＝迄現在代表**只有那一季**，
 *   拿它當預設等於一開機就把所有歷季圖壓成一個點。
 *
 * ⚠️ 使用者主動拉開之後就不再自動跟隨，否則他每匯入一季，
 *   自己設好的區間就被擦掉一次。清單裡沒有那一季（換計畫、刪季度）時
 *   要拉回來，不然會停在一個不存在的季度上，畫出空圖。
 */
function syncMainToolbarPeriods() {
  const list = mainToolbarPeriods();
  /* ⚠️ 舊存檔的 "all" 要先正規化，否則下拉會選不到任何一項（顯示成空白）。 */
  const main = MF.normalizeLegacyAll(MT.state.main);
  if (!list.length) {
    main.periodFrom = "";
    main.periodTo = "";
    return;
  }
  /*
   * ⚠️ 預設是**起＝最早一季、迄＝最新一季**（使用者 2026-09-15 定案）。
   *
   *   舊版預設起＝迄＝最新一季，而且把「起＝迄」在歷季類區塊上解釋成
   *   「不限季」，好讓趨勢圖預設畫得出全部季度。那是**用錯誤的語意去補
   *   預設值的問題**：使用者的定義是「起＝迄就是只有那一季」
   *  （「你一開始說的起＝迄代表不限季是錯誤的」）。
   *
   *   改成預設涵蓋全部季度之後，兩件事同時成立：
   *     ・預設狀態下歷季圖照樣畫全部季度（因為區間本來就是全部）
   *     ・起＝迄時**真的只看那一季**，三支語意一致
   *
   * ⚠️ 只有一季的計畫，起迄就都是那一季——那也是單季的意思，
   *   圖上就一個點。使用者：「總不能這個計畫只有一季的資料，
   *   圖片卻顯示空白吧」。
   *
   * ⚠️ 他主動改過之後就不再自動跟隨，否則每匯入一季，
   *   自己設好的區間就被擦掉一次。
   */
  const earliest = list[0];
  const latest = list[list.length - 1];
  if (!mainPeriodTouched) {
    main.periodFrom = earliest;
    main.periodTo = latest;
  }
  if (!list.includes(main.periodTo)) main.periodTo = latest;
  if (!list.includes(main.periodFrom)) main.periodFrom = earliest;
  /* 起比迄晚是不合法的區間，靜靜地畫空圖最糟——直接對調回來。 */
  if (periodIndex(main.periodFrom) > periodIndex(main.periodTo)) {
    const swap = main.periodFrom;
    main.periodFrom = main.periodTo;
    main.periodTo = swap;
  }
  /* 路段清單換了（換計畫）時，選到的路段要清掉，否則會篩出 0 筆。 */
  const roads = mainToolbarRoads();
  main.roads = (main.roads || []).filter((road) => roads.includes(road));
}
/**
 * 主工具列是展開還是收起。
 *
 * ⚠️ X-78（使用者 2026-09-17）：**預設收合**，而且**不記住**。
 *
 *   使用者的原話是「重新載入或第一次開網頁時，主工具列是否能預設為收合狀態。
 *   下方版面比較清楚」——他要的是**每一次開啟**都收合，
 *   所以記住狀態反而做不到他要的事：只要展開過一次，下一次開啟就不是收合的了。
 *   因此狀態只留在記憶體，localStorage 那個鍵一併清掉
 *  （留著只寫不讀是死碼，下一個人會以為它還有作用）。
 *
 *   舊註解寫「預設收合的話第一次使用的人看不到有哪些條件可以調」——
 *   那個顧慮由收合列上那一句條件摘要解決：收起來也永遠寫著目前的條件，
 *   而且展開鈕就在旁邊。三支同步。
 */
let mainToolbarOpenState = false;
function mainToolbarOpen() {
  return mainToolbarOpenState;
}
function setMainToolbarOpen(next) {
  mainToolbarOpenState = Boolean(next);
}
function renderMainToolbar() {
  syncMainToolbarPeriods();
  /* ⚠️ 舊存檔的 "all" 要先正規化，否則下拉會選不到任何一項（顯示成空白）。 */
  const main = MF.normalizeLegacyAll(MT.state.main);
  const periods = mainToolbarPeriods();
  const roads = mainToolbarRoads();
  MT.state.periods = periods;
  MT.state.roads = roads;
  MT.state.label = showQuarter;
  const detached = MF.detachedIds(MT.state.overrides);
  const option = (value, label, selected) =>
    `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const rangeOpen =
    main.periodFrom && main.periodTo && main.periodFrom !== main.periodTo;
  /*
   * ── 收合 ──────────────────────────────────────────────────
   *
   * 使用者 2026-09-15：「固定在上方隨時可見，只是會做著展開的按鈕，
   * 避免版面佔用過大」。
   *
   * ⚠️ 收起來的時候**不可以什麼都看不到**：收合列上永遠寫著目前的條件，
   *   而且「回歸全部」也留在收合列上——那一顆的用途正是
   *   「有區塊脫離了、而它可能捲在很下面看不到」。
   * ⚠️ 預設**展開**，但記住使用者的選擇。
   */
  const open = mainToolbarOpen();
  mainToolbar.className = open ? "main-toolbar" : "main-toolbar is-collapsed";
  mainToolbar.dataset.open = String(open);
  /*
   * ⚠️ 收合箭頭只能用 ▼（U+25BC，Big5 A1B9），靠 CSS 轉 90 度表示「收合」。
   *   **不可以用 ▾（U+25BE）或 ▸（U+25B8）**：那兩個字不在 Big5 字集裡，
   *   而網頁字型是微軟正黑體，它沒有那兩個字的字形，實機上畫出來是**空白**
   *   （不是豆腐框），看起來像「箭頭根本沒做」。
   *   使用者 2026-09-11 就回報過同一個坑（匯出備份旁邊的箭頭看不到）。
   *   全日交通量的 scripts/glyph-guard.mjs 是這一條的守門，三支同一套寫法。
   */
  const bar = `<div class="main-toolbar-bar">
        <button type="button" class="mt-toggle" data-testid="mt-toggle" id="mtToggle" aria-expanded="${open}"><i aria-hidden="true"${
          open ? "" : ' class="is-collapsed"'
        }>▼</i>主工具列收合</button>
        <span class="mt-summary" data-testid="mt-summary">${esc(
          /* ⚠️ 收合起來時這一句是使用者唯一看得到的條件，季度寫法要跟全頁一致。 */
          MF.describeMain(main, showQuarter),
        )}</span>${
          /*
           * ── X-10：一鍵把主工具列的條件回到預設 ──────────────────
           *
           * 使用者 2026-09-16：「主工具列少了一個按鍵功能，就是恢復預設選項按鍵，
           *   請在三份程式的主工具列新增一個按鍵，讓使用者可以按下後，
           *   一鍵恢復主工具列各項篩選條件恢復到預設值」。
           *
           * ⚠️ 這一顆與「回歸全部」是**兩件事**，文字要讓人分得出來：
           *   ・這一顆改的是**主工具列自己的值**（季度、路段、日別、方向、尖峰）
           *   ・「回歸全部」是把**脫離的區塊**拉回來跟隨主工具列
           *   所以按了這一顆**不會**動到任何脫離中的區塊。
           *
           * ⚠️ 條件本來就是預設值時**不出現**。主工具列要簡潔（使用者原則：
           *   「除非有說明的必要，不然能不要就不要」），而按了不會有任何事的
           *   按鈕正是那種噪音。
           */
          MT.isMainDefault(main, periods)
            ? ""
            : `<button type="button" class="mt-reset-main" data-testid="mt-reset-main" id="mtResetMain" title="把季度、路段、日別、方向與尖峰通通回到預設；不會動到正在用自己條件的區塊">恢復預設條件</button>`
        }${
          detached.length
            ? /*
               * ── L-2：一次性全部回歸，但看得到「是哪幾塊」───────────────
               *
               * 使用者 2026-09-15：「主工具列跳出全部回歸鈕時，上面會寫目前共
               *   N 項要回歸，你覺得要提供使用者選擇哪幾個回歸嗎？還是為了
               *   主工具列簡化目的，一次性全部回歸才是最實用的方式？」
               *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾塊**。
               *
               * ⚠️ 做成**浮動小卡**（position:absolute），不是展開的清單。
               *   使用者原話：「我怕展開時候，整個主工具列會被擠的超大」。
               *   浮動小卡不佔版面，工具列高度完全不變。
               *
               * ⚠️ 清單**只看、不勾選**。要單獨回歸某一塊，那一塊自己旁邊就有
               *   「回到主工具列條件」——比在這裡找一個勾選清單直覺得多，
               *   而且主工具列要簡潔（使用者原則：「能不要就不要」）。
               */
              `<span class="mt-detached">
                <button type="button" class="mt-reset-all" data-testid="mt-reset-all" id="mtResetAll">回歸全部（${detached.length} 塊正在用自己的條件）</button>
                <button type="button" class="mt-detached-toggle" data-testid="mt-detached-toggle" id="mtDetachedToggle" aria-expanded="false" aria-controls="mtDetachedPop">看是哪幾塊<i aria-hidden="true">▼</i></button>
                <div class="mt-detached-pop" data-testid="mt-detached-pop" id="mtDetachedPop" hidden></div>
              </span>`
            : ""
        }
      </div>`;
  mainToolbar.innerHTML = periods.length
    ? bar + `<div class="main-toolbar-row"${open ? "" : " hidden"}>
        <label class="mt-field"><span>季度（起）</span><select data-testid="mt-period-from" id="mtPeriodFrom">${periods
          .map((p) => option(p, showQuarter(p), p === main.periodFrom))
          .join("")}</select></label>
        <label class="mt-field"><span>季度（迄）</span><select data-testid="mt-period-to" id="mtPeriodTo">${periods
          .map((p) => option(p, showQuarter(p), p === main.periodTo))
          .join("")}</select></label>
        <!--
          ⚠️ 這裡**刻意不放**「區間已拉開…」那句說明。
          使用者 2026-09-15（附圖，紅框圈出那一句）：「這段說明文字因為在不會顯示的
          圖表，已經會有相同的提示了，在主工具列就不用這些提示，主工具列主要就是要簡潔」。
          真正需要提醒的是**那張圖自己**（「季度區間已拉開：這兩張圖畫的是區間內的季度」），
          那一句仍然掛在各區塊上，不是被拿掉。
        -->
        <!--
          ⚠️ 路段改成**下拉式**多選（使用者 2026-09-15：「請將交通服務水準程式和
          路口轉向程式主工具列的 路段/路口，變成跟全日交通量格式（下拉式）一樣」）。

          為什麼不用 <select multiple>：它一定要撐開好幾列才看得到選項，
          主工具列整條的高度被它決定；多選要按住 Ctrl，沒有人看得出來；
          而且「已選幾個」只能靠反白看。下拉式一列就夠，按鈕上直接寫「已選 N 個」。

          ⚠️ 一個都不勾＝全部，不是全部排除。面板底下那一行就是在講這件事，不可以拿掉。
        -->
        <div class="mt-field"><span class="mt-field-label">路段</span>
          <div class="multi-picker" id="mtRoadsBox">
            <button type="button" class="multi-picker-btn${
              (main.roads || []).length ? " on" : ""
            }" data-testid="mt-roads" id="mtRoads" aria-expanded="false" data-count="${roads.length}"><span>${esc(
              (main.roads || []).length === 0
                ? "全部路段"
                : (main.roads || []).length === 1
                  ? main.roads[0]
                  : `已選 ${(main.roads || []).length} 個`,
            )}</span><i aria-hidden="true">▼</i></button>
            <div class="multi-picker-panel" id="mtRoadsPanel" hidden>
              <div class="multi-picker-head">
                <button type="button" data-roads-all="1">全部路段</button>
                <button type="button" data-roads-every="1">全選</button>
              </div>
              <div class="multi-picker-list">${
                roads.length
                  ? roads
                      .map(
                        (r) =>
                          `<label><input type="checkbox" data-road="${esc(r)}"${
                            (main.roads || []).includes(r) ? " checked" : ""
                          }><span>${esc(r)}</span></label>`,
                      )
                      .join("")
                  : '<p class="multi-picker-empty">沒有可選的項目</p>'
              }</div>
              <div class="multi-picker-foot">一個都不勾＝全部路段</div>
            </div>
          </div>
        </div>
        <label class="mt-field"><span>日別</span><select data-testid="mt-day" id="mtDay">${MF.DAY_CHOICES.map(
          (k) => option(k, MF.DAY_LABELS[k], k === main.day),
        ).join("")}</select></label>
        <label class="mt-field"><span>方向</span><select data-testid="mt-direction" id="mtDirection">${MF.DIRECTION_CHOICES.map(
          (k) => option(k, MF.DIRECTION_LABELS[k], k === main.direction),
        ).join("")}</select></label>
        <label class="mt-field"><span>尖峰</span><select data-testid="mt-peak" id="mtPeak">${MF.PEAK_CHOICES.map(
          (k) => option(k, MF.PEAK_LABELS[k], k === main.peak),
        ).join("")}</select><small class="mt-note" data-testid="mt-peak-note">${
          main.peak === "representative"
            ? "代表尖峰＝同一組資料裡服務水準最差的那一筆，上午或下午、哪一個方向都由系統取。"
            : "已指定尖峰；彙總的代表值會從符合條件的那幾筆裡再挑最差。"
        }</small></label>
      </div>`
    : bar +
      `<div class="main-toolbar-row"${
        open ? "" : " hidden"
      }><small class="mt-note">目前這個計畫還沒有尖峰明細，主工具列沒有東西可以篩。</small></div>`;
  const from = $("mtPeriodFrom");
  if (from)
    from.onchange = (e) => {
      mainPeriodTouched = true;
      MT.setMain("periodFrom", e.target.value);
    };
  const to = $("mtPeriodTo");
  if (to)
    to.onchange = (e) => {
      mainPeriodTouched = true;
      MT.setMain("periodTo", e.target.value);
    };
  /*
   * 路段下拉（多選面板）。
   *
   * ⚠️ 面板開著時**不可以**重畫主工具列，否則使用者每勾一個就被關掉一次。
   *   所以勾選時只更新條件與按鈕文字，面板留在原地；點外面或按 Esc 才收。
   */
  const roadsBox = $("mtRoadsBox");
  if (roadsBox) {
    const button = $("mtRoads");
    const panel = $("mtRoadsPanel");
    const current = () => (MT.state.main.roads || []).slice();
    const paint = () => {
      const picked = current();
      button.classList.toggle("on", picked.length > 0);
      button.querySelector("span").textContent =
        picked.length === 0
          ? "全部路段"
          : picked.length === 1
            ? picked[0]
            : `已選 ${picked.length} 個`;
      for (const box of panel.querySelectorAll("input[data-road]"))
        box.checked = picked.includes(box.dataset.road);
    };
    const close = () => {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    button.onclick = (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    };
    panel.onclick = (e) => {
      e.stopPropagation();
      if (e.target.dataset.roadsAll) {
        MT.setMain("roads", []);
        paint();
        return;
      }
      if (e.target.dataset.roadsEvery) {
        MT.setMain(
          "roads",
          [...panel.querySelectorAll("input[data-road]")].map(
            (box) => box.dataset.road,
          ),
        );
        paint();
        return;
      }
      const box = e.target.closest("input[data-road]");
      if (!box) return;
      const picked = current();
      MT.setMain(
        "roads",
        box.checked
          ? [...picked, box.dataset.road]
          : picked.filter((r) => r !== box.dataset.road),
      );
      paint();
    };
    document.addEventListener("mousedown", (e) => {
      if (!panel.hidden && !roadsBox.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  const day = $("mtDay");
  if (day) day.onchange = (e) => MT.setMain("day", e.target.value);
  const direction = $("mtDirection");
  if (direction) direction.onchange = (e) => MT.setMain("direction", e.target.value);
  const peak = $("mtPeak");
  if (peak) peak.onchange = (e) => MT.setMain("peak", e.target.value);
  const resetMain = $("mtResetMain");
  if (resetMain)
    resetMain.onclick = () => {
      /*
       * ⚠️ 要把 mainPeriodTouched 一起放掉，否則 syncMainToolbarPeriods()
       *   會認為「使用者自己設過區間」而不肯把起迄拉回最早～最新——
       *   按了之後季度那兩格原封不動，看起來就像按鈕壞了。
       */
      mainPeriodTouched = false;
      MT.resetMain();
    };
  const resetAll = $("mtResetAll");
  if (resetAll)
    resetAll.onclick = () => {
      /* 回歸全部之後清單本身就沒有意義了，順手把小卡關掉。 */
      closeDetachedPop();
      MT.resetAll();
    };
  wireDetachedPop();
  const toggle = $("mtToggle");
  if (toggle)
    toggle.onclick = () => {
      setMainToolbarOpen(!mainToolbarOpen());
      renderMainToolbar();
    };
  /*
   * ⚠️ 每次重畫都要把高度重量一次。
   *   ResizeObserver 通常會自己收到，但它是**非同步**的（下一個影格才送到），
   *   而重畫之後緊接著就可能有程式去讀 --main-toolbar-h（例如捲到某一塊）。
   *   這裡同步量一次，讓「剛重畫完」那一瞬間的值也是對的。
   */
  writeMainToolbarHeight();
}
/*
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——列出**是哪幾塊**正在用自己的條件
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 名稱與落點**不寫死成一張對照表**，而是從畫面上長出來。
 *
 *   每一個脫離的區塊本來就掛著 `[data-detached-chart="<id>"]` 那條說明，
 *   往上找到它所屬的面板、讀那個面板的標題，就是使用者看到的名字。
 *   寫死對照表的話，改一次標題就要記得改兩個地方——而「同一件事寫在
 *   兩個地方就會漂移」是這個專案已經踩過好幾次的坑。
 *
 * ⚠️ 脫離的區塊可能在**別的分頁**上。分頁是 display:none 但仍在 DOM 裡，
 *   所以找得到；點名稱時要先換頁再捲過去，否則捲到一個看不見的東西。
 *
 * ⚠️ 2026-09-16 使用者回報：小卡上出現英文 id「detail-table」。
 *   原因是只往上找**一層**（第一個 .panel／section[id]／.chart-grid）就放棄：
 *   尖峰明細那一塊的 `.panel` 沒有 id 也沒有 h3，於是退回顯示 id。
 *   而 CHART_IDS 七塊裡只有 summary-table 真的有同名元素，其餘全靠往上找，
 *   所以那不是尖峰明細一塊的問題，是**每一塊都可能露出英文 id**。
 *   → 改成**一層一層往上找到有標題為止**（最遠到該分頁的 .title h2）。
 *   ⚠️ 仍然不可以改成寫死的對照表：標題改名過好幾次，寫兩份一定會漂移。
 */
/** 這一層自己的標題（不看子區塊的標題，否則會抓到隔壁那一塊的名字）。 */
function blockHeadingText(block) {
  const heading = block.querySelector(
    ":scope > .panel-head h3, :scope > .panel-head h2," +
      " :scope > .panel-head > div > h3, :scope > .panel-head > div > h2," +
      " :scope > h3, :scope > h2," +
      " :scope > .title h3, :scope > .title h2," +
      " :scope > summary",
  );
  return heading ? (heading.textContent || "").replace(/\s+/g, " ").trim() : "";
}
function detachedBlocks() {
  return MF.detachedIds(MT.state.overrides).map(function (id) {
    const note = document.querySelector('[data-detached-chart="' + id + '"]');
    let label = "";
    let labelAnchor = "";
    let firstAnchor = "";
    let view = "";
    /*
     * 從說明那一條往上走，邊走邊收：
     *   ・label ＝ 第一個「找得到標題」的祖先的標題
     *   ・anchor ＝ 有標題的那一層的 id（跳轉落在那一塊的開頭）；
     *     那一層沒有 id 時，退回途中第一個有 id 的祖先。
     * 走到 .view 為止。
     */
    for (let node = note; node && node !== document.body; node = node.parentElement) {
      if (node.nodeType !== 1) continue;
      if (!firstAnchor && node.id) firstAnchor = node.id;
      if (!label) {
        label = blockHeadingText(node);
        if (label) labelAnchor = node.id || "";
      }
      if (node.classList && node.classList.contains("view")) {
        view = node.id || "";
        break;
      }
    }
    const anchor = labelAnchor || firstAnchor;
    return {
      id: id,
      /*
       * ⚠️ 真的一個標題都找不到時**不要退回 id**（使用者看到的會是英文）。
       *   退回這一塊所在分頁的側欄名稱；再找不到才寫「未命名區塊」。
       */
      label: label || viewTitleText(view) || "未命名區塊",
      anchor: anchor,
      view: view,
    };
  });
}
/** 分頁（.view）自己的大標題，當作最後的退路。 */
function viewTitleText(viewId) {
  if (!viewId) return "";
  const heading = document.querySelector("#" + CSS.escape(viewId) + " .title h2");
  return heading ? (heading.textContent || "").replace(/\s+/g, " ").trim() : "";
}
/** 把小卡關起來（並把箭頭轉回去）。 */
function closeDetachedPop() {
  const pop = $("mtDetachedPop");
  const toggle = $("mtDetachedToggle");
  if (pop) pop.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}
function wireDetachedPop() {
  const toggle = $("mtDetachedToggle");
  const pop = $("mtDetachedPop");
  if (!toggle || !pop) return;
  toggle.onclick = function () {
    const open = pop.hidden;
    if (!open) return closeDetachedPop();
    const blocks = detachedBlocks();
    pop.innerHTML =
      '<p class="mt-detached-lead">這幾塊正在用自己的條件。點名稱可以跳過去看；要單獨回歸，用那一塊自己的「回到主工具列條件」。</p>' +
      '<ul class="mt-detached-list">' +
      blocks
        .map(function (block) {
          return (
            '<li><button type="button" class="mt-detached-item" data-detached-goto="' +
            esc(block.anchor) +
            '" data-detached-view="' +
            esc(block.view) +
            '">' +
            esc(block.label) +
            "</button></li>"
          );
        })
        .join("") +
      "</ul>";
    pop.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };
  pop.onclick = function (event) {
    const item = event.target.closest("[data-detached-goto]");
    if (!item) return;
    /*
     * ⚠️ 使用者 2026-09-15：「你提供了點一下清單裡的名稱，畫面會跳轉過去，
     *   那就要記得**浮動小卡也要跟著關掉**」。
     *   先關再跳：跳轉會重畫主工具列，順序反過來的話小卡會被重新畫出來。
     */
    closeDetachedPop();
    const view = item.dataset.detachedView;
    const anchor = item.dataset.detachedGoto;
    if (view) gotoView(view);
    if (anchor) focusBlock(anchor);
  };
}
/*
 * 點小卡以外的地方、或按 Esc，都要關掉。
 * ⚠️ 只掛一次（不在 renderMainToolbar 裡掛），否則每重畫一次就多一個監聽器。
 */
document.addEventListener("click", function (event) {
  const pop = $("mtDetachedPop");
  if (!pop || pop.hidden) return;
  if (event.target.closest("#mtDetachedPop, #mtDetachedToggle")) return;
  closeDetachedPop();
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") closeDetachedPop();
});

/**
 * 脫離中的區塊要掛的那一條說明＋回歸鈕。
 *
 * ⚠️ 一定要寫出**主工具列現在是什麼**。只寫「本區塊使用自訂條件」的話，
 *   使用者得自己捲回去對照才知道差在哪。
 */
function detachNoteHtml(chartId) {
  if (!MF.isDetached(MT.state.overrides, chartId)) return "";
  return `<p class="chart-detach-note" data-detached-chart="${esc(chartId)}" data-testid="chart-detach-note"><span>目前用本區塊自己的條件（主工具列：${esc(
    MF.describeMain(MF.normalizeLegacyAll(MT.state.main), showQuarter),
  )}）</span><button type="button" class="chart-detach-reset" data-testid="chart-detach-reset" data-reset-chart="${esc(
    chartId,
  )}">回到主工具列條件</button></p>`;
}
/**
 * L-1：表頭漏斗勾到「不在主工具列目前條件內」的值 → **整張表脫離**。
 *
 * 使用者 2026-09-15：「如果勾了一個與主工具列目前篩選條件不同的路段，
 *   **這個表單就脫離，只影響這個表單**，並出現回歸主工具列的按鈕，
 *   主工具列也跳出全部回歸按鈕。」
 *
 * ⚠️ 脫離的單位是**整張表**，不是「那一欄」。一張表同時有
 *   「這一欄跟隨、那一欄不跟隨」的話，使用者無法用一句話說出
 *   「我現在看到的是什麼」——而那一句話正是報告要抄的東西。
 *
 * ⚠️ 脫離後這張表用的是**完整資料**（季度拉到最早～最新、路段不設限、
 *   日別／方向不設限、尖峰回到代表尖峰），只剩表頭漏斗自己的條件。
 *   只放寬「被違反的那一欄」也做得到，但那樣脫離狀態會依你先勾哪一欄
 *   而不同，說明文字沒辦法寫成一句話。
 *
 * ⚠️ 已經脫離的表**不要再設一次**：那會在使用者每勾一個值時
 *   把他自己在這張表上調過的區塊條件洗掉。
 *
 * @returns true 代表這裡已經觸發重畫了（ColumnFilter 就不用再 onChange）
 */
function detachTableForOutOfScope(chartId) {
  if (MF.isDetached(MT.state.overrides, chartId)) return false;
  const list = mainToolbarPeriods();
  const wide = {
    periodFrom: list[0] || "",
    periodTo: list[list.length - 1] || "",
    roads: [],
    day: "all",
    direction: "all",
    /* ts2028 的尖峰沒有「全部」——代表尖峰才是「不篩尖峰」的那一個。 */
    peak: "representative",
  };
  MT.setChartMany(chartId, wide);
  return true;
}
/**
 * 某一個條件對這一塊不適用時掛的那一句。
 *
 * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
 *   而且只在真的篩了那個條件時才掛，沒篩時講一句沒有人問的話是另一種噪音。
 */
/**
 * @param {object} [options]
 * @param {boolean} [options.applied] 這一句是「**已套用**的說明」（例如「目前篩掉了 N 條
 *   路段」「只選了平日所以另一根柱子不出現」），不是「不適用」。
 *   2026-09-18 大檢查：e2e-filter-coverage 加了反向那一半（寫不適用卻變＝說謊），
 *   這幾句描述的正是條件生效後的結果，數字本來就會跟著變，
 *   所以只標成 data-note-kind="applied"，不可以同時宣告 data-inapplicable；
 *   正向檢查仍會從實際數值／圖形變化確認條件真的生效。
 */
function inapplicableHtml(show, text, fields, options) {
  if (!show) return "";
  const applied = Boolean(options && options.applied);
  const kind = applied ? ' data-note-kind="applied"' : "";
  /*
   * ⚠️ fields 要寫出這一句**交代了哪幾個條件**（使用者看不到，給守門用）。
   *
   * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選
   *   條件卻沒出現不受影響的提醒文字」——只驗「這一塊有沒有說明」會假綠：
   *   對季度講了一句、對顯示數值一個字都沒有，照樣算「有說明」。
   */
  const mark = !applied && fields && fields.length
    ? ` data-inapplicable="${esc(fields.join(" "))}"`
    : "";
  return `<p class="chart-inapplicable" data-testid="chart-inapplicable"${mark}${kind}>${esc(text)}</p>`;
}
/**
 * 「這一塊不吃**任何**主工具列條件」——一句常駐說明。
 *
 * ⚠️ 逐條件各跳一句會變成好幾句噪音，所以這種塊一句話講完；
 *   但不可以什麼都不說。
 */
function alwaysIndependentHtml(text) {
  return `<p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">${esc(text)}</p>`;
}
/* 回歸鈕是動態產生的，用事件委派接，重畫之後不必重新綁。 */
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-reset-chart]");
  if (!button) return;
  MT.resetChart(button.dataset.resetChart);
});
function renderYearStyleToggle() {
  const labels = globalThis.PeriodDate.YEAR_STYLE_LABELS;
  const style = state.yearStyle === "ad" ? "ad" : "roc";
  yearStyleButton.textContent = `年份顯示：${labels[style]}`;
  yearStyleButton.classList.toggle("is-on", style === "ad");
  yearStyleButton.title =
    "切換年份顯示方式：民國年（115Q1）／西元年（2026Q1）。畫面與匯出檔一起變；資料一律以民國年儲存，切換不影響分組與計算。";
}
/**
 * 期別字串在畫面與匯出檔上要顯示成什麼年份寫法。
 * 只換文字：傳進來的 period 仍是分組、排序與鍵值的依據，認不得的字串原樣回傳。
 */
/*
 * ⚠️ 這一支要把**兩層**都套上：年份寫法（民國／西元）**和**期別寫法（季別／調查月份）。
 *
 * 使用者 2026-09-13（附圖，匯入紀錄）：
 *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
 *     沒有變成調查月份**。請確認月份和年的切換功能都有正常運作。」
 *   「三份程式都有，確認都有正常運作。」
 *
 * 他是對的。舊版的 showQuarter 只呼叫 quarterInYearStyle()——那一支**只換年份**。
 * 於是全系統二十幾個顯示期間的欄位（匯入紀錄、刪除季度、品質檢查、追溯明細、
 * 重點路段、成果交付的 CSV…）年份都會跟著換，期別卻永遠停在季別。
 * 按鈕上明明寫著「調查月份」，欄位給的卻是季別——**畫面在說謊**，
 * 而使用者沒辦法分辨是「這批資料沒有日期」還是「功能壞了」。
 *
 * ⚠️ 不要在每個呼叫端各自補第二層：二十幾個地方一定會漏，
 *   而漏掉的那一個不會有任何錯誤訊息。兩層一律由這一支負責。
 *
 * ⚠️ projectPeriodLabel 沒有日期時會自己退回季別寫法，所以不必額外判斷；
 *   「有沒有日期」由期別切換鈕的停用機制負責告訴使用者。
 */
/*
 * ⚠️ 第二個參數是**計畫代碼**，不是陣列索引。
 *   絕對不可以把這支函式**直接**交給 map 當回呼——map 會把索引 0、1、2
 *   當成計畫代碼傳進來，
 *   查不到任何明細，於是安靜地退回季別寫法。
 *   2026-09-13 我自己就踩了這個坑：成果交付的季度清單改完之後仍然顯示 115Q1，
 *   守門抓到才發現。一律改寫成箭頭函式，明確只傳一個參數。
 */
function showQuarter(period, projectCode = state.activeCode) {
  return projectPeriodLabel(period, projectCode);
}
/**
 * 光年份（"115"）在畫面上要顯示成什麼寫法。
 * 借一個季度殼子換算完再把 Qn 去掉；換不成就原樣回傳。
 */
function showYear(year) {
  /*
   * ⚠️ 這裡**不可以**再借 showQuarter：它現在會回「115年2、3月」這種期別寫法，
   *   下面那個 /^(\d{2,4})Q1$/ 永遠對不上，光年份就會原樣吐回民國年。
   *   只換年份的需求要直接呼叫只換年份的那一支。
   */
  const shown = globalThis.PeriodDate.quarterInYearStyle(
    String(year) + "Q1",
    state.yearStyle === "ad" ? "ad" : "roc",
  );
  const m = String(shown).match(/^(\d{2,4})Q1$/);
  return m ? m[1] : String(year);
}
/*
 * 匯出用的期別文字。excel-export.js 是獨立元件（e2e 會單獨呼叫它），
 * 所以用一個可選的全域掛勾把顯示設定交給它，沒有掛勾時它就照原樣輸出。
 */
globalThis.periodExportLabel = showQuarter;
function renderPeriodDisplayToggle() {
  const labels = globalThis.PeriodDate.PERIOD_DISPLAY_LABELS;
  const mode = state.periodDisplay === "month" ? "month" : "quarter";
  periodDisplayButton.textContent = `期別顯示：${labels[mode]}`;
  periodDisplayButton.classList.toggle("is-on", mode === "month");
  /*
   * ⚠️ 判斷範圍只看**目前這一個計畫**。
   *   2026-09-13 以前這裡是「目前計畫 or Manager 專案包」有日期就啟用，
   *   於是 A 計畫有日期、切到沒有日期的 B 計畫時按鈕仍可按，按下去每一格
   *   還是季別——範圍不一致造成的那種「按了沒反應又沒訊息」。
   *   Manager 移除之後這個範圍自然收斂成一個，不必再分兩種說法。
   */
  const has = activeProjectHasSurveyDate();
  periodDisplayButton.disabled = !has;
  periodDisplayButton.title = has
    ? "切換期別顯示方式：季別（115Q1）／實際調查月份（115年2、3月）。只換顯示文字，不影響分組與計算。"
    : "目前這個計畫的資料沒有調查日期，無法顯示調查月份。重新匯入原始檔之後就會有。";
}
function clearPendingPreview() {
  // 預覽結果只對「預覽當下的那個計畫」有效。切換計畫、刪除計畫或全部清除之後
  // 若還留著，按下確認寫入會把資料寫到別的計畫，甚至寫進已經不存在的計畫。
  pending = [];
  pendingContext = null;
  pendingPeriodChecks = [];
  healthIssues = [];
  /*
   * healthChecked 也要跟著清掉。
   *
   * 舊版只清 healthIssues，healthChecked 仍是 true，於是切到一個從來沒檢查過
   * 的計畫時，資料異常檢查與品質總覽會顯示「檢查通過，未發現異常」「目前四項品質
   * 檢查均通過」——把「沒有檢查」講成「檢查過而且沒問題」，是這兩張表最不該
   * 出現的錯誤。
   */
  healthChecked = false;
  healthStale = false;
  roadPicks = new Set();
  if (typeof roadAlert !== "undefined") roadAlert.style.display = "none";
  if (typeof roadBatchBar !== "undefined") roadBatchBar.style.display = "none";
  if ($("commit")) $("commit").disabled = true;
  /*
   * 「取消匯入」也要一起停用。
   *
   * 這一顆的啟用狀態是在 renderPreview() 裡依 pending.length 設定的，
   * 但清理預覽的路徑不一定會走到 renderPreview()——判讀中途出錯時就不會。
   * 於是會出現「pending 已經清空，取消匯入卻還亮著」的狀態：按下去
   * 第一行就 `if (!pending.length) return;` 直接返回，使用者按了完全沒反應。
   *
   * 呼叫這個函式的六個地方（切換計畫、切換到別的計畫、刪除計畫、
   * 全部清除、按下取消、判讀例外復原）都是「這份預覽不算數了」，
   * 所以在這裡一起停用是安全的。
   */
  if ($("cancelPreview")) $("cancelPreview").disabled = true;
}
projectSwitch.onchange = async () => {
  state.activeCode = projectSwitch.value;
  clearPendingPreview();
  await save();
  toast("已切換計畫");
};
const projectPicker = document.createElement("label");
projectPicker.innerHTML = '要編輯的計畫<select id="projectPicker"></select>';
document.querySelector("#setup .form").prepend(projectPicker);
const projectScopeHint = document.createElement("p");
projectScopeHint.id = "projectScopeHint";
projectScopeHint.className = "warning";
projectScopeHint.setAttribute("role", "status");
projectScopeHint.setAttribute("aria-live", "polite");
projectScopeHint.style.display = "none";
projectPicker.after(projectScopeHint);
$("projectPicker").onchange = () => {
  const p = state.projects.find((x) => x.code === $("projectPicker").value);
  $("projectCode").value = p?.code || "";
  $("projectName").value = p?.name || "";
  renderProjectSetupActions();
};
// 刪除計畫的入口放在「計畫設定」，使用者要刪計畫時第一個就會找這裡。
const deleteProjectBtn = document.createElement("button");
deleteProjectBtn.id = "deleteProject";
deleteProjectBtn.className = "danger-button full";
deleteProjectBtn.style.marginTop = "10px";
deleteProjectBtn.textContent = "刪除這個計畫";
$("saveProject").after(deleteProjectBtn);
const deleteProjectHint = document.createElement("p");
deleteProjectHint.className = "muted";
deleteProjectHint.style.margin = "8px 0 0";
deleteProjectHint.textContent =
  "刪除會一併移除此計畫的所有季度資料、彙總、速限與別名；刪除前會自動下載一份專案包備份。";
deleteProjectBtn.after(deleteProjectHint);
function renderProjectSetupActions() {
  const code = ($("projectCode").value || "").trim();
  const exists = state.projects.some((x) => x.code === code);
  deleteProjectBtn.disabled = !exists;
  deleteProjectBtn.textContent = exists ? `刪除計畫「${code}」` : "刪除這個計畫";
  deleteProjectHint.style.display = exists ? "" : "none";
  const active = activeProject();
  const mismatched = Boolean(active && code && exists && code !== active.code);
  projectScopeHint.style.display = mismatched ? "" : "none";
  projectScopeHint.textContent = mismatched
    ? `⚠️ 目前作用中的是「${active.code} ${active.name}」——匯入、明細、彙總與圖表都會用那一個。` +
      `這張表單編輯的是「${code}」；按下「儲存計畫設定」才會把作用中計畫換成它，` +
      `或改用頁首的計畫選單直接切換。`
    : "";
}
deleteProjectBtn.onclick = () => {
  const code = ($("projectCode").value || "").trim();
  if (!state.projects.some((x) => x.code === code)) return toast("這個計畫尚未建立，沒有東西可刪除");
  return deleteProjectFlow(code, { fromSetup: true });
};
$("projectCode").addEventListener("input", renderProjectSetupActions);
const previewHead = document
  .querySelector("#previewRows")
  .closest("table")
  .querySelector("thead tr");
previewHead.insertAdjacentHTML("beforeend", "<th>路段判定</th>");
const roadAlert = document.createElement("div");
roadAlert.id = "roadAlert";
roadAlert.className = "warning";
roadAlert.style.display = "none";
document.querySelector("#previewRows").closest(".table-wrap").before(roadAlert);
/**
 * 疑似新路段的「批次確認」列。
 *
 * 一次匯入十幾二十份檔案時，系統對每個沒見過的路段名稱都會要求確認，
 * 使用者卻通常一眼就知道這批全部都是新路段——逐列點開下拉選單選一次，
 * 純粹是重複勞動。這一列讓使用者勾選（或全選）之後一次處理完，
 * 剩下真的要合併的那幾筆再自己逐一指定。
 */
const roadBatchBar = document.createElement("div");
roadBatchBar.id = "roadBatchBar";
roadBatchBar.className = "road-batch-bar";
roadBatchBar.style.display = "none";
roadBatchBar.innerHTML =
  '<label class="pick-all"><input type="checkbox" id="pickAll"><span>全選待確認</span></label>' +
  '<span id="pickCount" class="pick-count">已勾選 0 筆</span>' +
  '<span class="pick-actions">' +
  '<button class="primary" id="pickAsNew" disabled>勾選的確認為新路段</button>' +
  '<select id="pickMergeTarget"></select>' +
  '<button class="outline" id="pickAsMerge" disabled>勾選的合併至此路段</button>' +
  "</span>";
document.querySelector("#previewRows").closest(".table-wrap").before(roadBatchBar);

const renameBtn = document.createElement("button");
renameBtn.className = "outline";
renameBtn.textContent = "路段名稱修改／合併";
document.querySelector("#speed .title").append(renameBtn);

const roadAdminButton = document.createElement("button");
roadAdminButton.dataset.view = "roadadmin";
roadAdminButton.textContent = "路段管理";
document.querySelector('nav button[data-view="speed"]').before(roadAdminButton);
roadAdminButton.onclick = () => gotoView("roadadmin");
const roadAdminSection = document.createElement("section");
roadAdminSection.id = "roadadmin";
roadAdminSection.className = "view";
roadAdminSection.innerHTML = `<div class="title"><div><span class="eyebrow">ROAD DIRECTORY</span><h2>路段管理</h2><p>集中管理正式名稱、方向名稱、檔名別名與重複路段。合併前會先顯示影響範圍。</p></div><button class="outline" id="roadAdminBackup">下載合併前備份</button></div><div class="metrics compact road-metrics"><article><span>正式路段</span><b id="roadCount">0</b></article><article><span>檔名別名</span><b id="aliasCount">0</b></article><article><span>涵蓋季度</span><b id="roadPeriodCount">0</b></article></div><div class="road-admin-grid"><article class="panel form"><h3>修改正式名稱</h3><label>目前路段<select id="renameRoad"></select></label><label>新的正式名稱<input id="formalRoadName" placeholder="例如：中正一路（民族路～民權路）"></label><button class="primary full" id="previewRename">預覽修改影響</button></article><article class="panel form"><h3>方向顯示名稱</h3><small class="rule-note">命名之後，資料異常檢查的「方向對應不一致」就不會再提醒這個方向——命名本身就是人工確認。</small><label>路段<select id="directionRoad"></select></label><div class="row"><label>方向1名稱<input id="directionA" placeholder="例如：東→西"></label><label>方向2名稱<input id="directionB" placeholder="例如：西→東"></label></div><button class="primary full" id="saveDirections">儲存方向名稱</button></article><article class="panel form"><h3>設定檔名別名</h3><label>檔名中可能出現的名稱<input id="aliasName" placeholder="例如：中正路"></label><label>自動對應正式路段<select id="aliasTarget"></select></label><button class="primary full" id="addAlias">新增或更新別名</button></article><article class="panel form"><h3>合併重複路段</h3><label>來源路段<select id="mergeSource"></select></label><label>合併至<select id="mergeTarget"></select></label><button class="outline full" id="previewMerge">顯示合併影響</button></article></div><div id="roadImpact" class="panel impact-panel"><div class="panel-head"><div><h3>修改預覽</h3><small>按上面任一顆「預覽」之後，這裡會列出影響範圍。</small></div></div><b>尚未預覽修改</b><p>請先選擇路段並按「預覽」，系統不會立即改動資料。</p><button class="danger-button" id="confirmRoadChange" disabled>備份後確認執行</button></div><div class="panel"><div class="panel-head"><div><h3>正式路段清冊</h3><small>方向名稱只改變顯示，不改變原始方向鍵值；命名後全站（明細、彙總、速限、報告與結論草稿、CSV）都會改用新名稱。</small></div></div><div class="table-wrap"><table><thead><tr><th>正式路段</th><th>方向1</th><th>方向2</th><th>季度</th><th>明細筆數</th><th>別名數</th></tr></thead><tbody id="roadAdminRows"></tbody></table></div></div><div class="panel"><div class="panel-head"><div><h3>檔名別名清冊</h3><small>匯入時若檔名符合別名，會自動併入指定正式路段。</small></div></div><div class="table-wrap"><table><thead><tr><th>檔名別名</th><th>對應正式路段</th><th>操作</th></tr></thead><tbody id="aliasRows"></tbody></table></div></div>`;
document.querySelector("#speed").before(roadAdminSection);
const qualityPanel = document.createElement("div");
qualityPanel.className = "panel quality-panel";
/*
 * ══════════════════════════════════════════════════════════════════
 *  X-27：這一塊**真的吃**季度區間、路段與日別
 * ══════════════════════════════════════════════════════════════════
 *
 * 舊版在這一塊掛的是「不受主工具列條件影響」＋ data-inapplicable="all"，
 * 而實測改主工具列的季度，清單真的會少幾列——那句話是**假的**，
 * 而且因為標了 all，逐塊守門讀到就當它「常駐不適用、免逐條件表態」，
 * 於是這一塊吃了條件卻永遠不必交代吃了哪些。
 *
 * ⚠️ 真正的語意是**分母與分子不同**：
 *   ・分母（檢查本身）掃整個計畫的全部資料 → 「共 N 項」不隨主工具列變
 *   ・分子（清單列出哪幾項）跟著季度／路段／日別走，可以就地脫離
 * 說明文字已改成分兩句講，這裡則宣告它真的吃哪幾個條件。
 *
 * ⚠️ 為什麼需要 data-consumes 而不是只靠「數字有沒有變」：
 *   某些測資下篩了日別剛好一列都不會少（異常項目本身沒有日別欄位時，
 *   規則是「與該維度無關的項目任何選擇都列出」）。那不是漏，是資料的性質；
 *   只驗有沒有變會逼人去掛一句錯的說明，而畫面說謊比沒說更糟。
 */
qualityPanel.setAttribute("data-consumes", "periodFrom periodTo roads day");
qualityPanel.innerHTML = `<p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="direction peak" data-inapplicable-always="1">這一塊有兩個數字，兩個的規則不一樣：<b>「共 N 項」是檢查的總數，一律掃這個計畫的全部資料，不隨主工具列變</b>（被篩掉的地方有問題就永遠檢查不到）；<b>清單上列出哪幾項則會跟著季度、路段與日別走</b>，要縮小或放大範圍可以直接改這一區自己的四個下拉，改了只有這一塊脫離。方向與尖峰對這一塊不適用——異常項目本身沒有這兩個維度。</p><div class="panel-head"><div><h3>計畫資料品質總覽</h3><small>檢查每一季實際匯入的資料：平假日是否成對、四筆尖峰方向是否齊全、速限是否人工確認，以及相鄰季度的異常變化。沒有匯入資料的季度與路段不會列出——沒有匯入就代表那一季沒有調查。</small></div><span id="qualityShown" class="quality-shown">尚未檢查</span></div><div class="metrics compact quality-metrics"><article><span>缺少平假日</span><b id="qualityDay">0</b></article><article><span>缺少方向／尖峰</span><b id="qualityGroup">0</b></article><article><span>速限未確認</span><b id="qualitySpeed">0</b></article><article><span>異常變化</span><b id="qualityChange">0</b></article></div><div class="anomaly-filters"><div class="anomaly-filter-row"><label>起始季度<select id="qualityFrom"><option value="">不限</option></select></label><label>結束季度<select id="qualityTo"><option value="">不限</option></select></label><label>路段<select id="qualityRoad"><option value="">全部路段</option></select></label><label>日別<select id="qualityDayFilter"><option value="">全部日別</option><option value="平日">平日</option><option value="假日">假日</option></select></label></div><div class="anomaly-chips" id="qualityTypeChips"></div><div id="qualityNotes"></div><p class="anomaly-hint">季度區間的語意是「比較區間有重疊就列出」：異常變化是相鄰兩季相比，選 114Q1～114Q4 時，113Q4→114Q1 也會出現——114Q1 被標成異常的原因就在那一次比較。所有篩選都遵循同一個原則：<b>與該維度無關的項目，任何選擇都會列出</b>（期間標「全部」的名稱與速限不受季度區間影響；沒有日別的項目不受日別影響）。<b>匯出與交付檔案一律輸出全部項目，不受這裡的篩選影響。</b></p></div><div class="table-wrap"><table><thead><tr><th>類型</th><th>期間</th><th>路段／項目</th><th>說明</th><th>解決方式</th></tr></thead><tbody id="qualityRows"><tr><td colspan="5" class="empty">按「執行資料異常檢查」產生品質總覽</td></tr></tbody></table></div>`;
document.querySelector("#maintenance .health-panel").before(qualityPanel);
renameBtn.onclick = () => gotoView("roadadmin");

function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[﹙（]/g, "(")
    .replace(/[﹚）]/g, ")")
    .replace(/[~〜∼]/g, "～")
    .replace(/[‐‑‒–—―－]/g, "-")
    .replace(/[，､]/g, ",")
    .replace(/[。．]/g, ".")
    .replace(/[：]/g, ":")
    .replace(/[；]/g, ";")
    .replace(/[／]/g, "/");
}
function stripRoadSuffix(s) {
  return normalize(s).replace(
    /[-－]?\(?\s*(平日|假日)\s*\)?(?:[-－]?(?:\d{2,3}(?:[.\-]\d{1,4}){1,2}|\d{4,8}))?$/,
    "",
  );
}
function roadFromFile(name) {
  let s = name.replace(/\.(xlsx?|xlsm)$/i, "");
  s = s.replace(/^\d+TS\d+-?\d+[-－]?/i, "");
  return stripRoadSuffix(s);
}
function dayFromFile(name) {
  const stem = String(name).replace(/\.(xlsx?|xlsm)$/i, "");
  /* 只認結尾處的平假日標記，避免路段名稱裡的字樣誤判。 */
  const tail = stem.match(
    /(平日|假日)\s*\)?\s*(?:(?:[-－_]?\d[\d.\-]*)|(?:[（(]\d+[）)]))?$/,
  );
  if (tail) return tail[1];
  /* 尾端沒有標記就判不出來。不可因路段名稱中剛好出現其中一個字樣而猜測。 */
  return "";
}
function editDistance(a, b) {
  a = normalize(a);
  b = normalize(b);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}
function closestRoad(road, roads) {
  let best = null;
  for (const x of roads) {
    const score =
      1 - editDistance(road, x) / Math.max(normalize(road).length, normalize(x).length, 1);
    if (!best || score > best.score) best = { road: x, score };
  }
  return best;
}
function existingRoads() {
  return [
    ...new Set(state.details.filter((d) => d.projectCode === state.activeCode).map((d) => d.road)),
  ];
}
function suspiciousRoadName(road) {
  const value = String(road || "").trim();
  if (!value) return "從檔名讀不出路段名稱";
  /* 前面沒有案號數字的純代號（TS1401_、T14-02）也要攔——備援路徑正是為了
     應付沒有站名的舊模板，那時這種名稱會安靜變成一個幽靈路段。 */
  if (/^[A-Za-z]{1,3}\s*\d{2,}[-_－.]?\d*[-_－]?$/i.test(value))
    return "名稱看起來只是站號代號，不是路段名稱";
  if (/\d{3,}\s*[-_－.]?\s*TS\s*\d/i.test(value))
    return "名稱裡還留著案號（開頭格式須為「數字TS數字-數字」，例如 99999TS1-01；中間多符號或改用底線就切不掉）";
  if (/^(複本|副本|Copy of|-\s)/i.test(value))
    return "名稱以「複本」等字樣開頭，可能是另存的副本檔";
  if (/[(（]\s*\d+\s*[)）]\s*$/.test(value))
    return "名稱結尾有 (1) 這類重複下載的流水號";
  if (/(平日|假日)/.test(value))
    return "名稱裡仍含「平日／假日」字樣，可能沒有切乾淨";
  if (/^\d+(Q\d)?$/i.test(value)) return "名稱只有數字或季度字樣";
  return "";
}
function analyzeRoads() {
  const known = existingRoads(),
    seen = [...new Set(pending.filter((x) => x.ok).map((x) => x.road))],
    signatureMap = {};
  for (const road of known) (signatureMap[roadSignature(road)] ??= []).push(road);
  for (const item of pending) {
    item.roadChoice = "";
    item.originalRoad = item.road;
    item.matchType = "新路段";
    if (!item.ok) continue;
    /*
     * 名稱本身看起來就像沒切乾淨時，不論計畫裡有沒有既有路段都要先問。
     * 一律強制確認會讓正常流程平白多一道手續；完全不管又會讓
     * `複本 - …`、`…-平日 (1)`、案號沒切掉的檔名靜靜長出一個幽靈路段，
     * 而且第一次匯入時連比對對象都沒有，完全不會被發現。
     */
    const suspicious = suspiciousRoadName(item.road);
    if (suspicious) {
      item.matchType = "疑似判讀失敗";
      item.roadAlert = { near: "", score: 0, reason: suspicious };
      continue;
    }
    if (known.includes(item.road)) {
      item.matchType = "完全相符";
      continue;
    }
    if (!known.length) continue;
    const alias = state.aliases[`${state.activeCode}|${normalize(item.road)}`];
    if (alias && known.includes(alias)) {
      item.roadChoice = alias;
      item.matchType = "別名相符";
      continue;
    }
    const sameSignature = signatureMap[roadSignature(item.road)] || [];
    if (sameSignature.length === 1) {
      item.roadChoice = sameSignature[0];
      item.matchType = "完全相符";
      continue;
    }
    const near = closestRoad(item.road, known);
    item.matchType = "疑似相符";
    item.roadAlert = { near: near?.road || "", score: near?.score || 0 };
  }
  const hasNew = pending.some((x) => x.ok && x.roadAlert);
  const missing = known.filter(
    (x) => !seen.includes(x) && !pending.some((p) => p.roadChoice === x),
  );
  roadAlert.style.display = hasNew && missing.length ? "block" : "none";
  roadAlert.innerHTML =
    hasNew && missing.length
      ? `<b>本次有疑似新路段；另有 ${missing.length} 個既有路段未出現</b><p>${missing.map(esc).join("、")}</p><small>請先確認疑似新路段是否為名稱差異；若確為新增路段，仍可繼續。</small>`
      : "";
}
function rulesFor(code = state.activeCode) {
  return { ...DEFAULT_LOS_RULE, ...(state.losRules?.[code] || {}) };
}
/*
 * ── 判定門檻的適用範圍（季別 × 路段）────────────────────────────
 *
 * 使用者 2026-09-15：「服務水準判定方式，應該要比照全日交通量和路口轉向程式的
 *   參數設定那樣，新增一個依照每季和各路段／路口，當衝突發生時，**以每季優先**
 *  （和另外兩程式一致的判斷方式），套用後進行重新計算」。
 *
 * ⚠️ 順位判斷**全部集中在 los-rule-scope.js**，這裡只負責取出這個計畫的清單。
 *   分散判斷的話，遲早會出現「明細那一格」與「彙總那一格」用了不同門檻。
 */
function ruleScopesFor(code = state.activeCode) {
  var list = (state.losRuleScopes && state.losRuleScopes[code]) || [];
  return Array.isArray(list) ? list : [];
}
/**
 * 這一筆資料實際要用的門檻（含「是怎麼命中的」）。
 *
 * ⚠️ 沒有任何覆寫時回傳的就是計畫預設那一份——改版對還沒用範圍設定的人**完全無感**。
 */
function ruleHitFor(period, road, code = state.activeCode) {
  return globalThis.LosRuleScope.resolveLosRule(
    rulesFor(code),
    ruleScopesFor(code),
    period,
    road,
  );
}
/**
 * 目前計畫的三段分界。壞掉的設定一律回預設，不讓畫面掛掉。
 *
 * 兩個界線必須維持 smoothEnd ＜ congestedStart（以 A→F 的順序算），
 * 否則「順暢」與「壅塞」會重疊、中間的「尚可」變成負的。
 * 舊備份沒有這一欄，也走這條路回到預設值。
 */
function bandsFor(code = state.activeCode) {
  const saved = state.bandRules?.[code] || {};
  const smoothEnd = LOS_GRADES.indexOf(String(saved.smoothEnd));
  const congestedStart = LOS_GRADES.indexOf(String(saved.congestedStart));
  const valid =
    smoothEnd >= 0 &&
    congestedStart >= 0 &&
    smoothEnd < congestedStart &&
    congestedStart <= LOS_GRADES.length - 1;
  return valid
    ? { smoothEnd: LOS_GRADES[smoothEnd], congestedStart: LOS_GRADES[congestedStart] }
    : { ...DEFAULT_BAND_RULE };
}
/** 這個計畫的三段分法覆寫清單。 */
function bandScopesFor(code = state.activeCode) {
  var list = (state.bandRuleScopes && state.bandRuleScopes[code]) || [];
  return Array.isArray(list) ? list : [];
}
/**
 * 這一筆資料實際要用的**三段分界**（含「是怎麼命中的」）。
 *
 * ⚠️ 沒有任何覆寫時回傳的就是計畫預設那一份——改版對還沒用範圍設定的人
 *   **完全無感**（與 ruleHitFor 同一條不變量）。
 * ⚠️ 與服務水準門檻走**同一個解析器**，順位一致：
 *   季別區間 × 路段 → 季別區間 × 全路段 → 全季別 × 路段 → 計畫預設。
 */
function bandHitFor(period, road, code = state.activeCode) {
  return globalThis.LosRuleScope.resolveLosRule(
    bandsFor(code),
    bandScopesFor(code),
    period,
    road,
  );
}
/** 一個等級落在哪一段。認不得的等級（"?"）回 null，不可以當成壅塞。 */
function bandOf(los, bands = bandsFor()) {
  const index = LOS_GRADES.indexOf(String(los));
  if (index < 0) return null;
  if (index <= LOS_GRADES.indexOf(bands.smoothEnd)) return "smooth";
  if (index >= LOS_GRADES.indexOf(bands.congestedStart)) return "congested";
  return "fair";
}
/** 三段各自涵蓋哪幾級，畫圖例與說明文字時直接用，不各自再算一次。 */
function bandGrades(bands = bandsFor()) {
  const smooth = LOS_GRADES.indexOf(bands.smoothEnd);
  const congested = LOS_GRADES.indexOf(bands.congestedStart);
  return {
    smooth: LOS_GRADES.slice(0, smooth + 1),
    fair: LOS_GRADES.slice(smooth + 1, congested),
    congested: LOS_GRADES.slice(congested),
  };
}
/**
 * 三段的中文標題，含涵蓋等級與速限比門檻。
 * 圖例與說明欄位共用這一支——分界改了，兩邊一起改，不會有一邊沒跟上。
 */
function bandLabels(code = state.activeCode) {
  const bands = bandsFor(code);
  const grades = bandGrades(bands);
  const rule = rulesFor(code);
  const lowest = (list) => (list.length ? rule[list[list.length - 1]] : null);
  const text = (name, list) =>
    list.length
      ? `${name}（${list.join("、")}${
          lowest(list) != null ? `，速限比 ≧ ${fmt(lowest(list), 2)}` : ""
        }）`
      : `${name}（無）`;
  return {
    bands,
    grades,
    smooth: text("順暢", grades.smooth),
    fair: text("尚可", grades.fair),
    /* 壅塞是最後一段，寫成「小於」比較直觀 */
    congested: grades.congested.length
      ? `壅塞（${grades.congested.join("、")}，速限比 ＜ ${fmt(
          rule[LOS_GRADES[LOS_GRADES.indexOf(bands.congestedStart) - 1]],
          2,
        )}）`
      : "壅塞（無）",
    /* 趨勢圖那個佔比指標的名稱，一定跟著同一條分界走 */
    congestedShareLabel: `${bands.congestedStart} 級以下路段佔比`,
  };
}
/**
 * 速限比 → 服務水準等級。
 *
 * ⚠️ 第三、四個參數是**這一筆資料的季別與路段**，用來挑適用的門檻
 *   （季別 × 路段覆寫，見 ruleHitFor）。**不傳就是用計畫預設**，
 *   所以舊的呼叫端不會壞——但凡是手上有季別與路段的呼叫端都應該傳，
 *   不傳等於讓那一格永遠用預設門檻，而畫面上看不出來。
 */
function losOf(r, code = state.activeCode, period, road) {
  /*
   * 讀不到速限比時要回「?」，不是 F。
   * 舊寫法直接比大小，而 null >= 0.8 會因為 Number(null) === 0 而為 false，
   * 一路落到最後的 "F"——**缺值被判成最差等級**。呼叫端有的有防護
   * （d.ratio == null ? "?" : …），有的沒有；沒防護的那幾處（例如匯入預覽
   * 的 remapPending）就會在畫面上把「讀不到旅行速率」的那一筆標成 F。
   * 守衛放在這裡，六個呼叫端一次都對。
   */
  if (r == null || r === "" || !Number.isFinite(Number(r))) return "?";
  const value = Number(r);
  const x =
    period === undefined && road === undefined
      ? rulesFor(code)
      : ruleHitFor(period, road, code).rules;
  return value >= x.A
    ? "A"
    : value >= x.B
      ? "B"
      : value >= x.C
        ? "C"
        : value >= x.D
          ? "D"
          : value >= x.E
            ? "E"
            : "F";
}
const losRank = { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
function matrix(wb, names) {
  const targets = (Array.isArray(names) ? names : [names]).map(normalize);
  let found = null;
  for (const target of targets) {
    found =
      wb.SheetNames.find((n) => normalize(n) === target) ||
      wb.SheetNames.find((n) => normalize(n).includes(target));
    if (found) break;
  }
  return found
    ? XLSX.utils.sheet_to_json(wb.Sheets[found], { header: 1, raw: true, defval: null })
    : null;
}
function metricAt(m, r, c) {
  // 只有「冒號後面就是數字」才算標籤自帶數值。
  // 舊版取整格文字的第一串數字，遇到「方向1平均總旅行速率：」「平均總旅行速率（07:30~08:30）」
  // 這類寫法會把標籤裡的 1 或 7 當成速率讀進來，整份資料的 LOS 全部變成 F。
  const label = String(m[r]?.[c] ?? "");
  // 冒號前面不能是數字，否則「（07:30~08:30）」這種時段字樣會被當成
  // 「冒號後面就是數字」，把 30 讀成速率——這一格明明只是標題，沒有數值。
  const inline = label.match(/(?:^|[^\d])[：:]\s*(-?\d+(?:\.\d+)?)\s*[^\d]*$/);
  if (inline) return +inline[1];
  // 往右找數值時，一碰到「另一個文字格」就停。真實版面同一列是
  //「平均總旅行速率｜21.08｜平均總行駛速率｜35.78」，原始檔若因為公式沒有
  // 快取值而讓 21.08 是空的，舊寫法會一路掃過「平均總行駛速率」這個標題，
  // 把 35.78 當成旅行速率讀進來——旅行速率與行駛速率變成同一個數字，
  // 服務水準直接差兩級，畫面上卻沒有任何異常。
  for (let dc = 1; dc <= 5; dc++) {
    const cell = m[r]?.[c + dc];
    const n = num(cell);
    if (n != null) return n;
    if (cell != null && String(cell).trim() !== "") break;
  }
  for (let dr = 1; dr <= 3; dr++)
    for (let dc = 0; dc <= 3; dc++) {
      const n = num(m[r + dr]?.[c + dc]);
      if (n != null) return n;
    }
  return null;
}
function findLabels(m, text) {
  const a = [];
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < (m[r]?.length || 0); c++)
      if (normalize(m[r][c]).includes(text)) a.push({ r, c });
  return a;
}
function nearestMetric(m, row, text) {
  let best = null;
  for (const p of findLabels(m, text)) {
    const dist = Math.abs(p.r - row);
    // 距離相同時要挑「在下方」的那個標籤。findLabels 由上往下掃，
    // 舊版嚴格小於的比較會讓上一個方向的行駛速率被誤讀成這個方向的。
    const better = !best || dist < best.dist || (dist === best.dist && p.r >= row);
    if (dist <= 3 && better) best = { ...p, dist };
  }
  return best ? metricAt(m, best.r, best.c) : null;
}
/**
 * 讀取某一個方向的延滯數值。
 *
 * 只在「這個方向自己的區塊」裡找標籤（區塊界線＝相鄰兩個平均總旅行速率標籤），
 * 否則第二個方向會抓到第一個方向的延滯表，兩個方向拿到一模一樣的數字卻毫無警告。
 * 區塊內找不到就回傳 null，讓這份檔案在預覽時明確報錯，而不是匯入錯的數值。
 */
function delayPart(m, row, text, bounds) {
  const from = bounds?.from ?? 0;
  const to = bounds?.to ?? m.length;
  let best = null;
  for (const p of findLabels(m, text)) {
    if (p.r < from || p.r >= to) continue;
    // 優先取「在速率標籤上方、且最靠近」的那一個；區塊內沒有才往下找。
    if (p.r <= row) {
      if (!best || best.r > row || p.r > best.r) best = p;
    } else if (!best) best = p;
  }
  if (!best) return null;
  const limit = Math.min(to - 1, best.r + 20);
  for (let r = best.r + 1; r <= limit; r++) {
    const cell = m[r]?.[best.c];
    const n = num(cell);
    if (n != null) return n;
    /* 與 valueBelowLabel 同一條規則：碰到下一個文字標籤就停，不撿鄰欄的值。 */
    if (cell != null && String(cell).trim() !== "") break;
  }
  return null;
}
/**
 * 把一張尖峰工作表切成「一趟旅次一個區塊」。
 *
 * 這是讀取這類報告最關鍵的一步。實際收到的調查表，一張「上午尖峰」工作表裡
 * 會有 6 趟旅次（每個方向 3 趟）上下疊在一起，每一趟的高度還不一樣（實測有
 * 37、40、61 列三種）；平均速率寫在該趟的最後一列，延滯表則寫在該趟的上方。
 * 只用「上一個平均速率標籤」當界線，或用「離哪個標籤最近」來猜，都會在某些
 * 版型把方向2 的延滯判給方向1（或反過來），而且錯了不會有任何提示。
 *
 * 改以「記錄分隔線」切塊就跟版面高度無關：先找每趟都會出現一次的「旅次編號」，
 * 沒有的話退而求其次用「重複出現的標題列」。兩者都找不到才回到舊的界線邏輯。
 */
function recordBlocks(m) {
  const starts = [];
  const push = (r) => {
    if (!starts.includes(r)) starts.push(r);
  };
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < (m[r]?.length || 0); c++)
      if (normalize(m[r][c]).includes("旅次編號")) {
        push(r);
        break;
      }
  if (starts.length < 2) {
    starts.length = 0;
    const firstRow = m.findIndex((row) => (row || []).some((v) => normalize(v)));
    const title =
      firstRow < 0 ? "" : normalize((m[firstRow] || []).find((v) => normalize(v)));
    // 標題太短（例如只有「1」）當分隔線太危險，會把整張表切碎。
    if (title.length >= 6)
      for (let r = 0; r < m.length; r++)
        if ((m[r] || []).some((v) => normalize(v) === title)) push(r);
  }
  if (starts.length < 2) return [];
  starts.sort((a, b) => a - b);
  return starts.map((from, i) => ({
    from,
    to: i + 1 < starts.length ? starts[i + 1] : m.length,
  }));
}
function labelsInBlock(m, block, text) {
  return findLabels(m, text).filter((p) => p.r >= block.from && p.r < block.to);
}
/** 讀標籤正下方最近的一個數字，只在同一個區塊內找。 */
/**
 * 從標籤往下找它的數值。
 *
 * 碰到「另一個非空文字格」就停——那代表已經越過這個標籤的地盤，
 * 進到下一個欄位了。`metricAt()` 早就這樣做（見它上方的註解：
 *「舊寫法會把 35.78 當成旅行速率讀進來」），但延滯這條路徑漏掉了。
 *
 * 漏掉的後果實測：路段延滯格填「N/A」「-」「休」**或空白**時，掃描會越過
 *「交叉口延滯」這個標籤列（文字，被跳過），撿到它下面的值——同一個數字被
 * 算兩次，導致總延滯被高估，而且 issue 為空、ok=true、靜靜寫入。
 * 程式與 README 三處都寫著「缺一項就判定讀取失敗」，實際上是匯入了鄰欄的值。
 */
function valueBelowLabel(m, p, block) {
  const limit = Math.min(block.to - 1, p.r + 20);
  for (let r = p.r + 1; r <= limit; r++) {
    const cell = m[r]?.[p.c];
    const n = num(cell);
    if (n != null) return n;
    /* 非空的文字格＝已經是下一個欄位，不能再往下撿。 */
    if (cell != null && String(cell).trim() !== "") break;
  }
  return null;
}
/** 取「方向　往：A--->B」的內容，用來判斷兩趟旅次是不是同一個方向。 */
function directionTextOf(m, block) {
  for (let r = block.from; r < block.to; r++)
    for (const v of m[r] || []) {
      const text = normalize(v);
      if (!text.startsWith("方向往")) continue;
      const parts = String(v).split(/[:：]/);
      if (parts.length > 1) return normalize(parts.slice(1).join(":"));
    }
  return "";
}
function rowFromBlockData(item, peak, index) {
  return {
    peak,
    direction: `方向${index + 1}`,
    // 報告上寫的方向文字（例如「大同路口--->中正路口」），只用於顯示，
    // 不參與任何計算，也不會變成資料的鍵值。
    directionText: item.directionText || "",
    travel: item.travel,
    running: item.running,
    roadDelay: item.roadDelay,
    junctionDelay: item.junctionDelay,
    // 路段延滯與交叉口延滯都是總延滯的必要組成，缺一不可。
    // 舊版把讀不到的那一項當成 0，會讓總延滯嚴重低估卻照樣通過檢核。
    totalDelay:
      item.roadDelay == null || item.junctionDelay == null
        ? null
        : item.roadDelay + item.junctionDelay,
  };
}
/** 以記錄區塊讀取。讀不出剛好兩個方向時，一律附上具體原因。 */
function parseByRecordBlocks(m, peak, blocks) {
  const found = [];
  // 同一個區塊裡出現兩個同名標籤（例如另外印了一份「平均總旅行速率(雙向)」），
  // 取第一個就結束會靜默拿到錯的值，而且跟跨區塊重複的守門標準不一致。
  let ambiguous = "";
  const single = (block, text) => {
    const hits = labelsInBlock(m, block, text);
    /*
     * 2026-09-18 使用者裁示（F-11／X-65）：擋下不寫入之外，要**指到格子**——
     * 寫出是哪幾格重複、要使用者去確認哪一格才是這一趟的值。
     */
    if (hits.length > 1 && !ambiguous)
      ambiguous =
        `「${peak}」工作表同一趟旅次裡有 ${hits.length} 個「${text}」（儲存格 ${hits
          .map((p) => XLSX.utils.encode_cell({ r: p.r, c: p.c }))
          .join("、")}）。本檔這一張工作表不會寫入：系統不會自行挑選或平均，` +
        `請打開原始檔核對這幾格，只保留這一趟真正的「${text}」（其餘刪除或改名）後重新匯入`;
    return hits[0] || null;
  };
  for (const block of blocks) {
    const travelLabel = single(block, "平均總旅行速率");
    if (!travelLabel) continue;
    const travel = metricAt(m, travelLabel.r, travelLabel.c);
    if (travel == null) continue;
    const runningLabel = single(block, "平均總行駛速率");
    const roadLabel = single(block, "路段延滯");
    const junctionLabel = single(block, "交叉口延滯");
    found.push({
      directionText: directionTextOf(m, block),
      travel,
      running: runningLabel ? metricAt(m, runningLabel.r, runningLabel.c) : null,
      roadDelay: roadLabel ? valueBelowLabel(m, roadLabel, block) : null,
      junctionDelay: junctionLabel
        ? valueBelowLabel(m, junctionLabel, block)
        : null,
    });
  }
  if (ambiguous) return { rows: [], issue: ambiguous };
  if (found.length < 2)
    return {
      rows: [],
      issue: `「${peak}」工作表切出 ${blocks.length} 趟旅次，但只有 ${found.length} 趟讀得到「平均總旅行速率」（應為 2 趟：兩個調查方向各一）`,
    };
  const groups = [];
  found.forEach((item, index) => {
    // 沒寫方向文字時，每一筆自成一個方向（等同以出現順序區分）。
    const key = item.directionText || `#${index}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(item);
    else groups.push({ key, items: [item] });
  });
  if (groups.length !== 2)
    return {
      rows: [],
      issue: `「${peak}」工作表讀到 ${groups.length} 個調查方向（應為 2 個）：${groups
        .map((g) => (g.key.startsWith("#") ? "未標示方向" : g.key))
        .join("、")}`,
    };
  const duplicated = groups.find((g) => g.items.length > 1);
  if (duplicated)
    return {
      rows: [],
      issue: `「${peak}」工作表中方向「${duplicated.key}」有 ${duplicated.items.length} 個「平均總旅行速率」，系統不會自行挑選或平均，請確認報告只保留一個代表值`,
    };
  return {
    rows: groups.map((g, i) => rowFromBlockData(g.items[0], peak, i)),
    issue: "",
  };
}
/** 舊解法：整張表只有兩個「平均總旅行速率」、沒有記錄分隔線時使用。 */
function parseByTravelAnchors(m, peak) {
  const travels = findLabels(m, "平均總旅行速率");
  // 一張尖峰工作表應該剛好有兩個方向。多出來（例如另有一個雙向平均區塊）
  // 或少於兩個時，寧可讓這份檔案在預覽時報錯，也不要用位置去猜哪兩個是方向1、2——
  // 猜錯會把「雙向平均」當成方向1，真正最差的那個方向反而整個不見。
  if (travels.length !== 2)
    return {
      rows: [],
      issue: `「${peak}」工作表找到 ${travels.length} 個「平均總旅行速率」區塊（應為 2 個：方向1、方向2），系統不會猜測哪兩個才是調查方向`,
    };
  /*
   * 「平均總行駛速率」也要數。
   *
   * 旅行速率這一邊早就不准多也不准少（上面那一段），行駛速率這一邊卻只用
   * nearestMetric() 取「離這個方向最近的那一個」。調查員把文字打錯、變成同一個
   * 方向裡有兩筆「平均總行駛速率」時，最近的那個會被靜靜選走，issue 空的、
   * ok=true，數值就這樣進資料庫——而且兩個數字若剛好都合物理常識，
   * implausibleReason() 也攔不到。與區塊解法的 single() 是同一條標準：
   * 系統不替調查資料做決定，看到兩個就報錯。
   */
  const bounds = travels.map((p, i) => ({
    from: travels[i - 1] ? travels[i - 1].r + 1 : 0,
    to: travels[i + 1] ? travels[i + 1].r : m.length,
  }));
  const runnings = findLabels(m, "平均總行駛速率");
  for (let i = 0; i < bounds.length; i += 1) {
    const inside = runnings.filter(
      (q) => q.r >= bounds[i].from && q.r < bounds[i].to,
    );
    if (inside.length > 1)
      return {
        rows: [],
        issue:
          `「${peak}」工作表中方向${i + 1}有 ${inside.length} 個「平均總行駛速率」（儲存格 ${inside
            .map((q) => XLSX.utils.encode_cell({ r: q.r, c: q.c }))
            .join("、")}）。本檔這一張工作表不會寫入：系統不會自行挑選或平均，` +
          `請打開原始檔核對這幾格，只保留方向${i + 1} 真正的「平均總行駛速率」（其餘刪除或改名）後重新匯入`,
      };
  }
  const rows = travels.map((p, i) => {
    return rowFromBlockData(
      {
        directionText: "",
        travel: metricAt(m, p.r, p.c),
        running: nearestMetric(m, p.r, "平均總行駛速率"),
        roadDelay: delayPart(m, p.r, "路段延滯", bounds[i]),
        junctionDelay: delayPart(m, p.r, "交叉口延滯", bounds[i]),
      },
      peak,
      i,
    );
  });
  return { rows, issue: "" };
}
/**
 * 讀取一張尖峰工作表，回傳 { rows, issue }。
 *
 * 這裡不再用函式屬性傳遞診斷訊息：呼叫端會連續讀上午與下午兩張表，
 * 第二次呼叫一開始就會把第一次的訊息清掉，於是「問題出在上午尖峰」時
 * 使用者永遠看不到具體原因，只剩最泛用的那一句。
 *
 * 另外：只有在「切不出記錄分隔線」時才退回舊解法。區塊解法若已經明確
 * 判定版面有問題（例如兩趟旅次其實是同一個方向），那是陽性診斷，不能
 * 被舊解法覆蓋成靜默成功——舊解法只數整張表有幾個平均速率，看不出
 * 那兩個屬於同一個方向。
 */
function parsePeakSheet(m, peak) {
  if (!m) return { rows: [], issue: "" };
  const blocks = recordBlocks(m);
  if (blocks.length >= 2) return parseByRecordBlocks(m, peak, blocks);
  return parseByTravelAnchors(m, peak);
}
/**
 * 讀出來的四個數字合不合物理常識。
 *
 * 旅行速率是「含延滯」的速率，行駛速率是「不含延滯」的速率，所以
 * 旅行速率一定不會大於行駛速率；有延滯時一定嚴格小於。這條不變式幾乎
 * 不花成本，卻能擋掉「讀到隔壁欄位」這一整類錯誤——那類錯誤最可怕的
 * 地方在於數字看起來很正常，只是屬於別的欄位，事後完全查不出來。
 */
function implausibleReason(r) {
  const label = `${r.peak}／${r.directionText || r.direction}`;
  if (!(r.travel > 0)) return `${label} 的旅行速率不是正數（讀到 ${r.travel}）`;
  if (!(r.running > 0)) return `${label} 的行駛速率不是正數（讀到 ${r.running}）`;
  // 浮點數比較留一點餘裕，避免四捨五入造成誤判。
  const tolerance = 0.01;
  if (r.travel > r.running + tolerance)
    return `${label} 的旅行速率 ${r.travel.toFixed(2)} 大於行駛速率 ${r.running.toFixed(2)}，數值可能讀到相鄰欄位`;
  if (r.totalDelay > 0 && Math.abs(r.travel - r.running) < tolerance)
    return `${label} 有 ${r.totalDelay.toFixed(1)} 秒延滯，旅行速率卻等於行駛速率，數值可能讀到相鄰欄位`;
  return "";
}
/*
 * ────────────────────────────────────────────────────────────────
 *  Excel 解析的邊界防護
 * ────────────────────────────────────────────────────────────────
 * 這一套的 SheetJS 已經是官方 0.20.3（原型污染警示的修正版），所以下面
 * 這一層是「多一道」而不是「唯一一道」：
 *   1. 解析時關掉用不到的路徑（公式、內嵌 HTML、VBA 巨集）。這支程式只讀
 *      儲存格的值，那些一個都不需要，關掉就少一片攻擊面。
 *   2. 解析前後比對 Object.prototype 的自有屬性；多出來就代表這個檔案真的
 *      動到了原型：刪掉、中止這次匯入、並指出是哪一個檔案。安靜地清掉更
 *      危險——使用者會以為那個檔案沒問題。
 * 這樣即使日後 SheetJS 又退回舊版、或出現新的解析漏洞，也不會無聲通過。
 */
const SAFE_XLSX_READ_OPTIONS = {
  type: "array",
  cellFormula: false,
  cellHTML: false,
  bookVBA: false,
};
function prototypeFingerprint() {
  return Object.getOwnPropertyNames(Object.prototype);
}
function detectPrototypePollution(before) {
  const known = new Set(before);
  const added = Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => !known.has(name),
  );
  for (const name of added) {
    try {
      delete Object.prototype[name];
    } catch {
      /* 刪不掉也要照樣往下報告 */
    }
  }
  return added;
}
function assertNoPrototypePollution(before, fileLabel) {
  const added = detectPrototypePollution(before);
  if (!added.length) return;
  throw new Error(
    `「${fileLabel}」在解析過程中試圖修改瀏覽器的內建物件（${added.join("、")}），` +
      "本次匯入已中止，系統資料沒有變動。請確認這個檔案的來源。",
  );
}

/*
 * ── 調查日期 × 期別 ─────────────────────────────────────────
 *
 * 從表頭讀出調查日期，交給 period-date.js 判斷是不是和使用者選的季度相符。
 * 這一段**完全獨立於 parsePeakSheet／matrix**：它自己開活頁簿掃表頭前 12 列，
 * 不經過任何一條讀速率、延滯或 LOS 的路徑，所以不可能改到任何數值。
 *
 * 不看固定欄位位置——各家報表的日期欄擺放都不一樣（實測看過
 * 上午!AB3、統計表 (1)!B2 這兩種）。
 */
function headerTextsOf(wb) {
  const texts = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet || !sheet["!ref"]) continue;
    let range;
    try {
      range = XLSX.utils.decode_range(sheet["!ref"]);
    } catch {
      continue;
    }
    for (let r = range.s.r; r <= Math.min(range.e.r, 12); r++)
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const text = String(cell.w ?? cell.v ?? "").trim();
        if (text) texts.push(text);
      }
  }
  return texts;
}
function roadFromWorkbook(wb) {
  for (const text of headerTextsOf(wb)) {
    const match = text.match(/站\s*名\s*[：:]\s*(.+)$/);
    if (match) {
      /*
       * 合併儲存格的表頭常常把站名與方向／備註排在同一格
       *（「站名：中正路(甲街～乙街)  方向：北往南」）。`(.+)$` 會把後面
       * 整串吃進來，於是無聲長出一個幽靈路段。截到下一個「標籤：」為止。
       */
      const cut = match[1].split(/\s{2,}|　|(?=[\u4e00-\u9fa5]{2,6}\s*[：:])/)[0];
      /*
       * 表頭來的名稱也要走與檔名路徑相同的案號剝除，否則舊模板（無站名）
       * 匯入「中正路」、新模板（站名含案號）匯入「99999TS1-01-中正路」，
       * 同一條路段會被拆成兩個。
       */
      const value = stripRoadSuffix(
        cut.trim().replace(/^\d+\s*TS\s*\d+-?\d*[-－]?/i, ""),
      );
      if (value) return value;
    }
  }
  return "";
}
function dayFromWorkbook(wb) {
  for (const text of headerTextsOf(wb)) {
    /*
     * 要排除「製表日期」「列印日期」這類非調查日期。
     * period-date.js 的 findSurveyDate() 早就有這份排除清單，但那只作用在
     * 日期本身；平假日這條路徑若不比照辦理，表頭同時有
     *「製表日期：115年3月1日(假日)」與「日期：115年1月26日(平日)」時，
     * 會依掃描順序回傳「假日」——而日別是資料識別鍵的一部分。
     */
    if (globalThis.PeriodDate.isNonSurveyDateText(text)) continue;
    const match = text.match(/日\s*期\s*[：:][^（(]*[（(]\s*(平日|假日)\s*[）)]/);
    if (match) return match[1];
  }
  return "";
}
function surveyDateFromWorkbook(wb) {
  const cells = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet || !sheet["!ref"]) continue;
    let range;
    try {
      range = XLSX.utils.decode_range(sheet["!ref"]);
    } catch {
      continue;
    }
    for (let r = range.s.r; r <= Math.min(range.e.r, 12); r++)
      for (let c = range.s.c; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[address];
        if (!cell) continue;
        const text = String(cell.w ?? cell.v ?? "").trim();
        if (text) cells.push({ text, sheet: name, cell: address });
      }
  }
  const found = globalThis.PeriodDate.findSurveyDate(cells);
  /*
   * 同一份活頁簿裡出現「兩個都有標示、但不同季度」的調查日期時要講出來。
   *
   * findSurveyDate() 取第一個有標示的就回傳，這在單一日期時是對的；
   * 但實測 11535TS1501／1502／1503 三份真實檔，上午尖峰的表頭寫 115Q1、
   * 下午尖峰卻還留著上一季的 114Q4（套模板時忘了改），系統只看到前者，
   * 於是回報「調查日期與所選期別相符」——對一份自己前後矛盾的檔案發出
   * 無保留的通過。這支程式對路段名稱（roadConflict）與平假日（dayConflict）
   * 都已經會回報來源衝突，日期是唯一漏掉的一個。
   */
  if (!found) return found;
  const others = [];
  for (const item of cells) {
    if (globalThis.PeriodDate.isNonSurveyDateText(item.text)) continue;
    if (!globalThis.PeriodDate.isLabelledSurveyDateText(item.text)) continue;
    const iso = globalThis.PeriodDate.parseSurveyDateText(item.text);
    if (!iso || iso === found.iso) continue;
    if (!others.some((o) => o.iso === iso))
      others.push({ iso, sheet: item.sheet, cell: item.cell });
  }
  return others.length ? { ...found, conflicts: others } : found;
}

/*
 * 期別在畫面上要顯示成什麼：季別（115Q1）或實際調查月份（115年2、3月）。
 * **只換顯示的文字**——分組、排序、鍵值、計算與匯出的數值一律仍以 period 為準。
 */
function periodLabelFromRows(period, rows) {
  const yearStyle = state.yearStyle === "ad" ? "ad" : "roc";
  if (state.periodDisplay !== "month")
    return globalThis.PeriodDate.quarterInYearStyle(period, yearStyle);
  const dates = (rows || [])
    .filter((x) => x.period === period && x.surveyDate)
    .map((x) => x.surveyDate);
  return globalThis.PeriodDate.periodDisplayLabel(period, dates, "month", yearStyle);
}
/** 目前 Project 的期別顯示，只能採用目前計畫自己的原始明細日期。 */
function projectPeriodLabel(period, projectCode = state.activeCode) {
  return periodLabelFromRows(
    period,
    state.details.filter((x) => x.projectCode === projectCode),
  );
}
/**
 * 目前這個計畫的明細裡有沒有調查日期——沒有就把期別切換鈕停用並寫明原因。
 *
 * ⚠️ 範圍就是**目前這一個計畫**，不要再擴大。
 *   舊版另有一支 anySurveyDate()，掃的是「這台電腦上全部計畫＋全部 Manager
 *   專案包」，但月份顯示（projectPeriodLabel）只看目前這一個計畫。兩者範圍
 *   不一致時，A 計畫有日期、切到舊資料的 B 計畫按鈕仍可按，按下去每一格
 *   卻還是 115Q1，畫面上沒有一個字說明為什麼。
 *   Manager 於 2026-09-13 移除後 anySurveyDate() 沒有任何呼叫者，一併刪除。
 */
function activeProjectHasSurveyDate() {
  return state.details.some(
    (x) => x.projectCode === state.activeCode && x.surveyDate,
  );
}

async function parseFile(file, year, q, defSpeed) {
  const p = activeProject();
  const fingerprint = prototypeFingerprint();
  const wb = XLSX.read(await file.arrayBuffer(), SAFE_XLSX_READ_OPTIONS);
  assertNoPrototypePollution(fingerprint, file.name);
  /* 表頭調查日期。只作顯示與期別檢查用，不參與任何速率、延滯或 LOS 計算。 */
  const surveyDateFound = surveyDateFromWorkbook(wb);
  /*
   * 路段名稱與平假日一律「內容優先、檔名備援」。
   * 這兩個欄位是資料識別鍵（見下方 id 的組成），而調查表表頭本來就寫著
   * 「站名：台1(中山南路~…)」與「日期：…(平日)」——先讀內容，
   * 檔名就不再是決定資料歸屬的因素。
   */
  const roadFromContent = roadFromWorkbook(wb),
    dayFromContent = dayFromWorkbook(wb),
    roadFromName = roadFromFile(file.name),
    dayFromName = dayFromFile(file.name),
    road = roadFromContent || roadFromName,
    roadSource = roadFromContent ? "工作表「站名：」欄位" : "檔名",
    day = dayFromContent || dayFromName,
    daySource = dayFromContent ? "工作表日期欄的括號" : "檔名",
    /*
     * 兩個來源都算得出來、卻互相矛盾時要講出來，不能靜靜取其一。
     *
     * 最危險的情境：調查員把平日檔另存成假日檔、忘了改表頭的「(平日)」，
     * 但檔名正確寫成「…-假日.xlsx」。內容優先會靜靜記成平日，而 upsert
     * 依 id 覆蓋——真正的平日那一筆就被蓋掉了。同批匯入時碰撞檢查擋得住，
     * **分批匯入（平日上週、假日今天）就完全無聲**，假日資料人間蒸發。
     */
    dayConflict = Boolean(dayFromContent && dayFromName && dayFromContent !== dayFromName),
    roadConflict = Boolean(
      roadFromContent && roadFromName && normalize(roadFromContent) !== normalize(roadFromName),
    ),
    morning = matrix(wb, ["上午尖峰", "上午", "AM尖峰", "AM"]),
    afternoon = matrix(wb, ["下午尖峰", "下午", "PM尖峰", "PM"]);
  /*
   * 路段名稱與平假日都是識別鍵的一部分，判讀不出來時必須當成錯誤退回，
   * 不能給一個猜出來的值繼續往下走——那會安靜地把資料寫到錯的路段或
   * 錯的日別，而使用者永遠不會知道。訊息要說得出「改檔名就能解決」。
   */
  if (!road)
    throw new Error(
      "工作表表頭找不到「站名：」欄位，檔名也讀不出路段名稱。請確認調查表表頭有站名，" +
        "或將檔名改為「<案號>TS<站號>-<路段名稱>-平日.xlsx」的格式，例如 99999TS1-01-中正路(甲街～乙街)-平日.xlsx",
    );
  if (!day)
    throw new Error(
      `工作表日期欄沒有註明「(平日)」或「(假日)」，檔名也判斷不出來${
        /平日/.test(file.name) && /假日/.test(file.name)
          ? "（檔名同時出現「平日」與「假日」）"
          : "（檔名沒有「平日」或「假日」字樣）"
      }。請在檔名結尾加上「-平日」或「-假日」後重新選取，例如 ${String(file.name).replace(/\.(xlsx?|xlsm)$/i, "-平日.$1")}`,
    );
  const am = parsePeakSheet(morning, "上午尖峰");
  const pm = parsePeakSheet(afternoon, "下午尖峰");
  const rows = [...am.rows, ...pm.rows];
  // 兩張表的診斷都要留著。舊寫法把訊息放在函式屬性上，下午那次呼叫會把
  // 上午的訊息洗掉，而上午永遠先解析，等於上午的問題永遠看不到原因。
  const blockIssue = [am.issue, pm.issue].filter(Boolean).join("；");
  for (const r of rows) {
    const k = `${p.code}|${road}|${r.direction}`;
    // 匯入預覽也要走「速限版本」那一套。舊版只看 state.limits，於是設過
    // 速限版本的路段，預覽 LOS 是用預設速限算的，按下確認寫入之後 rebuild()
    // 才換成版本速限，同一批資料在預覽與匯入結果顯示成兩種服務水準。
    const context = {
      projectCode: p.code,
      road,
      direction: r.direction,
      period: `${year}Q${q}`,
    };
    const version = globalThis.speedVersionFor?.(context) || null;
    const base = Number(state.limits[k]);
    const limit = version
      ? Number(version.speed)
      : Number.isFinite(base) && base > 0
        ? base
        : Number(defSpeed) > 0
          ? Number(defSpeed)
          : 50;
    Object.assign(r, {
      id: `${p.code}|${year}|Q${q}|${road}|${day}|${r.peak}|${r.direction}`,
      projectCode: p.code,
      projectName: p.name,
      year: +year,
      quarter: +q,
      period: `${year}Q${q}`,
      road,
      roadSource,
      day,
      daySource,
      dayConflict,
      roadConflict,
      limit,
      // 報告上寫的方向文字，只作顯示用；方向的鍵值仍是方向1／方向2。
      directionText: r.directionText || "",
      limitSource: version ? version.source || "" : "",
      limitVersionStart: version ? version.start : "",
      ratio: r.travel == null ? null : r.travel / limit,
      /* ⚠️ 傳季別與路段：門檻可以依「季別 × 路段」覆寫（使用者 2026-09-15）。
         匯入預覽不傳的話，預覽顯示的等級會與寫入後的不同。 */
      los:
        r.travel == null
          ? "?"
          : losOf(r.travel / limit, state.activeCode, `${year}Q${q}`, r.road),
      source: file.name,
      /* 只作顯示用；rowKey 與 id 都不含它，覆蓋判斷完全不受影響。 */
      surveyDate: surveyDateFound ? surveyDateFound.iso : "",
    });
  }
  const complete =
    rows.length === 4 &&
    rows.every((r) => r.travel != null && r.running != null && r.totalDelay != null);
  const implausible = complete ? rows.map(implausibleReason).filter(Boolean) : [];
  const ok = complete && !implausible.length;
  const sheetError =
    !morning || !afternoon
      ? "找不到上午／下午工作表（支援名稱：上午尖峰、下午尖峰、上午、下午、AM、PM）"
      : "";
  return {
    file: file.name,
    road,
    roadSource,
    day,
    daySource,
    dayConflict,
    roadConflict,
    conflictNote: dayConflict
      ? `表頭寫「${dayFromContent}」、檔名寫「${dayFromName}」，兩者不一致。系統採用表頭的「${dayFromContent}」——若檔名才是對的，請先修正表頭或改檔名後重新預覽。`
      : roadConflict
        ? `表頭的站名「${roadFromContent}」與檔名切出來的「${roadFromName}」不一致。系統採用表頭的名稱。`
        : /*
           * 同一份檔案出現兩個不同的調查日期時，比照路段名稱與平假日一樣
           * 講出來。常見成因是套用上一季的模板卻只改了其中一張工作表的
           * 表頭，於是上午與下午分屬不同季度。
           */
          surveyDateFound?.conflicts?.length
          ? `這份檔案有兩個不同的調查日期：${globalThis.PeriodDate.readableDate(surveyDateFound.iso)}（${surveyDateFound.sheet}!${surveyDateFound.cell}）與 ${surveyDateFound.conflicts
              .map(
                (c) =>
                  `${globalThis.PeriodDate.readableDate(c.iso)}（${c.sheet}!${c.cell}）`,
              )
              .join("、")}。系統採用前者做期別檢查，請確認表頭是否有一處忘了更新。`
          : "",
    rows,
    surveyDateFound,
    ok,
    error: ok
      ? ""
      : sheetError ||
        blockIssue ||
        implausible[0] ||
        (rows.length !== 4 ? "無法辨識完整4筆尖峰方向資料" : "速率或延滯欄位缺少數值"),
  };
}
function rebuild() {
  /*
   * 資料一動，畫面上的資料異常檢查結果就是舊的。以前不標示，使用者匯入一整季
   * 新資料之後，品質總覽仍然顯示上一次的筆數與路段清單，而且四個統計數字
   * 看起來就像是「現在的」結果——新路段的問題完全看不到。
   */
  if (healthChecked) healthStale = true;
  const groups = {};
  for (const d of state.details) {
    /* ⚠️ 傳季別與路段：門檻可以依「季別 × 路段」覆寫（使用者 2026-09-15）。 */
    d.los = d.ratio == null ? "?" : losOf(d.ratio, d.projectCode, d.period, d.road);
    const k = [d.projectCode, d.year, d.quarter, d.road, d.day].join("|");
    (groups[k] ??= []).push(d);
  }
  state.summaries = Object.values(groups).map((rows) => {
    const w = worstOfGroup(rows);
    return { ...w, detailCount: rows.length };
  });
}
/**
 * 一組資料裡「最差」的那一筆。
 *
 * ⚠️ **全系統只有這一支**。主工具列篩了方向或尖峰時，
 *   彙總要「先篩再挑最差」，而那個「挑最差」必須與這裡完全相同；
 *   在兩個地方各寫一份排序，遲早分岔成兩種代表值，
 *   而且兩邊看起來都正常。
 *
 * 規則（沿用既有行為，一個字都沒改）：
 *   先取 LOS 最差 → 再取速限比最低 → 再取旅行速率最低。
 */
function worstOfGroup(rows) {
  const sorted = [...rows].sort(
    (a, b) =>
      (losRank[a.los] || 9) - (losRank[b.los] || 9) ||
      (a.ratio ?? 9) - (b.ratio ?? 9) ||
      (a.travel ?? 999) - (b.travel ?? 999),
  );
  return sorted[0];
}
function upsert(rows) {
  const map = new Map(state.details.map((x) => [x.id, x]));
  rows.forEach((x) => map.set(x.id, x));
  state.details = [...map.values()];
  for (const d of rows) {
    const k = `${d.projectCode}|${d.road}|${d.direction}`;
    if (!state.limits[k]) state.limits[k] = d.limit;
  }
  adoptDirectionNames(rows);
  rebuild();
}
/**
 * 報告上寫著「方  向  往：大同路口--->中正路口」，把它拿來當方向的顯示名稱。
 *
 * 只在使用者還沒自己命名時才填（預設值是「方向1」「方向2」，看不出哪個方向
 * 是哪一邊）。方向的鍵值仍然是方向1／方向2，不會因此改變，既有資料不受影響；
 * 使用者之後在「路段管理」改成別的名稱也不會被這裡蓋掉。
 */
function adoptDirectionNames(rows) {
  for (const d of rows) {
    if (!d.directionText) continue;
    const key = roadMetaKey(d.road, d.projectCode);
    const meta = state.roadMeta[key] || {
      directionA: "方向1",
      directionB: "方向2",
    };
    const field = d.direction === "方向1" ? "directionA" : "directionB";
    const fallback = d.direction === "方向1" ? "方向1" : "方向2";
    if (meta[field] && meta[field] !== fallback) continue;
    state.roadMeta[key] = { ...meta, [field]: d.directionText };
  }
}

$("saveProject").onclick = async () => {
  const code = $("projectCode").value.trim(),
    name = $("projectName").value.trim();
  if (!code || !name) return toast("請完整輸入計畫編號與名稱");
  // 所有設定都以「計畫編號|…」當鍵值，編號含有「|」會讓刪除計畫時
  // 連同另一個計畫的設定一起被清掉。
  if (code.includes("|")) return toast("計畫編號不可包含「|」符號");
  const i = state.projects.findIndex((p) => p.code === code);
  if (i >= 0) state.projects[i] = { code, name };
  else state.projects.push({ code, name });
  // 換了作用中的計畫就要清掉上一個計畫的預覽與資料異常檢查結果，
  // 否則新計畫會看到別人的路段清單與異常項目（切換下拉選單有清，這裡漏了）。
  const switched = state.activeCode !== code;
  state.activeCode = code;
  if (switched) clearPendingPreview();
  await save();
  toast(i >= 0 ? "計畫設定已更新" : "新計畫已建立");
  go("import");
};
enableFileDrop(document.querySelector("label.drop"), $("files"));
/*
 * (2) 選檔期間的提示。
 *
 * 使用者回報「按下選擇檔案之後畫面什麼都沒有，等很久才跳出已選取 X 份」。
 * 實測過原因：change 一送到，畫面 **0ms** 就更新了——那段等待完全發生在
 * 瀏覽器把檔案準備好之前，我們的程式那時候根本還沒被叫到，
 * 所以沒辦法在「等待中」才開始顯示提示。
 *
 * 只能從「使用者按下去」的那一刻就先顯示，等 change 到了再讓原本的
 * onchange 覆蓋成「已選取 X 份」。
 *
 * 取消選取時不會有 change，所以要靠視窗重新取得焦點當退路；
 * 有選檔時 change 會很快到，這裡等 1.2 秒再判斷，避免把正常情況誤判成取消。
 */
(() => {
  const input = $("files");
  const info = $("fileInfo");
  const HINT = "正在讀取您選擇的檔案，請稍候…";
  let picking = false;
  let previousText = "";
  let cancelTimer = 0;
  const stopPicking = () => {
    window.clearTimeout(cancelTimer);
    cancelTimer = 0;
    if (!picking) return;
    picking = false;
    window.removeEventListener("focus", onWindowFocus);
  };
  const onWindowFocus = () => {
    /*
     * 只留一顆計時器。舊版每次 focus 都排一顆，連按兩次選檔時第一顆會在
     * 第二次的空窗期中途觸發，把提示收掉又寫回舊字串。
     */
    window.clearTimeout(cancelTimer);
    cancelTimer = window.setTimeout(() => {
      if (!picking) return;
      /* 等到焦點回來卻仍然沒有 change：使用者按了取消 */
      stopPicking();
      info.textContent = previousText || "尚未選取檔案";
    }, 1200);
  };
  input.addEventListener("click", () => {
    if (input.disabled) return;
    /* 新一輪選檔開始時，先使上一輪取消所排的退路計時器失效。 */
    window.clearTimeout(cancelTimer);
    cancelTimer = 0;
    /*
     * ⚠️ previousText 只在「還沒進入選檔狀態」時記錄。
     *
     * 舊版無條件記錄，於是連按兩次選檔時，第二次會把提示字串本身記成
     * 「原本的文字」；等計時器回寫，畫面就永久停在「正在讀取…」，
     * 而退路已經被拆掉，再也收不掉。實測：連按兩次取消之後，
     * 提示留在畫面上，等 3 秒也不會消失。
     */
    if (!picking) previousText = info.textContent;
    picking = true;
    info.textContent = HINT;
    window.removeEventListener("focus", onWindowFocus);
    window.addEventListener("focus", onWindowFocus);
  });
  input.addEventListener("change", stopPicking);
})();
$("files").onchange = () => {
  $("fileInfo").textContent = $("files").files.length
    ? `已選取 ${$("files").files.length} 份檔案`
    : "尚未選取檔案";
};
$("preview").onclick = async () => {
  if (!activeProject()) return toast("請先完成計畫設定");
  const files = [...$("files").files],
    rawYear = $("rocYear").value,
    q = $("quarter").value;
  if (!files.length || !rawYear) return toast("請輸入年份並選取檔案");
  /*
   * 民國與西元都收，但**寫進資料時一律換算成民國年**。
   *
   * 年份會直接組成 period（`${year}Q${q}`）與紀錄 id，是資料的識別鍵之一。
   * 若照打的字原樣存，同一季會因為寫法不同而變成兩個不同的鍵：115Q1 與
   * 2026Q1 會並列成兩季、歷季比較被拆成兩段，而且永遠不會合併。
   * 三支系統都採同一個規則（民國年為準），正規化邏輯在共用的 period-date。
   *
   * 範圍檢查仍然保留：舊版完全不檢查，打錯成 1145 或 114.5 會產生一個
   * 「1145Q1」的幽靈季度，之後所有期間比較、速限版本與成果範圍都比對不到它，
   * 只能用刪除季度才清得掉。
   */
  const yearNumber = Number(rawYear);
  const isRocYear =
    Number.isInteger(yearNumber) && yearNumber >= 90 && yearNumber <= 200;
  const isAdYear =
    Number.isInteger(yearNumber) && yearNumber >= 2001 && yearNumber <= 2111;
  if (!isRocYear && !isAdYear)
    return toast("年份請輸入民國 90～200，或西元 2001～2111（會換算成民國年記錄）");
  const year = String(isAdYear ? yearNumber - 1911 : yearNumber);
  if (!window.XLSX) return toast("Excel 讀取元件尚未載入，請確認網路後重新整理");
  /*
   * ── 判讀中的提示 ──
   *
   * 舊版只有兩個動作：按鈕變灰、右邊「辨識預覽」的小字改成「讀取中…」。
   * 使用者回報「上傳大量檔案後以為沒成功」，原因不是程式沒反應——實測
   * 24 份 64KB 的檔案要 5.7 秒，這段期間「讀取中…」確實顯示著、畫面也沒卡死
   * ——而是那行字**在畫面另一側、很小、而且一動也不動**，
   * 按鈕本身文字又完全沒變，看起來就跟當掉一樣。
   *
   * 改成三件事同時做：
   *  ・按鈕本身變成「讀取中… 3／24」，使用者按完之後眼睛就在那裡
   *  ・檔案資訊列同步顯示正在讀哪一個檔名
   *  ・每讀完一份就讓瀏覽器有機會重畫（見下方 breathe()）
   */
  const previewButton = $("preview");
  const fileInput = $("files");
  const originalLabel = previewButton.textContent;
  previewButton.disabled = true;
  fileInput.disabled = true;
  /*
   * 從這裡到函式結尾包一層 try/catch/finally。
   *
   * 迴圈裡每一份檔案都有自己的 try/catch，但**迴圈之後**的整理步驟
   * （pendingPeriodChecks、analyzeRoads、renderPreview）沒有任何保護。
   * 那裡一丟例外，「讀取並預覽」就永遠停用、狀態欄卡在「讀取中…」，
   * 使用者只能重新整理頁面——實測確認過。
   * 其他交通調查系統已處理過同一類問題，這一支現在也採相同防護。
   */
  try {
  const showProgress = (done) => {
    previewButton.textContent = `讀取中… ${done}／${files.length}`;
    $("previewStatus").textContent = `讀取中… 已完成 ${done}／${files.length} 份`;
  };
  /*
   * 讓出主執行緒一個「巨集任務」的時間。
   *
   * 只有 await 一個已完成的 Promise 是不夠的——那只讓出微任務，
   * 瀏覽器不會重畫，進度數字會整批卡到最後才一次跳完。
   * setTimeout(0) 才會讓畫面真的更新。
   *
   * 誠實記一筆：突變測試把這裡改成 Promise.resolve()（只讓出微任務）時，
   * e2e-progress.mjs **仍然全綠**——因為匿名測資太小，parseFile 內部的
   * await 本來就足以讓畫面重畫。也就是說這一行目前沒有被守門測試釘住。
   * 保留它是為了真實尺寸的調查檔：那時 XLSX 的同步解析會長時間占住
   * 主執行緒，少了這一步進度就會整批卡到最後才跳完。
   */
  const breathe = () => new Promise((done) => setTimeout(done, 0));
  /*
   * (1) 第一次解析之前，要**確定畫面已經重繪過**。
   *
   * setTimeout(0) 只是讓出一個巨集任務，不保證瀏覽器有機會畫。
   * 實測：6 份大檔時，狀態欄停在「讀取中… 已完成 0／6 份」，
   * 中間每 20ms 的心跳整段只跳了 1 次——單一檔案解析的過程主執行緒
   * 完全被佔住，畫面零重繪。使用者因此看不到提示，
   * 連作業系統的檔案對話框關閉後的殘影都留在畫面上。
   *
   * 這裡改用「等兩個動畫影格再走」，那時候畫面確定已經更新過。
   * ⚠️ 分頁在背景時 requestAnimationFrame 不會觸發，所以一定要有時間退路，
   *    否則匯入會永遠停住。
   */
  const paint = () =>
    new Promise((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        done();
      };
      const fallback = setTimeout(finish, 250);
      if (typeof requestAnimationFrame === "function")
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(fallback);
            finish();
          }),
        );
    });
  showProgress(0);
  await paint();
  pending = [];
  roadPicks = new Set();
  let done = 0;
  for (const f of files) {
    $("fileInfo").textContent = `讀取中：${f.name}（第 ${done + 1}／${files.length} 份）`;
    await breathe();
    try {
      pending.push(await parseFile(f, year, q, $("defaultSpeed").value));
    } catch (e) {
      /*
       * 錯誤訊息要原樣傳給使用者。
       *
       * 舊寫法是 `String(e?.name || e?.message)`——`new Error()` 的 `.name`
       * 恆為 "Error"（真值），所以 `.message` **永遠讀不到**，每一種失敗都被
       * 顯示成「檔案無法開啟或格式不支援」。被吞掉的包括：
       *  ・「表頭找不到站名、檔名也讀不出路段名稱，請改成 …-平日.xlsx」
       *  ・「日期欄沒有註明(平日)/(假日)」（連建議檔名都算好了）
       *  ・**原型污染中止**這種安全訊息，被降級成「格式不支援」
       * 使用者只會去懷疑 Excel 版本、重存檔，永遠不會想到是檔名問題。
       */
      const detail = String(e?.message || "").trim();
      const changed = /NotReadable|not be read|changed/i.test(
        detail + " " + String(e?.name || ""),
      );
      pending.push({
        file: f.name,
        rows: [],
        ok: false,
        error: changed
          ? "這個檔案在選取之後被修改過，請重新選取一次檔案再預覽"
          : detail || "檔案無法開啟或格式不支援",
      });
    }
    done += 1;
    showProgress(done);
    await breathe();
  }
  $("fileInfo").textContent = `已選取 ${files.length} 份檔案`;
  // 記住這次預覽的條件。寫入時要用這一份，而不是當下輸入框的值：
  // 使用者若在預覽後才改民國年或季度，舊版會把資料寫進「預覽時的季度」，
  // 卻把「改過的季度」記進匯入紀錄，兩邊不一致而且完全看不出來。
  pendingContext = { year, quarter: q, projectCode: state.activeCode };
  /*
   * 調查日期 × 期別。判斷邏輯在 period-date.js（三支程式同一份）。
   * 這裡只算結果，**不阻擋**——讀不到日期只提醒，對不起來才在按
   *「確認寫入」時多問一次。
   */
  pendingPeriodChecks = pending.map((item) =>
    globalThis.PeriodDate.checkPeriodAgainstDate(
      `${year}Q${q}`,
      item.surveyDateFound || null,
      item.file,
    ),
  );
  analyzeRoads();
  renderPreview();
  } catch (error) {
    /*
     * finally 只能解鎖控制項，不能把一個「做了一半」的預覽變成安全狀態。
     * 若日期比對、路段分析或畫面重繪出錯，必須同時清掉 pending 與確認按鈕，
     * 否則使用者可能把上一次或本次未完成的結果誤認為可寫入資料。
     * 檔案欄也清空，讓同一批檔名修正後可以直接重新選取。
     */
    clearPendingPreview();
    fileInput.value = "";
    $("fileInfo").textContent = "本次判讀未完成，請重新選取檔案";
    $("previewStatus").textContent = "判讀未完成，資料尚未寫入；請重新選取檔案後再試";
    $("errorBadge").textContent = "1 錯誤";
    $("errorBadge").style.color = "#bd463d";
    $("previewRows").innerHTML =
      '<tr><td colspan="5" class="empty">本次判讀未完成，沒有資料被寫入</td></tr>';
    if ($("periodDateAlert")) {
      $("periodDateAlert").hidden = true;
      $("periodDateAlert").innerHTML = "";
    }
    const detail = String(error?.message || error || "").trim();
    toast(
      `本次判讀未完成，資料尚未寫入；請重新選取檔案後再試${detail ? `：${detail}` : ""}`,
    );
  } finally {
    /* 不論成功或中途出錯，畫面都要回到使用者能繼續操作的狀態 */
    previewButton.disabled = false;
    previewButton.textContent = originalLabel;
    fileInput.disabled = false;
  }
};
/**
 * 取消本次預覽。
 *
 * 預覽的用意就是「先看看有沒有問題，有問題先去修檔案」。舊版只有
 *「讀取並預覽」與「確認寫入」兩個按鈕，看到判讀失敗之後沒有任何方式
 * 把這批結果清掉——畫面就一直掛著一份錯誤的預覽，使用者也不確定自己
 * 是不是已經被寫進去了。這個按鈕把預覽狀態整個清乾淨，資料完全不動。
 */
$("cancelPreview").onclick = () => {
  if (!pending.length) return;
  clearPendingPreview();
  // 檔案輸入也要清掉：使用者修好檔案後通常會重新選同一個檔名，
  // 不清掉的話瀏覽器可能不觸發 change，看起來像「選了卻沒反應」。
  $("files").value = "";
  $("fileInfo").textContent = "尚未選取檔案";
  renderPreview();
  // renderPreview() 會把狀態列改寫成「成功 0，失敗 0…」，看起來像剛匯完
  // 一批 0 筆的資料。所以「尚未開始」要放在它後面才留得住。
  $("previewStatus").textContent = "尚未開始";
  toast("已取消本次預覽，資料完全沒有變動；修正檔案後請重新選取並預覽");
};

// 改了民國年或季度就讓預覽失效，避免用舊條件寫入。
for (const id of ["rocYear", "quarter"])
  $(id).addEventListener("change", () => {
    // 使用者一旦自己動過，renderAll 就不可以再把它改回上次匯入的季度。
    importPeriodTouched = true;
    if (!pending.length) return;
    pending = [];
    pendingContext = null;
    roadAlert.style.display = "none";
    renderPreview();
    toast("季度或年度已變更，請重新按「讀取並預覽」");
  });
for (const id of ["rocYear", "quarter"])
  $(id).addEventListener("input", () => {
    importPeriodTouched = true;
    renderYearHint();
  });
/*
 * 打西元年時當場說明實際會存成什麼。
 * 不講的話使用者會以為畫面上會看到 2026Q2，找不到就重打一次，
 * 結果同一季被匯入兩遍——而那兩筆的排序鍵一模一樣，很難看出是寫法問題。
 */
function renderYearHint() {
  const hint = $("yearHint");
  if (!hint) return;
  const n = Number($("rocYear").value);
  const isAd = Number.isInteger(n) && n >= 2001 && n <= 2111;
  hint.hidden = !isAd;
  if (isAd)
    hint.textContent = `將存成民國 ${n - 1911} 年（資料一律以民國年記錄）`;
}
renderYearHint();
/*
 * 匯入預覽上方的調查日期提示。
 * 紅底＝日期與所選季度對不起來（按「確認寫入」時會再問一次）；
 * 黃底＝有檔案讀不到日期（**不阻擋**，提醒使用者自行確認）。
 */
function renderPeriodDateAlert() {
  const box = $("periodDateAlert");
  if (!box) return;
  const bad = pendingPeriodChecks.filter((x) => x.status === "mismatch");
  const unknownNote = globalThis.PeriodDate.periodUnknownNotice(pendingPeriodChecks);
  if (!bad.length && !unknownNote) {
    box.hidden = true;
    box.innerHTML = "";
    box.classList.remove("period-date-alert-bad");
    return;
  }
  box.hidden = false;
  box.classList.toggle("period-date-alert-bad", bad.length > 0);
  const period = pendingContext ? `${pendingContext.year}Q${pendingContext.quarter}` : "";
  box.innerHTML =
    (bad.length
      ? `<strong>⚠️ 有 ${bad.length} 份檔案的調查日期與你選的「${esc(period)}」不一致</strong><ul>` +
        bad
          .map(
            (x) =>
              `<li><b>${esc(x.file)}</b>：檔案裡是 ${esc(x.date)}（屬 ${esc(x.dateLabel)}），你選的是 ${esc(x.periodLabel)}。<small>來源 ${esc(x.source)}「${esc(x.raw)}」</small></li>`,
          )
          .join("") +
        `</ul><small>按「確認寫入尖峰明細」時會再問一次；確認無誤才會以你選的季度寫入。</small>`
      : "") +
    (unknownNote ? `<p class="period-date-unknown">${esc(unknownNote)}</p>` : "");
}

function matchBadge(type) {
  const cls =
    { 完全相符: "exact", 別名相符: "alias", 疑似相符: "possible", 新路段: "new" }[type] || "new";
  return `<span class="match-badge match-${cls}">${esc(type || "新路段")}</span>`;
}
function roadDecision(x, i) {
  if (!x.ok) return "—";
  const badge = matchBadge(x.matchType);
  if (!x.roadAlert) {
    /*
     * 一律把「實際取到的路段名稱」與它的來源印出來。
     * 舊版在沒有 alert 時只寫「使用目前正式名稱」，但對一個全新計畫來說
     * 根本沒有「目前正式名稱」，那裡只有一個從檔名切出來的字串，
     * 而使用者從頭到尾看不到它是什麼。
     */
    if (x.conflictNote)
      return `${badge}<br>路段：${esc(x.road)}<br><small class="from-filename">⚠️ ${esc(x.conflictNote)}</small>`;
    const fromFile = x.roadSource === "檔名" || x.daySource === "檔名";
    const note = fromFile
      ? `<small class="from-filename">⚠️ 路段名稱取自${esc(x.roadSource || "檔名")}、日別取自${esc(x.daySource || "檔名")}，請確認</small>`
      : `<small class="from-content">路段名稱與日別皆讀自調查表表頭</small>`;
    return `${badge}<br>${x.roadChoice ? `自動對應：${esc(x.roadChoice)}` : `路段：${esc(x.road)}`}<br>${note}`;
  }
  const known = existingRoads(),
    hint = x.roadAlert.score >= 0.55 ? `（疑似：${esc(x.roadAlert.near)}）` : "";
  if (x.roadAlert.reason) {
    /*
     * 補救指示要看名稱是從哪裡來的。名稱取自表頭時叫使用者「改檔名」，
     * 他改了、重新預覽、還是同一個錯誤——因為內容優先，檔名根本沒被用到。
     */
    const howToFix =
      x.roadSource === "檔名"
        ? "請確認或改檔名後重新預覽"
        : "此名稱取自工作表「站名：」欄位，改檔名不會有作用；請確認，或修正原始檔的站名後重新預覽";
    return `<label class="road-pick"><input type="checkbox" data-pick="${i}" ${roadPicks.has(i) ? "checked" : ""}>${badge}</label><br><b>${esc(x.road) || "（空白）"}</b><br><small class="from-filename">${esc(x.roadAlert.reason)}；${howToFix}</small><br><select class="road-choice" data-pending="${i}"><option value="" ${!x.roadChoice ? "selected" : ""}>請確認</option><option value="__NEW__" ${x.roadChoice === "__NEW__" ? "selected" : ""}>確認就用這個名稱</option>${known.map((r) => `<option value="${esc(r)}" ${x.roadChoice === r ? "selected" : ""}>合併至：${esc(r)}</option>`).join("")}</select>`;
  }
  // 勾選框只出現在「需要人工確認」的列；已經確認過的仍保留勾選框，
  // 使用者改變主意時可以再批次改一次。
  return `<label class="road-pick"><input type="checkbox" data-pick="${i}" ${roadPicks.has(i) ? "checked" : ""}>${badge}</label><br><select class="road-choice" data-pending="${i}"><option value="" ${!x.roadChoice ? "selected" : ""}>請確認${hint}</option><option value="__NEW__" ${x.roadChoice === "__NEW__" ? "selected" : ""}>確認為新路段</option>${known.map((r) => `<option value="${esc(r)}" ${x.roadChoice === r ? "selected" : ""}>合併至：${esc(r)}</option>`).join("")}</select>`;
}
/** 需要人工確認的 pending 索引。 */
function pendingNeedingChoice() {
  return pending.map((x, i) => (x.ok && x.roadAlert ? i : -1)).filter((i) => i >= 0);
}
function applyRoadPick(value) {
  const picked = [...roadPicks].filter((i) => pending[i]?.roadAlert);
  if (!picked.length) return;
  for (const i of picked) {
    pending[i].roadChoice = value;
    pending[i].matchType = value === "__NEW__" ? "新路段" : "疑似相符";
  }
  roadPicks = new Set();
  renderPreview();
  toast(
    value === "__NEW__"
      ? `已將 ${picked.length} 筆確認為新路段`
      : `已將 ${picked.length} 筆設定為合併至「${value}」`,
  );
}
function renderRoadBatchBar() {
  const targets = pendingNeedingChoice();
  roadBatchBar.style.display = targets.length ? "flex" : "none";
  if (!targets.length) {
    roadPicks = new Set();
    return;
  }
  // 勾選集合只保留仍然存在、且仍需確認的索引。
  roadPicks = new Set([...roadPicks].filter((i) => targets.includes(i)));
  const undecided = targets.filter((i) => !pending[i].roadChoice);
  $("pickCount").textContent =
    `共 ${targets.length} 筆需確認（尚未決定 ${undecided.length} 筆）｜已勾選 ${roadPicks.size} 筆`;
  $("pickAll").checked = roadPicks.size > 0 && roadPicks.size === targets.length;
  $("pickAll").indeterminate = roadPicks.size > 0 && roadPicks.size < targets.length;
  $("pickAsNew").disabled = !roadPicks.size;
  const known = existingRoads();
  $("pickAsMerge").disabled = !roadPicks.size || !known.length;
  const previous = $("pickMergeTarget").value;
  $("pickMergeTarget").innerHTML = known.length
    ? known.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")
    : '<option value="">目前沒有既有路段</option>';
  if (known.includes(previous)) $("pickMergeTarget").value = previous;
}
function projectedId(item, r) {
  const target = item.roadChoice && item.roadChoice !== "__NEW__" ? item.roadChoice : r.road;
  return [r.projectCode, r.year, `Q${r.quarter}`, target, r.day, r.peak, r.direction].join("|");
}
function sourceConflictPrompt(items) {
  const conflicts = (items || []).filter(
    (x) => x?.ok && (x.dayConflict || x.roadConflict),
  );
  if (!conflicts.length) return "";
  const lines = conflicts.map(
    (x) => `・ ${x.file}：${x.conflictNote || "表頭與檔名不一致"}`,
  );
  return (
    `有 ${conflicts.length} 份檔案的表頭與檔名不一致：\n\n` +
    lines.join("\n") +
    "\n\n系統將採用工作表表頭的路段名稱／日別。確定仍要寫入嗎？"
  );
}
function duplicateStats() {
  const ids = new Set(state.details.map((x) => x.id));
  let added = 0,
    updated = 0;
  for (const item of pending.filter((x) => x.ok))
    for (const r of item.rows) ids.has(projectedId(item, r)) ? updated++ : added++;
  return { added, updated };
}
function renderPreview() {
  const errors = pending.filter((x) => !x.ok).length,
    unchecked = pending.filter((x) => x.ok && x.roadAlert && !x.roadChoice).length,
    dup = duplicateStats();
  $("errorBadge").textContent = unchecked ? `${unchecked} 路段待確認` : `${errors} 錯誤`;
  $("errorBadge").style.color = errors || unchecked ? "#bd463d" : "#168466";
  $("previewStatus").textContent =
    `成功 ${pending.length - errors}，失敗 ${errors}｜新增 ${dup.added}，重複 ${dup.updated}`;
  renderPeriodDateAlert();
  $("previewRows").innerHTML =
    pending
      .map(
        (x, i) =>
          `<tr><td>${esc(x.file)}</td><td>${esc(x.day || "—")}</td><td>${x.ok ? "辨識成功" : `<span style="color:#bd463d">${esc(x.error)}</span>`}</td><td>${x.rows.length}</td><td>${roadDecision(x, i)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="5" class="empty">沒有可預覽資料</td></tr>';
  document.querySelectorAll("[data-pending]").forEach(
    (s) =>
      (s.onchange = () => {
        const item = pending[+s.dataset.pending];
        item.roadChoice = s.value;
        item.matchType = s.value === "__NEW__" ? "新路段" : "疑似相符";
        renderPreview();
      }),
  );
  document.querySelectorAll("[data-pick]").forEach(
    (box) =>
      (box.onchange = () => {
        const index = +box.dataset.pick;
        if (box.checked) roadPicks.add(index);
        else roadPicks.delete(index);
        renderRoadBatchBar();
      }),
  );
  renderRoadBatchBar();
  $("commit").disabled = !pending.some((x) => x.ok) || unchecked > 0;
  // 只要有預覽結果就可以取消，不論成功或失敗。
  if ($("cancelPreview")) $("cancelPreview").disabled = !pending.length;
}
$("pickAll").onchange = () => {
  const targets = pendingNeedingChoice();
  roadPicks = $("pickAll").checked ? new Set(targets) : new Set();
  renderPreview();
};
$("pickAsNew").onclick = () => applyRoadPick("__NEW__");
$("pickAsMerge").onclick = () => {
  const target = $("pickMergeTarget").value;
  if (!target) return toast("目前沒有可合併的既有路段");
  applyRoadPick(target);
};

function remapPending(item, target) {
  if (!target || target === "__NEW__") return;
  state.aliases[`${state.activeCode}|${item.originalRoad}`] = target;
  for (const r of item.rows) {
    r.road = target;
    r.id = [r.projectCode, r.year, `Q${r.quarter}`, target, r.day, r.peak, r.direction].join("|");
    const k = `${r.projectCode}|${target}|${r.direction}`;
    r.limit = state.limits[k] || r.limit;
    r.ratio = r.travel == null ? null : r.travel / r.limit;
    r.los = losOf(r.ratio, r.projectCode, r.period, r.road);
  }
  item.road = target;
}
$("commit").onclick = async () => {
  if (!pendingContext) return toast("請先按「讀取並預覽」");
  if (pendingContext.projectCode !== state.activeCode)
    return toast("預覽之後計畫被切換過了，請重新預覽再寫入");
  const unchecked = pending.filter((x) => x.ok && x.roadAlert && !x.roadChoice);
  if (unchecked.length) return toast("請先確認所有疑似新路段");
  const good = pending.filter((x) => x.ok);
  good.forEach((x) => remapPending(x, x.roadChoice));
  // 同一批次內若有兩份檔案指向同一個路段＋日別，後寫入的會蓋掉前一份，
  // 而畫面上仍顯示「新增 8 筆」。這種情況一律擋下並指出是哪些檔案。
  const owners = new Map();
  for (const item of good)
    for (const row of item.rows) {
      const list = owners.get(row.id) ?? [];
      if (!list.includes(item.file)) list.push(item.file);
      owners.set(row.id, list);
    }
  const collided = [...new Set([...owners.values()].filter((list) => list.length > 1).flat())];
  if (collided.length)
    return toast(
      `這幾份檔案被判定為同一個路段與日別，會互相覆蓋，請確認後分批匯入：${collided.join("、")}`,
    );
  const sourceConflictMessage = sourceConflictPrompt(good);
  if (sourceConflictMessage && !confirm(sourceConflictMessage)) return;
  /*
   * 調查日期與所選季度對不起來時，寫入前顯眼提示並要求二次確認。
   * 只比對這次真的會寫入的檔案；讀不到日期一律**不阻擋**。
   */
  const writingFiles = new Set(good.map((x) => x.file));
  const dateProblems = pendingPeriodChecks.filter(
    (x) => x.status === "mismatch" && writingFiles.has(x.file),
  );
  if (dateProblems.length && !confirm(globalThis.PeriodDate.periodMismatchPrompt(dateProblems)))
    return;
  const all = good.flatMap((x) => x.rows),
    before = new Map(state.details.map((x) => [x.id, x])),
    policy = $("duplicatePolicy").value,
    batchId = `B${Date.now()}`,
    previous = [],
    addedIds = [],
    write = [];
  let skipped = 0;
  for (const row of all) {
    const old = before.get(row.id);
    if (old && policy === "skip") {
      skipped++;
      continue;
    }
    if (old) previous.push(structuredClone(old));
    else addedIds.push(row.id);
    write.push({ ...row, importBatch: batchId });
  }
  upsert(write);
  const now = new Date(),
    batch = {
      id: batchId,
      projectCode: state.activeCode,
      projectName: activeProject()?.name || "",
      period: `${pendingContext.year}Q${pendingContext.quarter}`,
      time: now.toLocaleString("zh-TW"),
      timestamp: now.toISOString(),
      files: good.map((x) => x.file),
      addedIds,
      previous,
      writtenIds: write.map((x) => x.id),
      added: addedIds.length,
      updated: previous.length,
      skipped,
      status: "有效",
    };
  state.imports.unshift(batch);
  state.last = {
    year: pendingContext.year,
    quarter: pendingContext.quarter,
    time: batch.time,
  };
  // 寫入完成之後這一輪就結束了，下一次可以再帶入「上次的季度」當預設值。
  importPeriodTouched = false;
  await save();
  toast(`寫入完成：新增 ${batch.added}、更新 ${batch.updated}、略過 ${batch.skipped}`);
  pending = [];
  roadAlert.style.display = "none";
  renderPreview();
  go("importlog");
};

let pendingRoadChange = null;
const roadMetaKey = (road, code = state.activeCode) => `${code}|${road}`;
function roadMeta(road, code = state.activeCode) {
  return (
    state.roadMeta[roadMetaKey(road, code)] || {
      directionA: "方向1",
      directionB: "方向2",
    }
  );
}
function validPeriod(v) {
  return !v || /^\d{2,4}Q[1-4]$/.test(v);
}
/*
 * ⚠️ 季別索引全站**只有一份**，在 los-rule-scope.js 裡。
 *   這裡只是轉呼叫。
 *
 *   為什麼不各寫各的：季別索引同時決定「排序」「區間包不包含這一季」
 *   與「起 > 迄 時要把哪一端帶過去」。三份各寫各的一旦漂移，
 *   同一季在不同地方會得到不同答案——那是**直接影響數字**的錯，
 *   而且畫面上每一格看起來都很合理，非常難找。
 *   los-rule-scope.test.mjs 有一條掃描擋著，誰再自己寫一份都會紅。
 */
function periodIndex(v) {
  return globalThis.LosRuleScope.periodIndex(v);
}
/*
 * ⚠️ periodBoundIndex()／canonicalPeriod()／roadObservedPeriods()／roadIsActive()
 *   已於 2026-09-15 隨「路段有效期間」一起移除（見 migrate 那一段的說明）。
 *   不要再加回來：判斷一條路段那一季在不在，唯一的依據是**有沒有匯入資料**。
 */
function sortPeriods(values) {
  return [...new Set(values)].sort((a, b) => periodIndex(a) - periodIndex(b));
}
/*
 * 方向的顯示名稱只有這一支可以決定，全站每一個要把方向寫給人看的地方
 * ——畫面表格、下拉與勾選框、CSV、結論草稿、報告草稿、資料異常檢查說明——
 * 都必須走這裡。
 *
 * 之前有一半的地方直接印 row.direction，結果使用者替路段命名之後，
 * 明細與速限表顯示新名稱、結論草稿卻還是「方向1／方向2」，
 * 同一份資料在同一個系統裡有兩種寫法，看的人無從判斷哪一個才對。
 *
 * 鍵值永遠是「方向1」「方向2」（原始報告就是這樣寫的），不會因為改名而變動；
 * 這裡只換顯示字。沒有自訂名稱時就回鍵值本身。
 */
function directionNameFrom(meta, direction) {
  if (direction === "方向1") return (meta && meta.directionA) || "方向1";
  if (direction === "方向2") return (meta && meta.directionB) || "方向2";
  return direction;
}
function directionName(road, direction, code = state.activeCode) {
  return directionNameFrom(roadMeta(road, code), direction);
}
/*
 * 一筆明細要顯示的方向。
 *
 * 使用者在「路段管理」設的名稱**永遠優先**。原本尖峰明細寫的是
 * `x.directionText || directionName(...)`，也就是報告上的起訖文字排在前面，
 * 於是使用者改名之後，彙總與速限表換了、明細沒換——同一個方向在相鄰兩張表
 * 上有兩個名字。
 *
 * 沒有設定名稱時（例如很舊的備份還原進來，roadMeta 是空的）才退回報告上的
 * 起訖文字，那比「方向1」有用；兩者都沒有就是鍵值本身。
 */
/**
 * 一筆紀錄要顯示的方向名稱——**全系統只有這一支**。
 *
 * 順序：專案包裡取過的名字 → 本機取過的名字 → 報告上的「方向往」文字 → 鍵值。
 *
 * 第二段（directionText）是獨立的一致性修正：同一筆資料在不同畫面上
 * 不應出現不同的方向名稱。以前尖峰彙總等處**少了報告文字這一層備援**，
 * 而尖峰明細有；結果同一個計畫、同一張表裡，報告有寫「方向往」的路段顯示成
 * 「南-北(北上)」，沒寫的顯示成「方向1」——看起來就像「有些改到、有些沒改到」。
 * 事實上兩者都沒有被使用者命名過，差別只在報告上有沒有那行字。
 *
 * ⚠️ 2026-09-13 簡化：原本第一順位是「別人專案包裡取過的名字」（參數
 *   packageMeta），那只有 Manager 比較會傳。Manager 移除之後每一個呼叫端
 *   傳的都是 null，那一段永遠不會執行——**留著等於留一段沒有人能觸發、
 *   也沒有人會再驗證的程式**，所以整段拿掉。
 *   行為完全沒變：packageMeta 為 null 時，舊版走的本來就是現在這條路。
 */
function rowDirectionName(row) {
  const key = roadMetaKey(row.road, row.projectCode);
  const fromLocal = state.roadMeta[key];
  if (hasRealDirectionName(fromLocal, row.direction))
    return directionNameFrom(fromLocal, row.direction);
  // 沒取過名字：報告上的「方向往：大同路口--->中正路口」比裸的「方向1」有用得多。
  if (row.directionText) return row.directionText;
  return directionNameFrom(fromLocal, row.direction);
}
/**
 * 只知道「路段＋方向」、手上沒有整筆紀錄時用這一支（路段速限表、速限未確認、
 * 速限版本清單）。它自己去 details 找一筆同路段同方向的紀錄，好讓報告上的
 * 「方向往」文字也能當備援——否則使用者在「路段速限」看到的永遠是裸的
 * 「方向1／方向2」，而那正是他要去改名字的畫面，最需要看得懂哪個方向是哪一邊。
 */
function directionNameFor(road, direction, code = state.activeCode) {
  const sample = state.details.find(
    (d) => d.projectCode === code && d.road === road && d.direction === direction,
  );
  return rowDirectionName(
    sample || { road, direction, projectCode: code, directionText: "" },
  );
}
/**
 * 這一份 roadMeta 到底有沒有「真的取過名字」。
 *
 * ⚠️ 「有沒有這個項目」不等於「有沒有取過名字」。roadMeta 的項目可能只是
 * 別的設定順手建立的，內容是 `{ directionA: "方向1", directionB: "方向2" }`
 * ——那兩個是**佔位值**，不是使用者取的名稱。
 */
function hasRealDirectionName(meta, direction) {
  if (!meta) return false;
  const name = directionNameFrom(meta, direction);
  return !!name && name !== direction;
}
function projectAliases() {
  const prefix = `${state.activeCode}|`;
  return Object.entries(state.aliases)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, target]) => ({ alias: k.slice(prefix.length), target }));
}
function roadImpact(source, target) {
  const rows = state.details.filter((x) => x.projectCode === state.activeCode && x.road === source),
    periods = sortPeriods(rows.map((x) => x.period)),
    targetIds = new Set(
      state.details
        .filter((x) => x.projectCode === state.activeCode && x.road === target)
        .map((x) => x.id),
    ),
    collisions = rows.filter((x) =>
      targetIds.has(
        [x.projectCode, x.year, `Q${x.quarter}`, target, x.day, x.peak, x.direction].join("|"),
      ),
    ).length;
  return {
    projectCode: state.activeCode,
    source,
    target,
    rows: rows.length,
    periods,
    summary: state.summaries.filter((x) => x.projectCode === state.activeCode && x.road === source)
      .length,
    collisions,
  };
}
function showRoadImpact(source, target, mode) {
  if (!source || !target || source === target) {
    pendingRoadChange = null;
    $("confirmRoadChange").disabled = true;
    $("roadImpact").innerHTML =
      '<b>無法預覽</b><p>來源與目標必須是不同名稱。</p><button class="danger-button" id="confirmRoadChange" disabled>備份後確認執行</button>';
    revealResult("roadImpact");
    return;
  }
  const impact = roadImpact(source, target),
    exists = existingRoads().includes(target);
  pendingRoadChange = { ...impact, mode };
  $("roadImpact").innerHTML =
    `<div><b>${mode === "rename" && !exists ? "正式名稱修改" : "重複路段合併"}預覽</b><p>「${esc(source)}」→「${esc(target)}」</p><ul><li>影響季度：${impact.periods.length ? impact.periods.map((x) => showQuarter(x)).join("、") : "無"}</li><li>尖峰明細：${impact.rows} 筆</li><li>尖峰彙總：${impact.summary} 筆</li><li>合併後重複鍵值：${impact.collisions} 筆（保留目標路段既有資料）</li></ul><small>執行前會自動下載 Project 專案包；路段速限、別名及圖表會一起更新。</small></div><button class="danger-button" id="confirmRoadChange">備份後確認執行</button>`;
  $("confirmRoadChange").onclick = confirmRoadChange;
  /* 預覽面板在四個表單方塊的下面，不捲過去使用者會以為沒反應 */
  revealResult("roadImpact");
}
async function applyRoadChange(source, target) {
  const code = state.activeCode,
    sourceKey = roadMetaKey(source),
    targetKey = roadMetaKey(target),
    sourceMeta = state.roadMeta[sourceKey],
    targetMeta = state.roadMeta[targetKey];
  state.aliases[`${code}|${normalize(source)}`] = target;
  for (const [k, v] of Object.entries(state.aliases))
    if (k.startsWith(`${code}|`) && v === source) state.aliases[k] = target;
  const kept = state.details.filter((x) => !(x.projectCode === code && x.road === source)),
    map = new Map(kept.map((x) => [x.id, x]));
  /* 因與目標路段既有版本重疊而沒有搬過去的速限版本，最後要一併告訴使用者。 */
  const skippedVersions = [];
  for (const d of state.details.filter((x) => x.projectCode === code && x.road === source)) {
    const oldLimit = `${code}|${source}|${d.direction}`,
      newLimit = `${code}|${target}|${d.direction}`;
    if (!state.limits[newLimit]) state.limits[newLimit] = state.limits[oldLimit] || d.limit || 50;
    if (state.limitConfirmed[oldLimit]) state.limitConfirmed[newLimit] = true;
    delete state.limits[oldLimit];
    delete state.limitConfirmed[oldLimit];
    // 速限版本（季別區間 × 路段 × 方向）也是以「計畫|路段|方向」為鍵，
    // 改名時一併搬過去，否則整組速限設定會變成孤兒、速限悄悄退回預設值。
    const versionMerge = mergeSpeedVersions(state, oldLimit, newLimit);
    if (versionMerge.skipped.length) skippedVersions.push(...versionMerge.skipped);
    const moved = { ...d, road: target, limit: state.limits[newLimit] };
    moved.ratio = moved.travel == null ? null : moved.travel / moved.limit;
    moved.los = losOf(moved.ratio, code, moved.period, moved.road);
    moved.id = [
      moved.projectCode,
      moved.year,
      `Q${moved.quarter}`,
      target,
      moved.day,
      moved.peak,
      moved.direction,
    ].join("|");
    if (!map.has(moved.id)) map.set(moved.id, moved);
  }
  state.details = [...map.values()];
  /*
   * ⚠️ 判定門檻與三段分法的覆寫**也是以路段名稱為鍵**，改名／合併時一併搬過去。
   *
   *   舊版只搬了 limits、limitConfirmed、speedVersions 與 roadMeta，
   *   這兩組留在原地變成**孤兒**：它們永遠命不中任何一筆資料，
   *   於是那幾季安靜地退回計畫預設門檻——服務水準等級跟著變，
   *   而畫面上一個字都沒說。速限那一組早就有搬，這兩組漏了；
   *   同一件事有兩種行為，本身就是缺陷。
   *
   * ⚠️ 撞期時的規則與 mergeSpeedVersions 一致：**目標路段原本的設定優先**，
   *   來源路段只帶進「與目標完全不重疊」的那幾條，被略過的一併告訴使用者。
   *   直接併入的話，目標路段原本就有、而且不在這次合併範圍內的季別
   *   也會被換掉一把尺。
   */
  const scopeMerge = { los: { skipped: [] }, band: { skipped: [] } };
  state.losRuleScopes = state.losRuleScopes || {};
  state.bandRuleScopes = state.bandRuleScopes || {};
  scopeMerge.los = mergeRoadScopes(ruleScopesFor(code), source, target);
  state.losRuleScopes[code] = scopeMerge.los.list;
  scopeMerge.band = mergeRoadScopes(bandScopesFor(code), source, target);
  state.bandRuleScopes[code] = scopeMerge.band.list;
  if (sourceMeta || targetMeta)
    state.roadMeta[targetKey] = {
      directionA: targetMeta?.directionA || sourceMeta?.directionA || "方向1",
      directionB: targetMeta?.directionB || sourceMeta?.directionB || "方向2",
    };
  delete state.roadMeta[sourceKey];
  rebuild();
  await save();
  return {
    skippedVersions,
    skippedScopes: scopeMerge.los.skipped.concat(scopeMerge.band.skipped),
  };
}
/**
 * 路段改名／合併時，把「指到來源路段」的覆寫搬到目標路段。
 *
 * @returns {{list: Array, skipped: Array}} 搬完的清單，以及因為與目標路段
 *   既有設定的季別區間重疊而**沒有**搬過去的那幾條。
 *
 * ⚠️ 「重疊」走 LosRuleScope.rangesOverlap（全站唯一一份）——
 *   畫面上說會重疊的那兩條，搬家時也一定要算重疊，否則兩邊會給出不同答案。
 * ⚠️ 只搬 road 剛好等於來源的那幾條。全路段（*）的覆寫與別的路段不動。
 */
function mergeRoadScopes(list, source, target) {
  var Scope = globalThis.LosRuleScope;
  var out = [];
  var incoming = [];
  (Array.isArray(list) ? list : []).forEach(function (item) {
    var n = Scope.normalizeScope(item);
    if (n && n.road === source) incoming.push(item);
    else out.push(item);
  });
  var skipped = [];
  incoming.forEach(function (item) {
    var n = Scope.normalizeScope(item);
    /*
     * ⚠️ 只帶三個欄位＋rules 過去，不整包複製。
     *   舊資料可能還留著單一 `period` 欄位，整包複製的話新舊欄位會同時存在，
     *   雖然 normalizeScope 目前以 periodFrom 為準，但那是一顆不必要的地雷。
     */
    var moved = {
      periodFrom: n.periodFrom,
      periodTo: n.periodTo,
      road: target,
      rules: item.rules,
    };
    var clash = out.some(function (other) {
      var m = Scope.normalizeScope(other);
      return m && m.road === target && Scope.rangesOverlap(m, moved);
    });
    if (clash) skipped.push(moved);
    else out.push(moved);
  });
  return { list: out, skipped: skipped };
}
async function confirmRoadChange() {
  const x = pendingRoadChange;
  if (!x) return;
  if (x.projectCode !== state.activeCode) {
    pendingRoadChange = null;
    renderRoadAdmin();
    return toast("計畫已切換，請重新預覽合併影響");
  }
  if (
    !confirm(
      `確定執行？\n\n${x.source}\n→ ${x.target}\n\n影響 ${x.periods.length} 個季度、${x.rows} 筆明細；${x.collisions} 筆重複資料將保留目標路段版本。`,
    )
  )
    return;
  downloadProjectPackage(false);
  const result = await applyRoadChange(x.source, x.target);
  pendingRoadChange = null;
  /*
   * 沒搬過去的速限版本一定要講出來。這些版本的有效期間與目標路段既有的
   * 重疊，若照舊直接併入，會蓋掉目標路段原本就有、而且不在這次合併範圍內
   * 的紀錄，速限比與服務水準都跟著變，而使用者不會收到任何提示。
   */
  const skipped = result?.skippedVersions ?? [];
  /*
   * 判定門檻與三段分法的覆寫同理：沒搬過去的一定要講，否則使用者會以為
   * 來源路段那一套標準跟著過來了，而實際上那幾季用的是目標路段原本的標準。
   */
  const skippedScopes = result?.skippedScopes ?? [];
  toast(
    "路段正式名稱、明細、速限、判定標準、別名與圖表已更新" +
      (skipped.length
        ? `。有 ${skipped.length} 組來源路段的速限版本因為與目標路段既有版本的有效期間重疊而未併入（保留目標路段原本的速限）：${skipped
            .map((v) => `${v.start || "?"}起${v.end ? `～${v.end}` : ""} ${v.speed} km/h`)
            .join("、")}。如需改用來源路段的速限，請至「路段速限」自行新增一條。`
        : "") +
      (skippedScopes.length
        ? `。另有 ${skippedScopes.length} 條來源路段的判定標準覆寫因為季別區間與目標路段既有的重疊而未併入（保留目標路段原本的標準）。如需改用來源路段的標準，請至「判定標準」自行新增一條。`
        : ""),
  );
  go("roadadmin");
}
function roadOptions(selected = "") {
  return (
    existingRoads()
      .sort()
      .map(
        (r) => `<option value="${esc(r)}" ${r === selected ? "selected" : ""}>${esc(r)}</option>`,
      )
      .join("") || '<option value="">目前尚無路段</option>'
  );
}
function renderRoadAdmin() {
  if (!$("roadAdminRows")) return;
  const roads = existingRoads().sort(),
    aliases = projectAliases(),
    periods = new Set(
      state.details.filter((x) => x.projectCode === state.activeCode).map((x) => x.period),
    );
  $("roadCount").textContent = roads.length;
  $("aliasCount").textContent = aliases.length;
  $("roadPeriodCount").textContent = periods.size;
  for (const id of [
    "renameRoad",
    "directionRoad",
    "aliasTarget",
    "mergeSource",
    "mergeTarget",
  ]) {
    const old = $(id).value;
    $(id).innerHTML = roadOptions(old);
    if (roads.includes(old)) $(id).value = old;
  }
  const selected = $("directionRoad").value;
  if (selected) {
    const m = roadMeta(selected);
    $("directionA").value = m.directionA || "方向1";
    $("directionB").value = m.directionB || "方向2";
  }
  $("roadAdminRows").innerHTML = roads.length
    ? roads
        .map((road) => {
          const rows = state.details.filter(
              (x) => x.projectCode === state.activeCode && x.road === road,
            ),
            m = roadMeta(road),
            /*
             * ⚠️ 這一欄是**給人看的**季度，要跟著「期別顯示／年份顯示」走。
             *
             * ⚠️ 2026-09-15 起這裡列的一律是**實際有資料的季度**。
             *   舊版在有「路段有效期間」時改列宣告的區間（例如「114Q1～持續」），
             *   於是同一欄有兩種意思：有時候是事實、有時候是宣告，看的人分不出來。
             *   有效期間整組移除之後，這一欄只剩一種意思——這條路段哪幾季有資料。
             */
            range = sortPeriods(rows.map((x) => x.period))
              .map((x) => showQuarter(x))
              .join("、");
          return `<tr><td><b>${esc(road)}</b></td><td>${esc(m.directionA || "方向1")}</td><td>${esc(m.directionB || "方向2")}</td><td>${esc(range)}</td><td>${rows.length}</td><td>${aliases.filter((x) => x.target === road).length}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">匯入資料後會建立正式路段清冊</td></tr>';
  $("aliasRows").innerHTML = aliases.length
    ? aliases
        .map(
          (x) =>
            `<tr><td>${esc(x.alias)}</td><td>${esc(x.target)}</td><td><button class="outline" data-delete-alias="${esc(x.alias)}">刪除</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="empty">尚未設定檔名別名</td></tr>';
  document.querySelectorAll("[data-delete-alias]").forEach(
    (b) =>
      (b.onclick = async () => {
        delete state.aliases[`${state.activeCode}|${b.dataset.deleteAlias}`];
        await save();
        toast("別名已刪除");
      }),
  );
}
$("roadAdminBackup").onclick = () => downloadProjectPackage();
$("directionRoad").onchange = () => {
  const m = roadMeta($("directionRoad").value);
  $("directionA").value = m.directionA || "方向1";
  $("directionB").value = m.directionB || "方向2";
};
$("saveDirections").onclick = async () => {
  const road = $("directionRoad").value;
  if (!road) return toast("請先選擇路段");
  const old = roadMeta(road);
  state.roadMeta[roadMetaKey(road)] = {
    ...old,
    directionA: $("directionA").value.trim() || "方向1",
    directionB: $("directionB").value.trim() || "方向2",
    /*
     * X-41：按下這一顆＝**使用者親自看過並確認**這條路段的兩個方向。
     * 資料異常檢查的「方向對應不一致」據此放行。
     * ⚠️ 只有這裡會設成 true——匯入時自動採用報告文字的那一支
     *（adoptDirectionNames）**不可以**設它，否則等於把檢查關掉。
     */
    directionConfirmed: true,
  };
  await save();
  toast("方向顯示名稱已更新，這條路段的「方向對應不一致」不會再提醒");
};
$("addAlias").onclick = async () => {
  const alias = normalize($("aliasName").value),
    target = $("aliasTarget").value;
  if (!alias || !target) return toast("請完整輸入別名並選擇正式路段");
  if (alias === target) return toast("別名不可與正式路段完全相同");
  state.aliases[`${state.activeCode}|${alias}`] = target;
  $("aliasName").value = "";
  await save();
  toast(`別名「${alias}」將自動對應至「${target}」`);
};
$("previewRename").onclick = () => {
  const source = $("renameRoad").value,
    target = normalize($("formalRoadName").value);
  if (!target) return toast("請輸入新的正式名稱");
  showRoadImpact(source, target, "rename");
};
$("previewMerge").onclick = () =>
  showRoadImpact($("mergeSource").value, $("mergeTarget").value, "merge");

function losChip(l) {
  return `<span class="los los-${String(l).toLowerCase()}">${esc(l)}</span>`;
}
/**
 * 建立人員可搜尋的文字，只納入純量欄位，避免內部物件被轉成
 * "[object Object]"；方向則另外加入畫面實際顯示的名稱。
 */
function rowSearchText(row, directionLabel, displayedPeriod = "") {
  const scalar = (v) => ["string", "number", "boolean"].includes(typeof v);
  const values = [];
  Object.values(row).forEach((value) => {
    if (scalar(value)) {
      values.push(value);
    } else if (Array.isArray(value) && value.every(scalar)) {
      /*
       * ⚠️ 陣列不可以跟著物件一起丟掉。
       *
       * 會被轉成 "[object Object]" 的是**物件**；純量陣列的 toString 是有意義的
       * 文字，而且本來就搜得到——sourceRefs（每個數字來自原始 Excel 哪幾格，
       * 例如「平均總旅行速率:A7,路段延滯:A3」）就是陣列。把它一起濾掉的話，
       * 稽核時想用儲存格位置或欄位標題回頭找是哪幾列，會查不到任何東西，
       * 而且畫面上不會有任何跡象說明為什麼搜不到。
       */
      values.push(value.join(" "));
    }
  });
  if (directionLabel) values.push(directionLabel);
  if (displayedPeriod) values.push(displayedPeriod);
  return values.join(" ");
}
/*
 * 兩張表的表頭欄位篩選（像 Excel 的資料篩選）。
 *
 * 只對「值是有限幾種」的欄位開篩選：期間、路段、日別、尖峰、方向、LOS。
 * 速率、延滯、速限、速限比是連續數值，逐值勾選沒有意義，所以不掛。
 *
 * value() 一律回**儲存值**、label() 才是畫面上的字：
 * 期間存的是民國年（115Q1），畫面可能顯示成西元或月份，
 * 用顯示值當鍵的話，切換年份顯示就會把勾好的條件弄丟。
 */
function periodColumn(indexInRow) {
  return {
    index: indexInRow,
    name: "期間",
    value: (x) => x.period,
    label: (x) => projectPeriodLabel(x.period, state.activeCode),
  };
}
const plainColumn = (index, name, field) => ({
  index,
  name,
  value: (x) => x[field],
  label: (x) => x[field],
});
const directionColumn = (index, name) => ({
  index,
  name,
  /* 方向的儲存值是 方向1／方向2，畫面上顯示的是使用者取的名字 */
  value: (x) => x.direction,
  label: (x) => rowDirectionName(x),
});

const detailFilter = globalThis.ColumnFilter.create({
  thead: "#detailHead",
  summary: "#detailFilterState",
  columns: [
    periodColumn(0),
    plainColumn(1, "路段", "road"),
    plainColumn(2, "日別", "day"),
    plainColumn(3, "尖峰", "peak"),
    directionColumn(4, "方向"),
    plainColumn(9, "LOS", "los"),
  ],
  onChange: () => renderDetails(),
  onOutOfScope: () => detachTableForOutOfScope(MT.CHART_IDS.detail),
});
const summaryFilter = globalThis.ColumnFilter.create({
  thead: "#summaryHead",
  summary: "#summaryFilterState",
  columns: [
    periodColumn(0),
    plainColumn(1, "路段", "road"),
    plainColumn(2, "日別", "day"),
    plainColumn(3, "代表尖峰", "peak"),
    directionColumn(4, "代表方向"),
    plainColumn(9, "LOS", "los"),
  ],
  onChange: () => renderSummaries(),
  onOutOfScope: () => detachTableForOutOfScope(MT.CHART_IDS.summary),
});

/*
 * 畫面上目前實際顯示的列。匯出 CSV 要跟著它走——
 * 使用者把畫面篩成「115Q2 A 路段」之後按匯出，卻拿到整包資料，
 * 那比不能篩選更糟：檔案和眼前看到的不一樣，而且不會有任何提示。
 */
let shownDetailRows = [];
/**
 * 明細表上要掛的提示：脫離、被主工具列篩掉幾筆。
 *
 * ⚠️ 「篩掉了」與「本來就沒有」一定要分得出來。
 *   只把列拿掉、什麼都不說的話，使用者會去翻原始檔找一批其實存在的資料。
 */
function renderDetailFilterNotes(all, shown) {
  const host = document.getElementById("detailFilterNotes");
  if (!host) return;
  const hidden = all.length - shown.length;
  const f = MT.filtersOf(MT.CHART_IDS.detail);
  host.innerHTML =
    detachNoteHtml(MT.CHART_IDS.detail) +
    /*
     * ── J-3／C-4／L-1：被主工具列篩掉幾筆，以及怎麼看回全部 ────────────
     *
     * 使用者 2026-09-15：「當我主工具列選擇 115Q1-115Q2 區間的資料時……
     *   匯總表本身的篩選條件範圍也變成只有 115Q1～115Q2，我無法篩選表格上
     *   有的其他資料（例如 114Q1～114Q4），但因為沒有任何提示……
     *   **會誤以為自己表格裡 114Q1～114Q4 資料遺失了**。請補充提示說明。」
     *
     * ⚠️ 這一句在 L-1 之後**改寫過**。舊版寫的是
     *   「表頭的篩選選項也只會列出這個範圍內的值」——那在 L-1 之後是**錯的**：
     *   漏斗現在列得出全部的值，勾了範圍外的就整張表脫離。
     *   說明文字沒跟著改的話，畫面會叫使用者去做一件他其實做得到的事的替代方案，
     *   那比不說更糟（「畫面說謊比沒說更糟」）。
     * ⚠️ 只在主工具列真的篩掉東西時才講（沒篩掉卻講一句是噪音）。
     */
    (hidden > 0
      ? `<p class="chart-inapplicable" data-testid="chart-inapplicable" data-testid-scope="main-scope-note">主工具列目前篩掉了 ${hidden} 筆（全部 ${all.length} 筆）。<b>這不是資料缺漏</b>——表頭的漏斗<b>仍然列得出全部的值</b>（範圍外的會標成灰字）。勾了範圍外的值，<b>只有這一張表會脫離主工具列</b>、改用完整資料，其他圖表不受影響。</p>`
      : "") +
    /*
     * ⚠️ 「並列」在**表格**上就是「兩者都列」——表格本來就逐列寫出日別、
     *   方向與尖峰，沒有「並排成兩欄」這回事。
     *   不講的話，使用者切了並列、表一動也不動，只會以為壞了。
     */
    /* ⚠️ 甲案之後日別與方向的預設就是並列，要用 MF.chose 問「他主動選了嗎」。 */
    inapplicableHtml(
      MF.chose(f, "day", "side-by-side") ||
        MF.chose(f, "direction", "side-by-side") ||
        MF.chose(f, "peak", "side-by-side"),
      MF.inapplicableNote(
        "「並列」是給圖用的呈現方式；這一張是逐筆明細表，本來就把日別、方向與尖峰各列一列，所以並列與「全部」看到的是同一份。",
        "全部資料（逐列列出）",
      ),
    );
}
/**
 * 彙總表上要掛的提示。
 *
 * ⚠️ 篩了方向或尖峰時一定要寫明**代表值是從哪幾筆挑出來的**，
 *   否則使用者無法判斷這個數字的來源
 *  （既有規則「彙總代表值三項數值必須來自同一筆」的延伸）。
 */
function renderSummaryFilterNotes(full, shown) {
  const host = document.getElementById("summaryFilterNotes");
  if (!host) return;
  const filters = MT.filtersOf(MT.CHART_IDS.summary);
  const narrowed =
    MF.isFiltered(filters, "direction") || MF.isFiltered(filters, "peak");
  const hidden = full.length - shown.length;
  host.innerHTML =
    detachNoteHtml(MT.CHART_IDS.summary) +
    /* ⚠️ 甲案之後日別與方向的預設就是並列，要用 MF.chose 問「他主動選了嗎」。 */
    inapplicableHtml(
      MF.chose(filters, "day", "side-by-side") ||
        MF.chose(filters, "direction", "side-by-side") ||
        MF.chose(filters, "peak", "side-by-side"),
      MF.inapplicableNote(
        "「並列」是給圖用的呈現方式；這一張彙總表逐列寫出日別，代表尖峰與代表方向本來就是每一列各自標示，所以並列與「全部」看到的是同一份。",
        "全部資料（逐列列出）",
      ),
    ) +
    (narrowed
      ? `<p class="chart-inapplicable" data-testid="chart-inapplicable">代表值改為「先依主工具列篩，再從剩下的那幾筆裡挑最差」。挑選規則沒有變（先取 LOS 最差、再取速限比最低、再取旅行速率最低），變的只是候選範圍。</p>`
      : "") +
    /*
     * ── C-4／J-3／L-1 ─────────────────────────────────────────────
     *   使用者 2026-09-15 就是在這一張表上發現的：主工具列選了
     *   115Q1～115Q2 之後，漏斗裡再也找不到 114 年的季度，
     *   而畫面上一個字都沒有 →「會誤以為自己表格裡 114Q1～114Q4 資料遺失了」。
     *   L-1 之後漏斗**列得出**全部的值，所以這一句也跟著改寫（與尖峰明細同一套）。
     */
    (hidden > 0
      ? `<p class="chart-inapplicable" data-testid="chart-inapplicable" data-testid-scope="main-scope-note">主工具列目前篩掉了 ${hidden} 組（全部 ${full.length} 組）。<b>這不是資料缺漏</b>——表頭的漏斗<b>仍然列得出全部的值</b>（範圍外的會標成灰字）。勾了範圍外的值，<b>只有這一張表會脫離主工具列</b>、改用完整資料，其他圖表不受影響。</p>`
      : "");
}
function renderDetails() {
  const q = normalize($("detailSearch")?.value || ""),
    code = state.activeCode;
  /*
   * ⚠️ 主工具列**先篩**，表頭的欄位篩選與搜尋框在它之後。
   *   順序反過來的話，欄位篩選的下拉會列出已經被主工具列篩掉的值——
   *   使用者勾了卻一筆都篩不出來，而畫面上不會說為什麼。
   *
   * ⚠️ 這一張是「一次看一季」的表嗎？**不是**。它是整個計畫的明細，
   *   所以區間用 range（起＝迄時不縮成一季）。
   *   真正一次看一季的是首頁的本季卡片。
   */
  const ownAll = state.details.filter((x) => x.projectCode === code);
  const all = MT.detailsFor(ownAll, MT.CHART_IDS.detail, "range");
  renderDetailFilterNotes(ownAll, all);
  /* 先套用搜尋框，欄位篩選的可選值就只會列出搜尋結果裡真的有的東西 */
  const searched = all.filter(
    (x) =>
      (!q || normalize(rowSearchText(x, rowDirectionName(x), projectPeriodLabel(x.period, code))).includes(q)),
  );
  const rows = detailFilter.filter(searched);
  shownDetailRows = rows;
  $("detailCount").textContent =
    rows.length === searched.length ? `${rows.length} 筆` : `${rows.length} / ${searched.length} 筆`;
  $("detailRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(projectPeriodLabel(x.period, code))}</td><td>${esc(x.road)}</td><td>${esc(x.day)}</td><td>${esc(x.peak)}</td><td>${esc(rowDirectionName(x))}</td><td>${fmt(x.travel, 3)}</td><td>${fmt(x.running, 3)}</td><td>${fmt(x.totalDelay, 3)}</td><td>${fmt(x.limit, Number.isInteger(Number(x.limit)) ? 0 : 1)}</td><td>${losChip(x.los)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="10" class="empty">${
        searched.length
          ? "目前的欄位篩選沒有符合的資料——請點表頭的漏斗調整，或按「清除全部篩選」。"
          : "目前計畫尚無尖峰明細"
      }</td></tr>`;
  /*
   * 搜尋只暫時限制下拉選項，不能因此刪掉使用者已勾的表頭條件。
   * 第三個參數 ownAll ＝ **完全不看主工具列**的全部資料：漏斗要列得出
   * 主工具列範圍外的值（L-1），勾了才有東西可以脫離。
   */
  detailFilter.mount(searched, all, ownAll);
}
function renderSummaries() {
  const q = normalize($("summarySearch")?.value || ""),
    code = state.activeCode;
  /*
   * ⚠️ **先篩再挑最差**，不可以拿已經建好的 state.summaries 再去篩。
   *
   *   state.summaries 是從**全部 4 筆**挑出來的代表值。拿它去篩方向，
   *   只會剩下「剛好代表值就是方向1」的那幾列，其餘整列消失——
   *   使用者會以為那些路段那一季沒有資料。
   *   正確的做法是：先把候選縮到符合條件的那幾筆，再從裡面挑最差。
   *
   *   ⚠️ 沒有任何條件被篩時，這一支算出來的必須與 state.summaries **逐格相同**
   *     （同一份明細、同一支排序函式、同一種分組鍵）。
   *     那是升級當天不可以有任何數字變動的保證。
   */
  const ownDetails = state.details.filter((x) => x.projectCode === code);
  const all = MT.summariesFor(
    ownDetails,
    MT.CHART_IDS.summary,
    worstOfGroup,
    "range",
  );
  /*
   * ⚠️ 完全不看主工具列的那一份，算一次就好——說明文字要用它算「篩掉幾組」，
   *   漏斗的選項母體（L-1）也要用它。算兩次不但慢，兩邊一旦改到不同的
   *   分組鍵或排序，畫面上的數字與漏斗裡的選項就會對不起來。
   */
  const fullSummaries = MT.summariesFor(
    ownDetails,
    "__unfiltered__",
    worstOfGroup,
    "range",
  );
  renderSummaryFilterNotes(fullSummaries, all);
  const summaryFilters = MT.filtersOf(MT.CHART_IDS.summary);
  const summaryNarrowed =
    MF.isFiltered(summaryFilters, "direction") ||
    MF.isFiltered(summaryFilters, "peak");
  const searched = all.filter(
    (x) =>
      (!q || normalize(rowSearchText(x, rowDirectionName(x), projectPeriodLabel(x.period, code))).includes(q)),
  );
  const rows = summaryFilter.filter(searched);
  $("summaryCount").textContent =
    rows.length === searched.length ? `${rows.length} 筆` : `${rows.length} / ${searched.length} 筆`;
  $("summaryRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            /*
             * ⚠️ 篩了方向或尖峰時，代表尖峰／代表方向那兩格要寫出
             *   **候選是哪幾筆**。不寫的話，同一個路段在兩種條件下
             *   會給出兩個不同的代表值，而使用者看不出是從哪裡挑的。
             */
            `<tr><td>${esc(projectPeriodLabel(x.period, code))}</td><td>${esc(x.road)}</td><td>${esc(x.day)}</td><td>${esc(x.peak)}${
              x.pickedFrom && summaryNarrowed
                ? `<br><small class="muted-cell">候選：${esc(x.pickedFrom)}</small>`
                : ""
            }</td><td>${esc(rowDirectionName(x))}</td><td>${fmt(x.travel, 3)}</td><td>${fmt(x.running, 3)}</td><td><b>${fmt(x.totalDelay, 3)}</b></td><td>${fmt(x.ratio, 3)}</td><td>${losChip(x.los)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="10" class="empty">${
        searched.length
          ? "目前的欄位篩選沒有符合的資料——請點表頭的漏斗調整，或按「清除全部篩選」。"
          : "目前計畫尚無尖峰彙總"
      }</td></tr>`;
  /* 第三個參數＝完全不看主工具列的全部彙總（L-1，與尖峰明細同一套）。 */
  summaryFilter.mount(searched, all, fullSummaries);
}
function renderLosRules() {
  const x = rulesFor();
  for (const grade of ["A", "B", "C", "D", "E"]) $(`los${grade}`).value = x[grade];
  $("losRuleExplanation").innerHTML =
    `<span><b>A：</b>速限比 ≧ ${fmt(x.A, 2)}</span><span><b>B：</b>${fmt(x.B, 2)} ≦ 速限比 ＜ ${fmt(x.A, 2)}</span><span><b>C：</b>${fmt(x.C, 2)} ≦ 速限比 ＜ ${fmt(x.B, 2)}</span><span><b>D：</b>${fmt(x.D, 2)} ≦ 速限比 ＜ ${fmt(x.C, 2)}</span><span><b>E：</b>${fmt(x.E, 2)} ≦ 速限比 ＜ ${fmt(x.D, 2)}</span><span><b>F：</b>速限比 ＜ ${fmt(x.E, 2)}</span>`;
  renderRuleScopes();
}
/*
 * ── 依季別／路段套用不同門檻（使用者 2026-09-15）────────────────
 *
 * ⚠️ 順位判斷全部在 los-rule-scope.js，這裡只負責畫與存。
 * ⚠️ 重疊**一定要寫出來**：使用者設了一條路段專屬門檻，卻因為那一季有
 *   全路段的設定而沒生效，畫面上不說的話，他會以為自己設的那一條壞了。
 */
/**
 * 一條覆寫的季別區間，寫成使用者看得懂的一句話。
 *
 * ⚠️ 全站只有這一份。服務水準門檻、三段分法、孤兒清單三個地方都要印同一句話；
 *   各寫一份的話，遲早出現「同一條覆寫在 A 表寫『115Q1 起』、在 B 表寫『115Q1』」
 *   這種看起來像兩條設定的畫面。
 * ⚠️ 一律走 projectPeriodLabel，不可以印出原始鍵值或 `*`——
 *   民國／西元、季別／調查月份的寫法整站一致，這裡也不例外。
 */
function scopeRangeText(scope, code = state.activeCode) {
  var ANY = globalThis.LosRuleScope.ANY;
  var n = globalThis.LosRuleScope.normalizeScope(scope);
  return n.periodFrom === ANY && n.periodTo === ANY
    ? "全季別"
    : n.periodFrom === ANY
      ? projectPeriodLabel(n.periodTo, code) + " 以前"
      : n.periodTo === ANY
        ? projectPeriodLabel(n.periodFrom, code) + " 起"
        : n.periodFrom === n.periodTo
          ? projectPeriodLabel(n.periodFrom, code)
          : projectPeriodLabel(n.periodFrom, code) +
            "～" +
            projectPeriodLabel(n.periodTo, code);
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  孤兒覆寫：指到一個已經不存在的路段
 * ══════════════════════════════════════════════════════════════════════
 *
 * 路段被改名、被合併、或那一段的資料整批被刪掉之後，原本針對那一段設的
 * 覆寫還留在清單裡，但它**永遠命不中任何一筆資料**——畫面上看起來設好了，
 * 實際上完全沒有作用。這是「設了卻沒用」那一類最難查的毛病：
 * 沒有任何錯誤訊息，圖與表也都畫得出來，只是用的是計畫預設那把尺。
 *
 * 作法（三種覆寫同一套）：
 *   ・平常**完全不出現**——沒有孤兒的人不該看到一塊空面板。
 *   ・偵測到就整塊冒出來，並且把每一條的**完整內容**寫出來
 *    （季別區間、指到的路段、原本設的值）。只說「有 3 條孤兒」而不說內容，
 *     使用者沒辦法判斷該不該清，等於逼他盲按。
 *   ・清除是**一次性**的動作，清掉救不回來，所以文案要講明白。
 *
 * ⚠️ 判準是「這個計畫**確實有資料**，而且資料裡沒有這一段」。
 *   剛建好計畫、還沒匯入時路段清單當然是空的，那時把使用者預先設好的
 *   覆寫全部標成孤兒並請他清掉，是我們自己幫他把設定丟掉。
 * ⚠️ 全路段（road = *）的覆寫**永遠不是孤兒**：它本來就不指定路段。
 */
function orphanScopeEntries(code = state.activeCode) {
  var ANY = globalThis.LosRuleScope.ANY;
  var roads = new Set(
    state.details
      .filter(function (d) {
        return d.projectCode === code;
      })
      .map(function (d) {
        return d.road;
      })
      .filter(Boolean),
  );
  if (!roads.size) return [];
  var out = [];
  ruleScopesFor(code).forEach(function (scope, index) {
    var n = globalThis.LosRuleScope.normalizeScope(scope);
    if (n.road === ANY || roads.has(n.road)) return;
    out.push({
      kind: "los",
      source: "服務水準門檻",
      index: index,
      road: n.road,
      range: scopeRangeText(scope, code),
      detail: ["A", "B", "C", "D", "E"]
        .map(function (grade) {
          return grade + " " + fmt((scope.rules || {})[grade], 2);
        })
        .join("／"),
    });
  });
  bandScopesFor(code).forEach(function (scope, index) {
    var n = globalThis.LosRuleScope.normalizeScope(scope);
    if (n.road === ANY || roads.has(n.road)) return;
    var rules = scope.rules || {};
    out.push({
      kind: "band",
      source: "三段分法",
      index: index,
      road: n.road,
      range: scopeRangeText(scope, code),
      detail:
        "順暢 A～" +
        String(rules.smoothEnd || "") +
        "／壅塞 " +
        String(rules.congestedStart || "") +
        "～F",
    });
  });
  return out;
}
/**
 * 畫「孤兒覆寫」那一塊。沒有孤兒就整塊 hidden。
 *
 * ⚠️ 用 hidden 而不是清空內容：側欄那條既有規則是「hidden 或高度 0 的一律不列」，
 *   所以整塊藏起來的同時，小分頁也自動不會列出一個點了什麼都沒有的項目。
 */
function renderOrphanScopes() {
  var host = $("standards-orphan");
  var rowsHost = $("orphanScopeRows");
  if (!host || !rowsHost) return;
  var code = state.activeCode;
  var list = orphanScopeEntries(code);
  host.hidden = list.length === 0;
  rowsHost.innerHTML = list
    .map(function (item) {
      return `<tr><td>${esc(item.source)}</td><td>${esc(item.range)}</td><td>${esc(item.road)}</td><td>${esc(item.detail)}</td></tr>`;
    })
    .join("");
}
if ($("clearOrphanScopes"))
  $("clearOrphanScopes").onclick = async () => {
    const p = activeProject();
    if (!p) return toast("請先建立或選擇計畫");
    const list = orphanScopeEntries(p.code);
    if (!list.length) return toast("目前沒有指到不存在路段的覆寫");
    if (
      !confirm(
        `確定清除這 ${list.length} 條指到不存在路段的覆寫？清掉之後救不回來。`,
      )
    )
      return;
    /*
     * ⚠️ 用**索引**刪，不是用「路段名稱」刪。
     *   同一個消失的路段可能有好幾條覆寫（不同季別區間），
     *   而且路段名稱可能同時出現在還在用的覆寫裡（例如改名後新舊都有）。
     *   orphanScopeEntries 已經逐條判定過，這裡照它給的索引刪最準。
     */
    const losDrop = new Set(
      list.filter((item) => item.kind === "los").map((item) => item.index),
    );
    const bandDrop = new Set(
      list.filter((item) => item.kind === "band").map((item) => item.index),
    );
    state.losRuleScopes = state.losRuleScopes || {};
    state.losRuleScopes[p.code] = ruleScopesFor(p.code).filter(
      (_, index) => !losDrop.has(index),
    );
    state.bandRuleScopes = state.bandRuleScopes || {};
    state.bandRuleScopes[p.code] = bandScopesFor(p.code).filter(
      (_, index) => !bandDrop.has(index),
    );
    renderLosRules();
    renderBandRule();
    rebuild();
    renderCharts();
    await save();
    toast(`已清除 ${list.length} 條指到不存在路段的覆寫`);
  };
function renderRuleScopes() {
  var periodFromSelect = $("scopePeriodFrom");
  var periodToSelect = $("scopePeriodTo");
  var roadSelect = $("scopeRoad");
  var rowsHost = $("ruleScopeRows");
  if (!periodFromSelect || !periodToSelect || !roadSelect || !rowsHost) return;
  var code = state.activeCode;
  var own = state.details.filter(function (d) {
    return d.projectCode === code;
  });
  var periods = [...new Set(own.map(function (d) { return d.period; }))]
    .filter(Boolean)
    .sort(function (a, b) { return periodIndex(a) - periodIndex(b); });
  var roads = [...new Set(own.map(function (d) { return d.road; }))]
    .filter(Boolean)
    .sort();
  var ANY = globalThis.LosRuleScope.ANY;
  var keepFrom = periodFromSelect.value;
  var keepTo = periodToSelect.value;
  var keepRoad = roadSelect.value;
  /*
   * ⚠️ 兩個下拉都要有「不限」。
   *   只設起、迄留不限 ＝「從那一季開始一直有效」——速限最常見的情形。
   *   兩個都不限 ＝ 全季別（那時只能靠路段區分，否則就是計畫預設）。
   */
  var periodOptions = periods
    .map(function (p) {
      return `<option value="${esc(p)}">${esc(projectPeriodLabel(p, code))}</option>`;
    })
    .join("");
  periodFromSelect.innerHTML =
    `<option value="${ANY}">不限（最早）</option>` + periodOptions;
  periodToSelect.innerHTML =
    `<option value="${ANY}">不限（最新）</option>` + periodOptions;
  roadSelect.innerHTML =
    `<option value="${ANY}">全路段</option>` +
    roads
      .map(function (r) {
        return `<option value="${esc(r)}">${esc(r)}</option>`;
      })
      .join("");
  if (keepFrom) periodFromSelect.value = keepFrom;
  if (keepTo) periodToSelect.value = keepTo;
  if (keepRoad) roadSelect.value = keepRoad;
  var list = ruleScopesFor(code);
  rowsHost.innerHTML = list.length
    ? list
        .map(function (scope, index) {
          var tier = globalThis.LosRuleScope.tierOf(scope);
          /*
           * ⚠️ 區間要寫成使用者看得懂的一句話，不可以印出 `*`。
           *   兩端都不限＝全季別；起＝迄＝那一季；只設一端＝「…起」「…止」。
           */
          var normalized = globalThis.LosRuleScope.normalizeScope(scope);
          var rangeText = scopeRangeText(scope, code);
          return `<tr><td>${esc(rangeText)}</td><td>${esc(normalized.road === ANY ? "全路段" : normalized.road)}</td><td>${fmt(scope.rules.A, 2)}</td><td>${fmt(scope.rules.B, 2)}</td><td>${fmt(scope.rules.C, 2)}</td><td>${fmt(scope.rules.D, 2)}</td><td>${fmt(scope.rules.E, 2)}</td><td>${esc(globalThis.LosRuleScope.TIER_LABELS[tier])}</td><td><button class="link-button" data-remove-scope="${index}">刪除</button></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="9" class="empty">目前沒有覆寫，全部季別與路段都用計畫預設門檻。</td></tr>';
  var conflicts = globalThis.LosRuleScope.conflictsIn(list);
  $("ruleScopeConflicts").innerHTML = conflicts.length
    ? `<p class="chart-inapplicable" data-testid="chart-inapplicable">⚠️ 有 ${conflicts.length} 組範圍互相重疊，實際套用的是<b>比較細的那一條</b>（季別優先）：${conflicts
        .map(function (hit) {
          return `「${esc(hit.winnerLabel)}」蓋過「${esc(hit.loserLabel)}」`;
        })
        .join("、")}。這不是錯誤，但被蓋過的那一條在重疊的範圍內不會生效。</p>`
    : "";
  renderOrphanScopes();
}
/**
 * 三段分界的設定介面。
 *
 * 只有兩個下拉：順暢的下界、壅塞的上界。中間「尚可」是算出來的，
 * 不讓使用者分別設三段——三段各自可設就會出現重疊或空隙。
 */
function renderBandRule() {
  var bands = bandsFor();
  var smooth = $("bandSmoothEnd");
  var congested = $("bandCongestedStart");
  if (!smooth || !congested) return;
  /*
   * 選項要互相限制：順暢的下界一定在壅塞的上界之前，否則兩段會重疊。
   * 這裡直接不把不合法的選項列出來，比讓使用者選了才報錯好。
   */
  var congestedIndex = LOS_GRADES.indexOf(bands.congestedStart);
  var smoothIndex = LOS_GRADES.indexOf(bands.smoothEnd);
  smooth.innerHTML = LOS_GRADES.slice(0, LOS_GRADES.length - 1)
    .map(function (grade, index) {
      return index < congestedIndex
        ? `<option value="${grade}"${grade === bands.smoothEnd ? " selected" : ""}>${grade}</option>`
        : "";
    })
    .join("");
  congested.innerHTML = LOS_GRADES.map(function (grade, index) {
    return index > smoothIndex
      ? `<option value="${grade}"${grade === bands.congestedStart ? " selected" : ""}>${grade}</option>`
      : "";
  }).join("");
  var labels = bandLabels();
  /*
   * 收合狀態下也要看得到目前的分法——設定藏起來可以，
   * 但「現在是怎麼分的」不能藏，否則使用者得展開才知道圖是怎麼畫的。
   */
  var grades = labels.grades;
  $("bandRuleSummary").textContent =
    "順暢 " + grades.smooth.join("、") +
    "／尚可 " + (grades.fair.length ? grades.fair.join("、") : "無") +
    "／壅塞 " + grades.congested.join("、");
  $("bandRuleExplanation").innerHTML =
    `<span><b>${esc(labels.smooth)}</b></span>` +
    `<span><b>${esc(labels.fair)}</b></span>` +
    `<span><b>${esc(labels.congested)}</b></span>` +
    `<span>趨勢圖的佔比指標：<b>${esc(labels.congestedShareLabel)}</b></span>`;
  renderBandScopes();
}

/**
 * 三段分法的「季別區間 × 路段」覆寫：下拉選項、清單與衝突提示。
 *
 * ⚠️ 與服務水準門檻那一段（renderLosRules 的後半）刻意長得一模一樣：
 *   使用者在同一頁上會連著看這兩塊，行為不一致的話他會以為其中一個壞了。
 */
function renderBandScopes() {
  var fromSelect = $("bandScopePeriodFrom");
  var toSelect = $("bandScopePeriodTo");
  var roadSelect = $("bandScopeRoad");
  var smoothSelect = $("bandScopeSmoothEnd");
  var congestedSelect = $("bandScopeCongestedStart");
  var rowsHost = $("bandScopeRows");
  if (!fromSelect || !toSelect || !roadSelect || !rowsHost) return;
  var code = state.activeCode;
  var own = state.details.filter(function (d) {
    return d.projectCode === code;
  });
  var periods = [...new Set(own.map(function (d) { return d.period; }))]
    .filter(Boolean)
    .sort(function (a, b) { return periodIndex(a) - periodIndex(b); });
  var roads = [...new Set(own.map(function (d) { return d.road; }))]
    .filter(Boolean)
    .sort();
  var ANY = globalThis.LosRuleScope.ANY;
  var keepFrom = fromSelect.value;
  var keepTo = toSelect.value;
  var keepRoad = roadSelect.value;
  var periodOptions = periods
    .map(function (p) {
      return `<option value="${esc(p)}">${esc(projectPeriodLabel(p, code))}</option>`;
    })
    .join("");
  fromSelect.innerHTML =
    `<option value="${ANY}">不限（最早）</option>` + periodOptions;
  toSelect.innerHTML =
    `<option value="${ANY}">不限（最新）</option>` + periodOptions;
  roadSelect.innerHTML =
    `<option value="${ANY}">全路段</option>` +
    roads
      .map(function (r) {
        return `<option value="${esc(r)}">${esc(r)}</option>`;
      })
      .join("");
  if (keepFrom) fromSelect.value = keepFrom;
  if (keepTo) toSelect.value = keepTo;
  if (keepRoad) roadSelect.value = keepRoad;
  /*
   * ⚠️ 兩個等級下拉要列**全部**等級，不像上面那組會互相限制。
   *   這裡不限制的理由：使用者是在替某一季／某一段設一把新的尺，
   *   合法性（順暢要在壅塞之前）在按下去時檢查並說明白，
   *   先把選項藏起來反而看不出「為什麼選不到」。
   */
  if (smoothSelect && !smoothSelect.options.length)
    smoothSelect.innerHTML = LOS_GRADES.slice(0, LOS_GRADES.length - 1)
      .map(function (grade) {
        return `<option value="${grade}">${grade}</option>`;
      })
      .join("");
  if (congestedSelect && !congestedSelect.options.length)
    congestedSelect.innerHTML = LOS_GRADES.slice(1)
      .map(function (grade) {
        return `<option value="${grade}">${grade}</option>`;
      })
      .join("");
  var list = bandScopesFor(code);
  rowsHost.innerHTML = list.length
    ? list
        .map(function (scope, index) {
          var tier = globalThis.LosRuleScope.tierOf(scope);
          var n = globalThis.LosRuleScope.normalizeScope(scope);
          var rangeText = scopeRangeText(scope, code);
          return `<tr><td>${esc(rangeText)}</td><td>${esc(n.road === ANY ? "全路段" : n.road)}</td><td>${esc(scope.rules.smoothEnd)}</td><td>${esc(scope.rules.congestedStart)}</td><td>${esc(globalThis.LosRuleScope.TIER_LABELS[tier])}</td><td><button class="link-button" data-remove-band-scope="${index}">刪除</button></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">目前沒有覆寫，全部季別與路段都用計畫預設分界。</td></tr>';
  var conflicts = globalThis.LosRuleScope.conflictsIn(list);
  $("bandScopeConflicts").innerHTML = conflicts.length
    ? `<p class="chart-inapplicable" data-testid="chart-inapplicable">⚠️ 有 ${conflicts.length} 組範圍互相重疊，實際套用的是<b>比較細的那一條</b>（季別優先、涵蓋季數少的優先）：${conflicts
        .map(function (hit) {
          return `「${esc(hit.winnerLabel)}」蓋過「${esc(hit.loserLabel)}」`;
        })
        .join("、")}。這不是錯誤，但被蓋過的那一條在重疊的範圍內不會生效。</p>`
    : "";
  renderOrphanScopes();
}
/**
 * 讀一組 A～E 門檻並驗證。
 *
 * @param prefix 欄位 id 的前綴：`"los"` 是計畫預設那一組，`"scope"` 是覆寫那一組。
 *
 * ⚠️ 兩組**共用同一支驗證**：分開寫的話，遲早會出現「預設那組擋得住、
 *   覆寫那組擋不住」的不一致，而不合法的門檻會讓整批資料悄悄變成 F。
 */
function readLosRuleInputs(prefix = "los") {
  const id = (g) => (prefix === "los" ? `los${g}` : `scope${g}`);
  const x = Object.fromEntries(
    ["A", "B", "C", "D", "E"].map((g) => [g, Number($(id(g)).value)]),
  );
  return Object.values(x).every(Number.isFinite) &&
    x.A > x.B &&
    x.B > x.C &&
    x.C > x.D &&
    x.D > x.E &&
    x.E >= 0 &&
    x.A <= 2
    ? x
    : null;
}
function readLosRules() {
  return readLosRuleInputs("los");
}
$("applyLosRules").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  const x = readLosRules();
  if (!x) return toast("門檻必須是 A＞B＞C＞D＞E，且介於 0～2");
  state.losRules[p.code] = x;
  rebuild();
  await save();
  toast("服務水準門檻已保存，明細、彙總與圖表已重新計算");
};
/*
 * ── 新增／更新一條「季別 × 路段」的門檻覆寫 ────────────────────
 *
 * ⚠️ 套用之後一定要 rebuild()：使用者 2026-09-15 指定
 *   「套用後進行重新計算，請確定服務水準有將需要用到的原始資料保存下來，
 *     **讓使用者不須重新匯入檔案**」。
 *   rebuild() 讀的是 state.details（旅行速率、速限、速限比都在裡面），
 *   所以換一組門檻只要重算 los 這一欄——原始資料本來就完整保存著。
 */
$("addRuleScope").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  const rules = readLosRuleInputs("scope");
  if (!rules) return toast("門檻必須是 A＞B＞C＞D＞E，且介於 0～2");
  let periodFrom = $("scopePeriodFrom").value;
  let periodTo = $("scopePeriodTo").value;
  const road = $("scopeRoad").value;
  const ANY = globalThis.LosRuleScope.ANY;
  /*
   * ⚠️ 起 > 迄 是使用者做得到的動作（兩個下拉各自獨立）。
   *   不處理的話這一條會永遠命不中任何一筆，而畫面上看起來設好了——
   *   「設了卻沒用」是最難查的一種。這裡直接對調並說一聲。
   */
  let swapped = false;
  if (
    periodFrom !== ANY &&
    periodTo !== ANY &&
    periodIndex(periodFrom) > periodIndex(periodTo)
  ) {
    const keep = periodFrom;
    periodFrom = periodTo;
    periodTo = keep;
    swapped = true;
  }
  if (periodFrom === ANY && periodTo === ANY && road === ANY)
    return toast(
      "「全季別 × 全路段」就是計畫預設本身——請直接改計畫預設，不要在覆寫裡加一條一樣的",
    );
  state.losRuleScopes = state.losRuleScopes || {};
  const list = (state.losRuleScopes[p.code] = ruleScopesFor(p.code).slice());
  /*
   * ⚠️ 「同一條」的判斷要用**正規化後**的三個欄位比。
   *   舊資料是單一 period，直接比 periodFrom 會認不出來，
   *   於是同一個範圍會被加成兩條——兩條都命中時取窄的，看起來像沒生效。
   */
  const at = list.findIndex(function (item) {
    const n = globalThis.LosRuleScope.normalizeScope(item);
    return (
      n.periodFrom === periodFrom && n.periodTo === periodTo && n.road === road
    );
  });
  const entry = { periodFrom, periodTo, road, rules };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  renderLosRules();
  rebuild();
  await save();
  toast(
    (swapped ? "起比迄晚，已自動對調。" : "") +
      (at >= 0
        ? "這一條覆寫已更新，明細、彙總與圖表已重新計算"
        : "已新增一條覆寫，明細、彙總與圖表已重新計算"),
  );
};
/*
 * 三段分法的覆寫：新增／更新。
 *
 * ⚠️ 與服務水準門檻那一顆刻意走同一套流程（驗證 → 寫入 → 重畫 → 存檔 → 說一聲）。
 *   ⚠️ 這裡**不必** rebuild()：三段分界不改變任何一筆的服務水準等級，
 *     它只決定「A～F 怎麼歸成三段」，圖表重畫就夠了。
 *     多呼叫一次 rebuild() 不會錯，但會讓使用者以為等級被重算過。
 */
$("addBandScope").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  const smoothEnd = $("bandScopeSmoothEnd").value;
  const congestedStart = $("bandScopeCongestedStart").value;
  const smoothIndex = LOS_GRADES.indexOf(smoothEnd);
  const congestedIndex = LOS_GRADES.indexOf(congestedStart);
  /*
   * ⚠️ 順暢的下界一定要在壅塞的上界**之前**，否則兩段重疊、
   *   中間的「尚可」變成負的，而圖照樣畫得出來——那是會說謊的圖。
   */
  if (smoothIndex < 0 || congestedIndex < 0 || smoothIndex >= congestedIndex)
    return toast("順暢的下界必須排在壅塞的上界之前（例如順暢到 B、壅塞從 E 起）");
  let periodFrom = $("bandScopePeriodFrom").value;
  let periodTo = $("bandScopePeriodTo").value;
  const road = $("bandScopeRoad").value;
  const ANY = globalThis.LosRuleScope.ANY;
  /* 起 > 迄 時自動對調並說一聲，理由與服務水準門檻那一顆相同。 */
  let swapped = false;
  if (
    periodFrom !== ANY &&
    periodTo !== ANY &&
    periodIndex(periodFrom) > periodIndex(periodTo)
  ) {
    const keep = periodFrom;
    periodFrom = periodTo;
    periodTo = keep;
    swapped = true;
  }
  if (periodFrom === ANY && periodTo === ANY && road === ANY)
    return toast(
      "「全季別 × 全路段」就是計畫預設本身——請直接改計畫預設，不要在覆寫裡加一條一樣的",
    );
  state.bandRuleScopes = state.bandRuleScopes || {};
  const list = (state.bandRuleScopes[p.code] = bandScopesFor(p.code).slice());
  const at = list.findIndex(function (item) {
    const n = globalThis.LosRuleScope.normalizeScope(item);
    return (
      n.periodFrom === periodFrom && n.periodTo === periodTo && n.road === road
    );
  });
  const entry = {
    periodFrom,
    periodTo,
    road,
    rules: { smoothEnd, congestedStart },
  };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  renderBandRule();
  renderCharts();
  await save();
  toast(
    (swapped ? "起比迄晚，已自動對調。" : "") +
      (at >= 0 ? "這一條分界覆寫已更新，圖表已重畫" : "已新增一條分界覆寫，圖表已重畫"),
  );
};
/* 刪除一條三段分法覆寫。 */
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-remove-band-scope]");
  if (!button) return;
  const p = activeProject();
  if (!p) return;
  const list = bandScopesFor(p.code).slice();
  list.splice(Number(button.dataset.removeBandScope), 1);
  state.bandRuleScopes = state.bandRuleScopes || {};
  state.bandRuleScopes[p.code] = list;
  renderBandRule();
  renderCharts();
  await save();
  toast("已刪除這一條分界覆寫，圖表已重畫");
});
/* 刪除一條覆寫：用事件委派，重畫之後不必重新綁。 */
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-remove-scope]");
  if (!button) return;
  const p = activeProject();
  if (!p) return;
  const list = ruleScopesFor(p.code).slice();
  list.splice(Number(button.dataset.removeScope), 1);
  state.losRuleScopes = state.losRuleScopes || {};
  state.losRuleScopes[p.code] = list;
  renderLosRules();
  rebuild();
  await save();
  toast("已刪除這一條覆寫，明細、彙總與圖表已重新計算");
});
$("applyBandRule").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  const smoothEnd = $("bandSmoothEnd").value;
  const congestedStart = $("bandCongestedStart").value;
  if (LOS_GRADES.indexOf(smoothEnd) >= LOS_GRADES.indexOf(congestedStart))
    return toast("順暢的下界必須排在壅塞的上界之前");
  state.bandRules[p.code] = { smoothEnd, congestedStart };
  renderBandRule();
  renderRuleShortcut();
  rebuild();
  await save();
  /*
   * ⚠️ 三段分法搬出「服務水準判定方式」面板、變成獨立一塊之後，
   *   這一頁變高了，按下「套用」之後的結果說明（#bandRuleExplanation）
   *   落在視窗外只露出 21px——按了看起來像沒反應。
   *   （e2e-reveal 抓到的，不是我事後想到的。）
   *   和這一頁另外幾個「按了才出現結果」的按鈕一樣，走 revealResult()。
   */
  revealResult("bandRuleExplanation");
  toast(`三段分法已保存：${bandLabels().congested}；趨勢圖的佔比指標改為「${bandLabels().congestedShareLabel}」`);
};
$("resetBandRule").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  delete state.bandRules[p.code];
  renderBandRule();
  renderRuleShortcut();
  rebuild();
  await save();
  toast("三段分法已恢復預設（順暢 A、B／尚可 C、D／壅塞 E、F）");
};
$("resetLosRules").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  if (!confirm("確定將目前計畫的服務水準門檻恢復為系統預設值？")) return;
  delete state.losRules[p.code];
  rebuild();
  await save();
  toast("已恢復預設門檻並重新計算");
};
$("detailSearch").oninput = renderDetails;
$("summarySearch").oninput = renderSummaries;
$("rebuild").onclick = async () => {
  rebuild();
  await save();
  toast("尖峰彙總已重新建立");
};
/*
 * ── 路段速限表的逐欄篩選 ───────────────────────────────────────
 *
 * 使用者 2026-09-15：「路段速限的表，請建立篩選功能……（每欄位都能篩，
 *   路段／方向／速限），所以篩選很重要」。
 *
 * ⚠️ **不要另外寫一套**：尖峰明細與尖峰彙總已經有 ColumnFilter
 *   （漏斗按鈕、勾選清單、同欄 OR／跨欄 AND、「一欄都沒勾＝不設限」）。
 *   另寫一套的話，三張表的行為遲早會分岔，而分岔不會有任何錯誤訊息。
 *
 * ⚠️ 比對用的是**儲存值**、顯示用的是**顯示值**（方向存的是「方向1」，
 *   畫面上是使用者取的名字）——這正是 ColumnFilter 分開 value/label 的原因。
 */
const speedFilter = globalThis.ColumnFilter.create({
  thead: "#speedHead",
  summary: "#speedFilterState",
  columns: [
    { index: 0, name: "路段", value: (x) => x.road, label: (x) => x.road },
    {
      index: 1,
      name: "方向",
      value: (x) => x.direction,
      label: (x) => x.directionName,
    },
    {
      index: 2,
      name: "公告速限",
      /* 數字要轉成字串當識別鍵，否則 50 與 "50" 會被當成兩個不同的選項。 */
      value: (x) => String(x.limit),
      label: (x) => `${x.limit} km/h`,
    },
    {
      index: 3,
      name: "資料來源",
      value: (x) => (x.confirmed ? "已人工確認" : "預設值，未確認"),
      label: (x) => (x.confirmed ? "已人工確認" : "預設值，未確認"),
    },
  ],
  onChange: () => renderLimits(),
});
function renderLimits() {
  const keys = [
    ...new Set(
      state.details
        .filter((d) => d.projectCode === state.activeCode)
        .map((d) => `${d.projectCode}|${d.road}|${d.direction}`),
    ),
  ].sort();
  /*
   * 先攤成一列一個物件再篩。舊版直接把 key 字串 map 成 HTML，
   * 沒有可以拿來比對的欄位值。
   */
  const allRows = keys.map((k) => {
    const parts = k.split("|"),
      direction = parts.pop(),
      road = parts.pop();
    return {
      key: k,
      road,
      direction,
      directionName: directionNameFor(road, direction),
      limit: state.limits[k] || 50,
      confirmed: Boolean(state.limitConfirmed[k]),
    };
  });
  const rows = speedFilter.filter(allRows);
  /*
   * ── I-3（大檢查 2026-09-15 查到的漏洞）─────────────────────────
   *
   * 這一頁有一張表，卻**完全不吃主工具列的任何條件**——速限是設定值，
   * 它屬於「這條路段這個方向」，不屬於某一季、某一個日別。
   *
   * ⚠️ 但在此之前這一頁**一句說明都沒有**，而且 e2e-filter-coverage 的
   *   分頁名單裡也沒有它（只有 home／detail／summary／charts／maintenance），
   *   所以「每張表都要有不適用說明」這條規則在這一頁上**從來沒被驗過**。
   *   使用者在主工具列篩了 115Q2 之後切到這一頁，看到的是全部路段——
   *   不講的話，他只會以為篩選壞了、或者這裡的資料是別的計畫的。
   */
  const scopeNotes = document.getElementById("speedScopeNotes");
  if (scopeNotes)
    scopeNotes.innerHTML = alwaysIndependentHtml(
      "這一張表不受上方主工具列影響（季度、路段、日別、方向、尖峰都一樣）：公告速限是「這條路段這個方向」的設定值，不隨季度或日別改變，所以這裡一律列出目前計畫的全部路段方向。要縮小範圍請用表頭的漏斗。",
    );
  /*
   * ⚠️ 篩掉幾列一定要**說出來**。只把列拿掉、什麼都不寫的話，
   *   使用者會以為那些路段的速限不見了——與尖峰明細同一條規則。
   */
  const notes = document.getElementById("speedFilterNotes");
  if (notes) {
    const hidden = allRows.length - rows.length;
    notes.hidden = hidden <= 0;
    notes.textContent = hidden > 0
      ? `表頭篩選中：${allRows.length} 列裡顯示 ${rows.length} 列，隱藏 ${hidden} 列（資料沒有消失）。⚠️「套用並重算 LOS」只會把畫面上這 ${rows.length} 列標成「已人工確認」；被隱藏的列速限維持原值、確認狀態也不變。`
      : "";
  }
  $("speedRows").innerHTML = rows.length
    ? rows
        .map((row) => {
          const k = row.key;
          const road = row.road;
          /*
           * 有「速限版本」覆蓋時，這一格顯示的基準速限並不是實際換算 LOS
           * 用的值。舊版什麼都不標，使用者在這裡把 90 改成 60、按下套用，
           * 畫面顯示 60、資料仍用 90，而 toast 還說「LOS 已重新計算」。
           * 這裡把「有版本覆蓋」明白標出來，並列出實際生效的速限。
           */
          const versions = (state.speedVersions?.[k] || []).filter(Boolean);
          const versionNote = versions.length
            ? `<div class="limit-version-note">此路段方向設有 ${versions.length} 個速限版本，實際換算 LOS 時以版本速限為準（${versions
                /*
                 * 欄位名稱要與速限版本實際存的一致：{ speed, start, end, … }。
                 * 舊版寫 v.from 與 v.limit，兩個都不存在，於是整段印成
                 * 「起始起 undefined km/h」——這一段的用意就是「列出實際生效的
                 * 速限」，印出 undefined 等於這個說明完全沒有作用。
                 * 同一支檔案別處（showQuarter(v.start)、v.speed）本來就是對的。
                 */
                .map(
                  (v) =>
                    `${esc(showQuarter(v.start) || "起始")}起 ${esc(String(v.speed ?? "未填"))} km/h`,
                )
                .join("、")}）；下方欄位是未被版本涵蓋的季度所使用的基準速限。</div>`
            : "";
          return `<tr><td>${esc(road)}</td><td>${esc(row.directionName)}</td><td><input class="speed-input" data-limit="${esc(k)}" type="number" min="1" value="${row.limit}">${versionNote}</td><td>${row.confirmed ? '<span class="status-ok">已人工確認</span>' : '<span class="status-warn">預設值，未確認</span>'}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="empty">${
        allRows.length
          ? "表頭篩選把所有列都篩掉了——點欄位標題上的漏斗可以改條件，或按「清除全部篩選」。"
          : "目前計畫匯入資料後會自動建立路段方向"
      }</td></tr>`;
  /*
   * ⚠️ mount 一定要在重畫表格**之後**呼叫：漏斗按鈕是掛在 <th> 上的，
   *   表格重畫時不會自己回來。
   * ⚠️ 第一個參數給的是「已套用其他條件、但不含自己這一欄」的母體——
   *   這裡沒有搜尋框，所以兩個參數都給完整母體。
   */
  speedFilter.mount(allRows, allRows);
}
$("applySpeed").onclick = async () => {
  // 速限一定是正數。`Number(i.value) || 50` 只擋得掉 0、空白與非數字：
  // 打成 -50 會照樣存進去，之後 travel / limit 變成負的比值，整條路段的
  // 服務水準無聲變成 F，而且畫面上也看不出哪裡不對。
  //
  // 而且驗證一定要「全部檢查完再寫入」。邊驗證邊寫入的話，合法的欄位已經
  // 進了 state 並標成「已人工確認」，卻因為提早 return 而沒有 rebuild()、
  // 沒有 save()；使用者以為整批取消了，下一次任何不相干的存檔卻會把這半套
  // 設定固化，重新整理後 LOS 就悄悄變了。
  const inputs = [...document.querySelectorAll("[data-limit]")];
  const rejected = inputs.filter((i) => {
    const parsed = Number(i.value);
    return !Number.isFinite(parsed) || parsed <= 0;
  });
  if (rejected.length) {
    rejected.forEach((i) => {
      i.value = state.limits[i.dataset.limit] || 50;
    });
    return toast(
      `速限必須大於 0，這次完全沒有變更：${rejected
        .map((i) => i.dataset.limit.split("|").slice(1).join(" "))
        .join("、")}`,
    );
  }
  inputs.forEach((i) => {
    state.limits[i.dataset.limit] = Number(i.value);
    state.limitConfirmed[i.dataset.limit] = true;
  });
  state.details
    .filter((d) => d.projectCode === state.activeCode)
    .forEach((d) => {
      d.limit = state.limits[`${d.projectCode}|${d.road}|${d.direction}`] || 50;
      d.ratio = d.travel == null ? null : d.travel / d.limit;
      d.los = losOf(d.ratio, d.projectCode, d.period, d.road);
    });
  rebuild();
  await save();
  toast("目前計畫的速限已人工確認，LOS 已重新計算");
};
/*
 * ══════════════════════════════════════════════════════════════════
 *  每一張圖都要有自己的文字說明
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「交通服務水準的 各路段LOS圖 和 各路段歷季旅行速率趨勢圖，
 *     都少了對應的文字說明。**我們是每一張圖會搭配一個文字說明**
 *     （排版要注意）」
 *
 * ⚠️ 排版：這兩張圖的卡片是**一排兩張**的格線，所以說明**放在卡片裡、
 *   圖的下面**，不是像三段分法那樣放在右邊。放右邊的話每一格會被切成
 *   一半，圖窄到看不清楚——那是「有說明但圖毀了」。
 *
 * ⚠️ 說明的數字一律從**畫這張圖的同一組 rows** 算出來，不另外查一次資料。
 *   兩邊各查一次，遲早會出現「圖上是 D、字裡寫 C」。
 */
/*
 * ══════════════════════════════════════════════════════════════════
 *  圖卡 → 高解析 PNG
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「各路段LOS圖……少了下載高清晰圖檔的功能」
 *   「各路段歷季旅行速率，少了下載高清晰圖檔功能」
 *
 * ── 為什麼不是「再畫一次」──────────────────────────────────────
 *
 * 這兩張圖在畫面上是 HTML 的 div 柱子（不是 SVG），沒辦法直接轉成圖檔。
 * 最直覺的做法是「再寫一支畫圖程式輸出 PNG」——**那會變成兩個來源**，
 * 遲早出現「畫面是 D、下載的圖是 C」這種只有交出去才會被發現的錯。
 *
 * 所以改成：畫卡片時把**算好的那份數字**原封不動存在卡片上
 *（data-chart-model），要輸出圖檔時直接讀它。
 * 數字只算一次，畫面與圖檔讀的是同一份，不可能分岔。
 */
function chartModelToSvg(model) {
  var W = 720, H = 430, padL = 96, padR = 24, padT = 44, padB = 76;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  var groups = model.groups || [];
  var slot = groups.length ? plotW / groups.length : plotW;
  var barW = Math.min(34, slot / 3);
  var parts = [];
  parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');
  parts.push('<text x="' + padL + '" y="26" class="cc-title">' + xmlEsc(model.road + (model.subtitle ? "｜" + model.subtitle : "")) + "</text>");
  /* Y 軸標題（旋轉）與刻度 */
  parts.push('<text transform="translate(26 ' + (padT + plotH / 2) + ') rotate(-90)" class="cc-ytitle" text-anchor="middle">' + xmlEsc(model.yTitle) + "</text>");
  /*
   * ⚠️ 刻度可以是字串（平均分）或 {label, ratio}（用和柱高同一把尺定位）。
   *
   *   旅行速率那張圖的刻度是 max、0.75max…0，平均分本來就等於 value/max，
   *   兩種寫法位置相同；但 LOS 圖不是——它的柱高是 losRank/6，
   *   平均分會讓柱頂對不到自己的等級（D 的柱頂落在 B、C 之間）。
   *   所以帶 ratio 的一律以 ratio 定位，畫面與圖檔才會是同一張圖。
   */
  (model.yTicks || []).forEach(function (tick, i, all) {
    var hasRatio = tick && typeof tick === "object" && typeof tick.ratio === "number";
    var y = hasRatio
      ? padT + plotH * (1 - Math.max(0, Math.min(1, tick.ratio)))
      : padT + (plotH * i) / (all.length - 1 || 1);
    var label = hasRatio ? tick.label : tick;
    parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e3eaee"/>');
    parts.push('<text x="' + (padL - 10) + '" y="' + (y + 4) + '" class="cc-tick" text-anchor="end">' + xmlEsc(label) + "</text>");
  });
  parts.push('<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#bccbd3"/>');
  groups.forEach(function (group, index) {
    var cx = padL + slot * index + slot / 2;
    [["weekday", "#247db4", -1], ["holiday", "#e88943", 1]].forEach(function (pair) {
      var bar = group[pair[0]];
      if (!bar || bar.ratio === null || bar.ratio === undefined) return;
      var h = Math.max(0, Math.min(1, bar.ratio)) * plotH;
      var x = cx + pair[2] * (barW / 2 + 2) - (pair[2] > 0 ? 0 : barW);
      parts.push('<rect x="' + x + '" y="' + (padT + plotH - h) + '" width="' + barW + '" height="' + h + '" fill="' + pair[1] + '"/>');
      if (bar.label)
        parts.push('<text x="' + (x + barW / 2) + '" y="' + (padT + plotH - h - 7) + '" class="cc-val" text-anchor="middle">' + xmlEsc(bar.label) + "</text>");
    });
    parts.push('<text x="' + cx + '" y="' + (padT + plotH + 20) + '" class="cc-cat" text-anchor="middle">' + xmlEsc(group.period) + "</text>");
  });
  /* 圖例 */
  var ly = H - 26;
  parts.push('<rect x="' + padL + '" y="' + (ly - 9) + '" width="14" height="10" fill="#247db4"/><text x="' + (padL + 20) + '" y="' + ly + '" class="cc-cat">平日</text>');
  parts.push('<rect x="' + (padL + 64) + '" y="' + (ly - 9) + '" width="14" height="10" fill="#e88943"/><text x="' + (padL + 84) + '" y="' + ly + '" class="cc-cat">假日</text>');
  if (model.legendNote)
    parts.push('<text x="' + (padL + 140) + '" y="' + ly + '" class="cc-cat">' + xmlEsc(model.legendNote) + "</text>");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '">' +
    "<style>text{font-family:'Microsoft JhengHei','Noto Sans TC',sans-serif}" +
    ".cc-title{font-size:17px;font-weight:700;fill:#173b59}" +
    ".cc-ytitle{font-size:12px;font-weight:700;fill:#536a72}" +
    ".cc-tick{font-size:11px;fill:#7a8a8e}" +
    ".cc-val{font-size:12px;font-weight:700;fill:#31505a}" +
    ".cc-cat{font-size:11px;fill:#5b6f77}</style>" +
    parts.join("") +
    "</svg>"
  );
}
/*
 * ⚠️ 掛到 globalThis 是給守門用的：e2e-chart-page.mjs 要在瀏覽器裡
 *   把同一份 chartModel 畫成 SVG，量「柱頂有沒有落在自己的刻度上」。
 *   沒有這一行的話那一條只能改成讀原始碼推算——那就變成兩份計算，
 *   守門會跟著同一個錯誤一起錯。
 */
globalThis.chartModelToSvg = chartModelToSvg;
function xmlEsc(text) {
  return String(text == null ? "" : text).replace(/[&<>"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

/** 把某一格線裡的每一張圖卡輸出成高解析 PNG（多張自動打包）。 */
async function downloadCardCharts(gridId, zipName) {
  var cards = [].slice.call(document.querySelectorAll("#" + gridId + " .chart-card[data-chart-model]"));
  if (!cards.length) return toast("目前沒有可以下載的圖");
  var items = cards.map(function (card) {
    var model = JSON.parse(card.dataset.chartModel);
    var holder = document.createElement("div");
    holder.innerHTML = chartModelToSvg(model);
    return {
      svg: holder.firstChild,
      name: (state.activeCode || "計畫") + "_" + model.road + (model.subtitle ? "_" + model.subtitle : ""),
    };
  });
  chartDownloadToast(await downloadChartImages(items, zipName));
}

function chartCardNote(title, lead, lines) {
  return (
    '<details class="figure-note card-note">' +
    "<summary><b>" + esc(title) + "</b>" +
    (lead ? '<span class="figure-note-lead">' + esc(lead) + "</span>" : "") +
    /*
     * ⚠️ 展開／收合的箭頭用 <i> 元素，**不要寫在 CSS 的 content 裡**。
     *   content 裡的字轉不了角度（要轉只能連文字一起轉），
     *   於是收合狀態只能改用另一個字——而「指向右邊的實心三角形」
     *   ▸（U+25B8）**不在 Big5 字集裡**，微軟正黑體畫不出來，
     *   在某些電腦上會變成空白，看起來像這顆鈕壞掉。
     *   使用者 2026-09-15：「這個圖示比較重要，是讓人可以展開／收合的按鈕，
     *     所以請以**任何電腦都能看到**為前題去設計」。
     *   ▼（U+25BC）在 Big5 A1B9，正黑體一定有；收合狀態靠 CSS 轉 -90 度。
     */
    '<i class="figure-note-caret" aria-hidden="true">▼</i>' +
    "</summary>" +
    '<div class="figure-note-body">' +
    lines.map(function (line) { return "<p>" + line + "</p>"; }).join("") +
    "</div>" +
    "</details>"
  );
}

/** 各路段 LOS 圖的說明：只講這張圖自己看得到的事。 */
function losCardScript(road, rows, code) {
  var withLos = rows.filter(function (r) { return r.los; });
  if (!withLos.length)
    return chartCardNote(
      "這張圖在說什麼",
      "目前沒有判定得出等級的資料",
      ["這條路段在目前的篩選條件下沒有算得出服務水準的紀錄，所以柱子畫不出來。"],
    );
  var periods = [...new Set(withLos.map(function (r) { return r.period; }))];
  var last = periods[periods.length - 1];
  var lastRows = withLos.filter(function (r) { return r.period === last; });
  var by = function (day) {
    var hit = lastRows.find(function (r) { return r.day === day; });
    return hit ? hit.los : null;
  };
  var weekday = by("平日"), holiday = by("假日");
  var first = periods[0];
  var firstRows = withLos.filter(function (r) { return r.period === first; });
  var firstWeekday = (firstRows.find(function (r) { return r.day === "平日"; }) || {}).los;
  var lead =
    "最新一季（" + projectPeriodLabel(last, code) + "）" +
    (weekday ? "平日 " + weekday : "") +
    (weekday && holiday ? "、" : "") +
    (holiday ? "假日 " + holiday : "");
  var lines = [];
  lines.push(
    "這張圖看的是「" + esc(road) + "」歷季的服務水準等級，" +
      "橫軸是季度，共 " + periods.length + " 季（" +
      projectPeriodLabel(first, code) + " 到 " + projectPeriodLabel(last, code) + "）。" +
      "柱子越高代表等級越好（A 最好、F 最差），柱子上方的字母就是該季的等級。",
  );
  if (firstWeekday && weekday) {
    var rankFirst = losRank[firstWeekday] || 0, rankLast = losRank[weekday] || 0;
    lines.push(
      "平日從 " + projectPeriodLabel(first, code) + " 的 " + firstWeekday +
        " 到 " + projectPeriodLabel(last, code) + " 的 " + weekday + "，" +
        (rankLast > rankFirst
          ? "等級變好了。"
          : rankLast < rankFirst
            ? "等級變差了。"
            : "等級沒有變化。"),
    );
  }
  lines.push(
    "⚠️ 等級是由速限比判定的，和旅行速率的絕對值不是同一件事——" +
      "速限不同的路段，同樣的速率可能落在不同等級。要看速率本身請對照「各路段歷季旅行速率」。",
  );
  return chartCardNote("這張圖在說什麼", lead, lines);
}

/** 各路段歷季旅行速率的說明。 */
function speedCardScript(road, own, code) {
  var valued = own.filter(function (r) { return r.travel !== null && r.travel !== undefined && r.travel !== ""; });
  if (!valued.length)
    return chartCardNote(
      "這張圖在說什麼",
      "目前沒有讀得到旅行速率的資料",
      ["這條路段在目前的篩選條件下沒有旅行速率數值，所以柱子畫不出來（缺值會留白，不會畫成 0）。"],
    );
  var periods = [...new Set(valued.map(function (r) { return r.period; }))];
  var first = periods[0], last = periods[periods.length - 1];
  var pick = function (period, day) {
    var hit = valued.find(function (r) { return r.period === period && r.day === day; });
    return hit ? Number(hit.travel) : null;
  };
  var lastWeekday = pick(last, "平日"), lastHoliday = pick(last, "假日");
  var firstWeekday = pick(first, "平日");
  var lead =
    "最新一季（" + projectPeriodLabel(last, code) + "）" +
    (lastWeekday !== null ? "平日 " + fmt(lastWeekday, 1) : "") +
    (lastWeekday !== null && lastHoliday !== null ? "、" : "") +
    (lastHoliday !== null ? "假日 " + fmt(lastHoliday, 1) : "") +
    " km/h";
  var lines = [];
  lines.push(
    "這張圖看的是「" + esc(road) + "」歷季的平均總旅行速率（km/h），" +
      "橫軸是季度，共 " + periods.length + " 季。柱子越高代表跑得越快。",
  );
  if (firstWeekday !== null && lastWeekday !== null) {
    var diff = lastWeekday - firstWeekday;
    lines.push(
      "平日從 " + projectPeriodLabel(first, code) + " 的 " + fmt(firstWeekday, 1) +
        " 到 " + projectPeriodLabel(last, code) + " 的 " + fmt(lastWeekday, 1) +
        " km/h，" +
        (Math.abs(diff) < 0.05
          ? "幾乎沒有變化。"
          : (diff > 0 ? "上升 " : "下降 ") + fmt(Math.abs(diff), 1) + " km/h。"),
    );
  }
  lines.push(
    "⚠️ 速率高不等於服務水準好：等級是拿速率和該路段的速限相比得出來的。" +
      "兩條速限不同的路段，速率一樣但等級可能不同，請對照「各路段 LOS 圖」。",
  );
  return chartCardNote("這張圖在說什麼", lead, lines);
}

function renderTravelCharts(rows, gridId, labelPeriod = projectPeriodLabel) {
  const grid = $(gridId);
  grid.innerHTML = "";
  const roads = [...new Set(rows.map((x) => x.road))];
  /*
   * ⚠️ 沒有資料時連同區塊標題一起收起來（作法與「各路段 LOS 圖」一致）。
   *   收的是**標題**不是整個區塊：側欄本來就有「畫不出高度的一律不列」
   *   這條規則，只收標題的話那條規則自然生效，不必新增第二套判斷。
   *   ⚠️ 只在主畫面那一塊生效；報告預覽等其他地方借用這支函式時
   *     gridId 不是 speedTrendGrid，不可以去動主畫面的標題。
   */
  if (gridId === "speedTrendGrid") {
    const speedTitleEl = document.getElementById("speedChartTitle");
    if (speedTitleEl) speedTitleEl.hidden = !roads.length;
    /*
     * ⚠️ X-62：這一塊現在自己一個大分頁。標題收起來、格子又是空的時候，
     *   整頁會是**全白**，使用者看不出是「還沒匯資料」還是「壞掉」。
     *   兩者恰好互斥：有圖就沒有這句話，沒圖就只有這句話。
     */
    const speedEmptyEl = document.getElementById("speedEmpty");
    if (speedEmptyEl) speedEmptyEl.hidden = roads.length > 0;
  }
  for (const road of roads) {
    const own = rows
        .filter((x) => x.road === road)
        .sort((a, b) => periodIndex(a.period) - periodIndex(b.period)),
      periods = [...new Set(own.map((x) => x.period))],
      values = own.map((x) => Number(x.travel) || 0),
      rawMax = Math.max(...values, 1),
      max = Math.ceil(rawMax / 10) * 10 || 10,
      ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0],
      card = document.createElement("article");
    card.className = "chart-card";
    /*
     * ⚠️ 圖的部分要包在 .chart-figure 裡，說明是它的**兄弟**不是子孫。
     *   圖在左、說明在右、圖 sticky 的版面（styles.css 的 .chart-card）
     *   靠的就是「卡片底下剛好兩個直接子元素」；
     *   把說明包進 .chart-figure 會讓它跟著圖一起釘住，等於整張卡都黏住。
     */
    card.innerHTML = `<div class="chart-figure"><h3>${esc(road)}｜旅行速率</h3><div class="bars speed-bars"><div class="speed-y-title">平均總旅行速率（km/h）</div><div class="y-axis">${ticks.map((t, i) => `<span style="top:${i * 25}%">${fmt(t, 1)}</span>`).join("")}</div>${periods
      .map((p) => {
        /*
         * 「有這筆紀錄，但速率讀不到」和「速率是 0」必須分開。
         * 舊寫法是 Number(w?.travel) || 0，null 會折成 0，而柱子的
         * data-value 判斷的是 w（紀錄存在）不是 w.travel（數值存在），
         * 於是缺值走進了「有值」那條路：柱高 0、柱上標「0.0」、
         * 提示寫「平日 0.000 km/h」。旅行速率 0 km/h 的意思是完全動不了，
         * 會被直接誤讀成最嚴重的壅塞。缺值要留白，不是畫成 0。
         */
        const w = own.find((x) => x.period === p && x.day === "平日"),
          h = own.find((x) => x.period === p && x.day === "假日"),
          hasW = w != null && w.travel != null && Number.isFinite(Number(w.travel)),
          hasH = h != null && h.travel != null && Number.isFinite(Number(h.travel)),
          wv = hasW ? Number(w.travel) : null,
          hv = hasH ? Number(h.travel) : null;
        return `<div class="bar-group"><i class="bar weekday speed-bar" data-value="${hasW ? fmt(wv, 1) : ""}" title="平日 ${hasW ? fmt(wv, 3) + " km/h" : "讀不到數值"}" style="height:${hasW ? (wv / max) * 100 : 0}%"></i><i class="bar holiday speed-bar" data-value="${hasH ? fmt(hv, 1) : ""}" title="假日 ${hasH ? fmt(hv, 3) + " km/h" : "讀不到數值"}" style="height:${hasH ? (hv / max) * 100 : 0}%"></i><small>${esc(labelPeriod(p))}</small></div>`;
      })
      .join(
        "",
      )}</div><p class="bars-x-title">季別</p><div class="chart-legend"><i style="background:#247db4"></i>平日<i style="background:#e88943"></i>假日　單位：km/h</div></div>${speedCardScript(road, own, state.activeCode)}`;
    /* 同上：畫面與圖檔讀同一份數字。 */
    card.dataset.chartModel = JSON.stringify({
      road: road,
      subtitle: "旅行速率",
      yTitle: "平均總旅行速率（km/h）",
      yTicks: ticks.map(function (t) { return fmt(t, 1); }),
      legendNote: "單位：km/h",
      groups: periods.map(function (p) {
        const w = own.find((x) => x.period === p && x.day === "平日"),
          h = own.find((x) => x.period === p && x.day === "假日");
        const num = function (row) {
          if (!row || row.travel === null || row.travel === undefined || row.travel === "")
            return null;
          const value = Number(row.travel);
          return { ratio: max ? value / max : 0, label: fmt(value, 1) };
        };
        return {
          period: labelPeriod(p, state.activeCode),
          weekday: num(w),
          holiday: num(h),
        };
      }),
    });
    grid.append(card);
  }
}
/**
 * 「各路段 LOS 圖」「各路段歷季旅行速率」上要掛的提示。
 *
 * ⚠️ 這兩塊在同一個區段裡（上下兩塊共用同一組條件），所以說明掛一份就好。
 */
function renderLosChartNotes(all, shown) {
  const host = document.getElementById("losChartNotes");
  const speedHost = document.getElementById("speedChartNotes");
  if (!host) return;
  /*
   * ⚠️ 完全沒有資料時**整塊都不要出聲**（連常駐的口徑說明也不要）。
   *
   *   側欄有一條規則：「畫不出高度的一律不列」——沒有資料時這一塊的高度
   *   本來就是 0，側欄就不會列出一個點了看不到東西的小分頁。
   *   但常駐的口徑說明永遠有高度，掛著就把那條規則破壞掉了
   *  （實測：e2e-nav-sections 的「沒有內容時不列任何小分頁」轉紅）。
   *   「尚無彙總資料」那句話由 #chartEmpty 負責講，這裡不必再站一次。
   */
  if (!all.length) {
    host.innerHTML = "";
    if (speedHost) speedHost.innerHTML = "";
    return;
  }
  const filters = MT.filtersOf(MT.CHART_IDS.los);
  const hiddenRoads =
    [...new Set(all.map((x) => x.road))].length -
    [...new Set(shown.map((x) => x.road))].length;
  /*
   * ── 目前的口徑一定要標在圖上（使用者 2026-09-15 的疑問）──────────
   *
   * 使用者：「上方工具列的尖峰有調整後，歷季旅行速率趨勢圖並沒有任何說明
   *   出現（例如不受尖峰影響），**還是其實有受尖峰影響，只是我沒看出來?**」
   *
   * 查下來是**有受影響**的（走 MT.summariesFor → matchesDetail，
   * 季度區間／路段／日別／方向／尖峰五項都篩），只是「先篩再挑最差」之後
   * 代表紀錄有時仍是同一筆，看起來像沒動。
   *
   * ⚠️ 所以**不可以**掛一句「不受尖峰影響」——那是讓畫面說謊。
   *   正確作法是把**現在畫的是什麼**寫出來，讓使用者自己對得上。
   * ⚠️ 這一句是**常駐**的（不是只在被篩時出現）：它是口徑，不是警告。
   *
   * ⚠️ 2026-09-16 使用者回報：這幾句原本寫「這兩張圖」，但
   *   (1) 使用者篩成 1 條路段時畫面上只有 1 張圖，字面就對不上；
   *   (2) 這一份說明是**兩塊各掛一份**，站在其中一塊上面時「這兩張」更難懂。
   *   → 一律改成**寫出區塊名稱**（「各路段 LOS 圖」與「各路段歷季旅行速率」）。
   *   ⚠️ 不要再用數量詞代稱區塊：張數會跟著篩選變，名稱不會。
   */
  const html =
    `<p class="chart-scope-note" data-testid="chart-scope-note">目前「各路段 LOS 圖」與「各路段歷季旅行速率」畫的是：<b>${esc(
      MF.describeMain(filters, showQuarter),
    )}</b>（代表值＝同一組資料裡最差的那一筆）。</p>` +
    detachNoteHtml(MT.CHART_IDS.los) +
    inapplicableHtml(
      hiddenRoads > 0,
      `主工具列目前篩掉了 ${hiddenRoads} 條路段（沒畫出來的不是沒有資料）。`,
      ["roads"],
      { applied: true },
    ) +
    /*
     * ⚠️ 「日別」在這兩張圖上是**兩根柱子**（平日藍、假日橘），
     *   不是篩選。選了單一日別時另一根柱子會消失，這要講出來，
     *   否則使用者會以為那一季缺資料。
     */
    inapplicableHtml(
      filters.day === "weekday" || filters.day === "假日" || filters.day === "holiday",
      `「各路段 LOS 圖」與「各路段歷季旅行速率」本來就用兩根柱子並排平日與假日（藍＝平日、橘＝假日）；目前只選了「${
        filters.day === "weekday" ? "平日" : "假日"
      }」，所以另一根柱子不會出現。`,
      ["day"],
      { applied: true },
    ) +
    /* ⚠️ 用 isPeriodNarrowed（比「全部季度」窄才算），不可以用 isFiltered——
       預設值現在是實際的最早一季，isFiltered 會恆為 true。 */
    inapplicableHtml(
      MT.isPeriodNarrowed(MT.CHART_IDS.los, mainToolbarPeriods()),
      `季度區間已縮小：「各路段 LOS 圖」與「各路段歷季旅行速率」畫的是區間內的季度（${showQuarter(
        filters.periodFrom,
      )}～${showQuarter(filters.periodTo)}），不是全部季度。`,
      ["periodFrom"],
      { applied: true },
    ) +
    /*
     * ⚠️ 這兩張圖畫的是**每一季的代表值**（同一組裡最差的那一筆），
     *   一根柱子就是一個值，沒有辦法把兩個方向或兩個尖峰並排。
     *   選了並列時要講出來，否則使用者切了完全沒反應。
     */
    /* ⚠️ 甲案之後方向的預設就是並列，要用 MF.chose 問「他主動選了嗎」。 */
    inapplicableHtml(
      MF.chose(filters, "direction", "side-by-side") ||
        MF.chose(filters, "peak", "side-by-side"),
      MF.inapplicableNote(
        "「各路段 LOS 圖」與「各路段歷季旅行速率」每一季畫的是一個代表值（同一組資料裡最差的那一筆），一根柱子只能是一個值，畫不了「雙向並列」或「上午＋下午並列」。",
        "代表值（系統取最差）",
      ),
      ["direction", "peak"],
    );
  host.innerHTML = html;
  /*
   * ⚠️ 兩塊**各掛一份**（使用者 2026-09-15：「每個圖表都要有各自的不適用說明」）。
   *   共用一份的話，捲到下面那一塊時說明已經在畫面外，等於沒有。
   */
  if (speedHost) speedHost.innerHTML = html;
}
function renderCharts() {
  const grid = $("chartGrid"),
    code = state.activeCode;
  /*
   * ── 這兩塊升級前**一個條件都沒有** ──────────────────────────
   *
   * 實測 2026-09-14：「各路段 LOS 圖」與「各路段歷季旅行速率」
   * 永遠畫全部路段、全部季度，使用者完全沒有辦法只看他要的那幾條。
   * 現在它們吃主工具列（以及自己的脫離值）。
   *
   * ⚠️ 這兩塊是**歷季**的圖，所以季度用 range：
   *   起＝迄（預設）時要畫全部季度，不可以縮成一季——
   *   縮成一季的話柱子只剩一根，那不是趨勢圖。
   *
   * ⚠️ 代表值要「先篩再挑最差」，所以**不可以**直接拿 state.summaries。
   */
  const ownDetails = state.details.filter((x) => x.projectCode === code);
  const own = MT.summariesFor(
    ownDetails,
    MT.CHART_IDS.los,
    worstOfGroup,
    "range",
  );
  const allSummaries = MT.summariesFor(
    ownDetails,
    "__unfiltered__",
    worstOfGroup,
    "range",
  );
  renderLosChartNotes(allSummaries, own);
  grid.innerHTML = "";
  $("chartEmpty").style.display = allSummaries.length ? "none" : "block";
  /*
   * ⚠️ 「有資料但被篩光了」和「本來就沒有資料」要分得出來。
   *   兩種都留一塊空白的話，使用者會去翻原始檔找一批其實存在的資料。
   */
  if (allSummaries.length && !own.length) {
    $("chartEmpty").style.display = "block";
    $("chartEmpty").textContent =
      "主工具列目前的條件把所有路段都篩掉了，所以畫不出圖。請放寬條件，或按區塊上的「回到主工具列條件」。";
  } else if (allSummaries.length) {
    $("chartEmpty").textContent =
      "尚無彙總資料，完成尖峰匯入後會自動建立圖表。";
  }
  /*
   * ⚠️ 沒有資料時，連同區塊標題一起收起來。
   *   只把格子清空、標題留著的話，畫面上會出現一個「各路段 LOS 圖」的大標
   *   底下什麼都沒有，而側欄也會列出一個點了看不到東西的小分頁——
   *   那正是 e2e-nav-sections 要擋的「列了卻點不到＝按鈕壞掉」。
   *   「尚無彙總資料」那句話由 #chartEmpty 負責講，標題不需要再站一次。
   */
  /*
   * ⚠️ 收的是**標題**，不是整個區塊。
   *   把整個 #losChartSection 設成 hidden 也能達到「側欄不列」的效果，
   *   但那會讓「這一塊有沒有內容」多一條獨立的開關，
   *   而側欄本來就有一條規則：**畫不出高度的一律不列**。
   *   只收標題的話，沒有資料時整塊高度自然是 0，既有規則直接生效，
   *   不必新增第二套判斷（兩套判斷遲早會互相矛盾）。
   */
  const losTitleEl = document.getElementById("losChartTitle");
  if (losTitleEl) losTitleEl.hidden = !own.length;
  const roads = [...new Set(own.map((x) => x.road))];
  for (const road of roads) {
    const rows = own
      .filter((x) => x.road === road)
      .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
    const periods = [...new Set(rows.map((x) => x.period))];
    const card = document.createElement("article");
    card.className = "chart-card";
    /*
     * ── Y 軸（使用者 2026-09-14）────────────────────────────────
     *
     * 「各路段LOS圖，畫面上沒有顯示Y軸及名稱（但 excel 下載下來後是有的）」
     *
     * 他說得對，而且這是**畫面與交出去的東西不一致**：Excel 那張圖的縱軸
     * 寫著「LOS等級（6=A、1=F）」、刻度 1～6，畫面上卻什麼都沒有——
     * 看畫面的人只能靠柱子上方那個字母，柱子高矮完全沒有基準。
     *
     * ⚠️ 刻度直接寫**等級字母**，不寫 1～6 那個內部級數。
     *   級數是為了讓 Excel 畫得出長條才存在的，對看圖的人沒有意義；
     *   而且畫面上柱子上方標的就是字母，兩邊要說同一種話。
     *
     * ⚠️ 結構照抄「旅行速率」那張圖已經在用的 .y-axis／y 軸標題，
     *   不另外發明一套——兩張圖並排時刻度位置、字級才會一致。
     */
    /*
     * ⚠️ 刻度的位置必須用**和柱高同一把尺**算出來，不可以平均分。
     *
     *   柱高是 `losRank / 6`（A=6/6 最高、F=1/6 最矮），
     *   而舊版的刻度是把六個字母**平均分**在軸上（第 i 個放在 i/5）。
     *   兩把尺不一樣，於是畫出來的柱子對不到自己的等級：
     *   實測 D（柱高 50%）的柱頂在離頂 50% 處，D 這個刻度卻在 60% 處——
     *   照著軸看，D 會被讀成 B 跟 C 中間。**這是圖說謊，不是排版問題。**
     *
     *   補上 Y 軸之前這個錯誤看不出來（沒有刻度可以對），
     *   所以它是跟著 Y 軸一起進來的，肉眼看畫面才抓到。
     *
     *   現在刻度帶著自己的 ratio（＝該等級的柱高比例），
     *   畫面與匯出的圖檔都用 `1 - ratio` 定位，柱頂必然落在自己的刻度上。
     */
    const losTicks = ["A", "B", "C", "D", "E", "F"].map(function (grade) {
      return { label: grade, ratio: losRank[grade] / 6 };
    });
    /*
     * ⚠️ 圖的部分要包在 .chart-figure 裡，說明是它的**兄弟**不是子孫。
     *   圖在左、說明在右、圖 sticky 的版面（styles.css 的 .chart-card）
     *   靠的就是「卡片底下剛好兩個直接子元素」；
     *   把說明包進 .chart-figure 會讓它跟著圖一起釘住，等於整張卡都黏住。
     */
    card.innerHTML = `<div class="chart-figure"><h3>${esc(road)}</h3><div class="bars los-bars"><div class="speed-y-title">服務水準等級（A 最好、F 最差）</div><div class="y-axis">${losTicks
      .map(
        (tick) =>
          `<span style="top:${(1 - tick.ratio) * 100}%">${tick.label}</span>`,
      )
      .join("")}</div>${periods
      .map((p) => {
        const w = rows.find((x) => x.period === p && x.day === "平日"),
          h = rows.find((x) => x.period === p && x.day === "假日");
        return `<div class="bar-group"><i class="bar weekday" data-los="${w?.los || ""}" title="平日 ${w?.los || "—"}" style="height:${((losRank[w?.los] || 0) / 6) * 100}%"></i><i class="bar holiday" data-los="${h?.los || ""}" title="假日 ${h?.los || "—"}" style="height:${((losRank[h?.los] || 0) / 6) * 100}%"></i><small>${esc(projectPeriodLabel(p, code))}</small></div>`;
      })
      .join(
        "",
      )}</div><p class="bars-x-title">季別</p><div class="chart-legend"><i style="background:#247db4"></i>平日<i style="background:#e88943"></i>假日　資料柱上方為LOS等級</div></div>${losCardScript(road, rows, code)}`;
    /*
     * ⚠️ 把**畫這張圖用的那份數字**原封不動存在卡片上，輸出圖檔時直接讀它。
     *   不可以在輸出時再算一次——那會變成兩個來源，遲早「畫面 D、圖檔 C」。
     */
    card.dataset.chartModel = JSON.stringify({
      road: road,
      yTitle: "服務水準等級（A 最好、F 最差）",
      yTicks: losTicks,
      legendNote: "資料柱上方為 LOS 等級",
      groups: periods.map(function (p) {
        const w = rows.find((x) => x.period === p && x.day === "平日"),
          h = rows.find((x) => x.period === p && x.day === "假日");
        return {
          period: projectPeriodLabel(p, code),
          weekday: w ? { ratio: (losRank[w.los] || 0) / 6, label: w.los || "" } : null,
          holiday: h ? { ratio: (losRank[h.los] || 0) / 6, label: h.los || "" } : null,
        };
      }),
    });
    grid.append(card);
  }
  renderTravelCharts(own, "speedTrendGrid");
  /*
   * ⚠️ 側欄小分頁只在換頁時重建（go()），但這一頁的區塊是**有資料才長出來**的。
   *   匯入完成後如果人已經站在圖表頁，畫面上多了兩塊、側欄卻還是舊的——
   *   「該列的沒列出來」，而使用者不會知道要切出去再切回來。
   *   這裡在重畫圖表之後補一次；renderNavSections 不會回頭呼叫 renderCharts，
   *   不會形成迴圈。
   */
  const activeViewId = document.querySelector(".view.active")?.id;
  if (CHART_VIEWS.includes(activeViewId)) renderNavSections(activeViewId);
}
function csv(rows, name) {
  if (!rows.length) return toast("目前沒有資料");
  // 取所有列的欄位聯集：舊版只看第一列，若第一列剛好是舊版沒有來源欄位的資料，
  // 整份 CSV 就會少掉來源檔名、工作表與驗證碼等欄位。
  const heads = [...new Set(rows.flatMap((row) => Object.keys(row)))],
    body = [heads, ...rows.map((r) => heads.map((h) => r[h]))]
      .map((a) => a.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  download(
    "\ufeff" + body,
    name || `${activeProject()?.code || "Project"}_尖峰明細.csv`,
    "text/csv",
  );
}
$("exportDetail").onclick = () => {
  /* 明講匯出的是「畫面上這些」，避免使用者以為拿到的是整包資料 */
  const filtered =
    shownDetailRows.length !==
    state.details.filter((x) => x.projectCode === state.activeCode).length;
  toast(
    filtered
      ? `已匯出畫面上的 ${shownDetailRows.length} 筆（有套用篩選）。要整包請先清除篩選與搜尋。`
      : `已匯出 ${shownDetailRows.length} 筆`,
  );
  return csv(
    /*
     * CSV 是照欄位原樣倒出去的，direction 一定是鍵值（方向1／方向2）。
     * 交出去的檔案只有鍵值，收的人看不出哪個方向是哪一邊，所以另外補一欄
     * 顯示名稱。鍵值那一欄保留不動，既有的比對流程不受影響。
     */
    shownDetailRows.map((x) => ({
      ...x,
      /* 季度欄跟著畫面上的年份顯示切換走；其餘欄位與數值原樣輸出。 */
      period: showQuarter(x.period),
      directionLabel: rowDirectionName(x),
    })),
  );
};
/**
 * 觸發瀏覽器下載。
 * 連結一定要先掛進文件再點擊：部分瀏覽器對「沒有掛進 DOM」的 <a> 會忽略
 * download 屬性，檔案就會被存成沒有副檔名的「download」，使用者根本認不出來。
 */
function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name || "download";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 1500);
}
globalThis.triggerDownload = triggerDownload;
function download(data, name, type = "application/json") {
  triggerDownload(URL.createObjectURL(new Blob([data], { type })), name);
}
/** 已經是 Blob 的東西（例如 canvas 產出的 PNG）走這一支，不要再包一層。 */
function downloadBlob(blob, name) {
  triggerDownload(URL.createObjectURL(blob), name);
}

/**
 * 把一張或多張圖表 SVG 變成高解析 PNG 交給使用者。
 *
 * ⚠️ **多張時一律打包成一個 ZIP，不可以連續觸發多次下載。**
 *
 * 使用者實測回報：「LOS 圖表選擇下載高解析圖片，右下角提示成功 6 張圖，
 * 但實際上我只收到一張。」——瀏覽器對「同一個手勢連續自動下載多個檔案」
 * 有節流：Chrome 會跳「要下載多個檔案嗎？」的許可，沒允許就只有第一個
 * 會過，而且**不會拋出任何錯誤**。舊版的提示是照迴圈次數數的，
 * 所以它數了 6 次、說了 6 張，實際只有 1 張。
 *
 * 一個 ZIP 只觸發一次下載，就沒有節流問題，提示的數字也一定是真的。
 * 只有一張時直接給 PNG——為了一張圖叫使用者解壓縮是多餘的。
 */
/*
 * 匯出圖的放大倍率。**三支程式同一個數字**：
 *   ・路口轉向 app/traffic-app.tsx 的 EXPORT_PNG_SCALE
 *   ・全日交通量 app/chart-png.ts 的 EXPORT_SCALE
 * 3 倍在 A4 報告與投影片上都還算銳利。
 *
 * ⚠️ 這一支以前是 2 倍，而且兩條下載路徑（單張與打包 ZIP）各寫各的 `scale`。
 *   同一個系統裡下載到的圖解析度不一樣、又比另外兩支低，貼進同一份報告
 *   就會看得出哪幾張比較糊。收斂成一個常數，才不會再各自漂移。
 */
const EXPORT_PNG_SCALE = 3;

/**
 * 匯出用的「乾淨版」SVG：把逐點的數值／等級標籤拿掉。
 *
 * 使用者 2026-09-11 定的規則（三支一致）：
 *   「網頁畫面是在筆數不多時，數據直接標記在圖上，不與圖形或標籤重疊。
 *     如果筆數超多一定量，則變成滑鼠移上去會顯示該數據點的數值。
 *     **匯出的圖則統一為乾淨版。**」
 *
 * 2026-09-13 使用者用下載下來的 PNG 證實這一支從來沒做到：
 *   「三段分法下載下來的 PNG 圖檔，**圖上面還有數字 3**，不是說會淨空嗎?
 *     **圖例保持在上面是正確的**。」
 *   「最差服務水準的圖檔也是，上面有英文字母 D（服務水準），
 *     如果數據一多，很容易出現標籤與文字和圖互相重疊的問題。」
 *
 * ⚠️ 要拿掉的**只有逐點標籤**：
 *     .trend-point-label（折線圖上的等級 D）
 *     .band-seg-label / .band-seg-label-dark（柱子裡的路段數 3）
 *   ⚠️ **圖例、座標軸、軸名、刻度一律保留**——使用者明講「圖例保持在上面是正確的」。
 *     把整批 <text> 清掉會連軸名一起拿走，那是另一種壞掉。
 *
 * ⚠️ 一定要**複製一份**再刪，不可以動畫面上那一張：
 *   畫面上那一張是使用者正在看的圖，刪了就整張圖的標籤都不見了。
 *
 * ⚠️ 放在這一支（PNG 序列化的唯一入口）而不是各個下載按鈕裡：
 *   按鈕有好幾顆（趨勢圖、三段圖、各路段圖、ZIP 批次），
 *   放在按鈕裡遲早會有一顆漏掉，而漏掉的那一顆不會有任何錯誤訊息。
 */
const EXPORT_STRIP_CLASSES = [
  "trend-point-label",
  "band-seg-label",
  "band-seg-label-dark",
];
function exportCleanSvg(svg) {
  const clone = svg.cloneNode(true);
  for (const className of EXPORT_STRIP_CLASSES)
    clone
      .querySelectorAll("." + className)
      .forEach((node) => node.remove());
  return clone;
}

async function svgFigureToPngBlob(svg, scale = EXPORT_PNG_SCALE) {
  const box = svg.viewBox.baseVal;
  const canvas = document.createElement("canvas");
  canvas.width = box.width * scale;
  canvas.height = box.height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  /* 白底：透明底貼到深色版面上，圖上的字會看不見。 */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, box.width, box.height);
  const image = new Image();
  const svgText = new XMLSerializer().serializeToString(exportCleanSvg(svg));
  await new Promise((done, fail) => {
    image.onload = done;
    image.onerror = fail;
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  });
  ctx.drawImage(image, 0, 0, box.width, box.height);
  return new Promise((done) => canvas.toBlob(done, "image/png"));
}

const safeFileName = (text) => String(text || "").replace(/[\\/:*?"<>|]/g, "_");

/**
 * items：[{ svg, name }]。name 不含副檔名。
 * 回傳實際交出去的檔案數與形式，呼叫端據此寫提示——**提示不可以自己數**。
 */
async function downloadChartImages(items, zipName) {
  const usable = items.filter((item) => item.svg);
  if (!usable.length) return { count: 0, mode: "none" };
  if (usable.length === 1) {
    const blob = await svgFigureToPngBlob(usable[0].svg);
    downloadBlob(blob, safeFileName(usable[0].name) + ".png");
    return { count: 1, mode: "png" };
  }
  if (typeof JSZip !== "function") {
    /*
     * 沒有 JSZip 時退回逐張下載，但**要明講可能被瀏覽器擋掉**，
     * 不可以照張數報成功——那正是舊版說謊的地方。
     */
    for (const item of usable) {
      const blob = await svgFigureToPngBlob(item.svg);
      downloadBlob(blob, safeFileName(item.name) + ".png");
      await new Promise((done) => setTimeout(done, 400));
    }
    return { count: usable.length, mode: "loose" };
  }
  const zip = new JSZip();
  for (const item of usable) {
    const blob = await svgFigureToPngBlob(item.svg);
    zip.file(safeFileName(item.name) + ".png", blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, safeFileName(zipName) + ".zip");
  return { count: usable.length, mode: "zip" };
}

/** 依實際交出去的形式寫提示，不照迴圈次數數。 */
function chartDownloadToast(result) {
  if (!result.count) return toast("目前沒有可以下載的圖");
  /*
   * ⚠️ 這裡**不可以斷言「已下載」**。
   *
   * 網頁沒有辦法知道檔案有沒有真的落到使用者的下載資料夾：瀏覽器可能
   * 因為「這個網站曾經被拒絕自動下載多個檔案」而靜靜擋掉，網頁端收不到
   * 任何錯誤。使用者實測回報過兩次「提示說已下載，但一個檔案都沒有」。
   * 所以提示只說「送出了什麼」，並附上找不到檔案時該去哪裡看。
   */
  const hint = "；若下載資料夾裡沒有，請檢查瀏覽器是否封鎖了本站的自動下載";
  if (result.mode === "png")
    return toast("已送出 1 張圖（只有圖，說明文字請用「複製說明文字」）" + hint);
  if (result.mode === "zip")
    return toast(
      `已送出 1 個 ZIP，裡面有 ${result.count} 張圖（瀏覽器會擋住連續多次下載，所以改成一次給一包）` +
        hint,
    );
  return toast(
    `已送出 ${result.count} 張圖，但瀏覽器可能只允許第一張——請確認下載資料夾，缺的話一張一張下載`,
  );
}


/* ══════════════════════════════════════════════════════════════════
 *  側欄分區
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的話：「讓使用者一目了然知道資料匯入區、參數設定區、圖表區、
 * 多計劃比較區等等各大功能區。」
 *
 * 舊版側欄是 15 個項目平鋪，順序照當初做出來的先後排，不是照使用流程，
 * 所以找東西只能從頭看到尾。
 *
 * ⚠️ 這裡**只重排與加小標，不動任何功能、不改任何 data-view 與按鈕 id**。
 * 三支系統用同一套分區名稱與順序，換一支也不用重新學。
 *
 * ⚠️ 一定要等所有擴充頁都掛好才能排（匯入紀錄、資料維護、
 * 路段管理在 app.js 裡插入，成果交付在 quality-extension.js 裡插入，
 * 而那一支是在 app.js 之後才載入的）。所以掛在 window load 上跑。
 */
/*
 * ⚠️ 「建立與管理計畫」一定要排在**所有匯入之前**。
 *
 * 使用者 2026-09-13：
 *   「交通服務水準**開始建立計畫是所有步驟第一個要做的**，它大分頁位置怎會
 *     放在匯入資料步驟之後，竟然放在參數設定裡? 應該放在匯入資料步驟之前吧?
 *     名稱要寫『建立與管理計畫』這樣才讓人看得懂吧? 其實**三個程式建立計畫的
 *     分頁名稱 應該都要統一為 建立與管理計畫**，這樣才知道所有的第一步都是
 *     從建立計畫開始，而且這裡也能管理計畫。」
 *
 * 他說得對，而且畫面自己早就這樣宣告了：那一頁的標題寫著「**STEP 1**　計畫設定」，
 * 但側欄把它放在第二區、第一區之後——**側欄的順序和頁面自己宣告的步驟互相矛盾**。
 *
 * ⚠️ 第一區因此改名為「建立與匯入」：把建立計畫搬進一個叫「資料匯入」的區
 *   會名不副實。
 */
/*
 * ── 分類整區收合的狀態 ────────────────────────────────────────────
 * 與「小分頁收合」分開存：兩者是不同層級的東西，混在一個陣列裡會互相覆蓋。
 */
const ZONE_COLLAPSE_KEY = "los-nav-zone-collapsed-v1";
function zoneCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(ZONE_COLLAPSE_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function setZoneCollapsed(list) {
  try {
    localStorage.setItem(ZONE_COLLAPSE_KEY, JSON.stringify(list));
  } catch {
    /* 存不進去只影響「下次還記得」，這一次照樣收合。 */
  }
}
/** 依收合狀態決定每一區的分頁顯不顯示，並把箭頭轉向。 */
function applyZoneCollapse() {
  const closed = zoneCollapsed();
  document.querySelectorAll("nav .nav-zone-toggle").forEach((toggle) => {
    const shut = closed.includes(toggle.dataset.zoneToggle);
    toggle.setAttribute("aria-expanded", shut ? "false" : "true");
    const arrow = toggle.querySelector("i");
    /* 同上：固定 ▼，收合狀態由 aria-expanded ＋ CSS 轉角度表示。 */
    if (arrow) arrow.textContent = "▼";
  });
  document.querySelectorAll("nav button[data-view][data-nav-zone]").forEach((button) => {
    const zone = button.dataset.navZone;
    const row = button.closest(".nav-row") || button;
    /*
     * ⚠️ 用 hidden 而不是移除節點：既有守門是用 `nav button[data-view]`
     *   列分頁的，節點還在但看不見，量高度的那幾支照樣量得到 0。
     */
    row.hidden = Boolean(zone) && closed.includes(zone);
  });
}

const NAV_ZONES = [
  { title: "", views: ["home", "guide"] },
  { title: "一　建立與匯入", views: ["setup", "import", "importlog"] },
  { title: "二　參數設定", views: ["roadadmin", "speed", "standards"] },
  { title: "三　資料檢視", views: ["detail", "summary"] },
  /*
   * ⚠️ 原本叫「四　圖表與比較」，因為這一區底下有「LOS 圖表」與
   *   「Manager 比較」兩頁。Manager 於 2026-09-13 移除後只剩圖表，
   *   區名再寫「與比較」會讓使用者去找一個不存在的東西。
   */
  { title: "四　圖表", views: CHART_VIEWS },
  { title: "五　產出與維護", views: ["conclusion", "delivery", "maintenance", "backup"] },
];
/** 每一區的代表色，與頁面裡區塊左緣的色條同一組。 */
const NAV_ZONE_CLASS = ["", "zone-in", "zone-set", "zone-data", "zone-chart", "zone-out"];


/**
 * 尖峰彙總留下的「目前套用的判定標準」摘要。
 *
 * 設定本身搬到「判定標準」頁了，但**「現在是怎麼判的」不能跟著藏起來**——
 * 看表格的人必須知道這些等級是用哪一組門檻、哪一種三段分法算出來的。
 */
function renderRuleShortcut() {
  const node = $("ruleShortcutText");
  if (!node) return;
  const rules = rulesFor();
  /*
   * ⚠️ 這裡**只能**寫服務水準門檻，不可以再把三段分法（順暢／尚可／壅塞）
   *   接在後面。
   *
   * 使用者 2026-09-13：「尖峰彙總，套用的標準只有服務水準，沒有順暢A、B／
   * 尚可C、D／壅塞E、F……會以為表格裡面哪邊有套用到，所以後面那句說明請拿掉。」
   *
   * 他是對的：尖峰彙總這張表只有一欄 LOS（A～F），**沒有任何一欄**用到
   * 三段分法——那是 LOS 圖表頁（bandPanel）才用的。橫幅把兩套規則並排寫，
   * 讀的人會去表格裡找三段分法的欄位，找不到。
   * **說明多講一件畫面上沒有的事，和漏講一樣會誤導。**
   *
   * ⚠️ 門檻數字一律讀 rulesFor()（目前計畫的設定），不可以寫死預設值——
   *   使用者在「判定標準」頁改了門檻，這一行必須跟著變。
   */
  node.textContent =
    "門檻 A≧" + rules.A + "／B≧" + rules.B + "／C≧" + rules.C +
    "／D≧" + rules.D + "／E≧" + rules.E;
}
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-goto]");
  if (button) go(button.dataset.goto);
});

function arrangeNav() {
  const nav = document.querySelector("nav");
  if (!nav || nav.dataset.zoned === "1") return;
  const buttons = new Map(
    [...nav.querySelectorAll("button[data-view]")].map((node) => [
      node.dataset.view,
      node,
    ]),
  );
  const placed = new Set();
  const frag = document.createDocumentFragment();
  NAV_ZONES.forEach((zone, index) => {
    const own = zone.views.map((view) => buttons.get(view)).filter(Boolean);
    if (!own.length) return;
    if (zone.title) {
      /*
       * ── 分類標題可以整區收合（使用者 2026-09-14，三支同步）──────────
       *
       * 「請讓交通服務水準的分類標題和全日交通/路口轉向一樣，
       *   具有展開/收合效果，且文字一樣適中」
       *
       * ⚠️ 收合鈕用 <span role="button">，**不可以用 <button>**。
       *   側欄有好幾支守門是用 `nav button` 把所有按鈕列出來當分頁清單、
       *   然後逐一點過去。分類標題一旦是 button，就會被當成一個分頁去點，
       *   而點它是「收合這一區」——那一區的分頁全部消失，後面每一項都找不到。
       *   同一個坑在路口轉向已經踩過一次（整條端對端鏈卡住）。
       *   用 span 的話 `nav button` 永遠選不到它，一支守門都不用改。
       */
      const head = document.createElement("div");
      head.className = "nav-zone";
      const toggle = document.createElement("span");
      toggle.className = "nav-zone-toggle";
      toggle.setAttribute("role", "button");
      toggle.tabIndex = 0;
      toggle.dataset.zoneToggle = zone.title;
      toggle.setAttribute("aria-label", "收合或展開「" + zone.title + "」這一區的分頁");
      const arrow = document.createElement("i");
      arrow.setAttribute("aria-hidden", "true");
      toggle.append(arrow, document.createTextNode(zone.title));
      const flip = () => {
        const list = zoneCollapsed();
        const at = list.indexOf(zone.title);
        if (at >= 0) list.splice(at, 1);
        else list.push(zone.title);
        setZoneCollapsed(list);
        applyZoneCollapse();
      };
      toggle.addEventListener("click", flip);
      toggle.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        flip();
      });
      head.append(toggle);
      frag.append(head);
    }
    own.forEach((button) => {
      /* 哪一區的，收合時才知道要藏誰。 */
      button.dataset.navZone = zone.title || "";
      /*
       * ⚠️ classList.add("") 會丟 SyntaxError（DOMTokenList 不接受空字串），
       * 而「開始」那一區本來就沒有色條。有色條才加。
       */
      const zoneClass = NAV_ZONE_CLASS[index];
      if (zoneClass) button.classList.add(zoneClass);
      frag.append(navRow(button));
      placed.add(button.dataset.view);
    });
  });
  /*
   * 沒有列在分區表裡的按鈕（日後新增而忘了歸類）**不可以憑空消失**，
   * 一律排在最後並標成「其他」——寧可版面不好看，也不要有人找不到功能。
   */
  const rest = [...buttons.entries()].filter(([view]) => !placed.has(view));
  if (rest.length) {
    const head = document.createElement("div");
    head.className = "nav-zone";
    head.textContent = "其他";
    frag.append(head);
    rest.forEach(([, button]) => frag.append(navRow(button)));
  }
  nav.append(frag);
  nav.dataset.zoned = "1";
  /*
   * ⚠️ 排完版就立刻套一次收合狀態。
   *   arrangeNav 是 window.load 才跑的，而 renderNavSections 可能更早跑過，
   *   那時候 .nav-row 還不存在、什麼都套不到。這裡補一次，
   *   首頁一載入就不會留下一排沒人管的空白按鈕。
   */
  applyNavCollapse();
  applyZoneCollapse();
}
window.addEventListener("load", arrangeNav);
globalThis.arrangeNav = arrangeNav;

function projectPackage() {
  const p = activeProject();
  if (!p) return null;
  const details = state.details.filter((x) => x.projectCode === p.code),
    summaries = state.summaries.filter((x) => x.projectCode === p.code),
    imports = state.imports.filter((x) => x.projectCode === p.code),
    limits = Object.fromEntries(
      Object.entries(state.limits).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    limitConfirmed = Object.fromEntries(
      Object.entries(state.limitConfirmed).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    aliases = Object.fromEntries(
      Object.entries(state.aliases).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    roadMeta = Object.fromEntries(
      Object.entries(state.roadMeta).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    speedVersions = Object.fromEntries(
      Object.entries(state.speedVersions).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    reportDrafts = Object.fromEntries(
      Object.entries(state.reportDrafts).filter(([k]) => k.startsWith(`${p.code}|`)),
    );
  return {
    kind: "TLM_PROJECT_PACKAGE",
    exportedAt: new Date().toISOString(),
    project: p,
    details,
    summaries,
    imports,
    limits,
    limitConfirmed,
    aliases,
    roadMeta,
    speedVersions,
    anomalyRule: state.anomalyRules[p.code] || null,
    reportDrafts,
    losRule: rulesFor(p.code),
    /*
     * 判定門檻的「季別 × 路段」覆寫也要跟著專案包走
     *（使用者 2026-09-15 新增的設定）。
     * ⚠️ 不帶的話，換一台電腦匯入之後同一份資料會算出不同的服務水準等級，
     *   而畫面只會說「匯入成功」——與 bandRule 是同一種錯法。
     */
    losRuleScopes: ruleScopesFor(p.code),
    /*
     * 三段分法也要跟著專案包走。它是使用者自己調的、會直接改變圖上的
     * 分段與趨勢圖指標名稱；換一台電腦匯入之後不見的話，同一份資料
     * 會畫出不一樣的圖，而畫面不會有任何提示。
     */
    bandRule: bandsFor(p.code),
    /*
     * 結論草稿的「條件範本」也要跟著專案包走。
     *
     * 它存在 state.conclusionTemplates[計畫代碼]，本機是有存的，
     * 但**匯出的專案包原本沒有收**——使用者在 A 電腦存好幾組常用條件，
     * 帶到 B 電腦匯入之後範本一個都不在，而畫面只會說匯入成功。
     * 那些條件是使用者自己一項一項勾出來的，重建很花時間。
     */
    conclusionTemplates: (state.conclusionTemplates || {})[p.code] || [],
    /*
     * 還原點（「版本差異與還原」那一份）也要跟著專案包走。
     *
     * ⚠️ 舊版只有**全部計畫**的組合包帶走 operations，單一計畫的專案包沒帶。
     *   於是把一個計畫帶到另一台電腦之後，那個計畫的還原點全部消失，
     *   而畫面只會說匯入成功——路口轉向踩過一模一樣的坑（匯出有帶、
     *   還原沒讀回來，換電腦之後整批消失）。還原點的價值就在「出事那一天」，
     *   平常完全看不出它不見了。
     */
    operations: (state.operations || []).filter((x) => x.projectCode === p.code),
  };
}
function downloadProjectPackage(note = true) {
  const pack = projectPackage();
  if (!pack) {
    toast("尚未建立計畫");
    return false;
  }
  download(
    JSON.stringify(pack, null, 2),
    `${pack.project.code}_${pack.project.name}_Project專案包.json`,
  );
  if (note) toast("目前 Project 專案包已下載");
  return true;
}
$("downloadBackup").textContent = "下載目前計畫的專案包";
$("downloadBackup").onclick = () => downloadProjectPackage();
const portfolioBtn = document.createElement("button");
portfolioBtn.className = "outline";
portfolioBtn.style.marginLeft = "8px";
portfolioBtn.textContent = "下載個人全部計畫包";
$("downloadBackup").after(portfolioBtn);
portfolioBtn.onclick = () => {
  if (!state.projects.length) return toast("尚未建立計畫");
  download(
    JSON.stringify(
      {
        kind: "TLM_PORTFOLIO_PACKAGE",
        exportedAt: new Date().toISOString(),
        projects: state.projects,
        details: state.details,
        summaries: state.summaries,
        imports: state.imports,
        limits: state.limits,
        limitConfirmed: state.limitConfirmed,
        aliases: state.aliases,
        roadMeta: state.roadMeta,
        speedVersions: state.speedVersions,
        anomalyRules: state.anomalyRules,
        reportDrafts: state.reportDrafts,
        operations: state.operations,
        losRules: state.losRules,
        /* 判定門檻的「季別 × 路段」覆寫（依計畫代碼分組），理由同 losRules。 */
        losRuleScopes: state.losRuleScopes || {},
        /* 三段分法（依計畫代碼分組），理由同 projectPackage 的 bandRule。 */
        bandRules: state.bandRules || {},
        /* 三段分法的「季別區間 × 路段」覆寫，理由同 losRuleScopes。 */
        bandRuleScopes: state.bandRuleScopes || {},
        /* 條件範本（依計畫代碼分組），理由同 projectPackage。 */
        conclusionTemplates: state.conclusionTemplates || {},
      },
      null,
      2,
    ),
    "交通服務水準_個人全部計畫包.json",
  );
  toast("個人全部計畫包已下載");
};
/**
 * 判斷一份沒有 kind 標記的 JSON 是不是「舊版備份」。
 *
 * 只檢查「有沒有 projects 與 details 兩個陣列」是不夠的：一個
 * `{"projects":[],"details":[]}` 就能通過，載入後把使用者全部的資料清空，
 * 畫面卻顯示「備份已載入」。舊版備份是把整個 state 存成 JSON，一定同時
 * 帶著版本號與其他設定物件，而且至少有一個計畫、每個計畫都有編號。
 */
function looksLikeLegacyBackup(x) {
  if (!Array.isArray(x.projects) || !Array.isArray(x.details)) return false;
  if (!x.projects.length) return false;
  if (!x.projects.every(isUsableProject)) return false;
  /* ⚠️ 新增一個依計畫保存的設定時，這一行**一定要跟著加**——
     漏了的話，專案包帶不走它，換一台電腦就整組不見。 */
  const bags = [
    "limits",
    "aliases",
    "roadMeta",
    "losRules",
    "losRuleScopes",
    "bandRules",
    "bandRuleScopes",
  ];
  return bags.some((k) => x[k] && typeof x[k] === "object");
}
/**
 * 一筆計畫資料能不能用。
 *
 * ⚠️ 計畫編號是**主鍵**：速限、別名、路段資料、還原點、報告草稿全部都以
 *   「編號|…」當儲存鍵，畫面上每一份明細也靠 projectCode 篩選。編號是空字串
 *   時，這些鍵會變成「|…」，而且計畫選單顯示成一個沒有名字的空項目——
 *   使用者看得到資料筆數，卻篩不出任何一筆，也不知道要去哪裡修。
 *   含「|」的編號更糟：刪除計畫時會連別的計畫的設定一起清掉
 *  （這正是 saveProject 擋掉「|」的理由，還原這條路以前沒有擋）。
 *
 * 所以「使用者自己輸入」與「從備份檔讀進來」要用同一組規則。
 */
function isUsableProject(p) {
  return (
    !!p &&
    typeof p.code === "string" &&
    p.code.trim() !== "" &&
    !p.code.includes("|")
  );
}
enableFileDrop($("restoreFile").closest("label"), $("restoreFile"));
$("restoreFile").onchange = async (e) => {
  // 還原前先把目前狀態留一份。舊版是「邊解析邊改 state」，
  // 遇到壞掉的備份檔會在改壞之後才丟出例外，畫面只顯示「這不是有效的備份檔」，
  // 但原本的資料其實已經被覆蓋，而且下一次存檔就寫進資料庫，救不回來。
  const snapshot = structuredClone(state);
  try {
    /*
      * ⚠️ 這裡原本還會把 state.manager 留下來（`manager = state.manager;`），
      *   因為還原備份時 Manager 匯入的專案包不該被別人的備份洗掉。
      *   Manager 於 2026-09-13 移除後沒有這個鍵了，一併拿掉——
      *   留著會把 undefined 寫回 state，之後任何讀它的地方都要多一層防呆。
      */
    const x = JSON.parse(await e.target.files[0].text());
    if (!x || typeof x !== "object") throw new Error("格式不符");
    if (x.kind === "TLM_PROJECT_PACKAGE") {
      /*
       * ⚠️ 只認 kind 標記是不夠的。專案包被改壞、被手動編輯、或被別的工具
       *   重新輸出時，project 可能整個不見或編號變成空字串——下面每一行都用
       *   `x.project.code` 當鍵，編號空掉就會建出一個點不開也篩不出東西的計畫，
       *   而畫面仍然報「備份已載入」。
       */
      if (!isUsableProject(x.project))
        throw new Error("專案包裡的計畫編號是空的或含有「|」");
      state.projects = state.projects.filter((p) => p.code !== x.project.code);
      state.projects.push(x.project);
      state.activeCode = x.project.code;
      state.details = state.details
        .filter((d) => d.projectCode !== x.project.code)
        .concat(x.details || []);
      state.imports = state.imports
        .filter((d) => d.projectCode !== x.project.code)
        .concat(x.imports || []);
      Object.assign(state.limits, x.limits || {});
      Object.assign(state.limitConfirmed, x.limitConfirmed || {});
      Object.assign(state.aliases, x.aliases || {});
      Object.assign(state.roadMeta, x.roadMeta || {});
      Object.assign(state.speedVersions, x.speedVersions || {});
      if (x.anomalyRule) state.anomalyRules[x.project.code] = x.anomalyRule;
      Object.assign(state.reportDrafts, x.reportDrafts || {});
      /*
       * 備份裡有什麼就還原什麼，不要再用 isLegacyLosRule 過濾。
       *
       * A.9/B.7/C.5/D.4/E.3 是實務上真的有人在用的門檻表（migrateLosRules
       * 的註解自己就寫了這件事，所以只在版本升級時清一次）。這裡卻無條件
       * 過濾，於是「匯出專案包再還原同一個檔案」就會把使用者的自訂門檻
       * 清成預設值——同一筆速限比 0.65 的紀錄，還原前是 C、還原後變成 B，
       * 整個計畫的服務水準悄悄改變，畫面只說「備份已載入」。
       */
      if (x.losRule) state.losRules[x.project.code] = x.losRule;
      else delete state.losRules[x.project.code];
      /*
       * 門檻覆寫：與 losRule 同一套處理——有就帶進來，沒有（舊版專案包）
       * 就刪掉這個計畫的覆寫回到「只有計畫預設」。
       * ⚠️ 一個沿用舊值、一個換新值的話，畫面上的等級會是兩組設定混出來的。
       */
      state.losRuleScopes = state.losRuleScopes || {};
      if (Array.isArray(x.losRuleScopes) && x.losRuleScopes.length)
        state.losRuleScopes[x.project.code] = x.losRuleScopes;
      else delete state.losRuleScopes[x.project.code];
      /*
       * 三段分法：專案包裡有就帶進來，沒有（舊版專案包）就刪掉這個計畫
       * 的設定回到預設。跟 losRule 同一套處理，兩者才不會一個沿用舊值、
       * 一個回預設而對不起來。
       */
      state.bandRules = state.bandRules || {};
      if (x.bandRule) state.bandRules[x.project.code] = x.bandRule;
      else delete state.bandRules[x.project.code];
      /*
       * 條件範本：專案包裡有就帶進來。沒有（舊版的專案包）就維持這台電腦
       * 原本的，不要清空——把使用者已經存好的範本刪掉比不還原更糟。
       */
      state.conclusionTemplates = state.conclusionTemplates || {};
      if (Array.isArray(x.conclusionTemplates))
        state.conclusionTemplates[x.project.code] = x.conclusionTemplates;
      /*
       * 還原點：專案包裡有就換成它的（這個計畫的整份替換）。
       * 沒有（舊版專案包）就維持原本的——理由同上面的條件範本。
       */
      if (Array.isArray(x.operations)) {
        state.operations = (state.operations || [])
          .filter((op) => op.projectCode !== x.project.code)
          .concat(x.operations);
      }
    } else if (x.kind === "TLM_PORTFOLIO_PACKAGE") {
      /*
       * ⚠️ 這一條會把整份 state 換掉，所以它比專案包更危險。
       *   以前這裡只看 kind：一個 `{"kind":"TLM_PORTFOLIO_PACKAGE"}`
       *   （檔案被截斷、或有人手打了一個殼）展開之後 projects 變成
       *   emptyState() 的空陣列，下面「是不是陣列」的完整性檢查照樣通過，
       *   接著 save() 就把使用者全部的計畫寫成空的，畫面只說
       *   「備份已載入：0 個計畫、0 筆尖峰明細」。
       *
       *   匯出端本來就擋掉「沒有計畫」（見 portfolioBtn），所以真正的
       *   全部計畫包一定至少有一個計畫、而且每個計畫的編號都可用。
       *   這一條與 looksLikeLegacyBackup 用的是同一組規則。
       */
      if (
        !Array.isArray(x.projects) ||
        !x.projects.length ||
        !x.projects.every(isUsableProject)
      )
        throw new Error("全部計畫包裡沒有可用的計畫");
      state = { ...emptyState(), ...x, activeCode: x.projects[0].code };
    } else if (looksLikeLegacyBackup(x)) {
      // 舊版備份沒有 kind 標記，只能靠形狀認。但「形狀」必須嚴格檢查：
      // 舊版是把整個 state 直接存成 JSON，一定同時帶著 projects 與 details
      // 兩個陣列。之前這裡是無條件 else，於是隨便一個 JSON（例如從別的系統
      // 匯出的設定檔）都會被當成備份，展開後 projects 變成 emptyState() 的空
      // 陣列，完整性檢查因此通過，接著 save() 就把使用者全部的計畫洗掉。
      state = { ...emptyState(), ...x };
    } else throw new Error("缺少備份檔標記");
    if (!Array.isArray(state.projects) || !Array.isArray(state.details))
      throw new Error("內容不完整");
    state.summaries = Array.isArray(state.summaries) ? state.summaries : [];
    state.imports = Array.isArray(state.imports) ? state.imports : [];
    migrateLosRules();
    rebuild();
    await save();
    // 把載入了什麼講清楚，使用者才看得出自己剛剛換掉了什麼。
    toast(
      `備份已載入：${state.projects.length} 個計畫、${state.details.length} 筆尖峰明細`,
    );
  } catch {
    state = snapshot;
    renderAll();
    toast("這不是有效的備份檔，原有資料未變動");
  } finally {
    e.target.value = "";
  }
};
/**
 * 刪除一個計畫，以及它底下所有的資料。
 * 各種以「計畫編號|…」為鍵值的設定（速限、別名、路段資料、速限版本、
 * 報告草稿…）都必須一併清掉，否則之後建立同編號的計畫會沿用到舊設定。
 */
function purgeProject(code) {
  state.projects = state.projects.filter((x) => x.code !== code);
  state.details = state.details.filter((x) => x.projectCode !== code);
  state.summaries = state.summaries.filter((x) => x.projectCode !== code);
  state.imports = state.imports.filter((x) => x.projectCode !== code);
  for (const bag of ["limits", "limitConfirmed", "aliases", "roadMeta", "speedVersions"])
    for (const k of Object.keys(state[bag] || {}))
      if (k.startsWith(`${code}|`)) delete state[bag][k];
  for (const k of Object.keys(state.reportDrafts || {}))
    if (k.startsWith(`${code}|`)) delete state.reportDrafts[k];
  state.operations = (state.operations || []).filter((x) => x.projectCode !== code);
  delete state.losRules[code];
  /*
   * 門檻覆寫也要跟著刪，理由與 losRules／bandRules 完全相同：
   * 留著的話，日後建立同代碼的新計畫會沉默地沿用上一個計畫的覆寫，
   * 而使用者從來沒設定過那幾條。
   */
  if (state.losRuleScopes) delete state.losRuleScopes[code];
  /* 三段分法的覆寫同理——留著會讓同代碼的新計畫沉默地沿用。 */
  if (state.bandRuleScopes) delete state.bandRuleScopes[code];
  /*
   * 三段分界也要跟著刪。留著的話，日後建立同代碼的新計畫會**沉默地**
   * 沿用上一個計畫的分界——圖上分成三段，而使用者從來沒設定過那把尺。
   * 這與 losRules 是同一類問題，那一項已經有守門，這一項是補上的。
   */
  delete state.bandRules[code];
  delete state.anomalyRules[code];
  if (state.activeCode === code) state.activeCode = state.projects[0]?.code || "";
  clearPendingPreview();
}
/** 刪除計畫前一律先產生一份專案包，誤刪時還救得回來。 */
async function deleteProjectFlow(code, { fromSetup = false } = {}) {
  const target = state.projects.find((x) => x.code === code);
  if (!target) return toast("找不到要刪除的計畫");
  const rows = state.details.filter((x) => x.projectCode === code).length;
  const periods = [
    ...new Set(state.details.filter((x) => x.projectCode === code).map((x) => x.period)),
  ].length;
  if (
    !confirm(
      `確定要刪除計畫「${target.code} ${target.name}」嗎？\n\n` +
        `這個計畫底下的 ${periods} 個季度、${rows} 筆尖峰明細、彙總、路段速限、別名與報告草稿都會一起刪除，且無法復原。\n\n` +
        `按「確定」前，系統會先自動下載一份這個計畫的專案包備份。`,
    )
  )
    return;
  const previousActive = state.activeCode;
  state.activeCode = code;
  downloadProjectPackage(false);
  state.activeCode = previousActive;
  purgeProject(code);
  await save();
  toast(`計畫「${target.code} ${target.name}」已刪除，其他計畫不受影響`);
  if (fromSetup) go(state.projects.length ? "home" : "setup");
}
// 「備份與淨空」原本的按鈕寫著「清除目前瀏覽器內所有計畫及資料」，
// 實際上卻只刪掉目前這一個計畫，文案與行為不符。這裡改成兩個分開的動作。
$("clearAll").textContent = "刪除目前這一個計畫";
$("clearAll").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("目前沒有計畫");
  await deleteProjectFlow(p.code);
};
const clearAllCard = $("clearAll").closest(".action-card");
if (clearAllCard) {
  clearAllCard.querySelector("b").textContent = "刪除計畫";
  clearAllCard.querySelector("p").textContent =
    "刪除目前選取的那一個計畫及其全部資料；刪除前會自動下載一份專案包備份。其他計畫不受影響。";
  const wipeAll = document.createElement("button");
  wipeAll.id = "wipeEverything";
  wipeAll.textContent = "清除這台電腦上的全部計畫";
  /*
   * ⚠️ 兩顆按鈕要用有 gap 的容器包起來，**不可以靠 marginTop**。
   *
   * 使用者 2026-09-13（附圖）：「刪除計畫的『刪除單一計畫』和『本機所有計畫』
   * 按鍵**黏在一起**了，請記得用肉眼確認畫面、按鍵是否被裁切或黏住或很接近
   * 畫面邊緣等問題。」
   *
   * 舊版寫的是 style.marginTop = "8px"——但這兩顆是**並排**的，
   * 橫向間距因此是 0，兩顆紅色按鈕連成一條，看起來像一顆被切成兩半。
   * 上下間距對、左右間距 0，是「補了一個軸、忘了另一個軸」的典型。
   * 改成 flex ＋ gap：不論這一列換不換行，兩個方向都留得住間距。
   */
  const dangerActions = document.createElement("div");
  dangerActions.className = "danger-actions";
  clearAllCard.append(dangerActions);
  dangerActions.append($("clearAll"), wipeAll);
  wipeAll.onclick = async () => {
    if (!state.projects.length) return toast("目前沒有任何資料");
    if (
      !confirm(
        `確定要清除這個瀏覽器內的「全部 ${state.projects.length} 個計畫」嗎？\n\n` +
          `此動作無法復原。建議先按上方「下載個人全部計畫包」保存備份。`,
      )
    )
      return;
    if (!confirm("再次確認：全部計畫資料都會被清除，且無法復原。確定繼續？")) return;
    state = emptyState();
    clearPendingPreview();
    await save();
    toast("已清除全部資料，回到全新空白模板");
    go("setup");
  };
}

function syncOptions(id, items, allLabel) {
  const el = $(id),
    old = el.value;
  el.innerHTML =
    `<option value="">${allLabel}</option>` +
    items.map((x) => `<option value="${esc(x.value ?? x)}">${esc(x.label ?? x)}</option>`).join("");
  el.value = [...el.options].some((x) => x.value === old) ? old : "";
}
/** 一張圖、多條線（一個計畫一條）。顏色固定跟著計畫代碼，不跟著排序跑。 */
const CROSS_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#4a3aa7", "#e34948"];
/*
 * ══════════════════════════════════════════════════════════════════
 *  圖表的樣式與版面：畫面與 PNG 的唯一來源
 * ══════════════════════════════════════════════════════════════════
 *
 * 每一張圖都把這份 <style> 內嵌進自己的 SVG。
 *
 * 為什麼一定要內嵌，而不是寫在 styles.css：PNG 匯出是把 SVG 序列化成
 * data:image/svg+xml 再畫進 canvas，那份 data URL 是獨立文件，讀不到外部
 * 樣式表。實測過未內嵌的結果：折線完全消失（.trend-line 的 fill:none／
 * stroke 一掉，polyline 退回預設的 fill:#000／stroke:none）、格線與軸線
 * 不見、資料點變成黑色大圓、字體變成 16px 襯線體因而互相重疊。
 * 那張圖會被貼進簡報交給業主。
 *
 * 字體要寫完整的備援串：PNG 是在 canvas 裡重新排版的，找不到字型時
 * 中文會變成豆腐或退回襯線體，字寬一變版面就跟著跑掉。
 */
var CHART_FONT =
  "'Noto Sans TC','PingFang TC','Microsoft JhengHei','Heiti TC',sans-serif";
var CHART_SVG_STYLE =
  "<style>" +
  "text{font-family:" + CHART_FONT + "}" +
  ".trend-grid{stroke:#e6edf1;stroke-width:1;fill:none}" +
  ".trend-axis{stroke:#c8d5dd;stroke-width:1;fill:none}" +
  ".trend-tick{fill:#8296a4;font-size:11px}" +
  ".trend-line{fill:none;stroke:#0f6f68;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}" +
  ".trend-dot{fill:#0f6f68;stroke:#fff;stroke-width:2;cursor:pointer}" +
  ".trend-empty-text{fill:#8296a4;font-size:13px}" +
  ".trend-series-label{font-size:11.5px;font-weight:700}" +
  ".trend-point-label{fill:#0f6f68;font-size:11.5px;font-weight:700}" +
  /*
   * ── 一張圖多條線時，每一條線的顏色 ────────────────────────────
   *
   * 使用者 2026-09-16：「目前反而缺少一張圖多條線……(這點三項程式都適用)」。
   *
   * ⚠️ 顏色**不是唯一的識別方式**：每一條線的右端都直接寫上路段名稱
   *   （見 trendChartSvg 的 endLabels）。色盲讀者與列印成灰階的人
   *   都靠那個名稱分辨，顏色只是輔助。
   *
   * ⚠️ 這 8 個色都驗過與白底的對比 ≥ 3:1（圖形物件的門檻），
   *   第一個刻意沿用原本的深綠，單線時外觀完全不變。
   *   ⚠️ 不可以「線多了就自動產生新顏色」——那會生出對比不足、
   *   或兩條幾乎一樣的色。超過 8 條時改成灰線＋只標名稱（見下）。
   */
  ".trend-line-0{stroke:#0f6f68}.trend-dot-0{fill:#0f6f68}.trend-end-0{fill:#0f6f68}" +
  ".trend-line-1{stroke:#D55E00}.trend-dot-1{fill:#D55E00}.trend-end-1{fill:#D55E00}" +
  ".trend-line-2{stroke:#0072B2}.trend-dot-2{fill:#0072B2}.trend-end-2{fill:#0072B2}" +
  ".trend-line-3{stroke:#8C6D31}.trend-dot-3{fill:#8C6D31}.trend-end-3{fill:#8C6D31}" +
  ".trend-line-4{stroke:#7A5195}.trend-dot-4{fill:#7A5195}.trend-end-4{fill:#7A5195}" +
  ".trend-line-5{stroke:#B5608E}.trend-dot-5{fill:#B5608E}.trend-end-5{fill:#B5608E}" +
  ".trend-line-6{stroke:#3B3B3B}.trend-dot-6{fill:#3B3B3B}.trend-end-6{fill:#3B3B3B}" +
  ".trend-line-7{stroke:#1F7A8C}.trend-dot-7{fill:#1F7A8C}.trend-end-7{fill:#1F7A8C}" +
  ".trend-end-label{font-size:11px;font-weight:700}" +
  /*
   * 三段圖的配色。
   * 三段而不是六段的理由見 DEFAULT_BAND_RULE 的長註解——六段配色過不了
   * 對比檢核，色盲讀者一定會有兩段分不出來。這三個色除了色相不同，
   * **明度也刻意拉開**（順暢最亮、壅塞最暗），列印成灰階也分得出來。
   */
  ".band-smooth{fill:#2f8f6b}" +
  ".band-fair{fill:#d9a441}" +
  ".band-congested{fill:#b4453d}" +
  ".band-empty{fill:#eef2f4}" +
  ".band-seg-label{fill:#fff;font-size:10.5px;font-weight:700}" +
  ".band-seg-label-dark{fill:#3c4b55;font-size:10.5px;font-weight:700}" +
  ".band-legend-text{fill:#4a5f6b;font-size:11px;font-weight:700}" +
  ".chart-title{fill:#173b59;font-size:13.5px;font-weight:700}" +
  ".axis-title{fill:#5b7183;font-size:11.5px;font-weight:700}" +
  "</style>";

/**
 * 軸名稱要怎麼寫。
 *
 * 使用者的要求：「有單位的軸，就要附上名稱和單位」。所以縱軸一律寫成
 * 「指標名稱（單位）」，沒有單位的指標（速限比是比值）就只寫名稱——
 * 掛一個空括號比不掛還糟。
 */
function axisTitleText(label, unit) {
  var clean = String(unit || "").trim();
  if (!clean) return String(label || "");
  /* 佔比的單位就是百分比，寫「（%）」比「（百分比）」在圖上短而且通用。 */
  return String(label || "") + "（" + clean + "）";
}

/**
 * X 軸標籤要間隔幾個才印一個。
 *
 * 只算「印得下幾個」：可用寬度 ÷（最長標籤寬 + 最小間距）。字寬用
 * 字元數估——中文字約等於字級、半形數字約 0.55 倍，估得比實際寬一點點
 * 是刻意的，寧可少印一個也不要疊在一起。
 *
 * ⚠️ 不可以「反正小圖才需要」。季度會一路累積下去，16 季、24 季之後
 * 大圖一樣會擠成一團，而那時候使用者已經在簡報現場了。
 */
function labelStride(labels, available, fontSize) {
  var widest = 0;
  for (var i = 0; i < labels.length; i += 1) {
    var text = String(labels[i] || "");
    var width = 0;
    for (var c = 0; c < text.length; c += 1)
      width += text.charCodeAt(c) > 255 ? fontSize : fontSize * 0.58;
    if (width > widest) widest = width;
  }
  var slot = widest + fontSize * 0.9;
  var fits = Math.max(1, Math.floor(available / slot));
  return Math.max(1, Math.ceil(labels.length / fits));
}

/**
 * 兩兩相鄰的線尾標籤不可以疊在一起。
 *
 * 跨計畫圖把計畫名稱直接寫在線的尾端（省掉來回對照圖例），但兩個計畫的
 * 最後一季數值很接近時，兩個名字會**印在同一個位置**——看起來像亂碼。
 * 這裡照 y 由小到大排好，逐一往下推到至少相隔一個字高。
 */
function spreadLabels(items, minGap, limit) {
  var sorted = items.slice().sort(function (a, b) {
    return a.y - b.y;
  });
  for (var i = 1; i < sorted.length; i += 1)
    if (sorted[i].y - sorted[i - 1].y < minGap)
      sorted[i].y = sorted[i - 1].y + minGap;
  /* 推到底之後如果超出畫布，整組往上平移回來。 */
  var overflow = sorted.length
    ? sorted[sorted.length - 1].y - limit
    : 0;
  if (overflow > 0)
    for (var j = 0; j < sorted.length; j += 1) sorted[j].y -= overflow;
  return sorted;
}

/**
 * 縱軸刻度要落在「好看的整數」上。
 *
 * 舊版是把資料範圍加 30% 留白之後直接四等分，於是刻度長成
 * 20.83／30.39／39.94／49.5／59.05——五個數字五種小數位數，貼進簡報
 * 業主第一眼看到的就是這排亂數。刻度的作用是讓人「一眼估出這個點多少」，
 * 落在 20／30／40／50／60 才做得到這件事。
 *
 * 做法是標準的 nice-number：把粗略的間距吸附到 1／2／2.5／5 的 10 倍數，
 * 再把上下界對齊到間距的整數倍。
 */
function niceScale(lo, hi, count) {
  var span = hi - lo;
  if (!(span > 0)) {
    var base = Math.abs(hi) || 1;
    lo = hi - base * 0.1;
    hi = hi + base * 0.1;
    span = hi - lo;
  }
  var rough = span / Math.max(1, count);
  var power = Math.pow(10, Math.floor(Math.log10(rough)));
  var scaled = rough / power;
  var step =
    (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) *
    power;
  var min = Math.floor(lo / step) * step;
  var max = Math.ceil(hi / step) * step;
  /* 浮點數尾巴（0.30000000000000004）會原樣印到刻度上，先修掉。 */
  var digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return {
    min: Number(min.toFixed(digits)),
    max: Number(max.toFixed(digits)),
    step: Number(step.toFixed(digits)),
    digits: Math.max(0, -Math.floor(Math.log10(step))),
  };
}

/** 刻度數字的寫法：由間距決定小數位數，同一條軸上位數一致。 */
function tickText(value, digits) {
  return Number(value).toFixed(digits);
}

function renderImportLog() {
  const rows = (state.imports || []).filter((x) => x.projectCode === state.activeCode);
  $("importLogCount").textContent = `${rows.length} 個批次`;
  $("importLogRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.time)}</td><td>${esc(x.projectCode)} ${esc(x.projectName)}</td><td>${esc(showQuarter(x.period, x.projectCode))}</td><td>${x.files.length}</td><td>${x.added}</td><td>${x.updated}</td><td>${x.skipped}</td><td>${esc(x.status)}</td><td>${x.status === "有效" ? `<button class="outline" data-rollback="${esc(x.id)}">復原此批</button>` : "—"}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="9" class="empty">目前計畫尚無匯入紀錄</td></tr>';
  document
    .querySelectorAll("[data-rollback]")
    .forEach((b) => (b.onclick = () => rollbackBatch(b.dataset.rollback)));
}
/** 清掉「已經沒有任何明細」的路段自動命名，避免留下孤兒方向名稱。 */
function forgetOrphanDirectionNames() {
  const alive = new Set(
    state.details.map((d) => roadMetaKey(d.road, d.projectCode)),
  );
  for (const key of Object.keys(state.roadMeta || {})) {
    if (alive.has(key)) continue;
    const meta = state.roadMeta[key];
    if (!meta) continue;
    /*
     * roadMeta 現在只剩方向顯示名稱（路段有效期間已於 2026-09-15 移除），
     * 名稱回到佔位值就等於整筆沒有內容了——直接刪掉，不留孤兒。
     */
    delete state.roadMeta[key];
  }
}
async function rollbackBatch(id) {
  const batch = state.imports.find((x) => x.id === id);
  if (!batch || batch.status !== "有效") return;
  const current = new Map(state.details.map((x) => [x.id, x])),
    written = Array.isArray(batch.writtenIds) ? batch.writtenIds : [],
    changed = written.filter(
      (key) => current.has(key) && current.get(key).importBatch !== id,
    );
  if (changed.length) return toast("此批資料已被後續批次更新，請先復原較新的相關批次");
  // 舊版的守門只看「被改掉的」，看不出「已經不存在的」。
  // 路段改名或合併會把每一筆的 id 全部改寫，這時 writtenIds 全部查無資料，
  // 守門形同虛設，一按復原就會把改名前的舊路段整批復活、與新名稱重複計算。
  if (written.length && written.some((key) => !current.has(key)))
    return toast("這批資料的路段名稱或期間已被後續操作變更，無法安全復原；請改用備份還原");
  // 「刪除季度」批次若之後又重新匯入同一季，直接還原會把新資料蓋回舊值。
  const restoring = (batch.previous || []).filter((row) => current.has(row.id));
  if (
    batch.type === "delete-quarter" &&
    restoring.some((row) => current.get(row.id).importBatch !== id)
  )
    return toast("這個季度在刪除後已重新匯入，還原會覆蓋新資料；請先復原較新的匯入批次");
  const message =
    batch.type === "delete-quarter"
      ? `確定還原已刪除的 ${showQuarter(batch.period)}？\n將回復 ${batch.previous.length} 筆尖峰明細。`
      : `確定復原 ${batch.time} 的匯入？\n新增 ${batch.added} 筆將移除，更新 ${batch.updated} 筆將還原。`;
  if (!confirm(message)) return;
  const added = new Set(batch.addedIds);
  state.details = state.details.filter((x) => !added.has(x.id));
  const map = new Map(state.details.map((x) => [x.id, x]));
  batch.previous.forEach((x) => map.set(x.id, x));
  state.details = [...map.values()];
  batch.status = "已復原";
  batch.revertedAt = new Date().toLocaleString("zh-TW");
  // 匯入時會把報告上的方向文字寫進路段的方向名稱。復原之後，若這個路段
  // 已經沒有任何明細，那組名稱就是孤兒——匯錯檔（例如被別名對應到錯的
  // 路段）復原後，錯的方向名稱會留在路段管理裡，而且因為「已經不是預設值」
  // 之後匯入正確檔案時也不會再被更新。
  forgetOrphanDirectionNames();
  rebuild();
  await save();
  toast(batch.type === "delete-quarter" ? "該季度已還原" : "該匯入批次已復原");
}
function projectPeriods() {
  // 用期間本身的先後排序，不能用字串比較：
  // "100Q1".localeCompare("99Q4") 會是負的，99→100 年的資料會整個排反。
  return sortPeriods(
    state.details.filter((x) => x.projectCode === state.activeCode).map((x) => x.period),
  );
}
function refreshMaintenance() {
  const periods = projectPeriods(),
    selected = $("deletePeriod").value;
  $("deletePeriod").innerHTML =
    periods
      .map(
        (p) =>
          /* 值必須留儲存的季別；只有看到的文字跟著年份顯示切換走。 */
          `<option value="${esc(p)}" ${p === selected ? "selected" : ""}>${esc(showQuarter(p))}</option>`,
      )
      .join("") || '<option value="">目前沒有資料</option>';
  const period = $("deletePeriod").value,
    rows = state.details.filter((x) => x.projectCode === state.activeCode && x.period === period),
    roads = new Set(rows.map((x) => x.road)).size;
  $("deleteImpact").textContent = period
    ? `${showQuarter(period)}：${rows.length} 筆尖峰明細、${roads} 個路段。刪除後可重新批次匯入。`
    : "目前沒有可刪除的季度";
  $("deleteQuarter").disabled = !rows.length;
}
$("deletePeriod").onchange = refreshMaintenance;

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-85：季度改名（三支同步）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：「我看全日交通量程式除了可以刪除單一季度外，還能針對
 *   單一季度做修改名稱，你覺得這項功能要同步給路口轉向程式和交通服務水準
 *   程式嗎?」→ 2026-09-18：「請幫我將另外兩支也同步季度改名功能，
 *   擺放位置可以參考全日交通量程式擺放的地方。」
 *
 * ⚠️ 為什麼需要：季度是匯入時**手打**的，打錯是必然。沒有改名就只能刪掉重匯，
 *   而重匯會連帶弄丟那一季的匯入紀錄與人工確認。
 * ⚠️ 兩條界線（與全日交通量一致，不可以放寬）：
 *   ① **不可以併進一個已經存在的季度**——那等於自行合併兩季，系統不替
 *     使用者做這種決定，直接擋下來。
 *   ② 要**一次改完全部**。這一支裡「記著季別」的地方不只 details：
 *     匯入紀錄（imports）、判定門檻的季別覆寫（losRuleScopes）、
 *     三段分法的季別覆寫（bandRuleScopes）都記著。漏掉任何一個，
 *     改完之後那些設定就會指向一個不存在的季度、默默失效。
 *     summaries 是 rebuild() 重算出來的，不必也不可以手動改。
 */
function refreshRenameMaintenance() {
  const periods = projectPeriods(),
    selected = $("renamePeriod").value;
  $("renamePeriod").innerHTML =
    periods
      .map(
        (p) =>
          `<option value="${esc(p)}" ${p === selected ? "selected" : ""}>${esc(showQuarter(p))}</option>`,
      )
      .join("") || '<option value="">目前沒有資料</option>';
  const period = $("renamePeriod").value,
    rows = state.details.filter(
      (x) => x.projectCode === state.activeCode && x.period === period,
    ),
    roads = new Set(rows.map((x) => x.road)).size;
  $("renameImpact").textContent = period
    ? `${showQuarter(period)}：${rows.length} 筆尖峰明細、${roads} 個路段會一起改名。`
    : "目前沒有可改名的季度";
  $("renameQuarter").disabled = !rows.length;
}
$("renamePeriod").onchange = refreshRenameMaintenance;
$("renameQuarter").onclick = async () => {
  const p = activeProject(),
    from = $("renamePeriod").value,
    raw = ($("renamePeriodInput").value || "").trim().toUpperCase();
  if (!p || !from) return;
  /* ⚠️ 這幾支住在 period-date.js 的 PeriodDate 命名空間底下，不是全域函式。 */
  const check = globalThis.PeriodDate.checkSurveyPeriodInput(raw);
  if (!check.ok)
    return toast(globalThis.PeriodDate.surveyPeriodInputMessage(check.reason));
  const next = check.key;
  if (next === from) return toast("季度名稱沒有變動。");
  /*
   * ⚠️ 撞名一律擋下來，**不自行合併**。合併看起來像幫使用者省事，
   *   實際上是把兩季的資料混成一季，而且事後分不回來——
   *   與三支共同的「系統不會自行挑選或平均」是同一條原則。
   */
  const clash = projectPeriods().find(
    (item) =>
      item !== from &&
      globalThis.PeriodDate.normalizeSurveyPeriod(item) === next,
  );
  if (clash)
    return toast(
      `${showQuarter(clash)} 已經存在，系統不會把兩季合併。請改用別的名稱，或先處理掉那一季。`,
    );
  const rows = state.details.filter(
    (x) => x.projectCode === state.activeCode && x.period === from,
  );
  if (!rows.length) return;
  if (
    !confirm(
      `確定把「${p.code} ${p.name}」的 ${showQuarter(from)} 改名為 ${showQuarter(next)}？
共 ${rows.length} 筆尖峰明細，匯入紀錄與季別覆寫設定會一起改。`,
    )
  )
    return;
  for (const row of state.details)
    if (row.projectCode === p.code && row.period === from) row.period = next;
  for (const batch of state.imports)
    if (batch.projectCode === p.code && batch.period === from)
      batch.period = next;
  /*
   * 判定門檻與三段分法的季別覆寫：新舊兩種寫法都要改。
   * 舊格式只有 period，新格式是 periodFrom／periodTo（見 los-rule-scope.js）。
   */
  for (const key of ["losRuleScopes", "bandRuleScopes"]) {
    const list = (state[key] && state[key][p.code]) || [];
    for (const scope of list) {
      if (scope.period === from) scope.period = next;
      if (scope.periodFrom === from) scope.periodFrom = next;
      if (scope.periodTo === from) scope.periodTo = next;
    }
  }
  rebuild();
  await save();
  refreshMaintenance();
  refreshRenameMaintenance();
  inspectHealth();
  $("renamePeriodInput").value = "";
  toast(
    `季度已改為 ${showQuarter(next)}（共 ${rows.length} 筆）` +
      (raw !== next ? `；輸入的 ${raw} 已正規化為 ${next}` : ""),
  );
};
$("deleteQuarter").onclick = async () => {
  const p = activeProject(),
    period = $("deletePeriod").value,
    rows = state.details.filter((x) => x.projectCode === state.activeCode && x.period === period);
  if (!p || !rows.length) return;
  if (
    !confirm(
      `確定刪除「${p.code} ${p.name}」的 ${showQuarter(period)}？\n共 ${rows.length} 筆尖峰明細。系統會先下載備份，刪除後可重新匯入。`,
    )
  )
    return;
  downloadProjectPackage(false);
  const now = new Date(),
    batch = {
      id: `D${Date.now()}`,
      type: "delete-quarter",
      projectCode: p.code,
      projectName: p.name,
      period,
      time: now.toLocaleString("zh-TW"),
      timestamp: now.toISOString(),
      files: [],
      addedIds: [],
      previous: structuredClone(rows),
      writtenIds: [],
      added: 0,
      updated: rows.length,
      skipped: 0,
      status: "有效",
    };
  state.details = state.details.filter((x) => !(x.projectCode === p.code && x.period === period));
  state.imports.unshift(batch);
  rebuild();
  await save();
  inspectHealth();
  toast(`${showQuarter(period)} 已刪除，可重新批次匯入`);
};
/**
 * 合併兩條路段時，把來源路段的速限版本搬到目標路段。
 *
 * 舊版直接 concat，沒有任何重疊檢查。但 speedFor() 挑版本的規則是
 * 「開始季度較新者優先；開始季度相同時，後建立的 id 較大者優先」——
 * 於是來源路段的版本只要開始季度不早於目標路段的，就會蓋過目標路段
 * **原本就有、而且根本不在這次合併範圍內**的紀錄：速限、速限比、服務水準
 * 與查證來源全部跟著換掉。實測目標路段一筆紀錄的 LOS 由 A 變成 D，
 * 而確認對話框只統計來源路段的列數，完全不會提到這件事。
 *
 * 手動新增版本時 saveSpeedVersion() 對重疊是會跳確認的；這條路徑不能比它寬鬆。
 * 因此改為：**目標路段既有的版本優先**，來源路段只帶進「與目標完全不重疊」
 * 的版本，被略過的則回報給呼叫端，由它一併告訴使用者。
 */
function mergeSpeedVersions(state, oldKey, newKey) {
  const incoming = state.speedVersions?.[oldKey];
  if (!incoming || !incoming.length) return { moved: 0, skipped: [] };
  /* ⚠️ 季別索引全站只有一份（los-rule-scope.js），這裡不可以自己再寫一次。 */
  const key = (v) => periodIndex(v);
  const existing = state.speedVersions[newKey] || [];
  const kept = [];
  const skipped = [];
  for (const v of incoming) {
    const overlap = existing.some(
      (e) =>
        key(v.start) <= key(e.end || "9999Q4") &&
        key(e.start) <= key(v.end || "9999Q4"),
    );
    if (overlap) skipped.push(v);
    else kept.push(v);
  }
  if (kept.length) state.speedVersions[newKey] = existing.concat(kept);
  delete state.speedVersions[oldKey];
  return { moved: kept.length, skipped };
}

/*
 * 「這兩個名稱是不是同一條路段」的比對簽章。
 *
 * 這裡要清掉的是**分隔符與標點**——路段名稱寫成「甲路(乙街～丙街)」還是
 * 「甲路(乙街-丙街)」是同一條路，寫法不同只是承辦習慣。
 *
 * 舊版的字元類列了各種連字號的原形（‐‑‒–—―－），卻漏了 ASCII 的 `-`。
 * 但 stripRoadSuffix() 裡的 normalize() 已經先把那六種全部換成 ASCII `-` 了，
 * 於是「-」永遠留著、「～」永遠被清掉，任何「波浪號 vs 連字號」的配對
 * 都算不出相同簽章——而這正是重複路段偵測要抓的最典型情形。
 * 實測某一組平日與假日的真實檔就是差這一個字元，
 *（原本這裡寫著那一組的站號，2026-09-15 拿掉——試用版會把原始碼連同註解
 *   一起內嵌，真實站號不可以跟著交出去。）
 * 結果被當成兩條路段，平假日比較整個不成立，而「名稱疑似重複」始終是 0。
 */
function roadSignature(s) {
  return stripRoadSuffix(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　/\\_\-~～〜‐‑‒–—―－.,，、。:：;；()（）\[\]【】]/g, "");
}
/*
 * ══════════════════════════════════════════════════════════════════
 *  X-49：一筆異常的「解決方式」儲存格（使用者 2026-09-16）
 * ══════════════════════════════════════════════════════════════════
 *
 * 「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
 *   指引前往某分頁進行人工確認等)」
 * 「如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
 *   標註說明請重新匯入該筆檔案」
 *
 * ⚠️ 類別標籤是**期待管理**，不是分類好看用的：
 *   標成「重新匯入」就是明講「一直按檢查也不會消失」；
 *   標成「畫面修正」卻其實改不掉，就是對使用者謊報。
 * ⚠️ 顏色只是輔助，類別的**字**一定要印出來——只靠顏色的話，
 *   色弱的使用者與列印出來的紙本都分不出來。
 * ⚠️ 「檢查結果」與「計畫資料品質總覽」是同一批項目的兩個視圖，
 *   所以共用這一支；各寫一份的話兩張表遲早給出不同的指引。
 */
/**
 * 一筆異常的指紋——「已確認」是記在這把鑰匙上的。
 *
 * ⚠️ 一定要帶 detail。它裡面有數字（「總延滯增加 30.7%」），
 *   所以數字一變指紋就變，上一次的確認**自動失效**、這一筆會重新出現。
 *   少了它，確認過一次之後同一個路段就再也不會提醒，
 *   而使用者完全不知道自己把後來更嚴重的變化按掉了。
 */
function issueFingerprint(issue) {
  /*
   * ⚠️ 用 JSON.stringify 串，不要自己挑一個分隔字元。
   *   挑字元要嘛會出現在路段名稱裡（兩筆不同的異常撞成同一把鑰匙），
   *   要嘛是罕見符號而踩到字型守門（微軟正黑體沒有的字會顯示成空白，
   *   雖然這個字串不會顯示，但守門不分場合——它是對的，不該為它開例外）。
   */
  return JSON.stringify([
    issue.type,
    issue.fromPeriod || "",
    issue.period || "",
    issue.road || "",
    issue.day || "",
    issue.item || "",
    issue.detail || "",
  ]);
}
/** 這個計畫已經確認過的指紋表（唯讀，沒有就回空物件）。 */
function ackMap() {
  return (state.ackedIssues && state.ackedIssues[state.activeCode]) || {};
}
/** 只有「人工確認」類可以按確認——理由見 emptyState 的說明。 */
function issueCanAck(issue) {
  return issue?.resolution?.kind === "人工確認";
}
function issueAcked(issue) {
  return issueCanAck(issue) && Boolean(ackMap()[issueFingerprint(issue)]);
}
/** 按下「已確認」／「取消確認」。 */
async function setIssueAck(fingerprint, on) {
  if (!state.activeCode) return;
  if (!state.ackedIssues) state.ackedIssues = {};
  const own = { ...(state.ackedIssues[state.activeCode] || {}) };
  if (on) own[fingerprint] = { at: new Date().toISOString() };
  else delete own[fingerprint];
  state.ackedIssues = { ...state.ackedIssues, [state.activeCode]: own };
  await save();
  toast(on ? "已記錄為「已確認」，下次檢查不再提醒。" : "已取消確認，這一筆會重新提醒。");
}
const RESOLUTION_KIND_CLASS = {
  重新匯入: "kind-reimport",
  人工確認: "kind-confirm",
  畫面修正: "kind-onscreen",
};
function issueResolutionCell(issue) {
  const r = issue.resolution;
  if (!r)
    /*
     * ⚠️ 不可以留白。漏寫的話畫面上是一個空格子，使用者只會以為
     *   「這一筆沒救」。寧可顯眼地承認漏了。
     */
    return '<td class="resolution-cell"><b class="resolution-kind kind-missing">尚未對應</b><span>這一類異常還沒有對應的處理指引，請回報給計畫主辦。</span></td>';
  return (
    '<td class="resolution-cell"><b class="resolution-kind ' +
    (RESOLUTION_KIND_CLASS[r.kind] || "") +
    '">' +
    esc(r.kind) +
    "</b><span>" +
    esc(r.text) +
    "</span>" +
    (r.view
      ? '<button type="button" class="resolution-goto" data-goto-view="' +
        esc(r.view) +
        '">前往「' +
        esc(r.viewLabel || r.view) +
        '」</button>'
      : "") +
    /*
     * 「已確認」鈕（使用者 2026-09-17）。
     * ⚠️ 只有「人工確認」類有這顆。「重新匯入」是原始檔真的有錯，
     *   給它一顆按掉的鈕，等於提供一個把資料錯誤藏起來的開關。
     */
    (issueCanAck(issue)
      ? '<button type="button" class="resolution-ack' +
        (issueAcked(issue) ? " on" : "") +
        '" data-ack-key="' +
        esc(issueFingerprint(issue)) +
        '" data-ack-on="' +
        (issueAcked(issue) ? "0" : "1") +
        '">' +
        (issueAcked(issue) ? "取消確認" : "已人工確認") +
        "</button>"
      : "") +
    "</td>"
  );
}
/**
 * 「已確認」與「前往…」兩顆鈕都是每次重畫都重建的，所以用事件委派。
 * ⚠️ 綁在 tbody 上、而且只綁一次（dataset 當旗標）——每次重畫都 addEventListener
 *   的話，按一次會跑好幾次，而畫面上完全看不出來。
 */
function bindIssueButtons(body) {
  if (!body || body.dataset.gotoBound) return;
  body.dataset.gotoBound = "1";
  body.addEventListener("click", function (event) {
    const goto = event.target.closest?.("[data-goto-view]");
    if (goto) return gotoView(goto.dataset.gotoView);
    const ack = event.target.closest?.("[data-ack-key]");
    if (ack) void setIssueAck(ack.dataset.ackKey, ack.dataset.ackOn === "1");
  });
}
function inspectHealth() {
  const rows = state.details.filter((x) => x.projectCode === state.activeCode),
    issues = [];
  const roads = [...new Set(rows.map((x) => x.road))];
  for (const road of roads) {
    const clean = stripRoadSuffix(road);
    if (clean !== road)
      issues.push({
        type: "異常名稱",
        period: "全部",
        road,
        item: road,
        detail: `疑似包含日別或日期尾碼，建議修正為「${clean}」`,
        fixable: true,
        resolution: {
          kind: "畫面修正",
          text: `路段名稱後面多了日別或日期尾碼。按「資料維護 → 備份後修正明顯日期尾碼」可以一次改掉（會先下載備份）；名稱比較特殊、自動改不掉的，到「路段管理 → 修改正式名稱」手動改成「${clean}」。改完重按一次檢查就會消失。`,
          view: "roadadmin",
          viewLabel: "路段管理",
        },
      });
  }
  const signatures = {};
  for (const road of roads) (signatures[roadSignature(road)] ??= []).push(road);
  for (const variants of Object.values(signatures)) {
    const names = [...new Set(variants)];
    if (names.length > 1)
      issues.push({
        type: "名稱疑似重複",
        period: "全部",
        item: names.join("／"),
        detail: "標點或分隔符不同，請確認是否為同一路段；可使用「路段名稱修改／合併」。",
        resolution: {
          kind: "畫面修正",
          text: "這幾個名稱只差在標點或分隔符，很可能是同一條路段被拆成好幾條。確認是同一條的話，到「路段管理 → 合併重複路段」把它們合併（合併前會先顯示影響範圍、也會先備份）；確認是不同路段就不必處理，這一項會一直列著。合併之後重按一次檢查就會消失。",
          view: "roadadmin",
          viewLabel: "路段管理",
        },
      });
  }
  // 方向1／方向2 是照報告裡旅次出現的先後決定的。同一個路段若在不同季度、
  // 不同日別的報告裡把兩個方向的順序對調（調查員換方向起跑很常見），
  // 同一個「方向1」就會對應到兩個相反的實際方向，而數字看起來都很正常。
  // 每一列都記著報告上寫的方向文字，這裡拿來互相比對。
  const directionTexts = {};
  for (const d of rows) {
    if (!d.directionText) continue;
    const k = [d.road, d.direction].join("|");
    /*
     * ⚠️ 路段名稱本身可能含有 `|`，所以**不可以**事後 split 回來
     *   （下面 groups 的註解講的是同一個坑）。欄位直接掛在分組上。
     */
    const hit = (directionTexts[k] ??= Object.assign(new Set(), {
      road: d.road,
      direction: d.direction,
    }));
    hit.add(d.directionText);
  }
  for (const set of Object.values(directionTexts))
    if (set.size > 1) {
      const road = set.road;
      const direction = set.direction;
      /*
       * ══════════════════════════════════════════════════════════════
       *  X-41：使用者已經人工確認過的，檢查就要認帳
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-16（附圖，追問兩次）：
       *   「調查員因為寫錯A資料的a路段名稱，在匯入時我已經指定系統，
       *     將a路段併入既有路段中，然後我在路段管理分頁中，
       *     將該路段統一了方向名稱，但做資料異常檢查時，
       *     它仍就把這個方向名稱不一致的問題點出來給我……
       *     變成我一定要去修改原始檔，重新匯入?」
       *
       * 他做的兩件事都**碰不到**這個檢查：
       *   ・「併入既有路段」改的是 `d.road`；
       *   ・「統一方向名稱」改的是 `state.roadMeta` 裡的顯示名稱。
       * 而這裡比對的是 `d.directionText`——**原始報告上寫的那一行字**，
       * 那是從 Excel 讀進來的，兩個動作都不會動到它。
       * 結果就是這一項永遠消不掉，唯一的出路變成「回去改原始檔重匯」——
       * 而原始檔是調查廠商交來的，改了就與交付檔案不一致。
       *
       * ⚠️ 這個檢查本身要保留：它要防的是「調查員換方向起跑，
       *   同一個『方向1』在不同季指向相反方向」，那是真的會出事。
       * ⚠️ 所以改成**給一個人工確認的出口**：使用者在「路段管理 →
       *   方向顯示名稱」替這個方向命過名，就表示他已經看過那幾種寫法、
       *   並且宣告了這個方向是什麼——那就是確認，不再提醒。
       *   （命名之前欄位上顯示的正是原始的方向文字，他是看著它們命名的。）
       */
      /*
       * ⚠️ 判斷依據**只能是「使用者按過儲存」**，不可以用「方向名稱不是預設值」。
       *
       *   `adoptDirectionNames()`（匯入時）會**自動**把報告上的方向文字寫進
       *   roadMeta.directionA／B，所以那兩個欄位幾乎永遠不是「方向1／方向2」。
       *   拿它當「已確認」的依據，等於把整個檢查關掉——
       *   我 2026-09-16 第一版就是這樣寫的，守門當場抓到（應該 2 項卻 0 項）。
       */
      if (roadMeta(road).directionConfirmed) continue;
      issues.push({
        type: "方向對應不一致",
        period: "全部",
        item: `${road}／${direction}`,
        detail: `不同報告把這個方向寫成：${[...set].join("、")}。請確認各季報告的旅次順序是否一致，否則跨季比較會拿相反方向互比。`,
        resolution: {
          kind: "人工確認",
          text: "這一項不是叫你改原始檔。請比對上面列出的那幾種寫法，確認各季報告的旅次順序是同一個方向之後，到「路段管理 → 方向顯示名稱」替這個方向命名並按儲存——命名本身就是人工確認，儲存後重按檢查就會消失。⚠️ 如果確認出來兩季真的是相反方向，那就要回去修正原始檔並重新匯入，否則跨季比較會拿相反方向互比。",
          view: "roadadmin",
          viewLabel: "路段管理",
        },
      });
    }
  // 分組的 key 用 | 串接，但還原欄位時不能再 split 回來——路段名稱本身可能
  // 含有 |，切出來的片段會變成錯誤的路段／日別，而那些值現在會進到篩選的
  // 下拉選單裡。改成把欄位直接掛在分組上。
  const groups = {};
  for (const d of rows) {
    const k = [d.period, d.road, d.day].join("|");
    (groups[k] ??= Object.assign([], { period: d.period, road: d.road, day: d.day })).push(d);
    if (!(
      Number(d.travel) > 0 &&
      Number(d.running) > 0 &&
      Number(d.totalDelay) >= 0 &&
      Number(d.limit) > 0
    ))
      issues.push({
        type: "數值異常",
        period: d.period,
        road: d.road,
        day: d.day,
        peak: d.peak,
        item: `${d.road}／${d.day}／${d.peak}／${rowDirectionName(d)}`,
        detail: "旅行速率、行駛速率、總延滯或速限包含空白、零值或無效數值。",
        resolution: {
          kind: "重新匯入",
          text: "本系統不提供逐格改值，也不會把空白當成 0。請到「尖峰明細」找到這一筆、比對原始報告是哪一欄空了或寫成 0，在原始檔補上正確數值後，把該季重新匯入（同季重匯會覆蓋）。⚠️ 只在畫面上操作不會讓這一項消失。",
          view: "detail",
          viewLabel: "尖峰明細",
        },
      });
    /*
     * 物理常識：旅行速率一定 ≦ 行駛速率（旅行速率含停等時間，行駛速率不含）。
     * 這個檢查本來只在匯入預覽時做，但備份／專案包還原是直接把資料塞進
     * state，完全不經過那條路徑——還原進來的不合理資料因此永遠不會被發現，
     * 還會被選為彙總的代表紀錄。
     */
    if (
      Number(d.travel) > 0 &&
      Number(d.running) > 0 &&
      Number(d.travel) > Number(d.running)
    )
      issues.push({
        type: "數值異常",
        period: d.period,
        road: d.road,
        day: d.day,
        peak: d.peak,
        item: `${d.road}／${d.day}／${d.peak}／${rowDirectionName(d)}`,
        detail: `旅行速率 ${fmt(d.travel, 1)} km/h 大於行駛速率 ${fmt(d.running, 1)} km/h，物理上不可能（旅行速率含停等時間）。常見原因是讀到隔壁欄位，請核對原始報告。`,
        resolution: {
          kind: "重新匯入",
          text: "常見原因是原始報告的欄位錯位（讀到隔壁欄），或兩欄填反了。請核對原始報告的「旅行速率」與「行駛速率」兩欄，更正後把該季重新匯入。⚠️ 系統不會自行把兩個值對調——那等於替調查資料做決定。",
          view: "import",
          viewLabel: "尖峰批次匯入",
        },
      });
  }
  for (const g of Object.values(groups))
    if (g.length !== 4)
      issues.push({
        type: "資料組不完整",
        period: g.period,
        road: g.road,
        day: g.day,
        item: `${g.road}／${g.day}`,
        detail: `應有4筆尖峰方向資料，目前為 ${g.length} 筆。`,
        resolution: {
          kind: "重新匯入",
          text: "一個路段一個日別應該有 4 筆（上午／下午 × 兩個方向）。少了代表原始檔缺那幾筆，多了代表同一筆被匯進來兩次。請確認原始報告後把該季重新匯入（同季重匯會整季覆蓋，不會疊加）。",
          view: "import",
          viewLabel: "尖峰批次匯入",
        },
      });
  const periods = projectPeriods(),
    dayGroups = {};
  for (const d of rows)
    (dayGroups[`${d.period}|${stripRoadSuffix(d.road)}`] ??= new Set()).add(d.day);
  for (const period of periods)
    for (const road of roads) {
      const days = dayGroups[`${period}|${stripRoadSuffix(road)}`] || new Set();
      /*
       * ⚠️ 這一季這條路段**完全沒有資料**就跳過，不算「日別不完整」。
       *
       * 使用者 2026-09-15 定案：「沒匯入＝沒資料……可能是整個停止監測，
       *   也可能是暫時停止監測幾季……程式直接以有沒匯入去判斷就好」。
       *
       * ⚠️ 這一行**不可以拿掉**。這個迴圈是「全部季度 × 全部路段」的交叉組合，
       *   拿掉之後，一個分階段施工的計畫（開工前調查 100 條、第一階段只調查
       *   其中 80 條）會在第一階段的每一季各冒出 20 條假警報——
       *   而假警報一多就沒有人會看，真的漏匯時也不會有人發現。
       *   舊版是用「路段有效期間」擋掉這些組合的，那個功能已於 2026-09-15
       *   整組移除，改由這一行負責。
       *
       * ⚠️ 真正該報的只有一種：**這一季有匯，但只匯了其中一種日別**。
       *   那是明確的「漏了一半」，而不是「這一季沒有調查這條路」。
       *   至於「前一季有、這一季整條都沒有」由匯入預覽的
       *   「與前一季差異檢查 → 前季有、本季未出現」負責。
       */
      if (!days.size) continue;
      if (!days.has("平日") || !days.has("假日"))
        issues.push({
          type: "日別不完整",
          period,
          road,
          item: road,
          detail: `目前只有 ${[...days].join("、")}，請確認本季是否漏匯另一種日別的檔案。`,
          resolution: {
            kind: "重新匯入",
            text: "這一季這條路段只匯到一種日別。請確認調查廠商是否有交另一種日別的報告：有的話補匯那一份即可（不必重匯已經進來的那一份）；如果本季本來就只調查一種日別，這一項會一直列著，屬正常，請在報告中註明。",
            view: "import",
            viewLabel: "尖峰批次匯入",
          },
        });
    }
  // 這裡同樣不能 split 回來取欄位，改為連同原始欄位一起記著。
  const limitKeys = new Map();
  for (const d of rows)
    limitKeys.set(`${d.projectCode}|${d.road}|${d.direction}`, {
      road: d.road,
      direction: d.direction,
    });
  for (const [key, meta] of limitKeys)
    if (!state.limitConfirmed[key])
      issues.push({
        type: "速限未確認",
        period: "全部",
        road: meta.road,
        item: `${meta.road}／${directionNameFor(meta.road, meta.direction)}`,
        detail: `目前使用預設 ${state.limits[key] || 50} km/h，請至「路段速限」人工核對後按套用。`,
        resolution: {
          kind: "人工確認",
          text: "這不是錯，是還沒有人簽過名。到「路段速限」核對公告速限後按「套用並重算 LOS」即可；⚠️ 就算公告速限剛好等於預設的 50 km/h，也要按一次套用——「值沒改」與「沒確認過」是兩件事。按完重按檢查就會消失。",
          view: "speed",
          viewLabel: "路段速限",
        },
      });
  for (const road of roads)
    for (const day of ["平日", "假日"]) {
      const seq = state.summaries
        .filter((x) => x.projectCode === state.activeCode && x.road === road && x.day === day)
        .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1],
          now = seq[i],
          drop = (losRank[prev.los] || 0) - (losRank[now.los] || 0),
          speedChange = prev.travel ? Math.abs(now.travel - prev.travel) / prev.travel : 0;
        if (drop >= 2 || speedChange >= 0.25)
          issues.push({
            type: "異常變化",
            // 異常變化是「相鄰兩季之間」的比較，兩端都要記著，
            // 季度區間篩選才能用「比較區間有重疊就列出」的語意。
            fromPeriod: prev.period,
            period: now.period,
            road,
            day,
            item: `${road}／${day}`,
            detail: `相較 ${showQuarter(prev.period)}：LOS ${prev.los}→${now.los}，旅行速率 ${fmt(prev.travel, 1)}→${fmt(now.travel, 1)} km/h，請確認資料或現地變化。`,
            resolution: {
              kind: "人工確認",
              text: "這是提醒，不是判定資料有錯。請到「尖峰彙總」比對這兩季的數字：確實有現地變化（施工、號誌改時制、路型改變）就在報告中說明，確認後可按下方的「已確認」，下次檢查就不再提醒；若判斷是資料有誤，才回原始檔更正並重新匯入該季。門檻可在「異常提醒門檻」調整。",
              view: "summary",
              viewLabel: "尖峰彙總",
            },
          });
      }
    }
  healthIssues = issues;
  healthChecked = true;
  healthStale = false;
  renderHealth();
  return issues;
}
function renderHealth() {
  const counts = (t) => healthIssues.filter((x) => x.type === t).length;
  $("healthNames").textContent = counts("異常名稱") + counts("名稱疑似重複");
  $("healthGroups").textContent = counts("資料組不完整") + counts("日別不完整");
  $("healthValues").textContent = counts("數值異常");
  /*
   * 沒檢查過就不能說「檢查通過」。品質總覽已經有這道守衛，這一格漏了：
   * 一開啟頁面（完全沒有資料時）就顯示「檢查通過，未發現異常」。
   * 檢查完之後資料又變動過的話，也要標示結果是舊的。
   */
  /*
   * ⚠️ 兩個數字都要寫出來。只寫「需確認 N 項」的話，按過確認的人
   *   會以為那幾筆消失了；只寫總數的話，又看不出還有幾筆要處理。
   */
  const ackedCount = healthIssues.filter(issueAcked).length;
  const openCount = healthIssues.length - ackedCount;
  $("healthCount").textContent = !healthChecked
    ? "尚未檢查"
    : (healthIssues.length
        ? healthFilterTypes.length
          ? `顯示 ${healthIssues.filter((x) => healthFilterTypes.includes(x.type)).length} / 共 ${healthIssues.length} 項（已篩選：${healthFilterTypes.join("、")}）`
          : ackedCount
            ? `${openCount} 項需確認、${ackedCount} 項已確認`
            : `發現 ${healthIssues.length} 項需確認`
        : "檢查通過，未發現異常") +
      (healthStale ? "（資料已變動，請重新檢查）" : "");
  $("healthCount").classList.toggle("stale", healthChecked && healthStale);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  類型標籤篩選（與「計畫資料品質總覽」同一套）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-13：
   *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的異常先挑出來看**哪幾筆，
   *     也不會因為筆數太多而沒注意到細節……針對**需要使用者確認的表**，
   *     都可以套用這種列表＋篩選的模式。」
   *
   * ⚠️ 這張表本來就有「類型」欄，卻沒有任何篩選——類型一多（實測 8 種）
   *   就只能整片看過去。隔壁的品質總覽早就有標籤篩選，同一頁兩張表兩種待遇。
   * ⚠️ 標籤的**筆數加總必須等於全列時的列數**，否則使用者會以為某一類被吃掉了。
   */
  const healthTypes = [...new Set(healthIssues.map((x) => x.type))];
  healthFilterTypes = healthFilterTypes.filter((t) => healthTypes.includes(t));
  const healthChips = $("healthTypeChips");
  if (healthChips) {
    /*
     * 重畫會把鍵盤焦點打掉（與品質總覽同一個坑）：記住焦點在哪一顆，重畫後放回去。
     */
    const focused = document.activeElement?.closest?.("#healthTypeChips .anomaly-chip")
      ?.dataset?.type;
    const focusedClear = document.activeElement?.id === "healthClear";
    healthChips.innerHTML = !healthChecked || !healthIssues.length
      ? ""
      : healthTypes
          .map(function (type) {
            const count = healthIssues.filter((x) => x.type === type).length;
            const on = healthFilterTypes.includes(type);
            return `<button type="button" class="anomaly-chip${on ? " on" : ""}" aria-pressed="${on}" data-type="${esc(type)}">${esc(type)}（${count}）</button>`;
          })
          .join("") +
        (healthFilterTypes.length
          ? '<button type="button" class="anomaly-chip clear" id="healthClear">清除篩選</button>'
          : "");
    /*
     * 「已確認」的開關也放在標籤列上——那是使用者找篩選的地方。
     * ⚠️ 只有真的有已確認的項目時才出現；一顆永遠寫著「0」的開關是噪音。
     */
    if (healthChecked && healthIssues.some(issueAcked))
      healthChips.innerHTML +=
        '<button type="button" class="anomaly-chip ack-toggle' +
        (healthShowAcked ? " on" : "") +
        '" aria-pressed="' +
        (healthShowAcked ? "true" : "false") +
        '" id="healthAckToggle">' +
        (healthShowAcked ? "隱藏已確認" : "顯示已確認") +
        "（" +
        healthIssues.filter(issueAcked).length +
        "）</button>";
    if (focused)
      healthChips
        .querySelector(`.anomaly-chip[data-type="${CSS.escape(focused)}"]`)
        ?.focus();
    else if (focusedClear) $("healthClear")?.focus();
  }
  /*
   * ── 已確認的那幾筆不列在主清單裡（使用者 2026-09-17）────────────
   *
   * ⚠️ 不是「刪掉」，是「收起來」：下面另有一行寫出有幾筆已確認，
   *   而且可以展開、可以取消確認。整個藏掉的話，使用者按完就再也
   *   找不到自己按過什麼——而那幾筆仍然會出現在交付檔案裡。
   */
  const healthAcked = healthIssues.filter(issueAcked);
  const healthOpen = healthIssues.filter((x) => !issueAcked(x));
  const healthPool = healthShowAcked ? healthIssues : healthOpen;
  const healthShown = healthFilterTypes.length
    ? healthPool.filter((x) => healthFilterTypes.includes(x.type))
    : healthPool;
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-49：「解決方式」欄（使用者 2026-09-16）
   * ══════════════════════════════════════════════════════════════════
   *
   * 「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
   *   指引前往某分頁進行人工確認等)」
   * 「如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
   *   標註說明請重新匯入該筆檔案」
   *
   * ⚠️ 類別標籤（重新匯入／人工確認／畫面修正）是**期待管理**，
   *   不是分類好看用的：標成「重新匯入」就是明講「一直按檢查也不會消失」。
   *   標成「畫面修正」卻其實改不掉，就是對使用者謊報。
   * ⚠️ 顏色只是輔助，類別的**字**本身一定要印出來——只靠顏色的話，
   *   色弱的使用者與列印出來的紙本都分不出來。
   */
  const resolutionCell = issueResolutionCell;
  $("healthRows").innerHTML = !healthChecked
    ? '<tr><td colspan="5" class="empty">按「執行資料異常檢查」開始</td></tr>'
    : healthIssues.length
      ? healthShown.length
        ? healthShown
            .map(
              (x) =>
                `<tr${issueAcked(x) ? ' class="issue-acked"' : ""}><td>${esc(x.type)}</td><td>${esc(showQuarter(x.period))}</td><td>${esc(x.item)}</td><td>${esc(x.detail)}</td>${resolutionCell(x)}</tr>`,
            )
            .join("")
        : '<tr><td colspan="5" class="empty">目前的類型篩選沒有符合的項目，請清除篩選</td></tr>'
      : '<tr><td colspan="5" class="empty">目前計畫未發現資料異常</td></tr>';
  /* 「前往…」與「已確認」都是每次重畫都會重建的按鈕，用事件委派。 */
  bindIssueButtons($("healthRows"));
  $("cleanSuffix").disabled = !healthIssues.some((x) => x.fixable);
  renderQuality();
}
/*
 * 品質總覽的篩選條件。
 *
 * 季度一累積，這張表就會長到幾十上百列，整片文字看不出重點。使用者要問的
 * 通常是「114Q1 到 114Q4 之間出過哪些異常」或「只看異常變化」，所以提供
 * 季度區間、類型（可複選）、路段、日別、尖峰五種篩選。
 *
 * 兩個刻意的設計：
 * 1. 篩選只影響「畫面」。匯出與交付的專案包一律含全部項目——篩選是給人看
 *    的工具，交付檔案不該因為畫面上剛好篩了什麼而少東西。
 * 2. 季度區間用「比較區間有重疊就列出」：異常變化是相鄰兩季相比，若只比對
 *    後面那一季，選 114Q1～114Q4 就會漏掉 113Q4→114Q1 這一筆，而那正是
 *    114Q1 出問題的原因。
 */
/** 「檢查結果」目前篩選的類型（空陣列＝全列）。 */
let healthFilterTypes = [];
/** 「檢查結果」要不要把已確認的那幾筆一起列出來。 */
let healthShowAcked = false;
/** 「計畫資料品質總覽」要不要把已確認的那幾筆一起列出來。 */
let qualityShowAcked = false;
const QUALITY_TYPES = ["日別不完整", "資料組不完整", "速限未確認", "異常變化"];
/*
 * ⚠️ from／to／road／day 現在是**主工具列的鏡子**（在這裡改只影響這一塊）；
 *   types（異常類型）留在這裡，它是這一塊自己的東西，
 *   主工具列上沒有這個條件，也不該有。
 */
const qualityFilter = { types: [] };
/** 這一塊目前的季度區間／路段／日別（主工具列，或它自己脫離後的值）。 */
function qualityScope() {
  const f = MT.filtersOf(MT.CHART_IDS.quality);
  /* ⚠️ 同上：要問的是「有沒有比全部季度窄」，不是「跟預設值一不一樣」。 */
  const ranged = MT.isPeriodNarrowed(MT.CHART_IDS.quality, mainToolbarPeriods());
  return {
    from: ranged ? f.periodFrom : "",
    to: ranged ? f.periodTo : "",
    road: (f.roads || []).length === 1 ? f.roads[0] : "",
    day: f.day === "weekday" ? "平日" : f.day === "holiday" ? "假日" : "",
    types: qualityFilter.types,
    filters: f,
  };
}
/**
 * 使用者是否自己動過匯入的年度／季度欄位。
 * 動過之後，renderAll 就不再把它改回「上次匯入的季度」。
 */
let importPeriodTouched = false;
/** 已經跑過資料異常檢查了嗎。沒跑過時不能宣稱「四項品質檢查均通過」。 */
let healthChecked = false;
/** 檢查完之後資料又變動過了嗎。是的話畫面上的結果是舊的，要講出來。 */
let healthStale = false;
/**
 * 這一筆異常涵蓋的季度區間；與季度無關的項目回 null（任何區間都列出）。
 * periodIndex 對無法解析的字串會回 -1，那個 -1 若被當成真正的季度，
 * 會讓區間變成「幾乎涵蓋全部」，使用者以為篩掉了舊季度其實沒有。
 */
function issueSpan(issue) {
  if (!issue.period || issue.period === "全部") return null;
  const end = periodIndex(issue.period);
  if (end < 0) return null;
  const start = issue.fromPeriod ? periodIndex(issue.fromPeriod) : end;
  const safeStart = start < 0 ? end : start;
  return { start: Math.min(safeStart, end), end: Math.max(safeStart, end) };
}
function filterQualityIssues(issues, filter) {
  // 無法解析的季度字串（手改過的備份可能出現 114Q9）不能當成邊界：
  // periodIndex 會回 -1，等於把下界拿掉。
  const fromIndex = filter.from ? periodIndex(filter.from) : -Infinity;
  const toIndex = filter.to ? periodIndex(filter.to) : Infinity;
  const from = fromIndex < 0 ? -Infinity : fromIndex;
  const to = toIndex < 0 ? Infinity : toIndex;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return issues.filter((issue) => {
    if (filter.types.length && !filter.types.includes(issue.type)) return false;
    /*
     * 路段與日別採用與季度相同的規則：「與這個維度無關的項目，任何選擇都列出」。
     *
     * 舊寫法是 issue.day !== filter.day，於是沒有日別欄位的項目（速限未確認、
     * 日別不完整）一選日別就整批消失——而「日別不完整」講的正是日別缺漏，
     * 被日別篩選藏起來完全說不通。路段同理，且日後若把「名稱疑似重複」
     * 這類沒有單一路段的項目納進來，也不會默默消失。
     */
    if (filter.road && issue.road && issue.road !== filter.road) return false;
    if (filter.day && issue.day && issue.day !== filter.day) return false;
    const span = issueSpan(issue);
    // 與季度無關的項目（名稱、速限）在任何區間都要看得到。
    if (!span) return true;
    return span.end >= lo && span.start <= hi;
  });
}
/** 品質總覽上要掛的提示。 */
function renderQualityNotes() {
  const host = document.getElementById("qualityNotes");
  if (!host) return;
  const f = MT.filtersOf(MT.CHART_IDS.quality);
  host.innerHTML =
    detachNoteHtml(MT.CHART_IDS.quality) +
    /*
     * ⚠️ 這一張檢查的是「每一組資料是否完整（4 筆一組）」，
     *   所以方向與尖峰對它不適用——先篩掉一半再檢查「有沒有 4 筆」，
     *   一定每一組都被判成缺漏，那是製造假警報。
     */
    inapplicableHtml(
      MF.isFiltered(f, "direction") || MF.isFiltered(f, "peak"),
      MF.inapplicableNote(
        "本表檢查的是每一組資料是否完整（上午／下午 × 方向1／方向2 共 4 筆），不分方向與尖峰；先篩掉一半再檢查會讓每一組都被判成缺漏。",
        "全部方向與尖峰",
      ),
    ) +
    inapplicableHtml(
      (f.roads || []).length > 1,
      MF.inapplicableNote(
        "本表的路段篩選是單選，接不住主工具列的多選（" +
          (f.roads || []).length +
          " 條）。",
        "全部路段",
      ),
    ) +
    /*
     * ⚠️ 這一張的篩選規則和別處不同：**與某個維度無關的項目，任何選擇都會列出**
     *   （例如「速限未確認」沒有日別，選了平日它照樣在）。
     *   所以篩了之後項目數可能一格都沒變——那是規則，不是漏篩。
     *   只在真的篩了的時候講這一句。
     */
    inapplicableHtml(
      MT.isPeriodNarrowed(MT.CHART_IDS.quality, mainToolbarPeriods()) ||
        MF.isFiltered(f, "roads") ||
        MF.isFiltered(f, "day"),
      "本表的篩選規則是「與該維度無關的項目，任何選擇都會列出」——例如「速限未確認」沒有日別，選了平日它照樣會列出來。所以篩了之後項目數可能沒有變，那是規則，不是漏篩。",
    );
}
function renderQuality() {
  if (!$("qualityRows")) return;
  const all = healthIssues.filter((x) => QUALITY_TYPES.includes(x.type));
  // 上方四個數字報的是「全部」，不隨篩選變動——那是這一季的體檢結果，
  // 不是目前畫面看了幾筆。筆數變化在下面的「顯示 N / 共 M」講。
  $("qualityDay").textContent = all.filter((x) => x.type === "日別不完整").length;
  $("qualityGroup").textContent = all.filter((x) => x.type === "資料組不完整").length;
  $("qualitySpeed").textContent = all.filter((x) => x.type === "速限未確認").length;
  $("qualityChange").textContent = all.filter((x) => x.type === "異常變化").length;
  /*
   * 季度下拉要列「這個計畫有哪些季度」，不是「哪些季度已經出過異常」。
   * 用後者的話，4 季資料只有一筆異常時下拉就只剩那一季，使用者根本沒辦法
   * 表達「114Q1 到 114Q4」這個問題——而那正是這個功能要回答的問題。
   */
  const periods = projectPeriods().filter(validPeriod);
  const roads = [...new Set(all.map((x) => x.road).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );
  /*
   * label 只換看到的文字（季別要跟著年份顯示切換走）；value 一律是儲存值，
   * 否則切成西元年之後，既有的篩選條件會對不到任何一筆資料。
   */
  const fillSelect = (id, values, placeholder, current, label = (v) => v) => {
    const el = $(id);
    if (!el) return "";
    const keep = values.includes(current) ? current : "";
    el.innerHTML =
      `<option value="">${placeholder}</option>` +
      values
        .map(
          (v) =>
            `<option value="${esc(v)}"${v === keep ? " selected" : ""}>${esc(label(v))}</option>`,
        )
        .join("");
    return keep;
  };
  const scope = qualityScope();
  fillSelect("qualityFrom", periods, "不限", scope.from, showQuarter);
  fillSelect("qualityTo", periods, "不限", scope.to, showQuarter);
  fillSelect("qualityRoad", roads, "全部路段", scope.road);
  if ($("qualityDayFilter")) $("qualityDayFilter").value = scope.day;
  renderQualityNotes();
  /*
   * 重畫按鈕會把焦點打掉：使用者用鍵盤按下一個類型鈕之後，該按鈕在事件處理
   * 過程中就被 innerHTML 換掉了，activeElement 掉回 body，第二下 Enter 沒有
   * 任何反應，得從頁首重新 Tab 一次。所以記住焦點在哪一顆，重畫後放回去。
   */
  const focusedType = document.activeElement?.closest?.(".anomaly-chip")?.dataset?.type;
  const focusedClear = document.activeElement?.id === "qualityClear";
  const chips = $("qualityTypeChips");
  if (chips) {
    chips.innerHTML =
      QUALITY_TYPES.map((type) => {
        const count = all.filter((x) => x.type === type).length;
        const on = qualityFilter.types.includes(type);
        return `<button type="button" class="anomaly-chip${on ? " on" : ""}" aria-pressed="${on}" data-type="${esc(type)}">${esc(type)}（${count}）</button>`;
      }).join("") +
      `<button type="button" class="anomaly-chip clear" id="qualityClear">清除篩選</button>` +
      /* 只有真的有已確認的項目時才出現這一顆——永遠寫著 0 的開關是噪音。 */
      (all.some(issueAcked)
        ? `<button type="button" class="anomaly-chip ack-toggle${qualityShowAcked ? " on" : ""}" aria-pressed="${qualityShowAcked}" id="qualityAckToggle">${qualityShowAcked ? "隱藏已確認" : "顯示已確認"}（${all.filter(issueAcked).length}）</button>`
        : "");
    if (focusedType)
      chips.querySelector(`.anomaly-chip[data-type="${CSS.escape(focusedType)}"]`)?.focus();
    else if (focusedClear) $("qualityClear")?.focus();
  }
  /*
   * ── 已確認的那幾筆預設收起來（與「檢查結果」同一套規則）──────────
   *   ⚠️ 上面四個數字**刻意不扣**：那是這一季的體檢結果，
   *     不是「還剩幾筆要處理」。扣掉的話，按過確認就等於把體檢結果改小了。
   */
  const ackedAll = all.filter(issueAcked);
  const pool = qualityShowAcked ? all : all.filter((x) => !issueAcked(x));
  const rows = filterQualityIssues(pool, scope);
  const countEl = $("qualityShown");
  if (countEl) {
    const base = !healthChecked
      ? "尚未檢查"
      : ackedAll.length
        ? `顯示 ${rows.length} / 共 ${all.length} 項（其中 ${ackedAll.length} 項已確認）`
        : rows.length === all.length
          ? `共 ${all.length} 項`
          : `顯示 ${rows.length} / 共 ${all.length} 項`;
    countEl.textContent =
      healthChecked && healthStale ? `${base}（資料已變動，請重新檢查）` : base;
    countEl.classList.toggle("stale", healthChecked && healthStale);
  }
  // 還沒按過「執行資料異常檢查」時不能寫「四項品質檢查均通過」——那是把
  //「沒檢查」講成「檢查過而且沒問題」，是這張表最不該出的錯。
  $("qualityRows").innerHTML = !healthChecked
    ? '<tr><td colspan="5" class="empty">按「執行資料異常檢查」產生品質總覽</td></tr>'
    : rows.length
      ? rows
          .map(
            (x) =>
              `<tr${issueAcked(x) ? ' class="issue-acked"' : ""}><td>${esc(x.type)}</td><td>${esc(x.fromPeriod ? `${showQuarter(x.fromPeriod)}→${showQuarter(x.period)}` : showQuarter(x.period))}</td><td>${esc(x.item)}</td><td>${esc(x.detail)}</td>${issueResolutionCell(x)}</tr>`,
          )
          .join("")
      : all.length
        ? '<tr><td colspan="5" class="empty">目前篩選條件下沒有符合的項目，請放寬季度區間或類型。</td></tr>'
        : '<tr><td colspan="5" class="empty">目前四項品質檢查均通過</td></tr>';
  /* 「前往…」與「已確認」每次重畫都會重建，所以用事件委派綁在 tbody 上。 */
  bindIssueButtons($("qualityRows"));
}
/* 篩選事件用委派綁在整個面板上：下拉選單與類型鈕都是每次 render 重畫的。 */
qualityPanel.addEventListener("change", (e) => {
  const map = {
    qualityFrom: "from",
    qualityTo: "to",
    qualityRoad: "road",
    qualityDayFilter: "day",
  };
  const key = map[e.target.id];
  if (!key) return;
  /*
   * ⚠️ 寫進 chartOverrides（只影響這一塊），不再是一份獨立的區域狀態。
   *   區域狀態的話它永遠不跟主工具列走，而主工具列改了季度這一塊不動、
   *   畫面上也沒有任何字說明。
   */
  const value = e.target.value;
  const scope = qualityScope();
  const periods = mainToolbarPeriods();
  if (key === "road")
    MT.setChart(MT.CHART_IDS.quality, "roads", value ? [value] : []);
  else if (key === "day")
    MT.setChart(
      MT.CHART_IDS.quality,
      "day",
      value === "平日" ? "weekday" : value === "假日" ? "holiday" : "all",
    );
  else {
    const from =
      key === "from"
        ? value || periods[0] || ""
        : scope.from || periods[0] || "";
    const to =
      key === "to"
        ? value || periods[periods.length - 1] || ""
        : scope.to || periods[periods.length - 1] || "";
    MT.setChart(MT.CHART_IDS.quality, "periodFrom", from);
    MT.setChart(MT.CHART_IDS.quality, "periodTo", to);
  }
});
qualityPanel.addEventListener("click", (e) => {
  const chip = e.target.closest(".anomaly-chip");
  if (!chip) return;
  if (chip.id === "qualityAckToggle") qualityShowAcked = !qualityShowAcked;
  else if (chip.id === "qualityClear") {
    /* 「清除篩選」＝ 回到主工具列條件 ＋ 清掉類型。 */
    qualityFilter.types = [];
    MT.resetChart(MT.CHART_IDS.quality);
  } else {
    const type = chip.dataset.type;
    qualityFilter.types = qualityFilter.types.includes(type)
      ? qualityFilter.types.filter((x) => x !== type)
      : [...qualityFilter.types, type];
  }
  renderQuality();
});
/*
 * 「檢查結果」的類型標籤：點一下切換、可多選；「清除篩選」全部放掉。
 * ⚠️ 用事件委派掛在面板上，因為標籤本身每次重畫都會被換掉——
 *   直接掛在按鈕上的話，重畫一次就失效了（品質總覽已經踩過這個坑）。
 */
document
  .querySelector("#maintenance .health-panel")
  ?.addEventListener("click", (e) => {
    const chip = e.target.closest(".anomaly-chip");
    if (!chip) return;
    if (chip.id === "healthAckToggle") healthShowAcked = !healthShowAcked;
    else if (chip.id === "healthClear") healthFilterTypes = [];
    else {
      const type = chip.dataset.type;
      healthFilterTypes = healthFilterTypes.includes(type)
        ? healthFilterTypes.filter((x) => x !== type)
        : [...healthFilterTypes, type];
    }
    renderHealth();
  });
$("runHealth").onclick = () => {
  inspectHealth();
  /*
   * ⚠️ 已確認的那幾筆要從「需確認」的數字裡扣掉，否則按過確認之後
   *   這一句仍然報同一個數字，使用者會以為確認沒有生效。
   */
  const acked = healthIssues.filter(issueAcked).length;
  const open = healthIssues.length - acked;
  toast(
    healthIssues.length
      ? acked
        ? `資料異常檢查完成：${open} 項需確認、${acked} 項已確認`
        : `資料異常檢查完成：${healthIssues.length} 項需確認`
      : "資料異常檢查通過",
  );
  /*
   * 按鈕在頁首，「檢查結果」表格在兩張卡片下面。實測（視窗高 900px）
   * 結果面板的頂端在 1865px——按下去畫面完全沒動，看起來就像沒反應。
   */
  revealResult(document.querySelector(".health-panel"));
};
$("cleanSuffix").onclick = async () => {
  const p = activeProject(),
    targets = new Map(
      healthIssues.filter((x) => x.fixable).map((x) => [x.item, stripRoadSuffix(x.item)]),
    );
  if (!p || !targets.size) return;
  if (
    !confirm(
      `確定修正 ${targets.size} 個含日期尾碼的路段名稱？\n系統會先下載 Project 備份，再合併明細、彙總與速限。`,
    )
  )
    return;
  downloadProjectPackage(false);
  const cleanFirst = state.details.filter((x) => x.projectCode !== p.code || !targets.has(x.road)),
    dirty = state.details.filter((x) => x.projectCode === p.code && targets.has(x.road)),
    map = new Map(cleanFirst.map((x) => [x.id, x]));
  let dropped = 0;
  /* 同 applyRoadChange：與目標路段既有版本重疊而未併入的速限版本要講出來。 */
  const skippedVersions = [];
  for (const d of dirty) {
    const old = d.road,
      target = targets.get(old);
    state.aliases[`${p.code}|${old}`] = target;
    const oldLimit = `${p.code}|${old}|${d.direction}`,
      newLimit = `${p.code}|${target}|${d.direction}`;
    if (!state.limits[newLimit]) state.limits[newLimit] = state.limits[oldLimit] || d.limit;
    if (state.limitConfirmed[oldLimit]) state.limitConfirmed[newLimit] = true;
    delete state.limits[oldLimit];
    delete state.limitConfirmed[oldLimit];
    // 速限版本一併搬過去（同 applyRoadChange）
    const versionMerge = mergeSpeedVersions(state, oldLimit, newLimit);
    if (versionMerge.skipped.length) skippedVersions.push(...versionMerge.skipped);
    d.road = target;
    d.limit = state.limits[newLimit];
    d.ratio = d.travel == null ? null : d.travel / d.limit;
    d.los = losOf(d.ratio, d.projectCode, d.period, d.road);
    d.id = [d.projectCode, d.year, `Q${d.quarter}`, target, d.day, d.peak, d.direction].join("|");
    // 併到同一個路段之後，鍵值可能撞到既有紀錄。保留既有的那一筆，
    // 但要記下丟掉幾筆——實測 32 筆合併成 16 筆而畫面只說「已修正並合併」，
    // 使用者不會知道有一半的資料被丟掉了（路段管理的合併就有揭露這件事）。
    if (!map.has(d.id)) map.set(d.id, d);
    else dropped += 1;
  }
  state.details = [...map.values()];
  rebuild();
  await save();
  inspectHealth();
  const versionNote = skippedVersions.length
    ? `另有 ${skippedVersions.length} 組速限版本因有效期間與目標路段既有版本重疊而未併入，目標路段維持原本的速限。`
    : "";
  toast(
    (dropped
      ? `明顯日期尾碼已修正並合併；其中 ${dropped} 筆與既有資料鍵值重複，已保留原有資料（合併前的備份已下載）。`
      : "明顯日期尾碼已修正並合併") + versionNote,
  );
};
function renderAll() {
  renderPeriodDisplayToggle();
  renderYearStyleToggle();
  renderMainToolbar();
  const p = activeProject(),
    ownDetails = state.details.filter((x) => x.projectCode === state.activeCode),
    ownSummary = state.summaries.filter((x) => x.projectCode === state.activeCode),
    options = state.projects
      .map(
        (x) =>
          `<option value="${esc(x.code)}" ${x.code === state.activeCode ? "selected" : ""}>${esc(x.code)} ${esc(x.name)}</option>`,
      )
      .join("");
  projectSwitch.innerHTML = options || '<option value="">尚未建立計畫</option>';
  $("projectPicker").innerHTML = '<option value="">＋ 建立新計畫</option>' + options;
  $("projectCode").value = p?.code || "";
  $("projectName").value = p?.name || "";
  $("headProject").textContent = p ? `${p.code} ${p.name}` : "尚未建立計畫";
  renderProjectSetupActions();
  /*
   * ⚠️ 這幾張卡數的是**這個計畫的全部資料**（不分季度、路段、日別），
   *   所以不受主工具列影響。不講的話，使用者在主工具列篩了之後回到首頁，
   *   會以為卡片上的筆數也跟著篩了，然後拿那個數字去對帳。
   */
  const homeNotes = document.getElementById("homeFilterNotes");
  if (homeNotes) {
    const f = MF.normalizeLegacyAll(MT.state.main);
    /*
     * ⚠️ 季度那一項要用 isPeriodNarrowed（比「全部季度」窄才算），
     *   不可以用 isFiltered——2026-09-15 起主工具列的預設值是**實際的
     *   最早一季**（不是空字串），isFiltered 會恆為 true，
     *   於是這一句在什麼都沒篩時也一直掛著（實測 e2e-main-toolbar 的前置轉紅）。
     */
    const anyFiltered =
      MT.isPeriodNarrowed(MT.CHART_IDS.home || "home", mainToolbarPeriods()) ||
      ["roads", "day", "direction", "peak"].some((field) =>
        MF.isFiltered(f, field),
      );
    homeNotes.innerHTML = inapplicableHtml(
      anyFiltered,
      MF.inapplicableNote(
        "首頁這幾張卡數的是這個計畫的全部資料（不分季度、路段、日別、方向與尖峰），它們回答的是「匯了多少、有沒有東西等著處理」。",
        "整個計畫的全部資料",
      ),
    );
  }
  $("mProject").textContent = state.projects.length;
  $("mDetail").textContent = ownDetails.length;
  $("mSummary").textContent = ownSummary.length;
  /* ⚠️ 這一格也要吃「期別顯示／年份顯示」，不可以自己拼字串。 */
  $("mPeriod").textContent = state.last.year
    ? showQuarter(`${state.last.year}Q${state.last.quarter}`)
    : "—";
  $("mTime").textContent = state.last.time || "尚無資料";
  /*
   * 匯入表單只在「使用者還沒自己填過」時才帶入上次的季度。
   *
   * 舊版是每次 renderAll 都無條件覆寫，而每一個 save() 結尾都會呼叫
   * renderAll——於是使用者輸入 116 年第 3 季之後，去別的頁面存個路段名稱
   * 再回來，表單已經悄悄變回 115Q1，接著「確認寫入」就把資料寫進錯誤的
   * 季度。因為是程式指派，change 事件不會觸發，預覽失效的保護也不會啟動。
   */
  if (state.last.year && !importPeriodTouched) {
    $("rocYear").value = state.last.year;
    $("quarter").value = state.last.quarter;
  }
  renderDetails();
  renderSummaries();
  renderLosRules();
  renderBandRule();
  renderRuleShortcut();
  renderLimits();
  renderCharts();
  renderTrendPanel();
  renderBandPanel();
  /* ⚠️ 重畫之後按鈕的包裝會被洗掉，要再補一次（冪等）。 */
  wrapAdjacentButtons();
  renderImportLog();
  refreshMaintenance();
  /* X-85：改名那一格的季度清單也要跟著重建，否則改完之後選單還是舊的。 */
  refreshRenameMaintenance();
  renderHealth();
  if (p && !ownDetails.length) {
    $("nextTitle").textContent = "匯入目前計畫的第一季尖峰資料";
    $("nextText").textContent = "選擇同一季度的平日、假日 Excel，先預覽再寫入。";
    $("nextBtn").onclick = () => gotoView("import");
  } else if (ownDetails.length) {
    $("nextTitle").textContent = "檢查目前計畫的尖峰彙總";
    $("nextText").textContent = "確認旅行速率、行駛速率與總延滯來自同一筆紀錄。";
    $("nextBtn").onclick = () => gotoView("summary");
  } else {
    $("nextTitle").textContent = "建立第一個計畫";
    $("nextText").textContent = "計畫數量不設上限，可持續新增並切換管理。";
    $("nextBtn").onclick = () => gotoView("setup");
  }
}
const renderAllBase = renderAll;
renderAll = () => {
  renderAllBase();
  renderRoadAdmin();
};
load();

/* ══════════════════════════════════════════════════════════════════
 * 歷季趨勢圖（可勾選指標）
 * ══════════════════════════════════════════════════════════════════
 *
 * 設計上的三個硬規則：
 *
 * 一、**圖、說明文字、匯出吃同一份計算。**
 *     資料一律來自 buildTrendSeries()，說明文字由 describeTrendChart()
 *     讀那一份 series 產生。任何一邊自己再算一次，遲早會出現
 *    「圖上 41%、旁邊寫 38%」——那是最難發現的錯。
 *
 * 二、**勾一個＝大圖，勾多個＝小倍數圖。**
 *     不做「大圖／小圖」的切換鈕：勾選數量本身就是使用者的意圖，
 *     多一個鈕就多一個要學的東西，也多一組會壞掉的狀態。
 *
 * 三、**不同單位不畫在同一張圖。**
 *     %、km/h、秒、等級四種單位。硬疊就得畫兩條縱軸，
 *     而雙軸圖是最容易讓人讀錯的做法——同一組資料換個縮放
 *     就能講出相反的故事。所以寧可排成多張小圖。
 */
/*
 * ⚠️ 「指標」留在這裡（它決定**這張圖畫什麼**，不是「看哪一批資料」，
 *   使用者 2026-09-14 同意不放進主工具列）。
 *   路段與日別改成**主工具列的鏡子**：在這裡改只影響這一塊。
 */
var trendState = { metrics: ["congestedShare"] };

/** 這一塊目前的路段與日別（主工具列，或它自己脫離後的值）。 */
function trendScopeState() {
  var f = MT.filtersOf(MT.CHART_IDS.trend);
  return {
    road: (f.roads || []).length === 1 ? f.roads[0] : "ALL",
    day: f.day === "weekday" ? "平日" : f.day === "假日" || f.day === "holiday" ? "假日" : "ALL",
    filters: f,
  };
}

/**
 * 目前計畫、依畫面選擇篩出來的彙總紀錄。趨勢圖與說明共用這一批。
 *
 * ⚠️ 彙總要「先篩再挑最差」，所以這裡從**明細**重算，
 *   不可以拿已經建好的 state.summaries 去篩（那是從全部 4 筆挑出來的）。
 */
function trendSummaryRows() {
  return MT.summariesFor(
    state.details.filter(function (row) {
      return row.projectCode === state.activeCode;
    }),
    MT.CHART_IDS.trend,
    worstOfGroup,
    "range",
  );
}

/**
 * 趨勢圖那兩個下拉（路段、日別）的**選項來源**。
 *
 * ⚠️ X-39／X-40（使用者 2026-09-16，附兩張圖）：
 *   「選擇平日後，選項會剩下平日、平日+假日，假日的選項消失了」
 *   「我選擇單一路段後，篩選也變成只剩下 全路段 和 單一路段」
 *
 *   成因：選單原本從 `trendSummaryRows()` 推，而那一份是**已經篩過**的
 *   （它套用了這一塊的路段與日別條件）。篩完之後其他選項當然不存在了——
 *   使用者被自己的選擇鎖在裡面，只能靠「選回全部」才解得開。
 *
 * ⚠️ 規則（與品質總覽同一套）：**選項清單不受它自己那個維度的條件影響**。
 *   ・路段選單不看路段條件、日別選單不看日別條件；
 *   ・但兩者都吃**季度區間**——縮小季度時，那一季真的沒有的路段不該列出來。
 * ⚠️ 選項來源用明細就夠（只要知道「有哪些路段、有哪些日別」），
 *   不需要走 summariesFor——那一支的工作是挑代表值，跟列選項是兩件事。
 */
function trendOptionSource() {
  var f = MT.filtersOf(MT.CHART_IDS.trend);
  var ranged = MT.isPeriodNarrowed(MT.CHART_IDS.trend, mainToolbarPeriods());
  var from = ranged ? f.periodFrom : "";
  var to = ranged ? f.periodTo : "";
  var lo = from ? periodIndex(from) : -Infinity;
  var hi = to ? periodIndex(to) : Infinity;
  if (lo > hi) {
    var swap = lo;
    lo = hi;
    hi = swap;
  }
  return state.details.filter(function (row) {
    if (row.projectCode !== state.activeCode) return false;
    var index = periodIndex(row.period);
    if (index < 0) return true;
    return index >= lo && index <= hi;
  });
}

function trendRowsForState(day) {
  var scope = trendScopeState();
  var wanted = day === undefined ? scope.day : day;
  return trendSummaryRows().filter(function (row) {
    if (scope.road !== "ALL" && row.road !== scope.road) return false;
    if (wanted !== "ALL" && row.day !== wanted) return false;
    return true;
  });
}

/**
 * 這次要畫哪幾種日別。
 *
 * ⚠️ 「平日＋假日」的意思是**兩種各畫一張、同時顯示**，
 * 不是把兩種混在一起算成一個數字。
 *
 * 混在一起算出來的東西沒有應用意義：平均旅行速率會變成一個
 * 「不對應平日也不對應假日」的速率，壅塞路段佔比會變成兩種日別的
 * 混合比例——業主問「所以平日到底多少」的時候答不出來。
 * 這是使用者明確指出過的坑：「平日+假日 這類條件，指的是同時顯示，
 * 因為這類計算，加總起來沒有應用的意義」。
 */
function trendDaysForState() {
  var scope = trendScopeState();
  if (scope.day !== "ALL") return [scope.day];
  /* 只列出目前真的有資料的日別，避免畫出一張永遠空白的圖。 */
  var found = [];
  trendSummaryRows().forEach(function (row) {
    if (scope.road !== "ALL" && row.road !== scope.road) return;
    if (row.day && found.indexOf(row.day) < 0) found.push(row.day);
  });
  found.sort();
  return found.length ? found : ["平日"];
}

/**
 * 這一塊目前範圍的一行字（圖標題、說明、PNG 與 Excel 檔名共用）。
 *
 * ⚠️ 選了兩個以上路段時**不可以寫「全部路段」**。
 *   trendScopeState().road 把「≥2 條」與「全部」都收成 "ALL"，
 *   那對「要不要一路段一條線」的判斷是對的，但拿來當標題就是說謊：
 *   圖上只畫了選到的那幾條，檔名卻寫「全部路段」，
 *   收到檔案的人會以為那是整個計畫的結果。（2026-09-16 實測抓到）
 */
function trendScopeText(day) {
  var scope = trendScopeState();
  var shown = day === undefined ? scope.day : day;
  var roads = (scope.filters.roads || []);
  var roadText =
    scope.road !== "ALL"
      ? scope.road
      : roads.length
        ? roads.length + " 條路段"
        : "全部路段";
  return (
    roadText +
    "（" +
    (shown === "ALL" ? "平日＋假日" : shown) +
    "）"
  );
}

/** 一張趨勢圖的 SVG。small=true 時畫成小倍數圖用的尺寸。 */
function trendChartSvg(series, small) {
  /*
   * 版面。左邊要留給「縱軸名稱（單位）」那一行直書的字，下面要留給
   * 「季度」那一行——舊版沒有軸名稱，所以邊界比較窄；加上名稱之後
   * 沿用舊邊界會讓名稱壓在刻度字上面。
   */
  var width = small ? 380 : 780;
  var height = small ? 214 : 348;
  var left = small ? 66 : 96;
  /*
   * ⚠️ 多條線時右邊要留給線尾的名稱，否則路段名會被 viewBox 切掉。
   *   （單線時維持原本的邊界，外觀一個像素都不變。）
   */
  var multiLine = Boolean(series.lines && series.lines.length > 1);
  var right = width - (multiLine ? (small ? 104 : 150) : small ? 16 : 30);
  var top = small ? 22 : 34;
  var bottom = height - (small ? 52 : 72);
  var tickSize = 11;
  var axisTitle = axisTitleText(series.label, series.unit);
  /*
   * 等級是序數，不是量。縱軸寫「（級）」會讓人以為 A 到 F 之間可以取
   * 平均，所以名稱後面直接標明是等級刻度。
   */
  /*
   * 序數指標的縱軸名稱寫「（A～F）」，不寫「（等級）」。
   *
   * 「最差服務水準等級（等級）」讀起來重複；「（A～F）」同時做到兩件事：
   * 說明這條軸不是量而是等級，而且直接告訴看圖的人刻度的範圍是什麼。
   */
  if (series.ordinal) axisTitle = series.label + "（A～F）";
  var axisMarkup =
    '<text class="axis-title" transform="translate(' +
    (small ? 15 : 20) +
    "," +
    (top + (bottom - top) / 2) +
    ') rotate(-90)" text-anchor="middle">' +
    esc(axisTitle) +
    "</text>" +
    '<text class="axis-title" x="' +
    (left + (right - left) / 2) +
    '" y="' +
    (height - (small ? 12 : 16)) +
    '" text-anchor="middle">季度</text>';
  /*
   * ══════════════════════════════════════════════════════════════════
   *  一張圖可以有**多條線**（使用者 2026-09-16 指名，三支都適用）
   * ══════════════════════════════════════════════════════════════════
   *
   * `series.lines` 有東西時就畫多條；沒有時把 `series.points` 包成一條，
   * 底下的程式一律走同一條路。**單線的外觀與改版前完全一樣**——
   * 第一個顏色就是原本那個深綠。
   *
   * ⚠️ 每一條線的橫軸**必須是同一組季度**（由呼叫端保證）。
   *   各線各排各的季度的話，同一個 x 會對應到不同的季，
   *   而圖上完全看不出來。
   */
  var seriesLines =
    series.lines && series.lines.length
      ? series.lines
      : [{ label: series.label, points: series.points || [] }];
  var points = seriesLines[0].points || [];
  var values = [];
  seriesLines.forEach(function (line) {
    (line.points || []).forEach(function (point) {
      if (point.value != null) values.push(point.value);
    });
  });
  if (!points.length || !values.length)
    return (
      '<svg viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="沒有資料">' +
      CHART_SVG_STYLE +
      '<text x="' +
      width / 2 +
      '" y="' +
      height / 2 +
      '" text-anchor="middle" class="trend-empty-text">這個條件下沒有可繪製的資料</text></svg>'
    );

  /*
   * 縱軸範圍。
   * 佔比與等級是有天然上下界的，一律用完整範圍畫——這種指標若自動縮放，
   * 「從 12% 到 14%」會被畫成一條陡峭上升的線，看起來像災難。
   * 速率、延滯沒有天然上界，才用資料範圍加留白。
   */
  var min;
  var max;
  var tickDigits = 0;
  var gridCount = small ? 2 : 4;
  if (series.unit === "%") {
    min = 0;
    max = 100;
  } else if (series.ordinal) {
    min = 0;
    max = 5;
    /*
     * ⚠️ 等級是**序數**，每一條格線必須剛好對應一個等級。
     *
     * 這裡以前沿用「大圖 4 格、小圖 2 格」，但等級有 A～F 共六級、
     * 跨距是 5。4 格的話刻度值會是 5／3.75／2.5／1.25／0，
     * 經 Math.round 之後印出 F／E／D／B／A——**C 整個不見了**，
     * 而且那個「D」其實畫在 2.5 的高度上。於是資料點在 3（D）
     * 的位置，看起來會落在標著 D 與標著 E 的兩條線中間，
     * 圖上就出現「這一點在 D 與 E 之間，卻說它是 D」。
     *
     * 六級就是六條線，一格一級，這是唯一不會錯位的畫法。
     */
    gridCount = 5;
  } else {
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var pad = (hi - lo) * 0.3 || Math.max(1, Math.abs(hi) * 0.1);
    /* 刻度吸附到整數倍，否則會印出 20.83／30.39／39.94 這種一排亂數。 */
    var nice = niceScale(Math.max(0, lo - pad), hi + pad, gridCount);
    min = nice.min;
    max = nice.max;
    tickDigits = nice.digits;
  }
  var span = max - min || 1;
  var stepX =
    points.length > 1 ? (right - left) / (points.length - 1) : 0;
  var px = function (index) {
    return points.length > 1 ? left + index * stepX : (left + right) / 2;
  };
  var py = function (value) {
    return bottom - ((Number(value) - min) / span) * (bottom - top);
  };

  var grid = "";
  for (var line = 0; line <= gridCount; line += 1) {
    var y = top + ((bottom - top) * line) / gridCount;
    var value = max - (span * line) / gridCount;
    grid +=
      '<line class="trend-grid" x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>' +
      '<text class="trend-tick" x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
      esc(
        series.ordinal
          ? TREND_GRADES[Math.round(value)] || ""
          : tickText(value, tickDigits) + (series.unit === "%" ? "%" : ""),
      ) +
      "</text>";
  }

  /*
   * 缺值要斷線，不可以連過去。
   * 連過去的話「那一季沒有調查」會被畫成一條平滑的線，看起來像有資料。
   */
  /*
   * ⚠️ 超過 8 條時不再給每一條一個顏色。
   *   自動產生新顏色一定會生出對比不足、或兩條幾乎一樣的色；
   *   而且 8 條以上本來就已經讀不動了。那時全部畫成同一個深灰，
   *   只靠線尾的名稱分辨，並在圖上寫一句請使用者縮小範圍。
   */
  var tooManyLines = seriesLines.length > 8;
  var lines = "";
  var dots = "";
  var endLabels = "";
  seriesLines.forEach(function (line, lineIndex) {
    var linePoints = line.points || [];
    var colorIndex = tooManyLines ? 6 : lineIndex % 8;
    var segments = [];
    var current = [];
    linePoints.forEach(function (point, index) {
      if (point.value == null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push(px(index) + "," + py(point.value));
    });
    if (current.length) segments.push(current);
    lines += segments
      .map(function (segment) {
        return (
          '<polyline class="trend-line trend-line-' + colorIndex +
          '" points="' + segment.join(" ") + '"/>'
        );
      })
      .join("");
    dots += linePoints
      .map(function (point, index) {
        if (point.value == null) return "";
        return (
          '<circle class="trend-dot trend-dot-' + colorIndex +
          '" data-period="' +
          esc(point.period) +
          '" data-day="' +
          esc(series.day || "") +
          '" data-line="' +
          esc(line.label || "") +
          '" cx="' +
          px(index) +
          '" cy="' +
          py(point.value) +
          '" r="' +
          (small ? 3.6 : 5) +
          '"><title>' +
          esc(
            (seriesLines.length > 1 && line.label ? line.label + "\n" : "") +
              trendPointTooltip(point, series),
          ) +
          "</title></circle>"
        );
      })
      .join("");
    /*
     * ⚠️ 線尾直接寫上名稱——**識別不可以只靠顏色**。
     *   色盲讀者、灰階列印、以及把圖貼進簡報縮小之後，顏色都靠不住。
     *   只有多條線時才寫（單線時圖的標題已經寫了它是什麼）。
     */
    if (seriesLines.length > 1 && line.label) {
      var lastIndex = -1;
      linePoints.forEach(function (point, index) {
        if (point.value != null) lastIndex = index;
      });
      if (lastIndex >= 0)
        endLabels +=
          '<text class="trend-end-label trend-end-' + colorIndex +
          '" x="' + (px(lastIndex) + 6) + '" y="' +
          (py(linePoints[lastIndex].value) + 4) +
          '">' + esc(line.label) + "</text>";
    }
  });
  if (tooManyLines)
    endLabels +=
      '<text class="trend-empty-text" x="' + left + '" y="' + (top - 8) + '">' +
      esc(
        "共 " + seriesLines.length +
          " 條線，已超過看得清楚的數量（不另外配色）；請用上方的路段選單縮小範圍。",
      ) +
      "</text>";

  /*
   * 等級要直接標在點上。
   *
   * 使用者的原話：「希望能在這個趨勢圖上標示出該資料點是什麼服務水準，
   * 這樣不用一直往左對照 Y 軸」——對照長條圖上方那一排「D D E E」。
   * 等級只有一個字母，寬度固定，所以照實際字寬算得下就全部印。
   *
   * ⚠️ 兩件事一定要處理，否則會變成「修了一半」：
   *  一、最高等級 F 的點就畫在 top 上，標籤放上面會被 viewBox 切掉。
   *      畫不下時改放點的下面。
   *  二、季度多的時候字會擠在一起。與 X 軸標籤共用同一支 labelStride，
   *      不是自己另外估一套。
   */
  var pointLabels = "";
  if (series.ordinal) {
    var letters = points.map(function (point) {
      return point.value == null
        ? ""
        : TREND_GRADES[Math.round(Number(point.value))] || "";
    });
    var labelStrideValue = labelStride(
      letters.filter(Boolean),
      right - left,
      tickSize,
    );
    var lift = small ? 9 : 12;
    pointLabels = points
      .map(function (point, index) {
        if (point.value == null || !letters[index]) return "";
        if (index % labelStrideValue !== 0 && index !== points.length - 1)
          return "";
        var y = py(point.value);
        /* 上面放不下就放下面——寧可換邊，也不要被切掉。 */
        var labelY = y - lift < top + 2 ? y + lift + 2 : y - lift;
        return (
          '<text class="trend-point-label" x="' +
          px(index) +
          '" y="' +
          labelY +
          '" text-anchor="middle">' +
          esc(letters[index]) +
          "</text>"
        );
      })
      .join("");
  }

  /*
   * X 軸標籤要間隔印。
   *
   * 舊版是「大圖全部印、小圖只印頭尾」，兩邊都不對：大圖累積到十幾季
   * 之後一樣會擠成一團（而那時候使用者已經在簡報現場了），小圖只印頭尾
   * 則是明明印得下也不印。改成一律照**實際字寬**算印得下幾個。
   * 最後一季一定要印——那是業主最在意的「現在到哪了」。
   */
  var periodTexts = points.map(function (point) {
    return projectPeriodLabel(point.period, state.activeCode);
  });
  var stride = labelStride(periodTexts, right - left, tickSize);
  var xLabels = points
    .map(function (point, index) {
      var show =
        index % stride === 0 ||
        index === points.length - 1;
      /*
       * 間隔印時，最後一個一定印，所以倒數那幾個要讓位。
       *
       * ⚠️ 這裡的門檻必須是整個 stride，不是 stride 的一半。用一半的話，
       * stride=2（24 季）時「倒數第二個」與「最後一個」只差 1 格就同時
       * 印出來——實測 118Q3 與 118Q4 直接疊在一起。間隔印的意思本來就是
       * 「任兩個印出來的標籤至少相隔 stride 格」，最後一個也不例外。
       */
      if (show && index !== points.length - 1 && stride > 1)
        if (points.length - 1 - index < stride) show = false;
      var anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
      return show
        ? '<text class="trend-tick" x="' +
            px(index) +
            '" y="' +
            (bottom + 18) +
            '" text-anchor="' + anchor + '">' +
            esc(periodTexts[index]) +
            "</text>"
        : "";
    })
    .join("");

  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
    esc(series.label + " 歷季趨勢") + '">' +
    CHART_SVG_STYLE +
    grid +
    '<line class="trend-axis" x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '"/>' +
    axisMarkup +
    xLabels +
    lines +
    dots +
    endLabels +
    pointLabels +
    "</svg>"
  );
}

/** 滑鼠移上去要看得到「是哪幾筆」，這是使用者特別要求的。 */
function trendPointTooltip(point, series) {
  var head =
    projectPeriodLabel(point.period, state.activeCode) +
    "　" +
    series.label +
    "：" +
    trendFormatValue(point.value, series);
  if (series.metric === "congestedShare")
    return (
      head +
      "（" +
      point.valueSize +
      " " + (series.sampleLabel || "條") + "裡有 " +
      point.congestedCount +
      " " + ((series.sampleLabel || "條") === "條" ? "條" : "筆") + "）\n" +
      (point.rows.length
        ? point.rows
            .slice(0, 6)
            .map(function (row) {
              return "・" + row.road + " " + row.day + " " + row.los + " 級";
            })
            .join("\n") + (point.rows.length > 6 ? "\n…等 " + point.rows.length + " 條" : "")
        : "・沒有落在壅塞的路段") +
      "\n（點一下看完整明細）"
    );
  if (series.metric === "worstLos")
    return (
      head +
      "（共 " +
      point.worstCount +
      " 條）\n" +
      point.rows
        .slice(0, 6)
        .map(function (row) {
          return "・" + row.road + " " + row.day + " " + row.peak + " " + row.direction;
        })
        .join("\n") +
      "\n（點一下看完整明細）"
    );
  return head + "（" + point.valueSize + " 筆有效數值平均）\n（點一下看完整明細）";
}

/** 把目前勾選的指標各算一份 series。圖、說明、匯出全部讀這個回傳值。 */
function trendSeriesList() {
  var congestedStart = bandsFor().congestedStart;
  var days = trendDaysForState();
  var list = [];
  /*
   * 一個指標 × 一種日別＝一張圖。
   *
   * 選「平日＋假日」時是**兩張圖同時顯示**（勾一個指標就是兩張小圖，
   * 橫軸對齊，可以直接上下對照），不是把兩種日別混成一條線——
   * 混出來的數字不對應任何一種日別，業主問「平日到底多少」時答不出來。
   *
   * ⚠️ 因此母體名稱一律是「路段」「條」。
   * 日別拆分前為了描述「平日＋假日混在一起」那份資料，把母體改稱
   * 「路段日別紀錄」——那是在替混合後的數字找一個講得通的名字。
   * 拆開之後每一張圖裡就只有一種日別，母體本來就是路段，
   * 再叫「路段日別紀錄」反而是錯的（會讓人以為那張圖含兩種日別）。
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 「全部路段」時**不再取跨路段平均**，改成一路段一條線
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16 的兩段裁示合起來就是這件事：
   *   「目前反而缺少一張圖多條線……(這點三項程式都適用)」
   *   「改成一路段一條線，不再平均」
   *
   * 為什麼原本那個平均不成立：旅行速率、行駛速率、總延滯、速限比
   * 這四個指標，各路段的**長度與速限都不同**，把它們平均起來得到的值
   * 不對應任何一條路的實際狀況。業主問「所以哪一條慢」時，
   * 那個平均一句也答不出來。
   *
   * ⚠️ 但**不是全部指標都改**：
   *   ・「E 級以下路段佔比」是**計數**（壅塞條數 ÷ 判定得出等級的條數），
   *   ・「最差服務水準等級」是**取最差**，
   *   這兩個本來就是「整個計畫」這個母體的統計量，不是平均，
   *   拆成一路段一條線反而沒有意義（每一條線只會是 0% 或 100%／它自己的等級）。
   *   所以那兩個維持單線，另外四個改多線。
   *   ⚠️ 不要「為了一致」把這兩個也拆掉——那會把一個對的東西改成錯的。
   */
  var AVERAGED_METRICS = ["travel", "running", "totalDelay", "ratio"];
  var scope = trendScopeState();
  trendState.metrics.forEach(function (metric) {
    days.forEach(function (day) {
      var rows = trendRowsForState(day);
      var perRoad =
        scope.road === "ALL" && AVERAGED_METRICS.indexOf(metric) >= 0;
      var series = buildTrendSeries(rows, {
        metric: metric,
        congestedStart: congestedStart,
        populationLabel: "路段",
        sampleLabel: "條",
        comparePeriod: function (a, b) {
          return periodIndex(a) - periodIndex(b);
        },
      });
      if (perRoad) {
        var roadNames = [];
        rows.forEach(function (row) {
          if (row.road && roadNames.indexOf(row.road) < 0)
            roadNames.push(row.road);
        });
        roadNames.sort();
        /*
         * ⚠️ 每一條線都要用**同一組季度**當橫軸，否則同一個 x
         *   在不同線上代表不同的季，而圖上完全看不出來。
         *   作法：先拿整份資料算出季度清單（series.points），
         *   再讓每一條線照那個清單對位，缺的季留 null（斷線）。
         */
        var axisPeriods = (series.points || []).map(function (point) {
          return point.period;
        });
        series.lines = roadNames.map(function (road) {
          var own = buildTrendSeries(
            rows.filter(function (row) {
              return row.road === road;
            }),
            {
              metric: metric,
              congestedStart: congestedStart,
              populationLabel: "路段",
              sampleLabel: "條",
              completePeriods: false,
              comparePeriod: function (a, b) {
                return periodIndex(a) - periodIndex(b);
              },
            },
          );
          var byPeriod = {};
          (own.points || []).forEach(function (point) {
            byPeriod[point.period] = point;
          });
          return {
            label: road,
            points: axisPeriods.map(function (period) {
              return byPeriod[period] || { period: period, value: null };
            }),
          };
        });
        /*
         * ⚠️ 多線時把**整份的平均值清掉**。留著的話：說明文字、Excel、
         *   tooltip 都還讀得到那個平均，等於畫面上拿掉了、檔案裡還在。
         *   改成「這一季有幾條路段」，那是計數，說得通。
         */
        series.points = (series.points || []).map(function (point) {
          return Object.assign({}, point, { value: null, averaged: false });
        });
        series.perRoad = true;
      }
      /* 日別要寫進標題與檔名，否則兩張圖長得一樣、匯出還會同名互相覆蓋。 */
      series.day = day;
      series.label =
        days.length > 1 ? series.label + "（" + day + "）" : series.label;
      list.push(series);
    });
  });
  return list;
}

/** 說明文字。與圖同一份 series，不重算。 */
function trendDescriptions(list) {
  var labels = bandLabels();
  return list.map(function (series) {
    return describeTrendChart(series, {
      /* 說明要講的是**這一張圖**的日別，不是選單上那個「平日＋假日」。 */
      scopeText: trendScopeText(series.day),
      bandText: labels.congested.replace(/^壅塞（|）$/g, ""),
      showPeriod: function (period) {
        return projectPeriodLabel(period, state.activeCode);
      },
    });
  });
}


/**
 * 三段圖：逐季的順暢／尚可／壅塞組成（100% 堆疊）。
 *
 * ── 為什麼是 100% 堆疊，不是三條折線或三根並排的柱 ──────────
 * 這張圖回答的是「這一季的路段裡，有多少比例卡住了」。三段加起來
 * 一定是 100%，堆疊柱把這件事直接畫出來；三條折線要看的人自己在心裡
 * 相加，而並排的柱又會讓人去比「順暢的柱和壅塞的柱誰高」——那個比較
 * 沒有意義。
 *
 * ⚠️ 每一段上直接標數字（幾條／百分比），不用回頭對照縱軸——
 * 使用者明確要求過：「不用一直往左對照 Y 軸」。段太薄放不下就不印，
 * 硬印會疊到隔壁那一段上。
 *
 * ⚠️ 分母是**判定得出等級的條數**，不是全部條數。判定不出來的那幾條
 * 另外寫在柱子上方，不可以默默丟掉——丟掉的話「100% 壅塞」可能其實是
 * 「唯一算得出來的那一條是壅塞」。
 */
function bandChartSvg(series, small) {
  var width = small ? 380 : 780;
  var height = small ? 232 : 366;
  var left = small ? 58 : 84;
  var right = width - (small ? 16 : 30);
  var top = small ? 40 : 56;
  var bottom = height - (small ? 52 : 72);
  var tickSize = 11;
  var points = series.points || [];
  var drawable = points.filter(function (point) {
    return point.shares;
  });
  if (!points.length || !drawable.length)
    return (
      '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="沒有資料">' +
      CHART_SVG_STYLE +
      '<text x="' + width / 2 + '" y="' + height / 2 +
      '" text-anchor="middle" class="trend-empty-text">這個條件下沒有可繪製的資料</text></svg>'
    );

  var span = 100;
  var py = function (value) {
    return bottom - (value / span) * (bottom - top);
  };
  var grid = "";
  for (var line = 0; line <= 4; line += 1) {
    var y = top + ((bottom - top) * line) / 4;
    var value = 100 - line * 25;
    grid +=
      '<line class="trend-grid" x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>' +
      '<text class="trend-tick" x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
      value + "%</text>";
  }

  /* 柱寬：留白至少與柱同寬的一半，柱子才不會黏在一起。 */
  var slot = (right - left) / points.length;
  var barWidth = Math.max(6, Math.min(small ? 26 : 42, slot * 0.62));
  var bars = "";
  var labels = "";
  var ORDER = [
    { key: "congested", cls: "band-congested", dark: false },
    { key: "fair", cls: "band-fair", dark: true },
    { key: "smooth", cls: "band-smooth", dark: false },
  ];
  points.forEach(function (point, index) {
    var cx = left + slot * (index + 0.5);
    var x = cx - barWidth / 2;
    if (!point.shares) {
      /* 整季沒有資料：畫一個淺色空槽，看得出「這一季是空的」而不是 0%。 */
      bars +=
        '<rect class="band-empty" x="' + x + '" y="' + py(100) +
        '" width="' + barWidth + '" height="' + (bottom - py(100)) + '" rx="2"/>';
      return;
    }
    var cursor = 0;
    ORDER.forEach(function (part) {
      var share = point.shares[part.key];
      if (!(share > 0)) return;
      var y0 = py(cursor + share);
      var y1 = py(cursor);
      cursor += share;
      bars +=
        '<rect class="' + part.cls + '" x="' + x + '" y="' + y0 +
        '" width="' + barWidth + '" height="' + Math.max(0.6, y1 - y0) + '" rx="1"><title>' +
        esc(
          projectPeriodLabel(point.period, state.activeCode) + "　" +
          (part.key === "smooth" ? "順暢" : part.key === "fair" ? "尚可" : "壅塞") +
          "：" + point.counts[part.key] + " 條（" + share.toFixed(1) + "%）",
        ) +
        "</title></rect>";
      /* 段太薄就不印字——硬印會疊到隔壁那一段上。 */
      if (y1 - y0 >= 14 && barWidth >= 22)
        labels +=
          '<text class="' + (part.dark ? "band-seg-label-dark" : "band-seg-label") +
          '" x="' + cx + '" y="' + ((y0 + y1) / 2 + 4) + '" text-anchor="middle">' +
          point.counts[part.key] + "</text>";
    });
    /*
     * 判定不出等級的條數寫在柱子上方，不可以只藏在 tooltip 裡。
     *
     * ⚠️ 但季度一多（實測 24 季）柱子會很窄，第一根柱子的這行字會往左
     * 蓋到縱軸最上面那個「100%」刻度上。放不下就不印——圖旁邊的說明文字
     * 一定會講出「有幾季存在判定不出等級的路段」，資訊不會消失。
     */
    if (point.unknown) {
      const text = "＋" + point.unknown + " 未判定";
      let textWidth = 0;
      for (let i = 0; i < text.length; i += 1)
        textWidth += text.charCodeAt(i) > 255 ? tickSize : tickSize * 0.58;
      const half = textWidth / 2;
      if (cx - half > left + 2 && cx + half < right - 2)
        labels +=
          '<text class="trend-tick" x="' + cx + '" y="' + (py(100) - 2) +
          '" text-anchor="middle">' + esc(text) + "</text>";
    }
  });

  var periodTexts = points.map(function (point) {
    return projectPeriodLabel(point.period, state.activeCode);
  });
  var stride = labelStride(periodTexts, right - left, tickSize);
  var xLabels = points
    .map(function (point, index) {
      var show = index % stride === 0 || index === points.length - 1;
      if (show && index !== points.length - 1 && stride > 1)
        if (points.length - 1 - index < stride) show = false;
      return show
        ? '<text class="trend-tick" x="' + (left + slot * (index + 0.5)) +
            '" y="' + (bottom + (small ? 23 : 18)) + '" text-anchor="middle">' +
            esc(periodTexts[index]) + "</text>"
        : "";
    })
    .join("");

  /*
   * 圖例畫在**圖裡面**，而且要寫出「哪幾級算這一段」。
   * 畫在圖外的話，這張圖存成 PNG 貼進簡報之後，看的人不知道尺是怎麼訂的
   * ——而那正是業主最可能當場質疑的地方。
   */
  var legendItems = (series.legend || []).filter(function (item) {
    return item.grades && item.grades.length;
  });
  var legendGap = small ? 108 : 150;
  var legendStart =
    left + (right - left) / 2 - ((legendItems.length - 1) * legendGap) / 2;
  var legend = legendItems
    .map(function (item, index) {
      var x = legendStart + index * legendGap;
      var cls =
        item.key === "smooth"
          ? "band-smooth"
          : item.key === "fair"
            ? "band-fair"
            : "band-congested";
      return (
        /* 圖例色塊多掛一個類別，量測時才分得出「這不是資料柱」。 */
        '<rect class="band-legend-key ' + cls + '" x="' + (x - 46) + '" y="' + (top - 30) +
        '" width="12" height="12" rx="2"/>' +
        '<text class="band-legend-text" x="' + (x - 30) + '" y="' + (top - 20) + '">' +
        esc(item.name + "（" + item.grades.join("、") + "）") + "</text>"
      );
    })
    .join("");

  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
    esc("三段分法組成 歷季變化") + '">' +
    CHART_SVG_STYLE +
    '<text class="axis-title" transform="translate(' + (small ? 15 : 20) + "," +
    (top + (bottom - top) / 2) + ') rotate(-90)" text-anchor="middle">路段佔比（%）</text>' +
    '<text class="axis-title" x="' + (left + (right - left) / 2) + '" y="' +
    (height - (small ? 12 : 16)) + '" text-anchor="middle">季度</text>' +
    legend +
    grid +
    '<line class="trend-axis" x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '"/>' +
    xLabels +
    bars +
    labels +
    "</svg>"
  );
}


/**
 * 三段圖面板。
 *
 * ⚠️ **平日與假日各畫一張，不加總**。這是使用者踩過的坑：
 * 「把平日和假日的車輛數加總起來，是沒有意義的圖表」——三段圖同理，
 * 把兩種日別的路段數堆進同一根柱子，那根柱子不對應任何一天。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  一圖一說明，配成一列
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「LOS圖表 我在看右邊文字說明時，往下滑動，圖直接滑離開畫面，並沒有之前
 *     說好的設定，在這一區塊會保持可見。」
 *   「當我把所有圖表都打勾的話，同時有好多個圖片要看，說明文字也暴增，
 *     根本做不到圖片保持可見＋配合文字說明。這裡的圖＋文字說明是否要重新設計？」
 *
 * ⚠️ 舊版是「左邊一整排圖、右邊一整排說明」，兩排各自排列、只靠**順序**對應。
 *   勾 2 張還能對上，勾 8 張時第 5 段說明旁邊是第 2 張圖——
 *   **再怎麼調 sticky 都救不回來，因為要釘住的目標本來就不只一個。**
 *
 * 現在每一張圖和它自己的說明是同一個 .figure-row 的兩半：
 *   ・釘住的範圍就是那一列（sticky 的包含區塊是父層），
 *     看第 3 張的說明時第 3 張圖一定在旁邊；滑出那一列，圖就跟著走。
 *   ・說明放得下就在右側、放不下自動掉到圖的下方——用 container query
 *     依**實際量到的容器寬度**決定，不是寫死的視窗斷點。
 *     這同時擋掉使用者踩過的那個雷：110% 之類的縮放比例下右側說明蓋住圖。
 *   ・說明預設收合，只露重點一行，點開才看詳細（「文字暴增」的解法）。
 */
function figureRow(figureHtml, script) {
  /*
   * ⚠️ summary 裡放的是**重點那一句**，不是標題重複一次。
   *   收合狀態下使用者只看得到 summary，那一行必須自己就有資訊量。
   */
  return (
    '<div class="figure-row">' +
    figureHtml +
    '<details class="trend-script-item figure-note">' +
    "<summary><b>" + esc(script.title) + "</b>" +
    (script.lead ? '<span class="figure-note-lead">' + esc(script.lead) + "</span>" : "") +
    /* 同上：箭頭用 <i>，不用 CSS content——理由見 chartCardNote()。 */
    '<i class="figure-note-caret" aria-hidden="true">▼</i>' +
    "</summary>" +
    '<div class="figure-note-body">' + script.body + "</div>" +
    "</details>" +
    "</div>"
  );
}

/** 三段圖畫面上那一份說明的純文字版，給「複製說明文字」共用。 */
var lastBandScripts = [];

/*
 * ══════════════════════════════════════════════════════════════════════
 *  三段分法自己的工具列：季度區間 ＋ 日別
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「三段分法的圖可以增加自己的工具列（如歷季趨勢那樣），可以讓使用者
 *     篩選季度、日別……這樣好處是使用者可以查看**指定的季度期間**的三段分法。
 *     我在想應該**不需要路段篩選**的功能，因為三段分法原本就是用來看這個計畫
 *     **所有路段**中，有幾條路在這一季是擁塞/尚可/順暢，對嗎」
 *
 * ⚠️ **刻意不做路段篩選**，使用者的判斷是對的：
 *   這張圖的分母是「該季判定得出等級的路段數」。篩成單一路段之後分母是 1，
 *   比例只可能是 0% 或 100%，那張圖就失去意義了。
 *
 * ⚠️ 右側那段講稿讀的是**同一份** series（見下方 bandScripts），
 *   所以篩選之後文字一定跟著變——這一支一直在防的是「圖與文字分岔」，
 *   而被抄進報告的是文字。
 */
/*
 * ⚠️ 這一塊的三個條件現在是**主工具列的鏡子**（使用者 2026-09-14：
 *   「針對共同的篩選條件，例如 路段/季別，在不影響其他圖的前題下，
 *     圖表自身的工具列仍舊要與主工具列同步」）。
 *   在這裡改一個 → 只有這一塊脫離，別塊不受影響；
 *   旁邊會出現「回到主工具列條件」。
 *
 * ⚠️ 「路段」仍然**刻意不做**（使用者的判斷是對的：分母會變成 1）。
 *   主工具列篩了路段時，這一塊要寫明不適用——不可以默默照篩，
 *   也不可以默默不理。
 */
/**
 * 三段分法上要掛的提示。
 *
 * ⚠️ 「本圖不適用路段篩選」這一句是**既有守門**（e2e-chart-page (4) 的精神），
 *   升級時不可以弄掉：這張圖的分母是「該季判定得出等級的路段數」，
 *   篩成單一路段之後分母是 1，比例只可能是 0% 或 100%。
 */
function renderBandNotes() {
  var host = document.getElementById("bandNotes");
  if (!host) return;
  var f = MT.filtersOf(MT.CHART_IDS.band);
  host.innerHTML =
    detachNoteHtml(MT.CHART_IDS.band) +
    inapplicableHtml(
      MF.isFiltered(f, "roads"),
      MF.inapplicableNote(
        "本圖不適用路段篩選：它統計的是全部路段中各等級的佔比，篩選單一路段會失去意義（分母變成 1，比例只會是 0% 或 100%）。",
        "全部路段",
      ),
    ) +
    /*
     * ⚠️ 甲案之後「平日＋假日並列」**就是預設值**，所以這一句在預設狀態下
     *   會一直掛著。它講的又剛好是「這本來就是預設的畫法」——
     *   一句永遠都在、而且只是在講預設值的說明，純粹是噪音。
     *   改成只有使用者主動選了並列（＝從平日或假日切回來）時才講。
     */
    inapplicableHtml(
      MF.chose(f, "day", "side-by-side"),
      "「平日＋假日並列」在這一塊本來就是預設的畫法：下面每一個日別各一張圖。",
      ["day"],
    ) +
    /*
     * ── J-3：這一區自己的選單是**從主工具列篩過的資料**產生的 ──────
     *
     * 使用者 2026-09-15：「部分表格的篩選是建立在經過主工具列篩選條件後的
     *   剩餘資料，供使用者進行篩選，這類情況，記得也要補充說明說當前資料是
     *   建立在主工具列篩選條件下的，**不然使用者會以為資料缺失**。」
     *
     * ⚠️ 只在主工具列真的縮小了範圍時才講（沒縮小卻講一句是噪音）。
     */
    inapplicableHtml(
      MT.isPeriodNarrowed(MT.CHART_IDS.band, mainToolbarPeriods()) ||
        MF.isFiltered(f, "roads"),
      "「三段分法」自己的季度與日別選單，列的是主工具列條件範圍內真的有的項目——不是全部資料。看不到某一季不代表資料不見了，把主工具列的條件放寬就會回來。",
      [],
    );
}
function bandStateOf() {
  var f = MT.filtersOf(MT.CHART_IDS.band);
  /*
   * ⚠️ 2026-09-15 起**不再分辨兩種起＝迄**。
   *
   * 使用者 2026-09-15 定義：「起＝迄……代表只有那一季」，
   * 而且「你一開始說的起＝迄代表不限季是錯誤的」。
   * 主工具列的預設值改成「起＝最早一季、迄＝最新一季」之後，
   * 預設狀態本來就是完整區間，不需要再把起＝迄解釋成別的意思——
   * `hasOwnPeriod()` 存在的唯一理由（分辨那兩種起＝迄）因此消失。
   *
   * 所以這裡直接照字面用：區間就是區間。
   */
  return {
    start: f.periodFrom || "ALL",
    end: f.periodTo || "ALL",
    day:
      f.day === "weekday" ? "平日" : f.day === "holiday" ? "假日" : "ALL",
  };
}

function renderBandPanel() {
  var panel = $("bandPanel");
  if (!panel) return;
  var bandState = bandStateOf();
  /*
   * ⚠️ 三段分法吃的是**彙總**（每一組的代表值）。主工具列篩了方向或尖峰時
   *   要「先篩再挑最差」，所以不可以直接拿 state.summaries。
   */
  var all = MT.summariesFor(
    state.details.filter(function (row) {
      return row.projectCode === state.activeCode;
    }),
    MT.CHART_IDS.band,
    worstOfGroup,
    "range",
    /*
     * ⚠️ 「路段」**刻意不吃**——這一點畫面上已經寫著
     *   （renderBandNotes 的「本圖不適用路段篩選……目前仍以全部路段計算」）。
     *   升級前只有那一句話，程式其實照篩：篩成單一路段之後分母是 1，
     *   每一季不是 0% 就是 100%，而畫面上那一句還在說它沒篩。
     *   寫著不適用卻其實會變，比沒有那一句更糟。（2026-09-16 實測抓到）
     */
    ["roads"],
  );
  renderBandNotes();
  panel.hidden = !all.length;
  /*
   * ⚠️ X-62：這一塊現在自己一個大分頁。整塊 hidden 時那一頁會**完全空白**，
   *   使用者看不出是「還沒匯資料」還是「壞掉」。所以補一塊說明，
   *   兩者恰好互斥（同時出現＝兩句話互相矛盾，同時消失＝空白頁）。
   */
  var bandEmpty = $("bandEmpty");
  if (bandEmpty) bandEmpty.hidden = !panel.hidden;
  if (!all.length) return;

  /* 季度選單依現有資料組出來，不寫死。 */
  var periods = [...new Set(all.map(function (row) { return row.period; }))]
    .filter(Boolean)
    .sort(function (a, b) { return periodIndex(a) - periodIndex(b); });
  if (bandState.start !== "ALL" && periods.indexOf(bandState.start) < 0)
    bandState.start = "ALL";
  if (bandState.end !== "ALL" && periods.indexOf(bandState.end) < 0)
    bandState.end = "ALL";
  var periodOptions = function (selected, firstLabel) {
    return (
      '<option value="ALL">' + firstLabel + "</option>" +
      periods
        .map(function (period) {
          return (
            '<option value="' + esc(period) + '"' +
            (period === selected ? " selected" : "") + ">" +
            esc(projectPeriodLabel(period, state.activeCode)) + "</option>"
          );
        })
        .join("")
    );
  };
  if ($("bandStart")) $("bandStart").innerHTML = periodOptions(bandState.start, "最早一季");
  if ($("bandEnd")) $("bandEnd").innerHTML = periodOptions(bandState.end, "最新一季");

  /*
   * ── 日別選項的母體：**要排除「日別」自己這一欄的條件** ──────────
   *
   * 使用者 2026-09-15：「三段分法，當我選擇了日別選了平日後，日別的選項
   *   變成只剩『平日＋假日』『平日』共 2 個，我必須先點選一次『平日＋假日』後，
   *   才會還原成 3 個日別選項……這是異常嗎」
   *
   * **是異常。** 成因：選項是從 `all` 產生的，而 `all` 已經套過日別篩選——
   * 選了平日之後資料裡就只剩平日，於是「假日」這個選項自己消失了，
   * 使用者再也選不回去（除非先切回「平日＋假日」）。
   *
   * 這與 Excel 資料篩選的規則一樣、也與本專案 ColumnFilter 早就寫過的規則
   * 一樣：**選項清單要排除自己這一欄的條件**，其餘條件照常套用
   *（所以季度區間或路段縮小時，這裡列的仍然是那個範圍內真的有的日別）。
   */
  var dayUniverseFilters = Object.assign({}, MT.filtersOf(MT.CHART_IDS.band), {
    day: "all",
  });
  var allDays = [
    ...new Set(
      state.details
        .filter(function (row) {
          return (
            row.projectCode === state.activeCode &&
            MT.matchesDetail(row, dayUniverseFilters, "range")
          );
        })
        .map(function (row) {
          return row.day;
        }),
    ),
  ]
    .filter(Boolean)
    .sort();
  /*
   * ⚠️ 這一段**不可以拿掉**：選項母體排除了日別自己，但若使用者選的那一個
   *   日別真的因為別的條件（季度、路段）而完全沒有資料，還是要退回全部，
   *   否則畫面會是一張空圖而且看不出原因。
   */
  if (bandState.day !== "ALL" && allDays.indexOf(bandState.day) < 0)
    bandState.day = "ALL";
  if ($("bandDay"))
    $("bandDay").innerHTML =
      '<option value="ALL">平日＋假日</option>' +
      allDays
        .map(function (day) {
          return (
            '<option value="' + esc(day) + '"' +
            (day === bandState.day ? " selected" : "") + ">" + esc(day) + "</option>"
          );
        })
        .join("");

  /*
   * ⚠️ 區間顛倒（起 > 迄）時**不要靜靜地畫出空圖**——那會讓人以為「那幾季沒資料」。
   *   直接把兩端對調，並在說明列講出來。
   */
  var startKey = bandState.start === "ALL" ? null : bandState.start;
  var endKey = bandState.end === "ALL" ? null : bandState.end;
  var swapped = false;
  if (startKey && endKey && periodIndex(startKey) > periodIndex(endKey)) {
    var swap = startKey;
    startKey = endKey;
    endKey = swap;
    swapped = true;
  }
  var own = all.filter(function (row) {
    if (startKey && periodIndex(row.period) < periodIndex(startKey)) return false;
    if (endKey && periodIndex(row.period) > periodIndex(endKey)) return false;
    if (bandState.day !== "ALL" && row.day !== bandState.day) return false;
    return true;
  });
  if ($("bandScopeNote"))
    $("bandScopeNote").textContent =
      (own.length
        ? "目前範圍：" +
          (startKey ? projectPeriodLabel(startKey, state.activeCode) : "最早一季") +
          "～" +
          (endKey ? projectPeriodLabel(endKey, state.activeCode) : "最新一季") +
          "・" +
          (bandState.day === "ALL" ? "平日＋假日" : bandState.day) +
          "・全部路段（這張圖不分路段，分母是判定得出等級的路段數）"
        : "這個範圍裡沒有資料，請放寬季度區間或改日別。") +
      (swapped ? "　⚠️ 起迄季度顛倒了，已自動對調。" : "");
  if (!own.length) {
    $("bandCharts").innerHTML =
      '<p class="empty">這個範圍裡沒有資料。</p>';
    lastBandScripts = [];
    return;
  }

  var bands = bandsFor();
  var days = [...new Set(own.map(function (row) { return row.day; }))]
    .filter(Boolean)
    .sort();
  if (!days.length) days = [""];
  var seriesList = days.map(function (day) {
    var rows = day ? own.filter(function (row) { return row.day === day; }) : own;
    var series = buildBandSeries(rows, {
      bands: bands,
      /*
       * ⚠️ 逐列問一次分界——三段分法 2026-09-15 起可以依
       *   季別區間 × 路段覆寫，同一張圖裡不同的列可能用不同的尺。
       *   沒有任何覆寫時每一列都會拿到同一組（＝改版前的行為）。
       */
      bandsOf: function (row) {
        return bandHitFor(row.period, row.road).rules;
      },
      comparePeriod: function (a, b) {
        return periodIndex(a) - periodIndex(b);
      },
    });
    series.day = day;
    return series;
  });

  var small = seriesList.length > 1;
  /*
   * ⚠️ 這裡不再是「一排圖」＋「一排說明」，而是一列一組（見 figureRow 的說明）。
   *   className 也跟著換掉——留著 trend-small 會讓兩張圖擠在同一列裡，
   *   那樣說明又對不上圖了。
   */
  $("bandCharts").className = "figure-rows";
  /* 說明文字只讀上面那一份 series，不回頭重算。 */
  var bandScripts = seriesList
    .map(function (series) {
      var valued = series.points.filter(function (point) { return point.shares; });
      if (!valued.length) return null;
      var first = valued[0];
      var last = valued[valued.length - 1];
      var lines = [
        "這張圖把 A～F 六級收成三段：" +
          series.legend
            .filter(function (item) { return item.grades.length; })
            .map(function (item) { return item.name + "＝" + item.grades.join("、"); })
            .join("；") +
          "。分母是**判定得出等級**的路段數，不是全部路段數。",
        "壅塞比例：從 " +
          projectPeriodLabel(first.period, state.activeCode) + " 的 " +
          first.shares.congested.toFixed(1) + "%（" + first.counts.congested + " / " + first.graded + " 條），到 " +
          projectPeriodLabel(last.period, state.activeCode) + " 的 " +
          last.shares.congested.toFixed(1) + "%（" + last.counts.congested + " / " + last.graded + " 條）。",
      ];
      var thin = valued.filter(function (point) { return point.graded > 0 && point.graded < 5; });
      if (thin.length)
        lines.push(
          "⚠️ 有 " + thin.length + " 季判定得出等級的路段不到 5 條，比例會跳得很大——" +
            "3 條的話比例只可能是 0%、33%、67%、100%，不要照著講「大幅上升」。",
        );
      var unknown = valued.filter(function (point) { return point.unknown; });
      if (unknown.length)
        lines.push(
          "有 " + unknown.length + " 季存在判定不出等級的路段（柱子上方標「＋N 未判定」），" +
            "那幾條沒有進到分母裡。",
        );
      var gaps = series.points.filter(function (point) { return !point.shares; });
      if (gaps.length)
        lines.push(
          "有 " + gaps.length + " 季整季沒有資料（圖上是淺色的空槽），不是「那幾季 0%」。",
        );
      return {
        title: series.day ? series.day + " 三段組成" : "三段組成",
        /* 重點那一句＝壅塞比例的頭尾對照，收合時只露這一行。 */
        lead: lines[1] || lines[0] || "",
        body: lines
          .map(function (line) {
            return "<p>" + esc(line).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") + "</p>";
          })
          .join(""),
        /* 複製說明文字用的純文字版（不經過 DOM，收合也複製得到）。 */
        text:
          (series.day ? series.day + " 三段組成" : "三段組成") +
          "\n" +
          lines.join("\n").replace(/\*\*(.+?)\*\*/g, "$1"),
      };
    })
    .filter(Boolean);
  /*
   * ⚠️ 留一份給「複製說明文字」用。
   *   舊版是讀畫面上的 innerText，但說明現在**預設收合**，
   *   收合的內容不會出現在 innerText 裡——照抄舊寫法會複製到半篇。
   *   改成和畫面共用同一份 bandScripts（仍然是「只算一次」，
   *   不會出現「畫面寫 A、複製出來是 B」）。
   */
  lastBandScripts = bandScripts.map(function (item) { return item.text; });
  $("bandCharts").innerHTML = seriesList
    .map(function (series, index) {
      var figureHtml =
        '<figure class="trend-figure">' +
        (series.day ? "<figcaption>" + esc(series.day) + "</figcaption>" : "") +
        bandChartSvg(series, small) +
        "</figure>";
      var script = bandScripts[index];
      return script
        ? figureRow(figureHtml, script)
        : '<div class="figure-row">' + figureHtml + "</div>";
    })
    .join("");
}

/** 歷季趨勢上要掛的提示。 */
function renderTrendNotes(rows) {
  var host = document.getElementById("trendNotes");
  if (!host) return;
  var f = MT.filtersOf(MT.CHART_IDS.trend);
  host.innerHTML =
    detachNoteHtml(MT.CHART_IDS.trend) +
    /*
     * ⚠️ 2026-09-16 訂正：這一句原本寫「接不住主工具列的多選，
     *   目前仍以全部路段合計計算」——**兩句都已經不成立**。
     *   X-34② 之後，選了 2 條以上時：
     *     ・速率／延滯／速限比 → 一路段一條線（不平均）
     *     ・佔比／最差等級 → 一條線，但分母就是**選到的那幾條**，
     *       不是全部路段（它們是母體統計量，這樣才對）
     *   兩種都真的吃了多選。寫著「接不住」「仍以全部路段計算」
     *   會讓使用者把只含 2 條路段的圖當成整個計畫的結果。
     *   改成講它**實際**怎麼畫。
     */
    ((f.roads || []).length > 1
      ? `<p class="chart-inapplicable" data-testid="chart-inapplicable">主工具列選了 ${(f.roads || []).length} 條路段，這一塊<b>只畫這幾條</b>（不是全部路段）：速率、延滯、速限比是<b>一條路段一條線</b>；佔比與最差等級是一條線，而分母就是這幾條。</p>`
      : "") +
    inapplicableHtml(
      !rows.length,
      "目前的條件下沒有資料可以畫。請放寬主工具列的條件，或按「回到主工具列條件」。",
    );
}
function renderTrendPanel() {
  var panel = $("trendPanel");
  if (!panel) return;
  /* ⚠️ 彙總要「先篩再挑最差」，所以從明細重算，不拿 state.summaries。 */
  var own = trendSummaryRows();
  /*
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 「這個條件下沒有資料」時**不可以把整塊藏起來**
   * ══════════════════════════════════════════════════════════════════
   *
   * 舊寫法是 `panel.hidden = !own.length; if (!own.length) return;`，
   * 三個後果一個比一個嚴重：
   *
   *  ① 整塊消失。使用者 2026-09-16 已經為了同一件事回報過
   *     「這張表忽然整張消失，我一度以為系統錯誤」。
   *  ② **選單跟著消失，使用者改不回去**。選了一個「這一天沒有調查」的
   *     路段之後，路段與日別兩個下拉都被藏起來了——想換回別的路段
   *     只能重新整理。這是這一版實測時踩到的（某一條路段只有平日資料，
   *     選它＋假日就整塊不見）。
   *  ③ **上一次的圖還留在 DOM 裡**。因為提早 return，#trendCharts 沒有重畫，
   *     裡面仍然是上一個路段的線與數字。藏起來的那一刻看不到，
   *     但那是一份「別的路段的資料」躺在畫面上——這種東西一旦
   *     因為任何原因再被顯示出來，使用者看到的就是錯的路段。
   *
   * 所以改成：**整塊留著、選單照畫、圖的位置換成一句說明**。
   * 只有連一筆明細都沒有（整個計畫還沒匯資料）時才收起來——
   * 那時連選單都沒有東西可列。
   */
  var hasAnyData = trendOptionSource().length > 0;
  panel.hidden = !hasAnyData;
  /* ⚠️ X-62：同上——這一塊自己一頁，藏起來時那一頁不可以是空白的。 */
  var trendEmpty = $("trendEmpty");
  if (trendEmpty) trendEmpty.hidden = !panel.hidden;
  renderTrendNotes(own);
  if (!hasAnyData) return;

  /*
   * 路段與日別的選單依現有資料組出來，不寫死。
   * ⚠️ X-39／X-40：來源是 **trendOptionSource()**（不吃自己那個維度的條件），
   *   **不可以**改回 own——own 是篩過的，選項會自我消失。
   */
  var scope = trendScopeState();
  var optionRows = trendOptionSource();
  var roads = [...new Set(optionRows.map(function (row) { return row.road; }))].sort();
  $("trendRoad").innerHTML =
    '<option value="ALL">全部路段合計</option>' +
    roads
      .map(function (road) {
        return (
          '<option value="' + esc(road) + '"' +
          (road === scope.road ? " selected" : "") + ">" + esc(road) + "</option>"
        );
      })
      .join("");
  var days = [...new Set(optionRows.map(function (row) { return row.day; }))].sort();
  $("trendDay").innerHTML =
    '<option value="ALL">平日＋假日</option>' +
    days
      .map(function (day) {
        return (
          '<option value="' + esc(day) + '"' +
          (day === scope.day ? " selected" : "") + ">" + esc(day) + "</option>"
        );
      })
      .join("");

  var congestedStart = bandsFor().congestedStart;
  $("trendMetricBoxes").innerHTML = TREND_METRICS.map(function (metric) {
    var label = trendMetricLabel(metric.key, { congestedStart: congestedStart });
    return (
      '<label><input type="checkbox" data-trend-metric="' + esc(metric.key) + '"' +
      (trendState.metrics.indexOf(metric.key) >= 0 ? " checked" : "") + ">" +
      esc(label) + "</label>"
    );
  }).join("");

  var list = trendSeriesList();
  var descriptions = trendDescriptions(list);
  /*
   * ⚠️ small 只決定 SVG 要畫成大圖還是小圖；版面一律是「一列一組」。
   *   舊版在勾多個指標時把圖排成多欄（trend-small），說明另外排成一欄，
   *   於是第 5 段說明旁邊是第 2 張圖——這正是使用者 2026-09-13 回報的毛病。
   */
  var small = list.length > 1;
  $("trendCharts").className = "figure-rows";
  /*
   * 說明欄位。使用者的場景是「把圖放進簡報，聽眾想知道這張圖代表什麼」，
   * 所以寫成可以照著念、也可以直接貼到投影片下面的講稿。
   * 現在它和自己那一張圖包在同一列裡（見 figureRow）。
   */
  /*
   * ⚠️ 條件篩到一筆都不剩時，**在圖的上方先講清楚**。
   *   圖裡面雖然會寫「這個條件下沒有可繪製的資料」，但那是一行 SVG 文字，
   *   放不下「下一步該做什麼」。而使用者卡住的正是下一步——
   *   他不知道是自己選到一條那一天沒有調查的路段。
   */
  var emptyHint =
    own.length === 0
      ? '<p class="empty-block">目前的條件下沒有可以繪製的資料：這個路段在所選的日別可能沒有調查。請用上方的「路段」或「日別」換一個條件。</p>'
      : "";
  $("trendCharts").innerHTML = emptyHint + (list.length
    ? list
        .map(function (series, index) {
          var description = descriptions[index];
          var figureHtml =
            /*
             * ⚠️ data-small 是給守門看的：版面改成「一列一組」之後，
             *   容器不再掛 trend-small，但「這一張要畫成小倍數圖」這個**決定**
             *   仍然存在（它決定 SVG 的比例與字級）。決定要看得見，
             *   否則守門只能驗到版面、驗不到這個決定還在不在。
             */
            '<figure class="trend-figure" data-small="' + (small ? "1" : "0") +
            '" data-metric="' + esc(series.metric) + '">' +
            "<figcaption>" + esc(series.label) + "</figcaption>" +
            trendChartSvg(series, small) +
            "</figure>";
          if (!description) return '<div class="figure-row">' + figureHtml + "</div>";
          return figureRow(figureHtml, {
            title: description.title,
            /* 收合時只露這一句：實際看到的變化，最有資訊量的那一行。 */
            lead: description.observed || description.meaning,
            body:
              "<p>" + esc(description.meaning) + "</p>" +
              (description.observed ? "<p>" + esc(description.observed) + "</p>" : "") +
              (description.caveats.length
                ? "<p class=\"trend-caveat\"><b>判讀時要注意：</b></p><ul>" +
                  description.caveats
                    .map(function (item) { return "<li>" + esc(item) + "</li>"; })
                    .join("") +
                  "</ul>"
                : ""),
          });
        })
        .join("")
    :       '<p class="empty-block">請至少勾選一個指標。</p>');
}

/* ── 趨勢圖的互動 ────────────────────────────────────────────── */
/*
 * ⚠️ 這兩顆現在寫進 chartOverrides（只影響歷季趨勢那一塊），
 *   不再是一份獨立的區域狀態——寫成區域狀態的話它永遠不跟主工具列走。
 * ⚠️ 也**不可以**順手重畫三段分法：那是另一塊，有它自己的條件。
 */
$("trendRoad").onchange = (e) => {
  MT.setChart(
    MT.CHART_IDS.trend,
    "roads",
    e.target.value === "ALL" ? [] : [e.target.value],
  );
};

/*
 * 各路段 LOS 圖／歷季旅行速率的高解析圖檔（使用者 2026-09-14 指名補上）。
 * 多張自動打包成一個壓縮檔，理由見 downloadChartImages。
 */
$("downloadLosPng").onclick = function () {
  return downloadCardCharts("chartGrid", (state.activeCode || "計畫") + "_各路段LOS圖");
};
$("downloadSpeedPng").onclick = function () {
  return downloadCardCharts(
    "speedTrendGrid",
    (state.activeCode || "計畫") + "_各路段歷季旅行速率",
  );
};

/** 多張三段圖合併成單一 ZIP，避免瀏覽器阻擋連續下載。 */
$("bandDownloadPng").onclick = async () => {
  const figures = [...document.querySelectorAll("#bandCharts .trend-figure")];
  if (!figures.length) return toast("目前沒有可以下載的圖");
  const result = await downloadChartImages(
    figures.map((figure) => ({
      svg: figure.querySelector("svg"),
      name:
        `${state.activeCode || "計畫"}_三段分法` +
        (figure.querySelector("figcaption")?.textContent
          ? "_" + figure.querySelector("figcaption").textContent
          : ""),
    })),
    `${state.activeCode || "計畫"}_三段分法圖`,
  );
  chartDownloadToast(result);
};


/**
 * 高解析度 PNG。
 *
 * 兩倍解析度、白底、圖片下方附說明文字——這樣沒有新版 Excel 的人
 * 拿到一張圖就有完整的話可以講，直接貼進投影片即可。
 * 透明底不行：貼到深色版面上文字會看不見。
 */
$("trendDownloadPng").onclick = async () => {
  const figures = [...document.querySelectorAll("#trendCharts .trend-figure svg")];
  if (!figures.length) return toast("目前沒有可以下載的圖");
  const list = trendSeriesList();
  const scope = trendScopeState().road === "ALL" ? "全部路段" : trendScopeState().road;
  /*
   * 匯出的圖**只有圖，不附說明文字**。
   *
   * 使用者的原話：「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，
   * 看到那些應該由簡報者說明的文字展示在上方這樣才奇怪。」——說明是給簡報者
   * 講的，不是印在投影片上的。說明文字留在畫面上圖的旁邊，並且有一顆
   * 「複製說明」可以貼進簡報備忘稿。
   */
  const result = await downloadChartImages(
    figures.map((svg, index) => ({
      svg,
      /* label 已經帶了日別（見 trendSeriesList），這裡只補路段範圍。 */
      name: `${state.activeCode || "計畫"}_${list[index]?.label || "趨勢圖"}_${scope}`,
    })),
    `${state.activeCode || "計畫"}_歷季趨勢圖_${scope}`,
  );
  chartDownloadToast(result);
};
$("trendDay").onchange = (e) => {
  MT.setChart(
    MT.CHART_IDS.trend,
    "day",
    e.target.value === "ALL"
      ? "all"
      : e.target.value === "平日"
        ? "weekday"
        : "holiday",
  );
};
/*
 * 三段分法自己的三個條件。
 * ⚠️ 它們**只**重畫三段分法那一塊——與歷季趨勢那一組各自獨立，
 *   否則使用者在這裡篩季度，上面那張趨勢圖也跟著變，那是兩件事。
 */
/*
 * ⚠️ 這三顆現在寫進 chartOverrides（只影響這一塊），
 *   不再是一份獨立的區域狀態。寫成區域狀態的話它永遠不會跟著主工具列走，
 *   使用者在主工具列改了季度、這一塊不動，而且沒有任何字說明——
 *   那正是升級要修掉的毛病。
 */
["bandStart", "bandEnd", "bandDay"].forEach((id) => {
  const node = $(id);
  if (!node) return;
  node.onchange = (e) => {
    const value = e.target.value;
    if (id === "bandDay")
      MT.setChart(
        MT.CHART_IDS.band,
        "day",
        value === "ALL" ? "all" : value === "平日" ? "weekday" : "holiday",
      );
    else {
      /*
       * 「最早一季／最新一季」（ALL）＝不設界線。主工具列的模型只有起訖，
       * 所以 ALL 對應成「把那一端拉到現有資料的頭或尾」。
       */
      const periods = mainToolbarPeriods();
      const current = bandStateOf();
      const from =
        id === "bandStart"
          ? value === "ALL"
            ? periods[0]
            : value
          : current.start === "ALL"
            ? periods[0]
            : current.start;
      const to =
        id === "bandEnd"
          ? value === "ALL"
            ? periods[periods.length - 1]
            : value
          : current.end === "ALL"
            ? periods[periods.length - 1]
            : current.end;
      MT.setChart(MT.CHART_IDS.band, "periodFrom", from);
      MT.setChart(MT.CHART_IDS.band, "periodTo", to);
    }
  };
});
$("trendMetricBoxes").onchange = (e) => {
  const key = e.target?.dataset?.trendMetric;
  if (!key) return;
  const next = new Set(trendState.metrics);
  if (e.target.checked) next.add(key);
  else next.delete(key);
  /*
   * 至少要留一個指標。全部取消的話畫面會空掉，而使用者通常只是想
   * 「換一個看」——那時候應該是換，不是變成空白。
   */
  if (!next.size) {
    e.target.checked = true;
    return toast("至少要勾選一個指標");
  }
  trendState.metrics = TREND_METRICS.map((m) => m.key).filter((k) => next.has(k));
  renderTrendPanel();
  renderBandPanel();
};

/*
 * 點圖上的點 → 跳到尖峰彙總，並把篩選套上去。
 *
 * 使用者特別交代這一項「要確實能自動跳轉及篩選功能正確」，
 * 所以這裡不是只捲動畫面：真的把搜尋框填成那一季，讓下面的表只剩那些列。
 */
$("trendCharts").onclick = (e) => {
  const dot = e.target?.closest?.("[data-period]");
  if (!dot) return;
  const period = dot.dataset.period;
  const search = $("summarySearch");
  if (search) {
    search.value = "";
  }
  summaryFilter.clearAll();
  summaryFilter.set("期間", [period]);
  if (dot.dataset.day) summaryFilter.set("日別", [dot.dataset.day]);
  renderSummaries();
  /*
   * 直接呼叫 go()，不要靠 querySelector 去找一顆按鈕。
   * 找按鈕的寫法在按鈕改名或搬家時會**安靜失效**——畫面沒跳過去，
   * 但也不會報錯，使用者只會覺得「點了沒反應」。實測就踩到這一個。
   */
  go("summary");
  setTimeout(() => {
    $("summarySearch")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 120);
  toast(
    `已跳到尖峰彙總，並篩出 ${projectPeriodLabel(period, state.activeCode)}` +
      (dot.dataset.day ? ` ${dot.dataset.day}` : "") +
      " 的資料",
  );
};

/*
 * 可編輯 Excel。
 *
 * 沿用既有的 exportLosWorkbook()——它產生的是 OOXML 原生折線／長條圖
 *（c:lineChart／c:barChart），資料表就在同一張工作表上，圖以儲存格範圍為
 * 來源，所以在 Excel 裡改數字圖會跟著動。Excel 2007 以上、LibreOffice、
 * WPS 都開得起來，不需要新版。
 *
 * 誠實說明（也寫在按鈕上）：Excel 匯出的是**逐路段的 LOS 與速率**，
 * 不是畫面上這幾張「佔比／平均」的趨勢圖。那幾張目前只提供高解析 PNG。
 * 原因是它們的資料是跨路段彙總出來的，要在 Excel 裡重現同一份彙總得再寫
 * 一套公式，而兩套算法遲早會分岔——那正是這次要避免的事。
 */
/*
 * 可編輯 Excel：**趨勢圖本身**變成原生 Excel 折線圖。
 *
 * 使用者的原話：「我下載下來，形成可編輯的圖，excel 裡面圖本身就是圖，
 * 文字說明可以放在 excel 其他欄位，使用者可以針對圖做修正或直接拿去簡報使用。」
 *
 * 所以這一份活頁簿有三張表：數值（可改，改了圖跟著動）、原生折線圖、講稿文字。
 * 講稿放在自己的工作表，**不印在圖上**——那些話是簡報者要用講的。
 *
 * ⚠️ 表格裡寫的是畫面上那張圖**已經算好的那一份數值**，不是把彙總邏輯用
 * Excel 公式再實作一次。再實作一次就有第二套算法，兩套遲早分岔，
 * 而分岔時沒有人會發現——使用者只會看到 Excel 與網頁不一樣。
 */
$("trendDownloadXlsx").onclick = async () => {
  const list = trendSeriesList();
  if (!list.length) return toast("請先勾選至少一個指標");
  /* 各日別可能涵蓋不同季度，Excel 類別軸使用全部數列的季度聯集。 */
  const aligned = alignTrendSeriesForExcel(list, function (a, b) {
    return periodIndex(a) - periodIndex(b);
  });
  const periods = aligned.periods;
  if (!periods.length) return toast("目前的條件下沒有可匯出的季度");
  const labels = periods.map(function (period) {
    return projectPeriodLabel(period, state.activeCode);
  });
  /*
   * 序數指標（最差服務水準等級）不匯出成折線——A～F 是等級不是量，
   * 畫成折線會讓人以為 C 與 D 之間可以取平均。它的值留在說明工作表裡。
   */
  const series = aligned.series;
  if (!series.length)
    return toast("「最差服務水準等級」是等級不是數量，不適合做成折線圖；請再勾一個數值型指標");
  const sections = trendDescriptions(list).map(function (description) {
    return {
      title: description.title,
      /*
       * caveats 是陣列（「判讀時要注意」可能有好幾條），不是單一字串。
       * 寫成 description.caveat 會是 undefined，被 filter 掉之後整段
       * 注意事項就靜靜消失——而那正是業主最可能當場問的一段。
       */
      lines: [description.meaning, description.observed]
        .concat(description.caveats || [])
        .filter(Boolean),
    };
  });
  try {
    const blob = await TrendExcel.build(series, periods, labels, sections);
    downloadBlob(
      blob,
      ((state.activeCode || "計畫") + "_" + trendScopeText() + "_歷季趨勢.xlsx").replace(
        /[\\/:*?"<>|]/g,
        "_",
      ),
    );
    toast("可編輯 Excel 已下載：圖是原生 Excel 折線圖，說明文字在「圖表說明」工作表");
  } catch (e) {
    toast(e.message || "Excel 匯出失敗");
  }
};

/**
 * 三段圖的說明文字：複製到剪貼簿。
 *
 * ⚠️ 讀的是**畫面上那一份**（renderBandPanel 產生時留下的 lastBandScripts），不回頭重算。
 * 重算會出現「畫面上寫 A、複製出來是 B」——而被貼進報告的是複製出來的那一份。
 */
$("bandCopyScript").onclick = async () => {
  /*
   * ⚠️ 不可以再讀 #bandScriptBox 的 innerText——那個容器已經不存在了，
   *   而且說明現在預設收合，**收合的內容不會出現在 innerText 裡**，
   *   照舊寫法會安靜地只複製到標題那一行。
   *   改讀 renderBandPanel 產生畫面時留下的同一份文字。
   */
  const text = (lastBandScripts || []).join("\n\n").trim();
  if (!text) return toast("目前沒有可以複製的說明文字");
  const full =
    text + "\n\n本段文字由系統依圖上同一份資料自動產生，正式引用前請核對原始檔。";
  try {
    await navigator.clipboard.writeText(full);
    toast("三段圖的說明文字已複製，可以直接貼進簡報或報告");
  } catch {
    download(full, `三段圖說明_${state.activeCode || "計畫"}.txt`);
    toast("瀏覽器不允許複製，已改為下載成 .txt");
  }
};

$("trendCopyScript").onclick = async () => {
  const list = trendSeriesList();
  if (!list.length) return toast("請先勾選指標");
  const text = trendDescriptions(list).map(trendScript).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("說明文字已複製，可以直接貼進簡報或報告");
  } catch {
    /* 沒有剪貼簿權限時不要靜靜失敗，改成下載成檔案 */
    download(text, `趨勢圖說明_${state.activeCode || "計畫"}.txt`);
    toast("瀏覽器不允許複製，已改為下載成 .txt");
  }
};

/**
 * 把畫面上的 SVG 存成高解析（EXPORT_PNG_SCALE 倍）、白底的 PNG。
 * **只有圖，沒有文字。**
 *
 * 白底是必要的：PNG 透明底貼到深色投影片上，字會看不見。
 *
 * 為什麼不在圖片下方附說明文字——使用者的原話：
 * 「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，看到那些應該由
 * 簡報者說明的文字展示在上方這樣才奇怪。」說明是講的，不是印在投影片上的。
 * 說明文字留在畫面上圖的旁邊，並且有一顆「複製說明」可以貼進簡報備忘稿。
 */
async function downloadSvgAsPng(svg, fileName) {
  /*
   * ⚠️ 畫布的產生走 svgFigureToPngBlob，**不要再抄一份**。
   *   舊版這裡自己重寫了一次同樣的十行，於是倍率、白底這些規矩有兩個地方
   *   要改——實際發生的事情是只有一邊被改到，同一個系統下載到的圖
   *   解析度不一樣。
   */
  const blob = await svgFigureToPngBlob(svg);
  downloadBlob(blob, fileName.replace(/[\\/:*?"<>|]/g, "_"));
}
