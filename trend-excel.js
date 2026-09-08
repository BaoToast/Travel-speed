/*
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢圖 → 可編輯的 Excel
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者要的東西講得很清楚：
 *   「我下載下來，形成可編輯的圖，excel 裡面圖本身就是圖，文字說明可以放在
 *    excel 其他欄位，使用者可以針對圖做修正或直接拿去簡報使用。」
 *
 * 所以這一份活頁簿有三張工作表，各司其職：
 *   1. 歷季趨勢資料 — 數字。改這裡，圖會跟著變。
 *   2. 歷季趨勢圖表 — 原生 Excel 折線圖（不是貼一張圖片）。
 *   3. 圖表說明     — 講稿文字。**放在自己的工作表，不印在圖上**，
 *                     因為那些話是簡報者要用講的，印在圖裡反而破壞版面。
 *
 * ── 相容性 ────────────────────────────────────────────────────
 * 只用 `c:lineChart`——這是 Excel 2007 就有的原生圖表，
 * **完全沒有用到 `chartex`、`x14`、`x15` 這些新版才看得懂的擴充**，
 * 舊版 Excel、LibreOffice、Google 試算表都開得起來。
 *
 * ── 為什麼不用公式重算 ────────────────────────────────────────
 * 表格裡寫的是**畫面上那張圖已經算好的那一份數值**，不是把彙總邏輯用
 * Excel 公式再實作一次。再實作一次就會有第二套算法，兩套遲早分岔，
 * 而分岔的時候沒有人會發現——使用者只會看到 Excel 與網頁不一樣。
 *
 * ── 每個指標一張圖 ────────────────────────────────────────────
 * 佔比是 %、速率是 km/h、延滯是秒。把不同單位疊在同一張圖需要雙軸，
 * 那是最容易被誤讀的畫法。一個指標一張圖，各自有自己的縱軸名稱與單位。
 */
(function (root) {
  root.JSZip = root.JSZip || globalThis.JSZip;

  const xml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
    );
  const colName = (n) => {
    let s = "";
    for (; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const textCell = (ref, value, style = 0) =>
    `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  const numCell = (ref, value, style = 3) =>
    value == null || value === "" || !Number.isFinite(Number(value))
      ? ""
      : `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;

  /* 折線顏色：與畫面上的跨計畫圖同一組，已通過色盲可辨識檢核。 */
  const SERIES_COLORS = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "4A3AA7", "E34948"];

  /**
   * 資料工作表。
   *
   * A 欄季度，B 欄起每一個指標各一欄。
   * ⚠️ 欄位順序不可以更動——下面的圖表是用欄位字母指定數列的。
   */
  function dataSheet(series, periods, periodLabels) {
    const headerRow = 3;
    const firstRow = headerRow + 1;
    const rows = [
      `<row r="1" ht="27" customHeight="1">${textCell("A1", "交通服務水準－歷季趨勢（可編輯）", 1)}</row>`,
      `<row r="2" ht="34" customHeight="1">${textCell(
        "A2",
        "請直接修改黃色欄位的數值，「歷季趨勢圖表」會跟著更新。圖表代表的意義寫在「圖表說明」工作表，那是給簡報者講的，刻意不印在圖上。",
        4,
      )}</row>`,
      `<row r="${headerRow}" ht="23" customHeight="1">${textCell(
        `A${headerRow}`,
        "季度",
        2,
      )}${series
        .map((item, index) =>
          textCell(
            `${colName(index + 2)}${headerRow}`,
            item.unit ? `${item.label}（${item.unit}）` : item.label,
            2,
          ),
        )
        .join("")}</row>`,
    ];
    periods.forEach((period, rowIndex) => {
      const row = firstRow + rowIndex;
      rows.push(
        `<row r="${row}">${textCell(`A${row}`, periodLabels[rowIndex] ?? period)}${series
          .map((item, index) =>
            /*
             * 算不出來的季度**留白**，不可以寫 0。
             * 寫 0 的話 Excel 會把它當成一個真實的資料點，折線掉到零；
             * 留白配上圖表的 dispBlanksAs=gap 才會正確斷線。
             */
            numCell(`${colName(index + 2)}${row}`, item.values[rowIndex]),
          )
          .join("")}</row>`,
      );
    });
    const lastRow = firstRow + periods.length - 1;
    const lastCol = colName(series.length + 1);
    return {
      firstRow,
      lastRow,
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="${
          series.length + 1
        }" width="26" customWidth="1"/></cols>` +
        `<sheetData>${rows.join("")}</sheetData>` +
        `<autoFilter ref="A${headerRow}:${lastCol}${Math.max(headerRow, lastRow)}"/>` +
        `<mergeCells count="2"><mergeCell ref="A1:${lastCol}1"/><mergeCell ref="A2:${lastCol}2"/></mergeCells>` +
        `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`,
    };
  }

  /**
   * 說明工作表。
   *
   * 一段一列，段落標題與內容分開兩欄，方便使用者直接複製到簡報備忘稿。
   * 這裡是唯一放文字的地方——圖上不放。
   */
  function scriptSheet(sections) {
    const rows = [
      `<row r="1" ht="27" customHeight="1">${textCell("A1", "圖表說明（給簡報者用的講稿）", 1)}</row>`,
      `<row r="2" ht="34" customHeight="1">${textCell(
        "A2",
        "以下文字是這幾張圖代表的意義，供簡報時口述。刻意不印在圖上——圖給聽眾看，話由簡報者講。",
        4,
      )}</row>`,
      `<row r="3" ht="23" customHeight="1">${textCell("A3", "段落", 2)}${textCell("B3", "內容", 2)}</row>`,
    ];
    let row = 4;
    for (const section of sections) {
      for (const line of section.lines) {
        rows.push(
          `<row r="${row}" ht="30" customHeight="1">${textCell(`A${row}`, section.title)}${textCell(
            `B${row}`,
            line,
            4,
          )}</row>`,
        );
        row += 1;
      }
    }
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/></cols>` +
      `<sheetData>${rows.join("")}</sheetData>` +
      `<mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="A2:B2"/></mergeCells>` +
      `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`
    );
  }

  function cache(values) {
    return values
      .map((v, i) =>
        v == null || v === "" ? "" : `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`,
      )
      .join("");
  }

  /** 一個指標一張原生折線圖。 */
  function chartXml(item, index, layout, periodLabels) {
    const sheet = "&apos;歷季趨勢資料&apos;";
    const column = colName(index + 2);
    const ax1 = 200000 + index * 2;
    const ax2 = ax1 + 1;
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const axisTitle = item.unit ? `${item.label}（${item.unit}）` : item.label;
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<c:date1904 val="0"/><c:lang val="zh-TW"/><c:style val="10"/><c:chart>` +
      `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-TW" sz="1100" b="1"/><a:t>${xml(
        item.label,
      )}－歷季趨勢</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>` +
      `<c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
      `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(item.label)}</c:v></c:tx>` +
      `<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>` +
      `<c:cat><c:strRef><c:f>${sheet}!$A$${layout.firstRow}:$A$${layout.lastRow}</c:f>` +
      `<c:strCache><c:ptCount val="${periodLabels.length}"/>${cache(periodLabels)}</c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${sheet}!$${column}$${layout.firstRow}:$${column}$${layout.lastRow}</c:f>` +
      `<c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="${item.values.length}"/>${cache(
        item.values,
      )}</c:numCache></c:numRef></c:val><c:smooth val="0"/></c:ser>` +
      `<c:marker val="1"/><c:smooth val="0"/><c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:lineChart>` +
      `<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
      `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-TW" sz="900"/><a:t>季度</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>` +
      `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
      `<c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>` +
      `<c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/>${
        /* 佔比有天然上下界，固定 0～100，不然「12% 到 14%」會被畫成災難。 */
        item.unit === "%" ? '<c:min val="0"/><c:max val="100"/>' : '<c:min val="0"/>'
      }</c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>` +
      /* 縱軸名稱一律帶單位——使用者的要求：有單位的軸要附上名稱和單位。 */
      `<c:title><c:tx><c:rich><a:bodyPr rot="-5400000" vert="horz"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-TW" sz="900"/><a:t>${xml(
        axisTitle,
      )}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>` +
      `<c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
      `<c:crossAx val="${ax1}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>` +
      `<c:plotVisOnly val="1"/>` +
      /* 留白的季度要斷線，不可以連過去——連過去等於宣稱那一季有一個中間值。 */
      `<c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>` +
      `<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`
    );
  }

  function drawing(count) {
    const anchors = [...Array(count)]
      .map((_, i) => {
        const left = (i % 2) * 9;
        const top = Math.floor(i / 2) * 19;
        return (
          `<xdr:twoCellAnchor><xdr:from><xdr:col>${left}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:to><xdr:col>${left + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top + 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
          `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="歷季趨勢圖 ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>` +
          `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
          `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/>` +
          `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
        );
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
  }

  /**
   * @param {Array<{label,unit,values:Array<number|null>}>} series 每個指標一條
   * @param {string[]} periods       季度（儲存值，只用來對齊列數）
   * @param {string[]} periodLabels  季度顯示字樣（跟著年份顯示切換）
   * @param {Array<{title,lines:string[]}>} sections 講稿
   */
  async function build(series, periods, periodLabels, sections) {
    if (!root.JSZip) throw new Error("Excel 匯出元件尚未載入");
    if (!series.length) throw new Error("目前沒有可匯出的趨勢資料");
    if (!periods.length) throw new Error("目前沒有可匯出的季度");
    const zip = new root.JSZip();
    const data = dataSheet(series, periods, periodLabels);
    const count = series.length;
    const overrides = [...Array(count)]
      .map(
        (_, i) =>
          `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      )
      .join("");
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    );
    zip
      .folder("_rels")
      .file(
        ".rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      );
    zip
      .folder("docProps")
      .file(
        "core.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>交通服務水準－歷季趨勢</dc:title><dc:creator>交通服務水準分析系統</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
      )
      .file(
        "app.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><AppVersion>12.0000</AppVersion></Properties>`,
      );
    const xl = zip.folder("xl");
    xl.file(
      "workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="歷季趨勢資料" sheetId="1" r:id="rId1"/><sheet name="歷季趨勢圖表" sheetId="2" r:id="rId2"/><sheet name="圖表說明" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="124519" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`,
    )
      .folder("_rels")
      .file(
        "workbook.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      );
    xl.file(
      "styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft JhengHei"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17354D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDCE5EA"/></left><right style="thin"><color rgb="FFDCE5EA"/></right><top style="thin"><color rgb="FFDCE5EA"/></top><bottom style="thin"><color rgb="FFDCE5EA"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="2" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    );
    const ws = xl.folder("worksheets");
    ws.file("sheet1.xml", data.xml)
      .file(
        "sheet2.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData/><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><drawing r:id="rId1"/></worksheet>`,
      )
      .file("sheet3.xml", scriptSheet(sections || []))
      .folder("_rels")
      .file(
        "sheet2.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      );
    xl.folder("drawings")
      .file("drawing1.xml", drawing(count))
      .folder("_rels")
      .file(
        "drawing1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[
          ...Array(count),
        ]
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`,
          )
          .join("")}</Relationships>`,
      );
    const charts = xl.folder("charts");
    series.forEach((item, i) =>
      charts.file(`chart${i + 1}.xml`, chartXml(item, i, data, periodLabels)),
    );
    return zip.generateAsync({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
    });
  }

  root.TrendExcel = { build };
})(window);
