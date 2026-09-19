/* Traffic LOS quality and delivery extension.
   版本字樣一律由 app.js 統一設定，本檔不得再寫入。
   This module does not change the representative-record or LOS formulas. */
(function () {
  "use strict";
  const q = (id) => document.getElementById(id);
  const clone = (x) => structuredClone(x);
  /*
   * 季度排序鍵。四碼年份一律視為西元、換算成民國，與另外兩支系統的
   * quarterOrderKey() 同一套規則。
   *
   * 舊版只認 2～3 碼，遇到西元寫法會回 -1 而排到最前面。寫入路徑現在已經
   * 一律正規化成民國年，理論上不會出現四碼；但**備份還原、手動編輯過的
   * 資料、以及外部匯入**都可能帶進來，排序鍵不該對它一無所知。
   */
  const periodKey = (v) => {
    const m = String(v || "").match(/^(\d{2,4})Q([1-4])$/);
    if (!m) return -1;
    const year = Number(m[1]);
    return (year >= 1000 ? year - 1911 : year) * 4 + Number(m[2]);
  };
  const ordered = (a) => [...new Set(a)].sort((x, y) => periodKey(x) - periodKey(y));
  const safe = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const downloadBlob = (blob, name) => triggerDownload(URL.createObjectURL(blob), name);
  const activeRows = () => state.details.filter((x) => x.projectCode === state.activeCode);
  const activeSummaries = () => state.summaries.filter((x) => x.projectCode === state.activeCode);
  const currentPeriod = () => `${q("rocYear")?.value || ""}Q${q("quarter")?.value || ""}`;

  function ensureState() {
    state.speedVersions = state.speedVersions || {};
    state.anomalyRules = state.anomalyRules || {};
    state.operations = state.operations || [];
    state.reportDrafts = state.reportDrafts || {};
    state.conclusionTemplates = state.conclusionTemplates || {};
    state.version = Math.max(Number(state.version) || 0, 10);
  }
  ensureState();
  // 版本字樣一律由 app.js 設定，這裡不要再寫一次。
  // 這支檔案在 index.html 裡排在 app.js 後面，先前這行把 app.js 剛寫上的
  // 版本又覆蓋成舊的，導致網站明明已更新、畫面卻永遠顯示上一版。

  function injectUI() {
    const importPanel = document.createElement("article");
    importPanel.className = "panel extension-panel";
    importPanel.id = "quarterDiffPanel";
    importPanel.innerHTML =
      '<div class="panel-head"><div><h3>與前一季差異檢查</h3><small>僅供寫入前核對，不改動資料</small></div><span class="status-neutral" id="diffStatus">尚未預覽</span></div><div id="diffContent" class="empty">完成辨識預覽後顯示</div><div id="representativePreview"></div>';
    q("roadAlert").after(importPanel);

    /*
     * ══════════════════════════════════════════════════════════════
     *  「來源追溯」——2026-09-16 起**不在畫面上**
     * ══════════════════════════════════════════════════════════════
     *
     * 使用者 2026-09-16：
     *   「交通服務水準的來源追朔功能，使用者用不到這資訊，如果你維護程式會用到的話，
     *     請你把這畫面放在程式碼給你看就好，使用者不須要查看這類資訊，
     *     讓程式看起來簡潔些」
     *
     * ⚠️ 拿掉的**只有那一塊畫面**。來源欄位本身一律照舊：
     *   ・`sourceFile` / `sourceSheet` / `sourceRefs` / `importBatch` / `sourceHash`
     *     照常在匯入時寫入每一筆（renderTrace 只是把它們列出來而已）。
     *   ・成果交付的 `*_來源追溯.json` **照常輸出**（維護／稽核靠那一份）。
     *   ・尖峰明細與彙總的搜尋框照常吃「來源儲存格」。
     *   拿掉欄位＝把追溯能力整個砍掉，那不是使用者要的。
     *
     * ⚠️ 要在畫面上看它時（只有維護會用到），在瀏覽器主控台貼：
     *     document.querySelector("#summary").insertAdjacentHTML("beforeend",
     *       '<details class="panel extension-panel trace-panel" id="summary-trace">'
     *       + TRACE_PANEL_HTML + '</details>');
     *     globalThis.LosQualityRenderTrace && globalThis.LosQualityRenderTrace();
     *   （TRACE_PANEL_HTML 就在下面這個常數，renderTrace 也還在。）
     *
     * ⚠️ 先前那一版是 <details>（預設收合，點小分頁自動展開，使用者 2026-09-14
     *   交辦）。整塊移出畫面之後，那條規則與它的守門（e2e-chart-page 第一節）
     *   一併改成「畫面上不可以有這一塊」。
     */
    const TRACE_PANEL_HTML =
      '<summary>來源追溯</summary><div class="panel-head"><div><small>搜尋尖峰明細並查看原始檔、工作表、標籤位置與批次</small></div><input id="traceSearch" placeholder="搜尋路段、季度或檔名"></div><div class="table-wrap"><table><thead><tr><th>期間／路段</th><th>代表資料</th><th>來源檔案</th><th>工作表</th><th>標籤位置</th><th>批次／驗證碼</th></tr></thead><tbody id="traceRows"></tbody></table></div>';
    /* 只留給上面那段主控台用法；正常執行時不插進畫面。 */
    globalThis.LosTracePanelHtml = TRACE_PANEL_HTML;

    const versionPanel = document.createElement("article");
    versionPanel.className = "panel extension-panel";
    versionPanel.id = "speedVersionPanel";
    /*
     * ⚠️ 常駐一句「不受主工具列影響」。
     *   這一塊設定的是**速限本身**（哪一段季度用哪一個速限），
     *   它是被主工具列篩選的那批資料的**輸入**，不是輸出——
     *   所以它不吃季度、路段、日別、方向與尖峰。
     *   不講的話，使用者在主工具列篩了 115Q2 之後切到這一頁，
     *   看到的是全部路段方向，只會以為篩選壞掉。
     *   （2026-09-15 大檢查：這一頁在此之前根本不在 e2e-filter-coverage
     *     的名單裡，所以這條規則從來沒在這一塊上驗過。）
     */
    versionPanel.innerHTML =
      '<p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：它設定的是<b>速限本身</b>（哪幾季套用哪一個速限），是計算的輸入而不是輸出，所以一律列出目前計畫的全部路段方向。</p><div class="panel-head"><div><h3>依季別區間／路段／方向套用不同速限</h3><small>季別是<b>區間</b>：起與迄都含在內，起＝迄就是只有那一季；迄留白就是「從那一季開始一直有效」。未設定時維持「路段速限」表裡該路段的基準速限。<b>與其他參數設定同一套概念</b>——差別只在速限多一個「方向」。</small></div></div><div class="version-grid"><label>路段／方向<select id="versionLimitKey"></select></label><label>公告速限（km/h）<input id="versionSpeed" type="number" min="1" value="50"></label><label>季別（起）<input id="versionStart" placeholder="例如 114Q1"></label><label>季別（迄）<input id="versionEnd" placeholder="持續有效可留白"></label><label>備註<input id="versionNote" placeholder="選填"></label></div><button class="primary" id="saveSpeedVersion">新增速限版本並重算</button><div class="table-wrap"><table><thead><tr><th>路段／方向</th><th>速限</th><th>季別區間</th><th>備註</th><th>操作</th></tr></thead><tbody id="speedVersionRows"></tbody></table></div><div class="orphan-panel orphan-inline" id="speedVersionOrphan" hidden><div class="panel-head"><div><h4>有速限版本指到已經不存在的路段／方向</h4><small>路段改名、合併或刪掉之後，原本針對那一段那個方向設的速限版本會變成<b>孤兒</b>：它永遠命不中任何一筆資料，但設定還留著，看起來像是有在生效。下面把每一條的<b>完整內容</b>列出來供核對——確認不需要了再按清除，清掉的內容<b>救不回來</b>。沒有孤兒時這一塊不會出現。</small></div><button class="outline" id="clearOrphanVersions">清除下列孤兒速限</button></div><div class="table-wrap"><table><thead><tr><th>指到的路段／方向</th><th>速限</th><th>季別區間</th><th>備註</th></tr></thead><tbody id="orphanVersionRows"></tbody></table></div></div>';
    q("speed").append(versionPanel);

    const quality = document.querySelector(".quality-panel");
    if (quality) {
      const rules = document.createElement("article");
      rules.className = "panel extension-panel";
      rules.innerHTML =
        '<p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：它設定的是<b>提醒門檻本身</b>（不改變 LOS 計算），不是資料。</p><div class="panel-head"><div><h3>異常提醒門檻</h3><small>只影響提醒，不改變 LOS 計算</small></div><button class="primary" id="saveAnomalyRules">儲存門檻並重檢</button></div><div class="four"><label>旅行速率下降（%）<input id="ruleSpeedDrop" type="number" min="1" max="100"></label><label>總延滯增加（%）<input id="ruleDelayRise" type="number" min="1" max="100"></label><label>LOS 下降級數<input id="ruleLosDrop" type="number" min="1" max="5"></label><label>連續惡化季度<input id="ruleStreak" type="number" min="2" max="12"></label></div>';
      quality.before(rules);
    }
    const priority = document.createElement("article");
    priority.className = "panel extension-panel";
    priority.id = "priorityPanel";
    priority.innerHTML =
      '<p class="chart-inapplicable" data-testid="chart-inapplicable" data-inapplicable="all" data-inapplicable-always="1">這一塊不受主工具列條件影響：它依這個計畫的全部資料自動排出需要優先檢視的路段，用途正是「先看哪一條」——跟著畫面上的篩選走就失去意義了。</p><div class="panel-head"><div><h3>重點路段總覽</h3><small>依目前計畫自動排列需優先檢視的路段</small></div><button class="outline" id="refreshPriority">重新分析</button></div><div class="table-wrap"><table><thead><tr><th>優先度</th><th>路段／日別</th><th>最近期間</th><th>變化原因</th><th>建議</th></tr></thead><tbody id="priorityRows"></tbody></table></div>';
    q("maintenance").append(priority);

    const deliveryButton = document.createElement("button");
    deliveryButton.dataset.view = "delivery";
    deliveryButton.textContent = "成果交付";
    document.querySelector('nav button[data-view="maintenance"]').after(deliveryButton);
    deliveryButton.onclick = () => go("delivery");
    titles.delivery = "成果交付";
    const delivery = document.createElement("section");
    delivery.id = "delivery";
    delivery.className = "view";
    delivery.innerHTML =
      '<div class="title"><div><span class="eyebrow">DELIVERY CENTER</span><h2>季度成果交付</h2><p>選擇季度與範圍，下載可追溯、可編輯的成果資料包。</p></div></div><div class="two"><article class="panel form"><h3>成果範圍</h3><p class="muted">可以只交付單一季度，也可以選擇一段期間（例如 114Q1～114Q4）一次交付。</p><div class="row"><label>起始季度<select id="deliveryPeriodStart"></select></label><label>結束季度<select id="deliveryPeriodEnd"></select></label></div><div class="note" id="deliveryRangeNote">尚無資料</div><label>路段<select id="deliveryRoad"><option value="">全部路段</option></select></label><label>日別<select id="deliveryDay"><option value="">平日與假日</option><option>平日</option><option>假日</option></select></label><label>方向<select id="deliveryDirection"><option value="">全部方向</option></select></label><label>尖峰<select id="deliveryPeak"><option value="">代表尖峰（同一組取最差）</option><option value="上午尖峰">上午尖峰</option><option value="下午尖峰">下午尖峰</option></select></label><label>小數位數<select id="deliveryDigits"><option value="0">0 位</option><option value="1" selected>1 位</option><option value="2">2 位</option></select></label><label>Excel 圖表內容<select id="deliveryMetric"><option value="travel">旅行速率（km/h）</option><option value="los">服務水準（A～F）</option></select></label><div class="check-grid"><label><input type="checkbox" id="packDetail" checked>尖峰明細</label><label><input type="checkbox" id="packSummary" checked>尖峰彙總</label><label><input type="checkbox" id="packQuality" checked>品質檢查</label><label><input type="checkbox" id="packNarrative" checked>分析文字草稿</label></div><button class="outline full" id="deliveryApplyMain" data-testid="delivery-apply-main">套用主工具列目前的條件<small>成果交付刻意與主工具列獨立（報告常要出一段和畫面不同的範圍）；要一鍵對齊就按這一顆。</small></button><button class="primary full" id="downloadQuarterPack">下載季度成果包 ZIP</button><button class="outline full" id="downloadFilteredCharts">匯出篩選後可編輯 Excel 圖表</button></article><article class="panel form"><h3>報告文字草稿</h3><p class="muted"><b>這一份是「這次交付的說明文字」</b>：依「成果範圍」設定的季度與路段，逐筆代表紀錄各寫一行，會隨 ZIP 成果包一起交出去。要自己挑條件（只寫某一季、某幾條路段、只寫服務水準…）請改用<b>「結論草稿」</b>。兩者的數字來源完全相同，都必須由使用者確認後再放入正式報告。</p><textarea id="reportDraft" rows="18"></textarea><div class="note" id="draftRecoverNote" hidden></div><div class="row"><button class="outline" id="generateDraft">重新產生</button><button class="primary" id="saveDraft">儲存修改</button></div></article></div>';
    q("backup").before(delivery);

    /*
     * ══════════════════════════════════════════════════════════════
     *  「版本差異與還原」——2026-09-16 起**不在畫面上**
     * ══════════════════════════════════════════════════════════════
     *
     * 使用者 2026-09-16：
     *   「三份程式這類版本差異與還原，只需要在程式碼裡給你看就好
     *     (要留幾筆資料也由你自行決定)，畫面上不用再展示出來了，
     *     使用者不會使用，因為不確定按了結果會如何。」
     *
     * ⚠️ 拿掉的**只有那一塊畫面**。還原點本身照舊：
     *   ・匯入、人工修改、刪除之前**照常自動拍快照**（watchButton 那一段）。
     *   ・保留 30 筆不變（UNDO_LIMIT）。它只存在 IndexedDB，不佔交付包體積；
     *     筆數再少會讓「上一季匯錯、下一季才發現」救不回來。
     *   ・專案包照常帶著它走（app.js 的專案包匯出／匯入）。
     *   把寫入一起砍掉＝拿掉整個系統唯一的安全網，那不是使用者要的。
     *
     * ⚠️ 維護時要看或要還原，在瀏覽器主控台貼：
     *     globalThis.LosUndoList()            // 列出還原點
     *     globalThis.LosUndoRestore("<id>")   // 還原到那一刻
     *   （面板 HTML 也留在 UNDO_PANEL_HTML，要看表格時插回 #backup 即可。）
     */
    const UNDO_PANEL_HTML =
      '<div class="panel-head"><div><h3>版本差異與還原</h3><small>匯入、人工修改與刪除之前都會自動留下還原點，最多保留最近 8 次。刪除還原點不會影響現在畫面上的任何資料。</small></div></div><div class="table-wrap"><table><thead><tr><th>時間</th><th>操作</th><th>計畫</th><th>操作</th></tr></thead><tbody id="operationRows"></tbody></table></div>';
    globalThis.LosUndoPanelHtml = UNDO_PANEL_HTML;
    const guide = document.createElement("article");
    guide.className = "panel extension-panel";
    /*
     * ⚠️ 這一塊是新手說明的第十一章，**純說明文字**，依使用者 2026-09-13
     *   的決定不列成左側小分頁（「新手使用說明全部小分頁都是說明用的文字，
     *   依照我們說好的，這類不用做成左側小分頁」）。
     *
     * ⚠️ 它是由**這一支**插進 #guide 的，不在 app.js 的 manual 包裹元素裡面，
     *   所以要自己掛標記——只改 app.js 的話，側欄會剩下這一項孤零零留著
     *   （實測就是如此：12 項拿掉 11 項，剩這一項）。
     */
    guide.setAttribute("data-nav-skip", "explanation");
    guide.innerHTML =
      "<h3>十一、資料品質與成果交付</h3><ol><li><b>匯入前：</b>在辨識預覽下方檢查與前一季的路段、平假日及4筆資料差異，再核對預計代表紀錄。</li><li><b>來源追溯：</b>到「尖峰彙總」下方搜尋原始檔名、工作表、標籤位置、批次及檔案驗證碼。</li><li><b>速限變更：</b>到「路段速限」新增一條「季別區間／路段／方向」的速限；系統只重算區間內的季度。</li><li><b>異常分析：</b>到「資料維護」設定提醒門檻並查看重點路段；提醒不會改變服務水準。</li><li><b>成果交付：</b>到「成果交付」選擇季度、路段及日別，下載 ZIP 或可編輯 Excel 圖表。自動文字僅為草稿，正式使用前必須人工核對。</li><li><b>操作復原：</b>到「備份與淨空」查看最近操作；匯入錯誤仍優先從「匯入紀錄」復原。</li></ol>";
    document.querySelector("#guide .warning").before(guide);
  }
  injectUI();

  function findSheetName(wb, targets) {
    const ns = targets.map(normalize);
    for (const t of ns) {
      const exact = wb.SheetNames.find((n) => normalize(n) === t);
      if (exact) return exact;
      const near = wb.SheetNames.find((n) => normalize(n).includes(t));
      if (near) return near;
    }
    return "";
  }
  function refsForSheet(wb, name) {
    if (!name) return [];
    const m = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }),
      labels = ["平均總旅行速率", "平均總行駛速率", "路段延滯", "交叉口延滯"],
      refs = [];
    for (const label of labels)
      for (const p of findLabels(m, label))
        refs.push(`${label}:${XLSX.utils.encode_cell({ r: p.r, c: p.c })}`);
    return refs;
  }
  async function digestFile(file) {
    try {
      const b = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return [...new Uint8Array(b)]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
    } catch {
      return "";
    }
  }
  const baseParseFile = parseFile;
  parseFile = async function (file, year, quarter, defSpeed) {
    const result = await baseParseFile(file, year, quarter, defSpeed);
    /*
     * 原型指紋要在 try **外面**取、也在外面比對。
     *
     * 放進 try 裡的話，assertNoPrototypePollution 丟出來的例外會被下面
     * 那個 catch 當成「來源追溯抓取失敗」吞掉——資料照常寫入，
     * 使用者只會看到溯源欄寫「本次讀取失敗」，完全看不出是安全中止。
     * 中止匯入這件事必須傳得出去。
     */
    const fingerprint = prototypeFingerprint();
    try {
      /*
       * ⚠️ 這是同一個檔案的**第二次**解析（為了抓來源儲存格位置）。
       *
       * 舊版在這裡自己寫了一組選項 { type, cellFormula }，少了
       * cellHTML:false 與 bookVBA:false，而且解析後沒有比對原型——
       * 等於 app.js 那一整套加固在這條路徑上完全不生效。
       * 更糟的是守門測試 xlsx-hardening.test.mjs 只讀 app.js，
       * 所以這個缺口一直是綠燈。實測：讓這一次解析污染 Object.prototype，
       * 匯入照常完成、畫面顯示「新增 4，重複 0」，沒有任何警告。
       *
       * 現在改用同一組 SAFE_XLSX_READ_OPTIONS，並在解析後立刻比對原型。
       */
      const wb = XLSX.read(await file.arrayBuffer(), SAFE_XLSX_READ_OPTIONS),
        am = findSheetName(wb, ["上午尖峰", "上午", "AM尖峰", "AM"]),
        pm = findSheetName(wb, ["下午尖峰", "下午", "PM尖峰", "PM"]),
        hash = await digestFile(file),
        maps = {
          上午尖峰: { sheet: am, refs: refsForSheet(wb, am) },
          下午尖峰: { sheet: pm, refs: refsForSheet(wb, pm) },
        };
      result.rows.forEach((r) =>
        Object.assign(r, {
          sourceFile: file.name,
          sourceSheet: maps[r.peak]?.sheet || "",
          sourceRefs: maps[r.peak]?.refs || [],
          sourceHash: hash,
        }),
      );
    } catch {
      /*
       * 舊版靜靜吞掉：資料照常寫入，但少了 sourceFile/sourceSheet/sourceRefs，
       * 於是「資料溯源」表顯示「舊資料未記錄」——把**這次抓取失敗**呈現成
       * **這是舊版匯入的資料**。這是稽核用的畫面，誤導的成本不低。
       * 畫面上「本次讀取失敗」那條分支早就寫好了，只是從來沒有地方寫入旗標。
       */
      result.rows.forEach((r) => {
        if (!r.sourceFile) r.sourceFile = file.name;
        r.sourceTraceFailed = true;
      });
    }
    /* 第二次解析也可能污染原型；這裡比對並在被污染時中止整批匯入。 */
    assertNoPrototypePollution(fingerprint, file.name);
    return result;
  };

  function priorPeriod(period) {
    const all = ordered(
      activeRows()
        .map((x) => x.period)
        .concat(period),
    ).filter((x) => periodKey(x) < periodKey(period));
    return all.at(-1) || "";
  }
  function previewDifferences() {
    if (!pending.length) {
      q("diffStatus").textContent = "尚未預覽";
      q("diffContent").innerHTML = '<div class="empty">完成辨識預覽後顯示</div>';
      q("representativePreview").innerHTML = "";
      return;
    }
    const period = currentPeriod(),
      prev = priorPeriod(period),
      good = pending.filter((x) => x.ok),
      newRoads = [...new Set(good.filter((x) => x.matchType === "新路段").map((x) => x.road))],
      incoming = new Set(
        good.map((x) => (x.roadChoice && x.roadChoice !== "__NEW__" ? x.roadChoice : x.road)),
      ),
      previous = prev
        ? new Set(
            activeRows()
              .filter((x) => x.period === prev)
              .map((x) => x.road),
          )
        : new Set(),
      missing = [...previous].filter((x) => !incoming.has(x)),
      groups = good.filter((x) => x.rows.length !== 4),
      dayMap = {};
    good.forEach((x) => (dayMap[x.road] ??= new Set()).add(x.day));
    const missingDays = Object.entries(dayMap)
      .filter(([, v]) => !v.has("平日") || !v.has("假日"))
      .map(([k, v]) => `${k}（${[...v].join("、") || "無"}）`);
    const warnings = newRoads.length + missing.length + groups.length + missingDays.length;
    q("diffStatus").textContent = warnings ? `${warnings} 類需確認` : "未發現結構差異";
    q("diffStatus").className = warnings ? "status-warn" : "status-ok";
    q("diffContent").innerHTML =
      `<div class="diff-grid"><div><b>比較基準</b><span>${prev || "沒有前一季資料"}</span></div><div><b>新路段</b><span>${newRoads.length ? newRoads.map(safe).join("、") : "無"}</span></div><div><b>前季有、本季未出現</b><span>${missing.length ? missing.map(safe).join("、") : "無"}</span></div><div><b>平假日不成對</b><span>${missingDays.length ? missingDays.map(safe).join("、") : "無"}</span></div><div><b>非4筆資料檔</b><span>${groups.length ? groups.map((x) => safe(x.file)).join("、") : "無"}</span></div></div>`;
    const candidates = good
      .map((item) => {
        const rows = [...item.rows].sort(
            (a, b) =>
              (losRank[a.los] || 9) - (losRank[b.los] || 9) ||
              (a.ratio ?? 9) - (b.ratio ?? 9) ||
              (a.travel ?? 999) - (b.travel ?? 999),
          ),
          w = rows[0];
        return w
          ? `<tr><td>${safe(item.road)}</td><td>${safe(item.day)}</td><td>${safe(w.peak)}</td><td>${safe(rowDirectionName(w))}</td><td>${fmt(w.travel, 2)}</td><td>${fmt(w.running, 2)}</td><td>${fmt(w.totalDelay, 2)}</td><td>${losChip(w.los)}</td><td>${safe(w.sourceSheet || "—")}</td></tr>`
          : "";
      })
      .join("");
    q("representativePreview").innerHTML =
      `<h4>預計代表紀錄（尚未寫入）</h4><div class="table-wrap"><table><thead><tr><th>路段</th><th>日別</th><th>代表尖峰</th><th>方向</th><th>旅行速率</th><th>行駛速率</th><th>總延滯</th><th>LOS</th><th>來源工作表</th></tr></thead><tbody>${candidates}</tbody></table></div>`;
  }
  /*
   * 預覽顯示的速限與 LOS 必須是「實際會寫進去的那一組」。
   *
   * 問題：parseFile 是用**檔案裡那個路段名**去查速限算 LOS 的；使用者在預覽
   * 選「合併至既有路段」（或別名自動相符）之後，真正生效的是**目標路段**的
   * 速限——但那要等按下「確認寫入」時 remapPending 才換，而寫入後 rebuild
   * 還會再依速限版本重算一次。於是預覽表與「預計代表紀錄」顯示的是一組數字，
   * 寫進去的是另一組。
   *
   * 實測：目標路段速限 80、來源退回預設 50，同一批旅行速率
   *   預覽 → 速限比 0.4220 → LOS D
   *   寫入 → 速限比 0.2638 → LOS E
   * 四筆全部差一級，代表紀錄的等級也跟著變。而手冊要使用者「寫入前務必核對」。
   *
   * 更麻煩的是合併會寫進別名，下一季同名檔案直接是「別名相符」、自動帶入，
   * 使用者什麼都不用做就會再看到一次錯的預覽。
   *
   * 這裡在每次重畫預覽時，用**與 rebuild 相同的規則**（速限版本優先，
   * 其次 state.limits，都沒有才沿用解析當下的值）重算，讓預覽等於結果。
   * 不影響任何已寫入的資料：commit 之後仍然照原本的 remapPending → upsert
   * → rebuild 流程走一次。
   */
  function previewWriteTarget(item) {
    return item.roadChoice && item.roadChoice !== "__NEW__" ? item.roadChoice : item.road;
  }
  const parsedPreviewLimits = new WeakMap();
  function syncPreviewLimits() {
    if (!Array.isArray(pending)) return;
    for (const item of pending) {
      if (!item || !item.ok || !Array.isArray(item.rows)) continue;
      const target = previewWriteTarget(item);
      for (const row of item.rows) {
        /* 記住解析當下的值，使用者改回「新路段」時才回得去 */
        if (!parsedPreviewLimits.has(row)) parsedPreviewLimits.set(row, row.limit);
        const version = speedFor({ ...row, road: target });
        const base = Number(state.limits[`${row.projectCode}|${target}|${row.direction}`]);
        row.limit = version
          ? Number(version.speed)
          : Number.isFinite(base) && base > 0
            ? base
            : parsedPreviewLimits.get(row);
        /* ⚠️ 查證來源已移除，新版本不會有 source；舊資料若有就沿用。 */
        row.limitSource = version ? version.source || "" : "";
        row.limitVersionStart = version ? version.start : "";
        row.ratio = row.travel == null || !row.limit ? null : row.travel / row.limit;
        /* ⚠️ 傳季別與路段：門檻可以依「季別 × 路段」覆寫（使用者 2026-09-15）。
           不傳的話，預覽顯示的等級會與寫入後不同。 */
        row.los = losOf(row.ratio, undefined, row.period, row.road);
      }
    }
  }

  const baseRenderPreview = renderPreview;
  renderPreview = function () {
    syncPreviewLimits();
    baseRenderPreview();
    previewDifferences();
  };

  function speedFor(row) {
    const key = `${row.projectCode}|${row.road}|${row.direction}`,
      versions = state.speedVersions[key] || [],
      hit = versions
        .filter(
          (v) =>
            periodKey(row.period) >= periodKey(v.start) &&
            (!v.end || periodKey(row.period) <= periodKey(v.end)),
        )
        // 開始季度相同時取「後來新增的那一個版本」，與畫面上的說明一致。
        .sort(
          (a, b) =>
            periodKey(b.start) - periodKey(a.start) ||
            String(b.id || "").localeCompare(String(a.id || "")),
        )[0];
    return hit || null;
  }
  // 匯入預覽（app.js）也要算得出版本速限，否則預覽與寫入後的 LOS 會不一致。
  globalThis.speedVersionFor = speedFor;
  const baseRebuild = rebuild;
  rebuild = function () {
    ensureState();
    // 每一筆都要重新決定速限，不能只處理「有版本」的那些。
    // 舊版沒有 else 分支，刪掉某個速限版本之後，受影響的資料仍然留著版本速限，
    // 「路段速限」頁顯示 50、明細與彙總卻還在用 90，兩邊永遠對不起來。
    for (const d of state.details) {
      const version = speedFor(d);
      const base = Number(state.limits[`${d.projectCode}|${d.road}|${d.direction}`]);
      d.limit = version ? Number(version.speed) : Number.isFinite(base) && base > 0 ? base : 50;
      d.limitSource = version ? version.source || "" : "";
      d.limitVersionStart = version ? version.start : "";
      d.ratio = d.travel == null || !d.limit ? null : d.travel / d.limit;
    }
    baseRebuild();
  };

  function renderTrace() {
    if (!q("traceRows")) return;
    const term = normalize(q("traceSearch").value || ""),
      rows = activeRows().filter(
        (x) =>
          !term ||
          normalize([x.period, x.road, x.sourceFile, x.sourceSheet].join(" ")).includes(term),
      );
    /*
     * ⚠️ 只顯示前 N 筆**本身不是錯，不講才是錯**。
     *
     * 使用者 2026-09-13（在匯入「需注意」上發現同一類毛病）：
     *   「有 22 筆提醒項目，但底下列出的並沒有這麼多，感覺只是展示前幾筆而已」。
     *
     * 這裡的 500 筆上限是為了效能（來源追溯可能上萬列），所以**保留上限**，
     * 但一定要在表尾明講還有幾筆沒顯示、以及該怎麼縮小範圍——
     * 否則使用者會以為那幾筆不存在。
     */
    const LIMIT = 500;
    const hidden = Math.max(0, rows.length - LIMIT);
    q("traceRows").innerHTML = rows.length
      ? rows
          .slice(0, LIMIT)
          .map(
            (x) =>
              `<tr><td>${safe(showQuarter(x.period))}<br>${safe(x.road)}／${safe(x.day)}</td><td>${safe(x.peak)}／${safe(rowDirectionName(x))}</td><td>${safe(x.sourceFile || x.source || "舊資料未記錄")}</td><td>${safe(x.sourceSheet || (x.sourceTraceFailed ? "本次讀取失敗" : "舊資料未記錄"))}</td><td>${safe((x.sourceRefs || []).join("、") || (x.sourceTraceFailed ? "本次讀取失敗" : "舊資料未記錄"))}</td><td>${safe(x.importBatch || "—")}<br><small>${safe(x.sourceHash || "—")}</small></td></tr>`,
          )
          .join("") +
        (hidden
          ? `<tr class="trace-more"><td colspan="6">另有 <b>${hidden}</b> 筆未顯示（一次最多列 ${LIMIT} 筆）。請用上方的搜尋縮小範圍。</td></tr>`
          : "")
      : '<tr><td colspan="6" class="empty">沒有符合的來源紀錄</td></tr>';
  }
  /*
   * ⚠️ 來源追溯自 2026-09-16 起不插進畫面，這裡一定要擋 null——
   *   少了這一行，整支 quality-extension 會在載入時就炸掉（畫面全白）。
   *   維護時手動插回那一塊之後，呼叫 globalThis.LosQualityRenderTrace() 即可。
   */
  if (q("traceSearch")) q("traceSearch").oninput = renderTrace;
  globalThis.LosQualityRenderTrace = renderTrace;

  function speedKeys() {
    return [
      ...new Set(activeRows().map((x) => `${x.projectCode}|${x.road}|${x.direction}`)),
    ].sort();
  }
  function renderSpeedVersions() {
    if (!q("versionLimitKey")) return;
    const keys = speedKeys(),
      old = q("versionLimitKey").value;
    q("versionLimitKey").innerHTML =
      keys
        .map((k) => {
          const p = k.split("|"),
            dir = p.pop(),
            road = p.pop();
          return `<option value="${safe(k)}">${safe(road)}／${safe(directionNameFor(road, dir))}</option>`;
        })
        .join("") || '<option value="">尚無路段</option>';
    if (keys.includes(old)) q("versionLimitKey").value = old;
    const all = keys
      .flatMap((k) => (state.speedVersions[k] || []).map((v) => ({ k, ...v })))
      .sort((a, b) => periodKey(b.start) - periodKey(a.start));
    q("speedVersionRows").innerHTML = all.length
      ? all
          .map((v, i) => {
            const p = v.k.split("|"),
              dir = p.pop(),
              road = p.pop();
            /*
             * ⚠️ 季別區間要寫成使用者看得懂的一句話，而且**季別的寫法要與全站一致**
             *   （民國／西元、季別／調查月份）——這裡走 showQuarter，不可以印原始鍵值。
             * ⚠️ 查證來源／日期／人員三欄已於 2026-09-15 移除：
             *   使用者原話「查證來源／日期／人員這些欄位可以拿掉，使用者不會做這些紀錄」。
             *   舊資料裡可能還留著那三個欄位，**不顯示但也不刪**——
             *   刪掉等於幫使用者丟東西，而且救不回來。
             */
            const range = v.end
              ? `${safe(showQuarter(v.start))}～${safe(showQuarter(v.end))}`
              : `${safe(showQuarter(v.start))} 起持續`;
            return `<tr><td>${safe(road)}／${safe(directionNameFor(road, dir))}</td><td>${v.speed} km/h</td><td>${range}</td><td>${safe(v.note || "—")}</td><td><button class="outline" data-remove-version="${safe(v.k)}" data-version-id="${safe(v.id)}">刪除</button></td></tr>`;
          })
          .join("")
      : '<tr><td colspan="6" class="empty">尚未設定期間版本，沿用上方路段速限</td></tr>';
    document.querySelectorAll("[data-remove-version]").forEach(
      (b) =>
        (b.onclick = async () => {
          recordOperation("刪除速限版本");
          state.speedVersions[b.dataset.removeVersion] = (
            state.speedVersions[b.dataset.removeVersion] || []
          ).filter((v) => v.id !== b.dataset.versionId);
          rebuild();
          await save();
          toast("速限版本已刪除並重算");
        }),
    );
    renderSpeedVersionOrphans();
  }
  /*
   * ══════════════════════════════════════════════════════════════════
   *  孤兒速限版本：指到一個已經不存在的路段／方向
   * ══════════════════════════════════════════════════════════════════
   *
   * 與判定標準那一頁的「孤兒覆寫」同一套作法與同一套理由：
   * 路段被改名、合併或整批刪掉之後，針對那一段設的速限版本還留在
   * state.speedVersions 裡，但 speedFor() 查的鍵值是「現在這筆資料的
   * 路段＋方向」，所以它**永遠命不中**——那幾季悄悄退回基準速限 50，
   * 而畫面上什麼都沒說。
   *
   * ⚠️ 平常完全不出現；偵測到才整塊冒出來，並且寫出完整內容
   *   （路段／方向、速限、季別區間、備註），不是只報一個數量。
   * ⚠️ 只在「這個計畫確實有資料」時才判定，理由與 app.js 那一支相同：
   *   還沒匯入時鍵值清單本來就是空的，那時全部標成孤兒等於幫使用者丟設定。
   * ⚠️ 只看**這個計畫**的鍵值（前綴 `code|`）。別的計畫的速限版本
   *   本來就不該出現在這一頁，更不可以被這顆按鈕清掉。
   */
  function orphanVersionEntries() {
    const rows = activeRows();
    if (!rows.length) return [];
    const alive = new Set(speedKeys());
    const prefix = `${state.activeCode}|`;
    const out = [];
    for (const key of Object.keys(state.speedVersions || {})) {
      if (!key.startsWith(prefix) || alive.has(key)) continue;
      const list = (state.speedVersions[key] || []).filter(Boolean);
      if (!list.length) continue;
      const parts = key.split("|"),
        dir = parts.pop(),
        road = parts.pop();
      for (const version of list)
        out.push({
          key,
          road,
          /*
           * ⚠️ 方向名稱要盡量還原成使用者取的名字。路段已經不在了，
           *   directionNameFor 可能查不到，那就退回內部代號——
           *   印「方向2」總比印空白好，至少對得起來。
           */
          label: `${road}／${directionNameFor(road, dir) || dir}`,
          speed: version.speed,
          range: version.end
            ? `${showQuarter(version.start)}～${showQuarter(version.end)}`
            : `${showQuarter(version.start)} 起持續`,
          note: version.note || "—",
        });
    }
    return out;
  }
  function renderSpeedVersionOrphans() {
    const host = q("speedVersionOrphan"),
      rowsHost = q("orphanVersionRows");
    if (!host || !rowsHost) return;
    const list = orphanVersionEntries();
    host.hidden = list.length === 0;
    rowsHost.innerHTML = list
      .map(
        (item) =>
          `<tr><td>${safe(item.label)}</td><td>${safe(item.speed)} km/h</td><td>${safe(item.range)}</td><td>${safe(item.note)}</td></tr>`,
      )
      .join("");
    const button = q("clearOrphanVersions");
    if (button)
      button.onclick = async () => {
        const again = orphanVersionEntries();
        if (!again.length) return toast("目前沒有指到不存在路段的速限版本");
        if (
          !confirm(
            `確定清除這 ${again.length} 條指到不存在路段／方向的速限版本？清掉之後救不回來。`,
          )
        )
          return;
        recordOperation("清除孤兒速限版本");
        for (const key of new Set(again.map((item) => item.key)))
          delete state.speedVersions[key];
        rebuild();
        await save();
        renderAll();
        toast(`已清除 ${again.length} 條指到不存在路段的速限版本`);
      };
  }
  q("saveSpeedVersion").onclick = async () => {
    const key = q("versionLimitKey").value,
      start = q("versionStart").value.trim().toUpperCase(),
      end = q("versionEnd").value.trim().toUpperCase(),
      speed = Number(q("versionSpeed").value);
    if (!key || !validPeriod(start) || !start || !validPeriod(end) || !speed)
      return toast("請輸入路段、有效速限及正確季度");
    // `!speed` 只擋掉 0 與空白，負數會通過；速限版本一旦存成負值，
    // 套用到的每一季旅行速率比都會變成負數，服務水準全部掉到 F。
    if (!Number.isFinite(speed) || speed <= 0)
      return toast("速限必須大於 0");
    if (end && periodKey(start) > periodKey(end)) return toast("結束季度不可早於開始季度");
    const existing = state.speedVersions[key] || [],
      overlap = existing.some(
        (v) =>
          periodKey(start) <= periodKey(v.end || "999Q4") &&
          periodKey(v.start) <= periodKey(end || "999Q4"),
      );
    if (
      overlap &&
      !confirm("此期間與既有速限版本重疊，系統將以開始季度較新的版本優先。仍要儲存嗎？")
    )
      return;
    recordOperation("新增速限版本");
    (state.speedVersions[key] ??= []).push({
      id: `SV${Date.now()}`,
      speed,
      start,
      end,
      /*
       * ⚠️ 查證來源／日期／人員三欄已於 2026-09-15 移除（使用者：
       *   「這些欄位可以拿掉，使用者不會做這些紀錄」）。
       *   這裡不再寫入；舊資料裡既有的值保留不動，只是畫面上不顯示。
       */
      note: q("versionNote").value.trim(),
    });
    /*
     * 不可以順手把「基準速限」標成已人工確認。
     *
     * 速限版本只涵蓋它自己的季度區間；區間外的季度用的還是那個沒被確認過的
     * 預設值 50。舊版在這裡把 limitConfirmed 設成 true，於是「速限未確認」
     * 的資料異常檢查提示整條消失，而真正還在用未確認預設值的，正是版本沒涵蓋到
     * 的那些季度——手冊自己說這是「最容易發生也最嚴重的錯誤」。
     */
    rebuild();
    await save();
    toast(
      "速限版本已儲存，相關季度 LOS 已重算。（版本未涵蓋的季度仍使用基準速限，請另外到上方確認）",
    );
  };

  function operationSnapshot() {
    const code = state.activeCode;
    return {
      projects: clone(state.projects),
      activeCode: code,
      details: clone(state.details.filter((x) => x.projectCode === code)),
      limits: Object.fromEntries(
        Object.entries(state.limits).filter(([k]) => k.startsWith(`${code}|`)),
      ),
      limitConfirmed: Object.fromEntries(
        Object.entries(state.limitConfirmed).filter(([k]) => k.startsWith(`${code}|`)),
      ),
      aliases: Object.fromEntries(
        Object.entries(state.aliases).filter(([k]) => k.startsWith(`${code}|`)),
      ),
      roadMeta: Object.fromEntries(
        Object.entries(state.roadMeta).filter(([k]) => k.startsWith(`${code}|`)),
      ),
      speedVersions: Object.fromEntries(
        Object.entries(state.speedVersions).filter(([k]) => k.startsWith(`${code}|`)),
      ),
      reportDrafts: Object.fromEntries(
        Object.entries(state.reportDrafts || {}).filter(([k]) =>
          k.startsWith(`${code}|`),
        ),
      ),
      losRule: clone(state.losRules[code] || null),
      /*
       * ⚠️ 本版補上的四樣。舊版的快照少了它們，於是
       * 「復原」之後分段規則、異常門檻、報告草稿與結論範本停在**操作後**
       * 的值，而其他東西回到操作前——畫面上看起來像復原成功了，
       * 實際上是一個兩邊拼起來、從來沒有存在過的狀態。
       *
       * 判斷依據不是「我覺得該存什麼」，是拿 projectPackage()（單一計畫
       * 備份帶走的東西）逐項比對：備份帶得走的，快照就要留得住。
       */
      bandRule: clone(state.bandRules?.[code] || null),
      anomalyRule: clone(state.anomalyRules?.[code] || null),
      conclusionTemplates: clone(state.conclusionTemplates?.[code] || null),
      /*
       * 匯入批次紀錄也要一起存。
       * 匯入前留的還原點若不含 imports，復原之後資料回到匯入前、
       * 但「匯入紀錄」那一頁仍然列著那一批——使用者會以為匯入還在。
       */
      imports: clone(
        (state.imports || []).filter((x) => x.projectCode === code),
      ),
    };
  }

  /**
   * 還原點保留幾筆。
   *
   * ⚠️ 2026-09-16 由 30 降到 **8**，與路口轉向（2026-09-15 已降）一致。
   *
   * 理由：畫面上那一塊已經移除（使用者 2026-09-16：「使用者不會使用，
   *   因為不確定按了結果會如何」），所以這份紀錄現在是**純維護用**，
   *   不是使用者的救援路徑；使用者真正會做的是「刪掉那一季重新匯入」
   *   與「還原備份檔」。
   *   而每一筆快照是**整個計畫的資料**，又會跟著專案包一起匯出——
   *   留 30 筆等於讓每一份備份檔多帶 30 份沒有人會看的副本。
   *   使用者 2026-09-15：「不要明明只需要前 10 筆，你卻讓程式硬是留 100 筆
   *   來增加儲存空間的負荷」。
   *
   * 選 8 的依據：維護時要回答的是「剛才那幾步做了什麼」，
   * 8 次操作足以涵蓋一輪匯入＋幾次人工修正。
   */
  const RESTORE_POINT_LIMIT = 8;
  function recordOperation(name) {
    ensureState();
    state.operations.unshift({
      id: `OP${Date.now()}${Math.random()}`,
      name,
      time: new Date().toLocaleString("zh-TW"),
      projectCode: state.activeCode,
      snapshot: operationSnapshot(),
      status: "可復原",
    });
    state.operations = state.operations.slice(0, RESTORE_POINT_LIMIT);
  }
  async function undoOperation(id) {
    const op = state.operations.find((x) => x.id === id);
    if (!op || op.status !== "可復原" || !confirm(`確定復原「${op.name}」？目前狀態會先下載備份。`))
      return;
    downloadProjectPackage(false);
    const s = op.snapshot,
      code = s.activeCode;
    state.details = state.details.filter((x) => x.projectCode !== code).concat(s.details);
    for (const bag of ["limits", "limitConfirmed", "aliases", "roadMeta", "speedVersions"]) {
      for (const k of Object.keys(state[bag])) if (k.startsWith(`${code}|`)) delete state[bag][k];
      Object.assign(state[bag], s[bag] || {});
    }
    if (s.losRule) state.losRules[code] = s.losRule;
    else delete state.losRules[code];
    /*
     * ⚠️ 「有值就寫、沒值就刪」——不可以只寫不刪。
     *   只寫的話，「操作前沒有設定、操作中新增了一筆」這種情形復原不掉：
     *   復原後那一筆還在，而使用者被告知已經復原。
     *
     * ⚠️ 舊快照沒有這幾個欄位，會是 undefined。
     *   undefined 代表「這一版沒有存」，不是「當時沒有設定」——
     *   當成「沒有設定」去刪，會把使用者現在的設定刪掉。所以用
     *   `in` 判斷欄位存不存在，而不是看值是不是 falsy。
     */
    if ("bandRule" in s) {
      if (s.bandRule) state.bandRules[code] = s.bandRule;
      else delete state.bandRules[code];
    }
    if ("anomalyRule" in s) {
      if (s.anomalyRule) state.anomalyRules[code] = s.anomalyRule;
      else delete state.anomalyRules[code];
    }
    if ("conclusionTemplates" in s) {
      state.conclusionTemplates = state.conclusionTemplates || {};
      if (s.conclusionTemplates)
        state.conclusionTemplates[code] = s.conclusionTemplates;
      else delete state.conclusionTemplates[code];
    }
    if ("reportDrafts" in s) {
      for (const k of Object.keys(state.reportDrafts || {}))
        if (k.startsWith(`${code}|`)) delete state.reportDrafts[k];
      Object.assign(state.reportDrafts, s.reportDrafts || {});
    }
    if ("imports" in s) {
      state.imports = (state.imports || [])
        .filter((x) => x.projectCode !== code)
        .concat(s.imports || []);
    }
    op.status = "已復原";
    rebuild();
    await save();
    toast("操作已復原");
  }
  function renderOperations() {
    if (!q("operationRows")) return;
    const rows = state.operations.filter(
      (x) => !x.projectCode || x.projectCode === state.activeCode,
    );
    q("operationRows").innerHTML = rows.length
      ? rows
          .map(
            (x) =>
              `<tr><td>${safe(x.time)}</td><td>${safe(x.name)}</td><td>${safe(x.projectCode)}</td><td>${x.status === "可復原" ? `<button class="outline" data-undo-operation="${safe(x.id)}">還原此版本</button>` : safe(x.status)} <button class="outline" data-drop-operation="${safe(x.id)}">刪除這個還原點</button></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4" class="empty">尚無可復原操作</td></tr>';
    document
      .querySelectorAll("[data-undo-operation]")
      .forEach((b) => (b.onclick = () => undoOperation(b.dataset.undoOperation)));
    /*
     * 刪除單一還原點。面板上明寫「刪除還原點不會影響現在畫面上的任何資料」，
     * 那句話必須是真的——所以這裡**只動 state.operations**，
     * 一個字都不碰 details／limits／roadMeta 等實際資料。
     */
    document.querySelectorAll("[data-drop-operation]").forEach(
      (b) =>
        (b.onclick = async () => {
          const op = state.operations.find((x) => x.id === b.dataset.dropOperation);
          if (!op) return;
          if (!confirm(`確定刪除這個還原點？\n\n「${op.name}」（${op.time}）\n\n刪除之後就無法退回那一刻，但現在畫面上的資料完全不受影響。`))
            return;
          await dropOperation(b.dataset.dropOperation);
          toast("已刪除這個還原點；現有資料沒有變動");
        }),
    );
  }
  /*
   * 刪除單一還原點。
   *
   * ⚠️ **只動 state.operations**，一個字都不碰 details／limits／roadMeta
   *   等實際資料——「刪除還原點不會影響現在畫面上的任何資料」這句話必須是真的。
   * ⚠️ 抽成具名函式是為了讓守門（e2e-restore-point）走**與畫面同一條路**。
   *   面板拿掉之後若讓守門自己改 state，等於守門在驗它自己寫的程式。
   */
  async function dropOperation(id) {
    if (!state.operations.some((x) => x.id === id)) return false;
    state.operations = state.operations.filter((x) => x.id !== id);
    await save();
    return true;
  }
  /*
   * ⚠️ 面板自 2026-09-16 起不在畫面上（見 injectUI 的說明）。
   *   還原能力仍然完整，只是改由維護在主控台呼叫：
   *     globalThis.LosUndoList()            // 列出還原點
   *     globalThis.LosUndoRestore("<id>")   // 還原到那一刻
   *   ⚠️ 不可以把 undoOperation 一起刪掉——刪掉就真的救不回來了。
   */
  globalThis.LosUndoList = function () {
    return (state.operations || []).map(function (x) {
      return {
        id: x.id,
        time: x.time,
        name: x.name,
        projectCode: x.projectCode,
        status: x.status,
      };
    });
  };
  globalThis.LosUndoRestore = undoOperation;
  globalThis.LosUndoDrop = dropOperation;
  /*
   * 監看一顆按鈕：按下去之前先拍一張快照，等操作真的改變了資料才記下來。
   *
   * ⚠️ 一、**用委派**（監聽 document），不是直接綁在按鈕上。
   *   有幾顆按鈕是動態重繪的——例如「備份後確認執行」（confirmRoadChange）
   *   每次預覽都會被 innerHTML 整個換掉。直接綁在元素上的話，換掉之後
   *   監聽就消失了，而**畫面上完全看不出來**：按鈕照樣能按、操作照樣完成，
   *   只是從此不再留還原點。這正是使用者說的「要過很久才知道」的那種壞法。
   *
   * ⚠️ 二、**要等到真的改變為止，不能只等 400 毫秒**。
   *   匯入一次幾十份檔案要跑好幾秒；固定等 400ms 再比對，那時候資料還沒
   *   寫進去，比對結果是「沒有改變」→ 不留還原點，而使用者以為留了。
   *   改成逐次拉長的輪詢（0.25／0.5／1／2／4／8 秒），一偵測到改變就記下來
   *   並停止；整段時間內都沒有改變才真的不記（那代表這次操作什麼都沒做，
   *   本來就不該留一筆「可復原」的紀錄）。
   *
   * ⚠️ 三、快照是在**點擊的捕獲階段**拍的，早於按鈕自己的 onclick，
   *   所以拍到的一定是「動手前」的狀態。
   */
  const OBSERVE_DELAYS = [250, 500, 1000, 2000, 4000, 8000];
  function observeOperation(id) {
    document.addEventListener(
      "click",
      (event) => {
        const button =
          event.target instanceof Element ? event.target.closest(`#${id}`) : null;
        if (!button || button.disabled) return;
        const before = operationSnapshot(),
          fingerprint = JSON.stringify(before),
          name = button.textContent.trim() || id;
        let step = 0;
        const check = () => {
          if (JSON.stringify(operationSnapshot()) === fingerprint) {
            step += 1;
            if (step < OBSERVE_DELAYS.length)
              setTimeout(check, OBSERVE_DELAYS[step]);
            return;
          }
          ensureState();
          state.operations.unshift({
            id: `OP${Date.now()}${Math.random()}`,
            name,
            time: new Date().toLocaleString("zh-TW"),
            projectCode: before.activeCode,
            snapshot: before,
            status: "可復原",
          });
          state.operations = state.operations.slice(0, RESTORE_POINT_LIMIT);
          void save();
        };
        setTimeout(check, OBSERVE_DELAYS[0]);
      },
      true,
    );
  }
  function protectHighImpactButton(id, impact) {
    const button = q(id),
      original = button?.onclick;
    if (!button || !original) return;
    button.onclick = null;
    button.addEventListener("click", async () => {
      const info = impact();
      if (!info.ok) {
        // 擋下來時要把畫面還原成儲存的內容，不要讓無效的值留在欄位裡
        // 看起來像已經生效了。
        if (typeof info.rerender === "function") info.rerender();
        return toast(info.message);
      }
      /*
       * ⚠️ `skipBackup`：這一次**不會改動任何數值**（例如速限維持原值、
       *   只是把它標成「已人工確認」）。那種操作沒有東西需要還原，
       *   先下載一份一模一樣的備份、再留一個還原點，只會讓使用者
       *   以為剛才改了什麼。
       */
      const confirmText = info.skipBackup
        ? `${info.title}\n\n${info.detail}\n\n這一次不會改動任何數值，所以不另外下載備份。確定繼續嗎？`
        : `${info.title}\n\n${info.detail}\n\n系統將先下載目前 Project 備份。確定繼續嗎？`;
      if (!confirm(confirmText)) return;
      if (!info.skipBackup) {
        downloadProjectPackage(false);
        recordOperation(info.title);
      }
      await original.call(button);
    });
  }
  protectHighImpactButton("applySpeed", () => {
    const inputs = [...document.querySelectorAll("[data-limit]")],
      changed = inputs.filter(
        (i) => Number(i.value) !== Number(state.limits[i.dataset.limit] || 50),
      ),
      keys = new Set(changed.map((i) => i.dataset.limit)),
      affected = activeRows().filter((d) =>
        keys.has(`${d.projectCode}|${d.road}|${d.direction}`),
      ).length;
    /*
     * 先驗證再下載備份。
     *
     * 舊版一律 ok:true，於是欄位裡有負數或空白時，使用者會先看到一個
     *「將修改 2 個路段方向」的確認視窗、被下載一份備份、在復原清單多一筆
     *「可復原」紀錄——然後才跳出「速限必須大於 0，這次完全沒有變更」。
     * 一次什麼都沒做的操作，留下了三個「好像做了什麼」的痕跡。
     * 這裡比照 applyLosRules 的作法，先把 app.js 的驗證條件跑一遍。
     */
    const invalid = inputs.filter((i) => {
      const value = Number(i.value);
      return !Number.isFinite(value) || value <= 0;
    });
    if (invalid.length)
      return {
        ok: false,
        message: `速限必須大於 0，這次完全沒有變更（請修正 ${invalid.length} 個欄位）`,
        rerender: renderLimits,
      };
    /*
     * ══════════════════════════════════════════════════════════════
     *  X-42：「沒有改動數值」與「沒有人工確認過」是兩件事
     * ══════════════════════════════════════════════════════════════
     *
     * 使用者 2026-09-16：
     *   「該計畫全部的路段速限，如果和預設值一致，我直接按套用，
     *     它會說我數值沒調整，不給我做套用並重算。這三條路段公告速限就是50，
     *     怎會阻止我套用50這個數值，只是因為和預設數值一樣，
     *     就變成我沒有做過人工確認?」
     *
     * 他是對的。公告速限本來就可能剛好等於預設值 50，**那也是確認**。
     * 舊版把兩件事綁在一起，後果不只是按鈕按不動——品質檢查的
     *「速限未確認」那一項因此**永遠消不掉**（實測 6 筆，怎麼按都是 6）。
     *
     * ⚠️ 原本那道守衛要擋的東西仍然保留：**什麼都沒改、而且每一筆都已經
     *   確認過**的時候，才是真正的空操作，這時照樣擋下來。
     */
    const unconfirmed = inputs.filter(
      (i) => !state.limitConfirmed[i.dataset.limit],
    );
    if (!changed.length && !unconfirmed.length)
      return {
        ok: false,
        message: "速限沒有任何變更，而且每一筆都已經人工確認過了",
      };
    if (!changed.length)
      return {
        ok: true,
        title: "確認路段速限（數值不變）",
        detail:
          `數值沒有調整，這一次是把 ${unconfirmed.length} 個路段方向標成「已人工確認」` +
          `（公告速限本來就可能剛好等於預設值 50）。LOS 會一併重算。`,
        skipBackup: true,
      };
    return {
      ok: true,
      title: "套用路段速限並重算",
      detail: `修改 ${changed.length} 個路段方向，影響 ${affected} 筆尖峰明細。設有期間速限版本的季度仍以版本設定為準。`,
    };
  });
  protectHighImpactButton("applyLosRules", () => {
    const rules = readLosRules();
    return rules
      ? {
          ok: true,
          title: "修改服務水準門檻並重算",
          detail: `將重新計算目前計畫 ${activeRows().length} 筆尖峰明細、${activeSummaries().length} 筆彙總與全部相關圖表。`,
        }
      : { ok: false, message: "門檻必須是 A＞B＞C＞D＞E，且介於 0～2" };
  });
  /*
   * ══════════════════════════════════════════════════════════════════
   *  哪些操作要自動留還原點
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12 指定三支一致：「每次匯入／人工修改／刪除前自動留
   * 還原點，最多保留最近 30 次」（筆數 2026-09-16 改為 8，見
   * RESTORE_POINT_LIMIT 的說明），並補一句
   * 「這類我無法驗證、要過很久才知道的功能，三項程式都要特別謹慎檢查」。
   *
   * ⚠️ 舊版只掛了三顆（重設門檻／刪季度／清理路名）＋兩顆高影響按鈕，
   *   **匯入那一條完全沒有**——而匯入是最危險的一步：
   *   `update` 模式會直接覆蓋同季度的既有資料，匯錯檔、匯錯季度、
   *   匯到別的計畫都在這一步發生，而且覆蓋掉就回不來。
   *
   * ⚠️ commit 這一顆要用 observeOperation（先拍快照、400ms 後比對有沒有
   *   真的改變）而不是 protectHighImpactButton：匯入本來就有自己的確認
   *   與進度流程，再插一個 confirm 會變成按兩次確認。
   */
  [
    /* 匯入（最重要的一條） */
    "commit",
    /* 人工修改 */
    "resetLosRules",
    "applyBandRule",
    "resetBandRule",
    "saveDirections",
    "addAlias",
    "confirmRoadChange",
    "saveSpeedVersion",
    /* 刪除 */
    "deleteQuarter",
    "cleanSuffix",
  ].forEach(observeOperation);

  function anomalyRule() {
    return {
      speedDrop: 25,
      delayRise: 30,
      losDrop: 2,
      streak: 2,
      ...(state.anomalyRules[state.activeCode] || {}),
    };
  }
  function renderAnomalyRules() {
    const r = anomalyRule();
    q("ruleSpeedDrop").value = r.speedDrop;
    q("ruleDelayRise").value = r.delayRise;
    q("ruleLosDrop").value = r.losDrop;
    q("ruleStreak").value = r.streak;
  }
  q("saveAnomalyRules")?.addEventListener("click", async () => {
    state.anomalyRules[state.activeCode] = {
      speedDrop: Number(q("ruleSpeedDrop").value) || 25,
      delayRise: Number(q("ruleDelayRise").value) || 30,
      losDrop: Number(q("ruleLosDrop").value) || 2,
      streak: Number(q("ruleStreak").value) || 2,
    };
    await save();
    inspectHealth();
    renderPriority();
    toast("異常提醒門檻已儲存");
  });
  function priorityRows() {
    const r = anomalyRule(),
      out = [];
    for (const road of existingRoads())
      for (const day of ["平日", "假日"]) {
        const seq = activeSummaries()
          .filter((x) => x.road === road && x.day === day)
          .sort((a, b) => periodKey(a.period) - periodKey(b.period));
        if (seq.length < 1) continue;
        const now = seq.at(-1),
          prev = seq.at(-2),
          reasons = [];
        let score = 6 - (losRank[now.los] || 6);
        if (prev) {
          // 上一季是 0 時同樣不能報 0%（見 inspectHealth 的說明）。
          const speed = prev.travel ? ((prev.travel - now.travel) / prev.travel) * 100 : 0,
            delay = prev.totalDelay
              ? ((now.totalDelay - prev.totalDelay) / prev.totalDelay) * 100
              : now.totalDelay > 0
                ? Infinity
                : 0,
            los = (losRank[prev.los] || 0) - (losRank[now.los] || 0);
          if (speed >= r.speedDrop) {
            reasons.push(`旅行速率下降 ${speed.toFixed(1)}%`);
            score += 2;
          }
          if (delay >= r.delayRise) {
            reasons.push(
              Number.isFinite(delay)
                ? `總延滯增加 ${delay.toFixed(1)}%`
                : `總延滯由 0 秒增為 ${Number(now.totalDelay || 0).toFixed(1)} 秒`,
            );
            score += 2;
          }
          if (los >= r.losDrop) {
            reasons.push(`服務水準下降 ${los} 級`);
            score += 3;
          }
        }
        let streak = 0;
        for (let i = seq.length - 1; i > 0; i--) {
          if (
            (losRank[seq[i].los] || 0) < (losRank[seq[i - 1].los] || 0) ||
            seq[i].travel < seq[i - 1].travel
          )
            streak++;
          else break;
        }
        if (streak >= r.streak) {
          reasons.push(`連續 ${streak} 季惡化`);
          score += 2;
        }
        if (["E", "F"].includes(now.los)) {
          reasons.push(`目前服務水準 ${now.los}`);
          score += 2;
        }
        if (reasons.length) out.push({ road, day, period: now.period, reasons, score });
      }
    return out.sort((a, b) => b.score - a.score);
  }
  function renderPriority() {
    if (!q("priorityRows")) return;
    const rows = priorityRows();
    q("priorityRows").innerHTML = rows.length
      ? rows
          .map(
            (x, i) =>
              `<tr><td><b>${i + 1}</b></td><td>${safe(x.road)}／${safe(x.day)}</td><td>${safe(showQuarter(x.period))}</td><td>${safe(x.reasons.join("；"))}</td><td>${x.score >= 7 ? "優先查核原始資料與現地狀況" : "持續觀察"}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="5" class="empty">目前沒有達到提醒門檻的路段</td></tr>';
  }
  q("refreshPriority").onclick = renderPriority;

  /**
   * 成果範圍是「一段期間」而不是單一季度：使用者常常要一次交付 114Q1～114Q4。
   * 起訖若被選反了，這裡自動對調，不讓使用者得到一個空的成果包。
   */
  let deliveryRangeTouched = false;
  let deliveryRangeOwner = "";
  function deliveryRange() {
    const periods = ordered(activeRows().map((x) => x.period));
    if (!periods.length) return { start: "", end: "", periods: [], label: "" };
    const startValue = q("deliveryPeriodStart")?.value || periods[0];
    const endValue = q("deliveryPeriodEnd")?.value || periods.at(-1);
    let start = startValue,
      end = endValue;
    if (periodKey(start) > periodKey(end)) [start, end] = [end, start];
    const inRange = periods.filter(
      (x) => periodKey(x) >= periodKey(start) && periodKey(x) <= periodKey(end),
    );
    /*
     * label 是內部識別用（草稿的儲存鍵就是它），永遠是儲存的季別字串，
     * 不能跟著年份顯示切換走——否則切一次西元年，之前存的草稿就找不到了。
     * displayLabel 才是給人看的（提示文字、檔名、草稿標題）。
     */
    const showQ = (v) => (typeof showQuarter === "function" ? showQuarter(v) : v);
    return {
      start,
      end,
      periods: inRange,
      label: start === end ? start : `${start}-${end}`,
      displayLabel:
        start === end ? showQ(start) : `${showQ(start)}-${showQ(end)}`,
    };
  }
  function inDeliveryRange(period) {
    const r = deliveryRange();
    if (!r.start || !r.end) return true;
    return periodKey(period) >= periodKey(r.start) && periodKey(period) <= periodKey(r.end);
  }
  /** 報告文字草稿的小數位數（0～2）。壞值一律回 1 位，與結論草稿同一個預設。 */
  function deliveryDigits() {
    const raw = Number(q("deliveryDigits")?.value);
    return Number.isInteger(raw) && raw >= 0 && raw <= 2 ? raw : 1;
  }
  /**
   * 交付範圍的代表紀錄。
   *
   * @param scope "range"（預設）只取交付季度區間；"all" 取全部季度——
   *              前期比較要用後者，否則區間第一季永遠寫「無前期資料可比較」。
   *
   * ⚠️ 篩了方向或尖峰時**絕對不可以**拿已經挑好的代表紀錄（state.summaries）
   *   再去篩：那一份是從**全部四筆**挑出來的，篩掉之後只會剩下
   *   「剛好代表值就是方向1」的那幾列，其餘路段整列消失——
   *   使用者會以為那些路段沒有資料。
   *   正確作法是**先篩再挑最差**，與尖峰彙總、各路段 LOS 圖同一個口徑，
   *   而「挑最差」一律轉呼叫 app.js 的 worstOfGroup（全站唯一一份）。
   */
  function deliveryRepresentatives(scope) {
    const road = q("deliveryRoad")?.value || "",
      day = q("deliveryDay")?.value || "",
      direction = q("deliveryDirection")?.value || "",
      peak = q("deliveryPeak")?.value || "";
    const inRange = (period) => scope === "all" || inDeliveryRange(period);
    if (!direction && !peak)
      return activeSummaries().filter(
        (x) => inRange(x.period) && (!road || x.road === road) && (!day || x.day === day),
      );
    const picked = activeRows().filter(
      (x) =>
        inRange(x.period) &&
        (!road || x.road === road) &&
        (!day || x.day === day) &&
        (!direction || x.direction === direction) &&
        (!peak || x.peak === peak),
    );
    const groups = new Map();
    for (const row of picked) {
      const key = [row.projectCode, row.year, row.quarter, row.road, row.day].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()]
      .map((list) => (typeof worstOfGroup === "function" ? worstOfGroup(list) : list[0]))
      .filter(Boolean)
      .sort(
        (a, b) =>
          periodKey(a.period) - periodKey(b.period) ||
          String(a.road).localeCompare(String(b.road), "zh-TW") ||
          String(a.day).localeCompare(String(b.day), "zh-TW"),
      );
  }
  function deliveryRows() {
    return deliveryRepresentatives("range");
  }
  function refreshDelivery() {
    if (!q("deliveryPeriodStart")) return;
    // 換了計畫就回到「涵蓋全部季度」的預設，
    // 否則前一個計畫挑過的範圍會沿用到新計畫，成果包只出得到其中一季。
    if (deliveryRangeOwner !== state.activeCode) {
      deliveryRangeTouched = false;
      deliveryRangeOwner = state.activeCode;
    }
    const periods = ordered(activeRows().map((x) => x.period)),
      roads = existingRoads().sort(),
      oldStart = q("deliveryPeriodStart").value,
      oldEnd = q("deliveryPeriodEnd").value,
      oldR = q("deliveryRoad").value;
    // 使用者還沒自己挑過範圍以前，預設一律涵蓋目前計畫的全部季度。
    // 否則第一次匯入時只有 114Q1，之後再匯入 Q2～Q4，範圍會一直卡在 114Q1。
    const startValue = deliveryRangeTouched && periods.includes(oldStart) ? oldStart : periods[0];
    const endValue = deliveryRangeTouched && periods.includes(oldEnd) ? oldEnd : periods.at(-1);
    /* value 必須是儲存的季別，否則切成西元年之後成果範圍會對不到資料。 */
    const optionsFor = (value) =>
      periods
        .map(
          (x) =>
            `<option value="${safe(x)}" ${x === value ? "selected" : ""}>${safe(showQuarter(x))}</option>`,
        )
        .join("") || '<option value="">尚無資料</option>';
    q("deliveryPeriodStart").innerHTML = optionsFor(startValue);
    q("deliveryPeriodEnd").innerHTML = optionsFor(endValue);
    q("deliveryRoad").innerHTML =
      '<option value="">全部路段</option>' +
      roads.map((x) => `<option ${x === oldR ? "selected" : ""}>${safe(x)}</option>`).join("");
    /*
     * ── 方向下拉：標籤要寫**使用者取的方向名稱**，不是內部鍵值 ──────
     *
     * ⚠️ 第一版直接寫死 `<option value="方向1">方向1</option>`，
     *   結果成果交付這一頁出現了裸的「方向1」——那正是 e2e-direction-name
     *   在守的事（報告與交付畫面上一律寫使用者取的名字）。守門當場抓到。
     * ⚠️ value 仍然是**鍵值**：篩選要用鍵值，改名才不會讓條件失效。
     *   只有看到的字跟著名稱走。
     * ⚠️ 各路段名稱不同時要講出來，不可以隨便挑一個當代表——
     *   使用者會以為自己篩的是那一條路段的方向。
     */
    const oldDirection = q("deliveryDirection")?.value || "";
    const directions = [...new Set(activeRows().map((x) => x.direction))]
      .filter(Boolean)
      .sort();
    if (q("deliveryDirection"))
      q("deliveryDirection").innerHTML =
        '<option value="">全部方向</option>' +
        directions
          .map((dir) => {
            const names = [
              ...new Set(
                activeRows()
                  .filter((x) => x.direction === dir)
                  .map((x) => rowDirectionName(x)),
              ),
            ].filter((name) => name && name !== dir);
            const label =
              names.length === 1
                ? names[0]
                : names.length > 1
                  ? `${names.slice(0, 2).join("／")}${names.length > 2 ? "…" : ""}（各路段名稱不同）`
                  : dir;
            return `<option value="${safe(dir)}" ${dir === oldDirection ? "selected" : ""}>${safe(label)}</option>`;
          })
          .join("");
    const range = deliveryRange();
    if (q("deliveryRangeNote"))
      q("deliveryRangeNote").textContent = range.periods.length
        ? `本次成果範圍：${range.displayLabel}，共 ${range.periods.length} 個季度（${range.periods.map((x) => showQuarter(x)).join("、")}）`
        : "目前計畫尚無季度資料";
    loadDraft();
  }
  function narrative(rows = deliveryRows()) {
    if (!rows.length) return "目前篩選範圍沒有資料。";
    const p = activeProject(),
      range = deliveryRange(),
      digits = deliveryDigits(),
      road = q("deliveryRoad")?.value || "",
      day = q("deliveryDay")?.value || "",
      direction = q("deliveryDirection")?.value || "",
      peak = q("deliveryPeak")?.value || "",
      /*
       * ⚠️ 前期比較要用**同一組條件**算出來的前一季。
       *   舊版拿的是沒有篩過的 activeSummaries()：使用者把方向篩成方向1 之後，
       *   這一季寫的是方向1 的值、卻拿「全部四筆挑最差」的上一季來比，
       *   算出來的增減幅度**兩邊的口徑不一樣**——那是會寫進正式報告的數字。
       */
      basis = deliveryRepresentatives("all"),
      lines = [
        `${p?.code || ""} ${p?.name || ""} ${range.displayLabel} 交通服務水準分析草稿`,
        range.periods.length > 1
          ? `本次範圍涵蓋 ${range.periods.length} 個季度（${range.periods.map((x) => showQuarter(x)).join("、")}），共分析 ${new Set(rows.map((x) => x.road)).size} 個路段、${rows.length} 筆路段日別代表資料。`
          : `本期共分析 ${new Set(rows.map((x) => x.road)).size} 個路段、${rows.length} 筆路段日別代表資料。`,
      ];
    /*
     * ⚠️ 條件一定要寫進草稿本身。
     *   這一段文字會被複製進正式報告，而報告上不會附著畫面——
     *   看到的人無從得知這些數字是「哪一個方向、哪一個尖峰」算出來的。
     */
    lines.push(
      "統計條件：" +
        [
          road ? `路段 ${road}` : "全部路段",
          day || "平日與假日",
          direction || "全部方向",
          peak || "代表尖峰（同一組取最差）",
          `數值小數 ${digits} 位`,
        ].join("、") +
        "。",
    );
    if (direction || peak)
      lines.push(
        "口徑：先依上列條件篩出符合的紀錄，再從同一組（季度・路段・日別）裡挑最差的一筆為代表，" +
          "與「尖峰彙總」「各路段 LOS 圖」相同；前期比較也走同一組條件。",
      );
    /*
     * 「不適用」逐項寫出來（使用者 2026-09-15 指定的寫法）。
     * ⚠️ 只在使用者**確實設了**那個條件時才寫——沒設的條件寫一堆只是噪音。
     */
    if (peak || day)
      lines.push(
        "本數值不適用" +
          [peak ? "「尖峰」" : "", day ? "「日別」" : ""].filter(Boolean).join("與") +
          "條件的部分：公告速限是「這條路段這個方向」的設定值，不分尖峰也不分平日假日，" +
          "因此下列各行引用的速限與速限比不受這兩項影響。",
      );
    for (const x of rows) {
      const prev = basis
        .filter(
          (y) => y.road === x.road && y.day === x.day && periodKey(y.period) < periodKey(x.period),
        )
        .sort((a, b) => periodKey(a.period) - periodKey(b.period))
        .at(-1);
      let change = "無前期資料可比較";
      if (prev) {
        /*
         * 這一段會原封不動寫進報告文字草稿，所以絕對不能把「0 → 480 秒」
         * 講成「增加 0.0%」。上一季是 0 而這一季有值，就直接寫出實際數值。
         */
        const pctText = (before, after, label) => {
          if (!Number.isFinite(before) || !Number.isFinite(after))
            return `${label}無法比較（資料含非數值）`;
          if (!before)
            return after > 0
              ? `${label}由 0 增為 ${fmt(after, digits)}`
              : `${label}維持 0`;
          const change = ((after - before) / before) * 100;
          /*
           * ⚠️ 百分比也要吃「小數位數」。三支系統都踩過同一個雷：
           *   位數改成 2 位之後，只有前面的數值變了、百分比仍然寫死 1 位。
           */
          return `${label}${change >= 0 ? "增加" : "下降"} ${Math.abs(change).toFixed(digits)}%`;
        };
        change =
          `較 ${showQuarter(prev.period)} ` +
          pctText(prev.travel, x.travel, "旅行速率") +
          "，" +
          pctText(prev.totalDelay, x.totalDelay, "總延滯");
      }
      lines.push(
        `${showQuarter(x.period)} ${x.road}（${x.day}）服務水準為 ${x.los}，代表紀錄為${x.peak}${rowDirectionName(x)}，旅行速率 ${fmt(x.travel, digits)} km/h、總延滯 ${fmt(x.totalDelay, digits)} 秒；${change}。`,
      );
    }
    lines.push("本段文字由系統依彙總資料自動產生，正式引用前應核對原始檔、速限設定及現地情況。");
    return lines.join("\n");
  }
  function draftKey() {
    /*
     * ⚠️ 方向與尖峰只有在**確實設了**的時候才進鍵值。
     *   無條件加進去的話，鍵值格式就變了，使用者**先前存過的草稿全部找不到**
     *  （畫面上看起來像是草稿不見了）。兩者都是預設值時維持舊格式，
     *   舊草稿照樣讀得回來；設了條件才另外存一份，這樣
     *   「方向1 的草稿」與「方向2 的草稿」不會互相蓋掉。
     */
    const direction = q("deliveryDirection")?.value || "";
    const peak = q("deliveryPeak")?.value || "";
    const base = `${state.activeCode}|${deliveryRange().label}`;
    return direction || peak ? `${base}|${direction}|${peak}` : base;
  }
  let draftDirty = false;
  let lastDraftKey = null;
  function loadDraft(force = false) {
    if (!q("reportDraft")) return;
    const key = draftKey();
    // 只有換了範圍、或明確要求重新產生時才覆寫文字框。
    // 舊版每次存檔（切換計畫、儲存別名、匯入…）都會重新產生一次草稿，
    // 使用者剛打好的正式分析文字會被無聲蓋掉。
    if (!force && key === lastDraftKey && draftDirty) return;
    lastDraftKey = key;
    draftDirty = false;
    const saved = state.reportDrafts[key];
    q("reportDraft").value = saved || narrative();
    // 草稿是以「計畫｜交付範圍」為鍵存的。切換計畫再切回來時，交付範圍常常
    // 會回到預設值，鍵值跟著不一樣，於是文字框顯示的是重新產生的草稿，使用
    // 者以為自己寫的內容被弄丟了——其實還在，只是掛在別的範圍底下。
    const note = q("draftRecoverNote");
    if (!note) return;
    const others = Object.keys(state.reportDrafts || {}).filter(
      (k) => k.startsWith(`${state.activeCode}|`) && k !== key && state.reportDrafts[k],
    );
    if (saved || !others.length) {
      note.hidden = true;
      note.innerHTML = "";
      return;
    }
    note.hidden = false;
    note.innerHTML =
      `這個範圍還沒有存過草稿；本計畫另有 ${others.length} 份已儲存的草稿：` +
      others
        .map(
          (k) =>
            `<button class="link-button" data-load-draft="${esc(k)}">${esc(k.split("|").slice(1).join("｜"))}</button>`,
        )
        .join("　");
    note.querySelectorAll("[data-load-draft]").forEach((b) => {
      b.onclick = () => {
        q("reportDraft").value = state.reportDrafts[b.dataset.loadDraft] || "";
        draftDirty = true;
        toast("已載入該範圍的草稿；按「儲存修改」才會存到目前範圍");
      };
    });
  }
  const onRangeChange = () => {
    deliveryRangeTouched = true;
    deliveryRangeOwner = state.activeCode;
    refreshDelivery();
  };
  q("deliveryPeriodStart").onchange = onRangeChange;
  q("deliveryPeriodEnd").onchange = onRangeChange;
  /*
   * onchange 會把 DOM Event 當成第一個參數傳進去，而 loadDraft 的第一個
   * 參數是 force——Event 物件是 truthy，於是每次改路段或日別都等同於
   *「強制重新產生」，使用者剛打好的正式分析文字被無聲蓋掉。
   * 必須包一層，明確不帶 force。
   */
  q("deliveryRoad").onchange = () => loadDraft();
  q("deliveryDay").onchange = () => loadDraft();
  /*
   * ⚠️ 新增的三個條件也要重載草稿。
   *   少接一個的話，使用者改了方向、畫面上的草稿卻停在舊條件算出來的數字——
   *   而那份文字會被複製進正式報告。
   *   小數位數改了也一樣要重算（位數是呈現，但呈現錯了照樣是錯的數字）。
   */
  if (q("deliveryDirection")) q("deliveryDirection").onchange = () => loadDraft(true);
  if (q("deliveryPeak")) q("deliveryPeak").onchange = () => loadDraft(true);
  if (q("deliveryDigits")) q("deliveryDigits").onchange = () => loadDraft(true);
  /*
   * ⚠️ 使用者 2026-09-14 裁示：成果交付與結論草稿**維持獨立**，
   *   不自動跟著主工具列跑，另加這一顆一鍵對齊。
   *   理由很實際：報告常常要輸出一段和畫面上不同的範圍
   *  （畫面在看最新一季、報告要出全年）。
   *
   * ⚠️ 按下去要**說出套用了什麼**。默默改掉使用者設好的一整組條件，
   *   他會以為是自己剛才點錯了。
   */
  const applyMain = q("deliveryApplyMain");
  if (applyMain)
    applyMain.onclick = () => {
      const MTx = globalThis.LosMainToolbar;
      const f = MTx.state.main;
      const setIfPossible = (id, value) => {
        const node = q(id);
        if (!node) return "";
        const hit = [...node.options].find((o) => o.value === value);
        if (!hit) return "";
        node.value = value;
        return value;
      };
      setIfPossible("deliveryPeriodStart", f.periodFrom);
      setIfPossible("deliveryPeriodEnd", f.periodTo);
      const road = (f.roads || []).length === 1 ? f.roads[0] : "";
      setIfPossible("deliveryRoad", road);
      const day =
        f.day === "weekday" ? "平日" : f.day === "holiday" ? "假日" : "";
      setIfPossible("deliveryDay", day);
      /*
       * 方向與尖峰（2026-09-15 新增）。
       * ⚠️ 「並列」是**呈現方式不是篩選**，在文字草稿裡就是兩邊都寫，
       *   所以對應到「全部」；「代表尖峰」對應到空字串——那正是這一格的預設
       *  （同一組取最差）。三者都要在 toast 裡說出來，不可以默默處理。
       */
      const direction =
        f.direction === "方向1" || f.direction === "方向2" ? f.direction : "";
      setIfPossible("deliveryDirection", direction);
      const peak =
        f.peak === "上午尖峰" || f.peak === "下午尖峰" ? f.peak : "";
      setIfPossible("deliveryPeak", peak);
      deliveryRangeTouched = true;
      deliveryRangeOwner = state.activeCode;
      refreshDelivery();
      loadDraft();
      const parts = [
        "季度 " +
          globalThis.periodExportLabel(f.periodFrom) +
          "～" +
          globalThis.periodExportLabel(f.periodTo),
        road ? "路段 " + road : "全部路段",
        day ? "日別 " + day : "平日與假日",
        direction ? "方向 " + direction : "全部方向",
        peak ? "尖峰 " + peak : "代表尖峰（同一組取最差）",
      ];
      const skipped =
        ((f.roads || []).length > 1
          ? /*
             * ⚠️ 2026-09-16 訂正：這一句原本寫「路段**維持原設定**」，
             *   但上面 setIfPossible("deliveryRoad", "") 其實把它**改成了
             *   「全部路段」**——使用者原本挑的那一條被無聲換掉，
             *   而同一則訊息的前半段已經寫著「全部路段」，自己打自己。
             */
            "（主工具列選了 " +
            (f.roads || []).length +
            " 條路段，成果交付一次只出一條或全部，因此這裡改成「全部路段」——原本挑的那一條已被取代，需要的話請重新選）"
          : "") +
        (f.peak === "side-by-side" || f.direction === "side-by-side" || f.day === "side-by-side"
          ? "（「並列」在文字草稿就是兩邊都寫，因此對應到「全部」）"
          : "") +
        (f.peak === "representative"
          ? "（「代表尖峰」就是這一格的預設「同一組取最差」，已對齊）"
          : "");
      toast("已套用主工具列：" + parts.join("、") + "。" + skipped);
    };
  q("reportDraft").addEventListener("input", () => {
    draftDirty = true;
  });
  q("generateDraft").onclick = () => {
    q("reportDraft").value = narrative();
    draftDirty = false;
  };
  q("saveDraft").onclick = async () => {
    state.reportDrafts[draftKey()] = q("reportDraft").value;
    draftDirty = false;
    await save();
    toast("報告文字草稿已儲存");
  };
  function rowsCsv(rows) {
    if (!rows.length) return "";
    const fields = [
      "period",
      "road",
      "day",
      "peak",
      "direction",
      // 報告上寫的起訖路口。只有方向1／方向2 的話，交付出去的 CSV 看不出
      // 哪個方向是哪一邊。
      "directionText",
      "travel",
      "running",
      "totalDelay",
      "limit",
      "ratio",
      "los",
      "sourceFile",
      "sourceSheet",
      "sourceHash",
      "importBatch",
    ];
    /*
     * 標題列要用看得懂的中文欄名並且**標單位**。
     * 舊版直接把英文欄位鍵 join 出去，交付給委託單位的 CSV 分不出
     * travel 是 km/h、totalDelay 是秒、ratio 是比值還是百分比。
     * 畫面上（setHeaders）本來就是標了單位的，這裡對齊同一套。
     */
    const labels = {
      period: "季度",
      road: "路段",
      day: "日別",
      peak: "尖峰時段",
      direction: "方向",
      directionText: "方向起訖",
      travel: "旅行速率（km/h）",
      running: "行駛速率（km/h）",
      totalDelay: "總延滯（秒）",
      limit: "速限（km/h）",
      ratio: "速限比（比值，0～1）",
      los: "服務水準（A～F）",
      sourceFile: "來源檔案",
      sourceSheet: "來源工作表",
      sourceHash: "來源雜湊",
      importBatch: "匯入批次",
    };
    return [
      fields.map((k) => csvCell(labels[k] || k)).join(","),
      /*
       * 季度欄跟著畫面上的年份顯示切換走（使用者要「畫面與匯出都跟著變」）。
       * 只有這一欄換寫法，其餘欄位與數值原樣輸出。
       */
      ...rows.map((x) =>
        fields.map((k) => csvCell(k === "period" ? showQuarter(x[k]) : x[k])).join(","),
      ),
    ].join("\r\n");
  }
  q("downloadQuarterPack").onclick = async () => {
    const range = deliveryRange();
    if (!range.periods.length) return toast("目前沒有可匯出的季度");
    const summaries = deliveryRows(),
      /*
       * ⚠️ 明細也要吃方向與尖峰。
       *   草稿寫著「方向1」、附在同一個 ZIP 裡的明細卻是全部四筆，
       *   拿到成果包的人會以為其中一邊算錯了。
       *   篩選條件不一致與算錯一樣嚴重——兩份東西要說同一件事。
       */
      detail = activeRows().filter(
        (x) =>
          inDeliveryRange(x.period) &&
          (!q("deliveryRoad").value || x.road === q("deliveryRoad").value) &&
          (!q("deliveryDay").value || x.day === q("deliveryDay").value) &&
          (!q("deliveryDirection")?.value || x.direction === q("deliveryDirection").value) &&
          (!q("deliveryPeak")?.value || x.peak === q("deliveryPeak").value),
      );
    if (!summaries.length && !detail.length)
      return toast("這個範圍與篩選條件沒有任何資料，請調整後再試");
    inspectHealth();
    const zip = new JSZip(),
      p = activeProject(),
      prefix = `${p.code}_${range.displayLabel}`;
    if (q("packDetail").checked) zip.file(`${prefix}_尖峰明細.csv`, "\uFEFF" + rowsCsv(detail));
    if (q("packSummary").checked) zip.file(`${prefix}_尖峰彙總.csv`, "\uFEFF" + rowsCsv(summaries));
    if (q("packQuality").checked)
      zip.file(
        `${prefix}_資料品質檢查.json`,
        JSON.stringify(
          healthIssues.filter((x) => x.period === "全部" || inDeliveryRange(x.period)),
          null,
          2,
        ),
      );
    if (q("packNarrative").checked)
      zip.file(`${prefix}_報告文字草稿.txt`, "\uFEFF" + q("reportDraft").value);
    zip.file(
      `${prefix}_來源追溯.json`,
      JSON.stringify(
        detail.map((x) => ({
          id: x.id,
          sourceFile: x.sourceFile || x.source,
          sourceSheet: x.sourceSheet,
          sourceRefs: x.sourceRefs,
          sourceHash: x.sourceHash,
          importBatch: x.importBatch,
        })),
        null,
        2,
      ),
    );
    zip.file(
      `${prefix}_說明.txt`,
      "本成果包由交通服務水準分析系統產生。報告文字及異常提醒必須由使用者核對後使用；LOS與代表紀錄依系統既有規則計算。",
    );
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${prefix}_成果包.zip`);
    toast(
      range.periods.length > 1
        ? `成果包已下載（${range.displayLabel}，共 ${range.periods.length} 個季度）`
        : "季度成果包已下載",
    );
  };
  q("downloadFilteredCharts").onclick = async () => {
    const rows = deliveryRows(),
      p = activeProject(),
      metric = q("deliveryMetric").value;
    if (!rows.length) return toast("目前篩選範圍沒有資料");
    try {
      /*
       * ⚠️ 檔名要用 displayLabel，不是 label。
       *   label 是**儲存用**的季別字串（一律民國年），displayLabel 才跟著
       *   畫面上的「年份顯示」走。用 label 的話，同一個面板的兩個下載
       *   （成果包 ZIP 與這一個）會在檔名上寫出兩種年份系統。
       *   這一支自己的註解早就寫過這條規則（「displayLabel 才是給人看的」），
       *   只有這一行漏了。（2026-09-16 實測抓到）
       */
      const label = deliveryRange().displayLabel || deliveryRange().label;
      if (metric === "los") await exportLosWorkbook(rows, `${p.code}_${label}_服務水準圖表.xlsx`);
      else await exportTravelWorkbook(rows, `${p.code}_${label}_旅行速率趨勢.xlsx`);
      toast("篩選後可編輯 Excel 圖表已下載");
    } catch (e) {
      toast(e.message || "Excel 匯出失敗");
    }
  };

  const baseInspectHealth = inspectHealth;
  inspectHealth = function () {
    const base = baseInspectHealth().filter((x) => x.type !== "異常變化"),
      r = anomalyRule(),
      extra = [];
    for (const road of existingRoads())
      for (const day of ["平日", "假日"]) {
        const seq = activeSummaries()
          .filter((x) => x.road === road && x.day === day)
          .sort((a, b) => periodKey(a.period) - periodKey(b.period));
        let streak = 0;
        for (let i = 1; i < seq.length; i++) {
          const prev = seq[i - 1],
            now = seq[i],
            losDrop = (losRank[prev.los] || 0) - (losRank[now.los] || 0),
            speedDrop = prev.travel ? ((prev.travel - now.travel) / prev.travel) * 100 : 0,
            /*
             * 上一季是 0 時不能回 0%。路段延滯 0 在真實資料裡很常見
             *（28 份樣本每一份都有），舊版於是把「0 秒 → 480 秒」報成
             *「增加 0.0%」，而且那句話會原封不動寫進報告文字草稿。
             * 從 0 變成有值＝新出現的延滯，一律視為需要提醒。
             */
            delayRise = prev.totalDelay
              ? ((now.totalDelay - prev.totalDelay) / prev.totalDelay) * 100
              : now.totalDelay > 0
                ? Infinity
                : 0,
            worse = losDrop > 0 || speedDrop > 0;
          streak = worse ? streak + 1 : 0;
          const reasons = [];
          if (losDrop >= r.losDrop) reasons.push(`服務水準 ${prev.los}→${now.los}`);
          if (speedDrop >= r.speedDrop) reasons.push(`旅行速率下降 ${speedDrop.toFixed(1)}%`);
          if (delayRise >= r.delayRise)
            reasons.push(
              // Infinity 代表上一季是 0：講「增加 Infinity%」沒有意義，
              // 要講實際發生了什麼。
              Number.isFinite(delayRise)
                ? `總延滯增加 ${delayRise.toFixed(1)}%`
                : `總延滯由 0 秒增為 ${Number(now.totalDelay || 0).toFixed(1)} 秒`,
            );
          if (streak >= r.streak) reasons.push(`連續 ${streak} 季惡化`);
          if (reasons.length)
            extra.push({
              type: "異常變化",
              // 這幾個結構化欄位是「品質總覽」的篩選在用的。
              // 這支覆寫掉了 app.js 的「異常變化」判定（改用可自訂門檻），
              // 少帶任何一個欄位，篩選就會把整類異常變化默默濾掉——而且
              // 畫面上看起來只是「這個路段沒有異常」，不會有任何錯誤訊息。
              fromPeriod: prev.period,
              period: now.period,
              road,
              day,
              item: `${road}／${day}`,
              detail: `相較 ${showQuarter(prev.period)}：${reasons.join("；")}，請確認原始資料或現地變化。`,
              /*
               * ⚠️ resolution **一定要帶**。
               *   這一支覆寫掉了 app.js 的「異常變化」判定（改用可自訂門檻），
               *   而 app.js 那一版是有 resolution 的——漏帶的結果是
               *   畫面上每一筆異常變化都顯示「尚未對應／請回報給開發者」，
               *   等於系統自己說它沒有處理指引，而指引其實早就寫好了。
               *   （使用者 2026-09-17 附圖回報）
               * ⚠️ 文字與 app.js 那一版**刻意一致**：同一種異常在兩個地方
               *   給出兩套指引，使用者只會不知道該聽哪一個。
               */
              resolution: {
                kind: "人工確認",
                text: "這是提醒，不是判定資料有錯。請到「尖峰彙總」比對這兩季的數字：確實有現地變化（施工、號誌改時制、路型改變）就在報告中說明，確認後可按下方的「已確認」，下次檢查就不再提醒；若判斷是資料有誤，才回原始檔更正並重新匯入該季。門檻可在「異常提醒門檻」調整。",
                view: "summary",
                viewLabel: "尖峰彙總",
              },
            });
        }
      }
    healthIssues = base.concat(extra);
    // baseInspectHealth() 內部已經 render 過一次（用的是還沒換掉異常變化的
    // 清單），這裡再 render 一次才是最終結果。兩次 render 之間畫面會閃一下
    // 不同的筆數，但最終狀態正確。
    renderHealth();
    return healthIssues;
  };

  /* ══════════════ 結論草稿產生器 ══════════════
   *
   * 條件面板 → conclusion.js 組字 → 文字框。
   * 這裡只負責把畫面上的勾選整理成 condition，數字一律由 state.details 帶，
   * 不在這裡重算，草稿的數字才會和「尖峰明細」「彙總」完全一致。
   */
  let conclusionCondition = clone(SPEED_DEFAULT_CONDITION);
  let conclusionEdited = false;
  let conclusionOwner = null;

  /*
   * 結論草稿的每一行都要寫方向。conclusion.js 是純組字模組，拿不到 state，
   * 所以顯示名稱在這裡先解析好，多帶一個 directionLabel 欄位進去。
   *
   * 篩選條件（conclusionCondition.directions）仍然存鍵值「方向1／方向2」，
   * 已經存好的條件範本不受影響，路段改名也不會讓舊範本失效。
   */
  function conclusionRows() {
    return activeRows().map((row) => ({
      ...row,
      directionLabel: rowDirectionName(row),
    }));
  }

  /*
   * 方向勾選框的標籤。
   *
   * 名稱是「每個路段各自命名」的，而這個勾選框是跨路段的篩選條件，
   * 所以不能直接拿某一個路段的名稱當標籤。全部路段都叫同一個名字時才寫出來，
   * 有不一樣的就老實說「各路段名稱不同」——寧可寫得長一點，也不要挑一個
   * 名稱出來，讓使用者以為篩的只有那個路段。
   */
  function directionChoiceLabel(rows, direction) {
    const names = [
      ...new Set(
        rows
          .filter((row) => row.direction === direction)
          .map((row) => rowDirectionName(row)),
      ),
    ];
    if (!names.length || (names.length === 1 && names[0] === direction))
      return direction;
    if (names.length === 1) return `${direction}／${names[0]}`;
    return `${direction}（各路段名稱不同）`;
  }

  function conclusionTemplates() {
    state.conclusionTemplates = state.conclusionTemplates || {};
    const key = state.activeCode || "";
    if (!Array.isArray(state.conclusionTemplates[key]))
      state.conclusionTemplates[key] = [];
    return state.conclusionTemplates[key];
  }

  /*
   * labelOf 只換顯示字，勾選送回去的永遠是 values 裡的原值（篩選鍵值）。
   * 兩者一定要分開，否則路段一改名，使用者存好的條件範本就全部篩不到資料。
   */
  function checkboxGroup(host, values, selected, onToggle, labelOf) {
    if (!host) return;
    host.innerHTML = values
      .map(
        (value, index) =>
          `<label><input type="checkbox" data-index="${index}" ${
            selected.indexOf(value) >= 0 ? "checked" : ""
          }>${safe(labelOf ? labelOf(value) : value)}</label>`,
      )
      .join("");
    host.querySelectorAll("input").forEach((input) => {
      input.onchange = () => onToggle(values[Number(input.dataset.index)]);
    });
  }

  function toggleIn(list, value) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else list.push(value);
  }

  /*
   * ⚠️ 使用者 2026-09-14 裁示：結論草稿**維持獨立**，不自動跟著主工具列跑，
   *   另加這一顆一鍵對齊。
   *
   * ⚠️ 三件事一定要做對，否則這一顆比沒有還糟：
   *   (1) 「並列」與「全部」在這裡都要換成**空陣列**（＝全部都寫），
   *     不可以塞一個 "side-by-side" 進去——那個值不是任何一筆資料的方向，
   *     條件看起來設好了、卻會篩出 0 筆。
   *   (2) 「代表尖峰」不是一種尖峰，是一種挑選方式；結論草稿沒有這個概念，
   *     所以尖峰維持「全部都寫」，並在訊息裡點名這一項沒有套進去。
   *   (3) 要**說出套用了什麼**——默默改掉整組條件，使用者會以為是自己點錯。
   */
  /*
   * 草稿要用的兩支「畫面端的算法」。
   *
   * ⚠️ 一律轉呼叫 app.js 的那一份，不可以在這裡重寫。
   *   worstOfGroup 是「挑最差」全站唯一一份（彙總、LOS 圖、草稿共用）；
   *   bandHitFor 是三段分界唯一一份（含依季別區間／路段的覆寫）。
   * ⚠️ 取不到時回傳 undefined／空物件而不是自己給一組預設值：
   *   自己給預設值等於悄悄換一把尺，草稿會寫出和畫面不同的佔比。
   */
  const conclusionWorstOf = (list) =>
    typeof worstOfGroup === "function" ? worstOfGroup(list) : list && list[0];
  const conclusionBandsOf = (row) =>
    typeof bandHitFor === "function" ? bandHitFor(row.period, row.road).rules : null;

  function applyMainToConclusion() {
    const MTx = globalThis.LosMainToolbar;
    const MFx = globalThis.LosMainFilters;
    const f = MTx.state.main;
    const ranged = MFx.isFiltered(f, "periodFrom");
    conclusionCondition.scope = ranged
      ? { kind: "range", from: f.periodFrom, to: f.periodTo }
      : { kind: "quarter", quarter: f.periodTo || f.periodFrom };
    conclusionCondition.roads = (f.roads || []).slice();
    conclusionCondition.days =
      f.day === "weekday" ? ["平日"] : f.day === "holiday" ? ["假日"] : [];
    conclusionCondition.directions =
      f.direction === "方向1" || f.direction === "方向2" ? [f.direction] : [];
    conclusionCondition.peaks =
      f.peak === "上午尖峰" || f.peak === "下午尖峰" ? [f.peak] : [];
    /*
     * ⚠️ 「代表尖峰（系統取最差）」**不是一種尖峰**，是一種挑選方式——
     *   所以它對應的是結論草稿的「資料層級」，不是「尖峰」那一組核取方塊。
     *   舊版在這裡整個跳過，並在 toast 裡說「結論草稿沒有這個概念」，
     *   那句話從 2026-09-15 起不再成立：草稿有 rowLevel 了。
     */
    conclusionCondition.rowLevel =
      f.peak === "representative" ? "representative" : "detail";
    renderConclusion();
    const parts = [
      ranged
        ? "季度 " + showQuarter(f.periodFrom) + "～" + showQuarter(f.periodTo)
        : "季度 " + showQuarter(f.periodTo || f.periodFrom),
      conclusionCondition.roads.length
        ? "路段 " + conclusionCondition.roads.length + " 條"
        : "全部路段",
      conclusionCondition.days.length
        ? "日別 " + conclusionCondition.days.join("、")
        : "全部日別",
      conclusionCondition.directions.length
        ? "方向 " + conclusionCondition.directions.join("、")
        : "全部方向",
    ];
    parts.push(
      conclusionCondition.rowLevel === "representative"
        ? "資料層級：代表紀錄（先篩再挑最差）"
        : "資料層級：逐筆明細",
    );
    /*
     * 「並列」在**文字**草稿裡就是兩邊都寫——它是呈現方式不是篩選。
     * 這一句一定要說出來，否則使用者會以為並列沒有被套進去。
     */
    const skipped =
      f.peak === "side-by-side"
        ? "（「上午＋下午並列」在文字草稿就是兩種都寫，因此尖峰維持「全部都寫」）"
        : f.direction === "side-by-side"
          ? "（「雙向並列」在文字草稿就是兩個方向都寫，因此方向維持「全部都寫」）"
          : f.day === "side-by-side"
            ? "（「平日＋假日並列」在文字草稿就是兩種都寫，因此日別維持「全部都寫」）"
            : "";
    toast("已套用主工具列：" + parts.join("、") + "。" + skipped);
  }
  function renderConclusion() {
    if (!q("conclusionMain")) return;
    /* 換計畫時條件與草稿都要重設，否則會把上一個計畫的路段帶過來，
       篩出 0 筆卻找不出原因。 */
    if (conclusionOwner !== state.activeCode) {
      conclusionOwner = state.activeCode;
      conclusionCondition = clone(SPEED_DEFAULT_CONDITION);
      conclusionEdited = false;
      if (q("conclusionDraft")) q("conclusionDraft").value = "";
    }
    const rows = conclusionRows();
    q("conclusionEmpty").hidden = rows.length > 0;
    q("conclusionMain").hidden = rows.length === 0;
    if (!rows.length) return;

    const periods = ordered(rows.map((x) => x.period));
    const years = [...new Set(periods.map((x) => speedPeriodYear(x)).filter(Boolean))].sort();
    /*
     * value 一律是儲存值（季別或民國年份），只有看到的文字跟著年份顯示切換走；
     * 兩者混用的話，切成西元年之後既有的條件會挑不到任何資料。
     */
    const options = (list, value, label = (x) => x) =>
      list
        .map(
          (x) =>
            `<option value="${safe(x)}" ${x === value ? "selected" : ""}>${safe(label(x))}</option>`,
        )
        .join("");
    const scope = conclusionCondition.scope;

    q("conclusionQuarterBox").hidden = scope.kind !== "quarter";
    q("conclusionYearBox").hidden = scope.kind !== "year";
    q("conclusionRangeBox").hidden = scope.kind !== "range";
    q("conclusionQuarter").innerHTML = options(periods, scope.quarter, showQuarter);
    q("conclusionYear").innerHTML = options(years, scope.year, showYear);
    q("conclusionFrom").innerHTML = options(periods, scope.from, showQuarter);
    q("conclusionTo").innerHTML = options(periods, scope.to, showQuarter);
    q("conclusionScopeKinds")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = input.value === scope.kind;
      });

    checkboxGroup(
      q("conclusionPeaks"),
      [...new Set(rows.map((x) => x.peak))].sort(),
      conclusionCondition.peaks,
      (value) => {
        toggleIn(conclusionCondition.peaks, value);
        renderConclusion();
      },
    );
    checkboxGroup(
      q("conclusionDirections"),
      [...new Set(rows.map((x) => x.direction))].sort(),
      conclusionCondition.directions,
      (value) => {
        toggleIn(conclusionCondition.directions, value);
        renderConclusion();
      },
      (value) => directionChoiceLabel(rows, value),
    );
    checkboxGroup(
      q("conclusionDays"),
      [...new Set(rows.map((x) => x.day))].sort(),
      conclusionCondition.days,
      (value) => {
        toggleIn(conclusionCondition.days, value);
        renderConclusion();
      },
    );
    checkboxGroup(
      q("conclusionRoads"),
      [...new Set(rows.map((x) => x.road))].sort(),
      conclusionCondition.roads,
      (value) => {
        toggleIn(conclusionCondition.roads, value);
        renderConclusion();
      },
    );

    q("conclusionMetrics").innerHTML = SPEED_CONCLUSION_METRICS.map(
      (metric, index) =>
        `<label class="${conclusionCondition.metrics.indexOf(metric.key) >= 0 ? "selected" : ""}">` +
        `<input type="checkbox" data-index="${index}" ${
          conclusionCondition.metrics.indexOf(metric.key) >= 0 ? "checked" : ""
        }>${safe(metric.label)}</label>`,
    ).join("");
    q("conclusionMetrics")
      .querySelectorAll("input")
      .forEach((input) => {
        input.onchange = () => {
          toggleIn(
            conclusionCondition.metrics,
            SPEED_CONCLUSION_METRICS[Number(input.dataset.index)].key,
          );
          renderConclusion();
        };
      });

    q("conclusionGrouping")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = input.value === conclusionCondition.grouping;
      });
    /*
     * 資料層級（逐筆明細／代表紀錄）。
     * ⚠️ 每次重畫都要重綁 onchange：checkboxGroup 那幾組是整個重建 innerHTML，
     *   這一組是寫死在 HTML 裡的，所以改成每次重設 checked 並重綁——
     *   只在初始化綁一次的話，套用範本或換計畫之後那兩顆會停在舊值。
     */
    if (q("conclusionRowLevel"))
      q("conclusionRowLevel")
        .querySelectorAll("input")
        .forEach((input) => {
          input.checked = input.value === (conclusionCondition.rowLevel || "detail");
          input.onchange = () => {
            conclusionCondition.rowLevel = input.value;
            renderConclusion();
          };
        });
    q("conclusionDigits").value = String(conclusionCondition.digits);

    /*
     * ⚠️ 這個筆數必須和草稿裡實際寫出來的筆數**是同一個數**，
     *   所以挑最差那一支要一起傳進去。少傳的話，切到「代表紀錄」時
     *   這裡仍然顯示逐筆明細的筆數，而草稿寫的是另一個——
     *   使用者會以為其中一邊漏資料。
     */
    const picked = selectSpeedConclusionRows(
      rows,
      conclusionCondition,
      conclusionWorstOf,
    );
    q("conclusionCount").textContent = "符合條件 " + picked.length + " 筆";
    q("conclusionCount").classList.toggle("zero", picked.length === 0);

    const templates = conclusionTemplates();
    q("conclusionTemplateList").innerHTML = templates
      .map(
        (t, index) =>
          `<span class="conclusion-template"><button data-apply="${index}">${safe(t.name)}</button>` +
          `<button class="danger" data-remove="${index}" aria-label="刪除範本 ${safe(t.name)}">×</button></span>`,
      )
      .join("");
    q("conclusionTemplateHint").hidden = templates.length > 0;
    q("conclusionTemplateList")
      .querySelectorAll("button[data-apply]")
      .forEach((button) => {
        button.onclick = () => {
          conclusionCondition = clone(templates[Number(button.dataset.apply)].condition);
          renderConclusion();
          toast("已套用範本「" + templates[Number(button.dataset.apply)].name + "」");
        };
      });
    q("conclusionTemplateList")
      .querySelectorAll("button[data-remove]")
      .forEach((button) => {
        button.onclick = () => {
          templates.splice(Number(button.dataset.remove), 1);
          save();
          renderConclusion();
        };
      });

    q("conclusionEditHint").textContent = conclusionEdited
      ? "您已手動修改過這份草稿；按「重新產生」會先詢問再覆蓋。"
      : "這段文字可以直接修改，改過之後不會被自動覆蓋。";
  }

  function generateConclusion() {
    if (
      conclusionEdited &&
      !confirm("您已經手動修改過草稿。重新產生會覆蓋掉修改內容，確定要繼續嗎？")
    )
      return;
    const p = activeProject();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    q("conclusionDraft").value = buildSpeedConclusion(
      conclusionRows(),
      conclusionCondition,
      {
        projectName: p ? `${p.code} ${p.name}` : "未命名計畫",
        systemVersion: document.querySelector(".brand small")?.textContent || "",
        /* 草稿上的季度跟著畫面的年份顯示切換走；篩選與排序仍走儲存值。 */
        showPeriod: showQuarter,
        /*
         * ⚠️ 「挑最差」與「三段分界」兩支都由這裡傳進去，草稿**不自己算**。
         *   草稿自己另算一次的話，只要哪天畫面那邊改了規則，
         *   草稿與畫面就會分岔——而那種錯在報告送出去之前幾乎不會被發現。
         *   worstOf ＝ rebuild() 用的那一支；bandsOf ＝ 三段分法圖用的那一支
         *  （會吃「依季別區間／路段」的分界覆寫）。
         */
        worstOf: conclusionWorstOf,
        bandsOf: conclusionBandsOf,
        generatedAt:
          now.getFullYear() +
          "-" +
          pad(now.getMonth() + 1) +
          "-" +
          pad(now.getDate()) +
          " " +
          pad(now.getHours()) +
          ":" +
          pad(now.getMinutes()),
      },
    );
    conclusionEdited = false;
    renderConclusion();
    toast("結論草稿已產生");
    /*
     * 唯一的「產生草稿」就在草稿框旁邊，所以正常情況下結果本來就在眼前，
     * revealResult() 會判斷「已經看得到」而完全不動。
     * 保留這一行是為了少數例外——例如視窗特別矮、或草稿變長把框推出畫面外。
     */
    if (typeof revealResult === "function") revealResult(q("conclusionDraft"));
  }

  if (q("conclusionScopeKinds"))
    q("conclusionScopeKinds")
      .querySelectorAll("input")
      .forEach((input) => {
        input.onchange = () => {
          const periods = ordered(conclusionRows().map((x) => x.period));
          const years = [...new Set(periods.map((x) => speedPeriodYear(x)).filter(Boolean))].sort();
          const kind = input.value;
          conclusionCondition.scope =
            kind === "quarter"
              ? { kind: "quarter", quarter: periods.at(-1) || "" }
              : kind === "year"
                ? { kind: "year", year: years.at(-1) || "" }
                : kind === "range"
                  ? { kind: "range", from: periods[0] || "", to: periods.at(-1) || "" }
                  : { kind: "project" };
          renderConclusion();
        };
      });
  if (q("conclusionQuarter"))
    q("conclusionQuarter").onchange = () => {
      conclusionCondition.scope = { kind: "quarter", quarter: q("conclusionQuarter").value };
      renderConclusion();
    };
  if (q("conclusionYear"))
    q("conclusionYear").onchange = () => {
      conclusionCondition.scope = { kind: "year", year: q("conclusionYear").value };
      renderConclusion();
    };
  if (q("conclusionFrom"))
    q("conclusionFrom").onchange = () => {
      conclusionCondition.scope = {
        kind: "range",
        from: q("conclusionFrom").value,
        to: q("conclusionTo").value,
      };
      renderConclusion();
    };
  if (q("conclusionTo"))
    q("conclusionTo").onchange = () => {
      conclusionCondition.scope = {
        kind: "range",
        from: q("conclusionFrom").value,
        to: q("conclusionTo").value,
      };
      renderConclusion();
    };
  if (q("conclusionGrouping"))
    q("conclusionGrouping")
      .querySelectorAll("input")
      .forEach((input) => {
        input.onchange = () => {
          conclusionCondition.grouping = input.value;
          renderConclusion();
        };
      });
  if (q("conclusionDigits"))
    q("conclusionDigits").onchange = () => {
      conclusionCondition.digits = Number(q("conclusionDigits").value);
      renderConclusion();
    };
  if (q("conclusionAllRoads"))
    q("conclusionAllRoads").onclick = () => {
      conclusionCondition.roads = [];
      renderConclusion();
    };
  /*
   * 只留草稿框旁邊這一顆。
   *
   * 頁首原本另有一顆「產生草稿」，和這一顆呼叫同一個函式，只是位置不同。
   * 使用者指出實際動線根本用不到它：條件與條件範本都在下方，
   *「哪怕條件沒變，為了確保資料正確，正常情況下仍會往下滑動確認條件」，
   * 所以每一條動線最後都停在草稿框旁邊。兩顆同名按鈕反而讓人以為有差別，
   * 還可能讓新手在還沒勾任何條件時就按下去，拿到一份用預設條件產生的草稿。
   */
  if (q("conclusionApplyMain"))
    q("conclusionApplyMain").onclick = applyMainToConclusion;
  if (q("conclusionRegenerate")) q("conclusionRegenerate").onclick = generateConclusion;
  if (q("conclusionDraft"))
    q("conclusionDraft").oninput = () => {
      conclusionEdited = true;
      q("conclusionEditHint").textContent =
        "您已手動修改過這份草稿；按「重新產生」會先詢問再覆蓋。";
    };
  if (q("conclusionCopy"))
    q("conclusionCopy").onclick = () => {
      const text = q("conclusionDraft").value;
      if (!text) return toast("草稿還是空的，請先按「產生草稿」");
      navigator.clipboard
        ?.writeText(text)
        .then(() => toast("已複製到剪貼簿"))
        .catch(() => toast("瀏覽器不允許複製，請手動全選複製"));
    };
  if (q("conclusionDownload"))
    q("conclusionDownload").onclick = () => {
      const text = q("conclusionDraft").value;
      if (!text) return toast("草稿還是空的，請先按「產生草稿」");
      downloadBlob(new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" }), "結論草稿.txt");
    };
  if (q("conclusionSaveTemplate"))
    q("conclusionSaveTemplate").onclick = () => {
      const name = String(q("conclusionTemplateName").value || "").trim();
      if (!name) return toast("請先輸入範本名稱");
      const templates = conclusionTemplates();
      const existing = templates.findIndex((t) => t.name === name);
      const entry = {
        id: "CT-" + Date.now(),
        name,
        condition: clone(conclusionCondition),
        savedAt: new Date().toISOString(),
      };
      if (existing >= 0) templates.splice(existing, 1, entry);
      else templates.unshift(entry);
      q("conclusionTemplateName").value = "";
      save();
      renderConclusion();
      toast("已存成範本「" + name + "」");
    };

  const baseRenderAll = renderAll;
  renderAll = function () {
    ensureState();
    baseRenderAll();
    renderTrace();
    renderSpeedVersions();
    renderAnomalyRules();
    renderPriority();
    refreshDelivery();
    renderOperations();
    renderConclusion();
  };
  renderAll();
})();
