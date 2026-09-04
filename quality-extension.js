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

    const sourcePanel = document.createElement("article");
    sourcePanel.className = "panel extension-panel";
    sourcePanel.innerHTML =
      '<div class="panel-head"><div><h3>來源追溯</h3><small>搜尋尖峰明細並查看原始檔、工作表、標籤位置與批次</small></div><input id="traceSearch" placeholder="搜尋路段、季度或檔名"></div><div class="table-wrap"><table><thead><tr><th>期間／路段</th><th>代表資料</th><th>來源檔案</th><th>工作表</th><th>標籤位置</th><th>批次／驗證碼</th></tr></thead><tbody id="traceRows"></tbody></table></div>';
    q("summary").append(sourcePanel);

    const versionPanel = document.createElement("article");
    versionPanel.className = "panel extension-panel";
    versionPanel.id = "speedVersionPanel";
    versionPanel.innerHTML =
      '<div class="panel-head"><div><h3>速限有效期間與查證紀錄</h3><small>不同季度可套用不同速限；未設定版本時維持原本路段速限</small></div></div><div class="version-grid"><label>路段方向<select id="versionLimitKey"></select></label><label>公告速限（km/h）<input id="versionSpeed" type="number" min="1" value="50"></label><label>開始季度<input id="versionStart" placeholder="例如 114Q1"></label><label>結束季度<input id="versionEnd" placeholder="持續有效可留白"></label><label>資料來源<input id="versionSource" placeholder="例如：現場速限牌／機關公告"></label><label>查證日期<input id="versionChecked" type="date"></label><label>查證人員<input id="versionBy" placeholder="姓名"></label><label>備註<input id="versionNote" placeholder="選填"></label></div><button class="primary" id="saveSpeedVersion">新增速限版本並重算</button><div class="table-wrap"><table><thead><tr><th>路段／方向</th><th>速限</th><th>有效期間</th><th>來源</th><th>查證</th><th>操作</th></tr></thead><tbody id="speedVersionRows"></tbody></table></div>';
    q("speed").append(versionPanel);

    const quality = document.querySelector(".quality-panel");
    if (quality) {
      const rules = document.createElement("article");
      rules.className = "panel extension-panel";
      rules.innerHTML =
        '<div class="panel-head"><div><h3>異常提醒門檻</h3><small>只影響提醒，不改變 LOS 計算</small></div><button class="primary" id="saveAnomalyRules">儲存門檻並重檢</button></div><div class="four"><label>旅行速率下降（%）<input id="ruleSpeedDrop" type="number" min="1" max="100"></label><label>總延滯增加（%）<input id="ruleDelayRise" type="number" min="1" max="100"></label><label>LOS 下降級數<input id="ruleLosDrop" type="number" min="1" max="5"></label><label>連續惡化季度<input id="ruleStreak" type="number" min="2" max="12"></label></div>';
      quality.before(rules);
    }
    const priority = document.createElement("article");
    priority.className = "panel extension-panel";
    priority.id = "priorityPanel";
    priority.innerHTML =
      '<div class="panel-head"><div><h3>重點路段總覽</h3><small>依目前計畫自動排列需優先檢視的路段</small></div><button class="outline" id="refreshPriority">重新分析</button></div><div class="table-wrap"><table><thead><tr><th>優先度</th><th>路段／日別</th><th>最近期間</th><th>變化原因</th><th>建議</th></tr></thead><tbody id="priorityRows"></tbody></table></div>';
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
      '<div class="title"><div><span class="eyebrow">DELIVERY CENTER</span><h2>季度成果交付</h2><p>選擇季度與範圍，下載可追溯、可編輯的成果資料包。</p></div></div><div class="two"><article class="panel form"><h3>成果範圍</h3><p class="muted">可以只交付單一季度，也可以選擇一段期間（例如 114Q1～114Q4）一次交付。</p><div class="row"><label>起始季度<select id="deliveryPeriodStart"></select></label><label>結束季度<select id="deliveryPeriodEnd"></select></label></div><div class="note" id="deliveryRangeNote">尚無資料</div><label>路段<select id="deliveryRoad"><option value="">全部路段</option></select></label><label>日別<select id="deliveryDay"><option value="">平日與假日</option><option>平日</option><option>假日</option></select></label><label>Excel 圖表內容<select id="deliveryMetric"><option value="travel">旅行速率（km/h）</option><option value="los">服務水準（A～F）</option></select></label><div class="check-grid"><label><input type="checkbox" id="packDetail" checked>尖峰明細</label><label><input type="checkbox" id="packSummary" checked>尖峰彙總</label><label><input type="checkbox" id="packQuality" checked>品質檢查</label><label><input type="checkbox" id="packNarrative" checked>分析文字草稿</label></div><button class="primary full" id="downloadQuarterPack">下載季度成果包 ZIP</button><button class="outline full" id="downloadFilteredCharts">匯出篩選後可編輯 Excel 圖表</button></article><article class="panel form"><h3>報告文字草稿</h3><p class="muted"><b>這一份是「這次交付的說明文字」</b>：依左邊的成果範圍逐筆代表紀錄各寫一行，會隨 ZIP 成果包一起交出去。要自己挑條件（只寫某一季、某幾條路段、只寫服務水準⋯）請改用左側選單的<b>「結論草稿」</b>。兩邊的數字來源完全相同，都必須由使用者確認後再放入正式報告。</p><textarea id="reportDraft" rows="18"></textarea><div class="note" id="draftRecoverNote" hidden></div><div class="row"><button class="outline" id="generateDraft">重新產生</button><button class="primary" id="saveDraft">儲存修改</button></div></article></div>';
    q("backup").before(delivery);

    const undo = document.createElement("article");
    undo.className = "panel extension-panel";
    undo.id = "undoPanel";
    undo.innerHTML =
      '<div class="panel-head"><div><h3>最近操作與復原</h3><small>保留最近10次會改變分析結果的操作；匯入批次仍請優先由「匯入紀錄」復原</small></div></div><div class="table-wrap"><table><thead><tr><th>時間</th><th>操作</th><th>計畫</th><th>操作</th></tr></thead><tbody id="operationRows"></tbody></table></div>';
    q("backup").append(undo);
    const guide = document.createElement("article");
    guide.className = "panel extension-panel";
    guide.innerHTML =
      "<h3>十一、資料品質與成果交付</h3><ol><li><b>匯入前：</b>在辨識預覽下方檢查與前一季的路段、平假日及4筆資料差異，再核對預計代表紀錄。</li><li><b>來源追溯：</b>到「尖峰彙總」下方搜尋原始檔名、工作表、標籤位置、批次及檔案驗證碼。</li><li><b>速限變更：</b>到「路段速限」新增有效期間、資料來源、查證日期與人員；系統只重算有效季度。</li><li><b>異常分析：</b>到「資料維護」設定提醒門檻並查看重點路段；提醒不會改變服務水準。</li><li><b>成果交付：</b>到「成果交付」選擇季度、路段及日別，下載 ZIP 或可編輯 Excel 圖表。自動文字僅為草稿，正式使用前必須人工核對。</li><li><b>操作復原：</b>到「備份與淨空」查看最近操作；匯入錯誤仍優先從「匯入紀錄」復原。</li></ol>";
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
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: false }),
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
  const baseRenderPreview = renderPreview;
  renderPreview = function () {
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
    q("traceRows").innerHTML = rows.length
      ? rows
          .slice(0, 500)
          .map(
            (x) =>
              `<tr><td>${safe(showQuarter(x.period))}<br>${safe(x.road)}／${safe(x.day)}</td><td>${safe(x.peak)}／${safe(rowDirectionName(x))}</td><td>${safe(x.sourceFile || x.source || "舊資料未記錄")}</td><td>${safe(x.sourceSheet || (x.sourceTraceFailed ? "本次讀取失敗" : "舊資料未記錄"))}</td><td>${safe((x.sourceRefs || []).join("、") || (x.sourceTraceFailed ? "本次讀取失敗" : "舊資料未記錄"))}</td><td>${safe(x.importBatch || "—")}<br><small>${safe(x.sourceHash || "—")}</small></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty">沒有符合的來源紀錄</td></tr>';
  }
  q("traceSearch").oninput = renderTrace;

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
            return `<tr><td>${safe(road)}／${safe(directionNameFor(road, dir))}</td><td>${v.speed} km/h</td><td>${safe(v.start)}～${safe(v.end || "持續")}</td><td>${safe(v.source || "—")}</td><td>${safe(v.checked || "—")}／${safe(v.by || "—")}</td><td><button class="outline" data-remove-version="${safe(v.k)}" data-version-id="${safe(v.id)}">刪除</button></td></tr>`;
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
      source: q("versionSource").value.trim(),
      checked: q("versionChecked").value,
      by: q("versionBy").value.trim(),
      note: q("versionNote").value.trim(),
    });
    /*
     * 不可以順手把「基準速限」標成已人工確認。
     *
     * 速限版本只涵蓋它自己的季度區間；區間外的季度用的還是那個沒被確認過的
     * 預設值 50。舊版在這裡把 limitConfirmed 設成 true，於是「速限未確認」
     * 的健康檢查提示整條消失，而真正還在用未確認預設值的，正是版本沒涵蓋到
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
      losRule: clone(state.losRules[code] || null),
    };
  }
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
    state.operations = state.operations.slice(0, 10);
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
              `<tr><td>${safe(x.time)}</td><td>${safe(x.name)}</td><td>${safe(x.projectCode)}</td><td>${x.status === "可復原" ? `<button class="outline" data-undo-operation="${safe(x.id)}">復原</button>` : safe(x.status)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4" class="empty">尚無可復原操作</td></tr>';
    document
      .querySelectorAll("[data-undo-operation]")
      .forEach((b) => (b.onclick = () => undoOperation(b.dataset.undoOperation)));
  }
  function observeOperation(id) {
    const button = q(id);
    if (!button) return;
    button.addEventListener(
      "click",
      () => {
        const before = operationSnapshot(),
          fingerprint = JSON.stringify(before);
        setTimeout(async () => {
          if (JSON.stringify(operationSnapshot()) === fingerprint) return;
          ensureState();
          state.operations.unshift({
            id: `OP${Date.now()}${Math.random()}`,
            name: button.textContent.trim(),
            time: new Date().toLocaleString("zh-TW"),
            projectCode: before.activeCode,
            snapshot: before,
            status: "可復原",
          });
          state.operations = state.operations.slice(0, 10);
          await save();
        }, 400);
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
      if (
        !confirm(`${info.title}\n\n${info.detail}\n\n系統將先下載目前 Project 備份。確定繼續嗎？`)
      )
        return;
      downloadProjectPackage(false);
      recordOperation(info.title);
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
    if (!changed.length)
      return { ok: false, message: "速限沒有任何變更" };
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
  ["resetLosRules", "deleteQuarter", "cleanSuffix"].forEach(observeOperation);

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
  function deliveryRows() {
    const road = q("deliveryRoad").value,
      day = q("deliveryDay").value;
    return activeSummaries().filter(
      (x) => inDeliveryRange(x.period) && (!road || x.road === road) && (!day || x.day === day),
    );
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
    const range = deliveryRange();
    if (q("deliveryRangeNote"))
      q("deliveryRangeNote").textContent = range.periods.length
        ? `本次成果範圍：${range.displayLabel}，共 ${range.periods.length} 個季度（${range.periods.map(showQuarter).join("、")}）`
        : "目前計畫尚無季度資料";
    loadDraft();
  }
  function narrative(rows = deliveryRows()) {
    if (!rows.length) return "目前篩選範圍沒有資料。";
    const p = activeProject(),
      range = deliveryRange(),
      lines = [
        `${p?.code || ""} ${p?.name || ""} ${range.displayLabel} 交通服務水準分析草稿`,
        range.periods.length > 1
          ? `本次範圍涵蓋 ${range.periods.length} 個季度（${range.periods.map(showQuarter).join("、")}），共分析 ${new Set(rows.map((x) => x.road)).size} 個路段、${rows.length} 筆路段日別代表資料。`
          : `本期共分析 ${new Set(rows.map((x) => x.road)).size} 個路段、${rows.length} 筆路段日別代表資料。`,
      ];
    for (const x of rows) {
      const prev = activeSummaries()
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
              ? `${label}由 0 增為 ${fmt(after, 1)}`
              : `${label}維持 0`;
          const change = ((after - before) / before) * 100;
          return `${label}${change >= 0 ? "增加" : "下降"} ${Math.abs(change).toFixed(1)}%`;
        };
        change =
          `較 ${showQuarter(prev.period)} ` +
          pctText(prev.travel, x.travel, "旅行速率") +
          "，" +
          pctText(prev.totalDelay, x.totalDelay, "總延滯");
      }
      lines.push(
        `${showQuarter(x.period)} ${x.road}（${x.day}）服務水準為 ${x.los}，代表紀錄為${x.peak}${rowDirectionName(x)}，旅行速率 ${fmt(x.travel, 1)} km/h、總延滯 ${fmt(x.totalDelay, 1)} 秒；${change}。`,
      );
    }
    lines.push("本段文字由系統依彙總資料自動產生，正式引用前應核對原始檔、速限設定及現地情況。");
    return lines.join("\n");
  }
  function draftKey() {
    return `${state.activeCode}|${deliveryRange().label}`;
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
      detail = activeRows().filter(
        (x) =>
          inDeliveryRange(x.period) &&
          (!q("deliveryRoad").value || x.road === q("deliveryRoad").value) &&
          (!q("deliveryDay").value || x.day === q("deliveryDay").value),
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
      const label = deliveryRange().label;
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
    q("conclusionDigits").value = String(conclusionCondition.digits);

    q("conclusionCount").textContent =
      "符合條件 " + selectSpeedConclusionRows(rows, conclusionCondition).length + " 筆";
    q("conclusionCount").classList.toggle(
      "zero",
      selectSpeedConclusionRows(rows, conclusionCondition).length === 0,
    );

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
