/*
 * 端對端：圖表版面與匯出圖片的正確性
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的原話：「圖片最容易出現X軸沒文字或是文字被縮減、重疊等等狀況
 * 發生，請幫我確認圖表的圖或轉變成圖片後，格式都能正確，不要有縮減或
 * 重疊情況發生，美觀易讀懂是最重要的，有單位的軸，就要附上名稱和單位」。
 *
 * ── 這一支要擋的是什麼 ────────────────────────────────────────
 *
 * 一、**匯出的 PNG 與畫面不一樣。** 這不是假設，是實測出來的：
 *     downloadSvgAsPng 把 SVG 序列化成 data:image/svg+xml 再畫進 canvas，
 *     那份 data URL 是獨立文件，讀不到 styles.css。折線是 .trend-line 的
 *     stroke 畫的，樣式一掉，polyline 退回預設的 fill:#000／stroke:none
 *     ——**整條折線消失**，格線與軸線不見，資料點變黑色大圓，字變成
 *     16px 襯線體因而互相重疊。畫面上一切正常，下載下來不能用，
 *     而下載下來那張才是貼進簡報交給業主的。
 *
 * 二、季度累積之後 X 軸標籤擠在一起。
 * 三、縱軸沒有名稱與單位（「41.5」是什麼？km/h 還是秒？）。
 * 四、跨計畫圖的線尾標籤衝出畫布、或兩個計畫的名字疊在一起。
 * 五、刻度印成 20.83／30.39／39.94 這種一排亂數。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、**只驗畫面上的 SVG 不算數。** 畫面有 styles.css，PNG 沒有；
 *     只量畫面的文字外框，第一項那個最嚴重的問題一項都驗不到。
 *     所以這裡一定要把 PNG 真的產生出來，讀它的像素。
 * 二、**只驗「PNG 有產生出來」不算數。** 一張全白的圖也產生得出來。
 *     要驗折線的顏色真的出現在像素裡、而且數量夠多。
 * 3、**只量 getBBox 不算數。** 旋轉過的縱軸名稱在自己的座標系裡 x 是
 *     負的，不換算就會每次都誤報出界；誤報久了就會被當雜訊忽略。
 *     一律換算到 viewBox 座標再判斷。
 * 四、**只驗目前的資料量不算數。** 現在 3 季不會擠，16 季、24 季會。
 *     這裡用合成資料把季度數一路壓到 40 季。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((req, res) => {
  const path = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "networkidle" });

/*
 * 量測與 PNG 都在頁面裡做，因為 getBBox 與 canvas 都只有瀏覽器有。
 * 這裡刻意**直接呼叫繪圖函式**，不走匯入流程——匯入流程只給得出
 * 目前測資的季度數，壓不出 24 季、40 季與長計畫名稱那幾種情形。
 */
const result = await page.evaluate(async () => {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:900px;background:#fff;z-index:9999;opacity:0";
  document.body.appendChild(host);

  /** 量一張 SVG 裡每一段文字的外框（換算到 viewBox 座標）。 */
  const layout = (markup) => {
    host.innerHTML = markup;
    const svg = host.querySelector("svg");
    if (!svg) return { error: "沒有 svg" };
    const box = svg.viewBox.baseVal;
    const root = svg.getScreenCTM();
    const texts = [...svg.querySelectorAll("text")].map((node) => {
      const b = node.getBBox();
      const m = node.getScreenCTM();
      const corners = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(m).matrixTransform(root.inverse());
      });
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      return {
        text: node.textContent,
        cls: node.getAttribute("class") || "",
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    });
    const overlaps = [];
    for (let i = 0; i < texts.length; i += 1)
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        if (
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h
        )
          overlaps.push(`「${a.text}」與「${b.text}」`);
      }
    const outside = texts
      .filter(
        (t) =>
          t.x < -0.5 ||
          t.y < -0.5 ||
          t.x + t.w > box.width + 0.5 ||
          t.y + t.h > box.height + 0.5,
      )
      .map((t) => `「${t.text}」`);
    return {
      overlaps,
      outside,
      blanks: texts.filter((t) => !String(t.text).trim()).length,
      axisTitles: texts.filter((t) => t.cls === "axis-title").map((t) => t.text),
      /*
       * X 軸標籤與縱軸刻度都掛 .trend-tick，要分得開。
       * 用「在不在畫布下緣」分會誤判——縱軸最下面那一格刻度（例如 20）
       * 也在下緣，會被算成 X 軸標籤，讓「X 軸有幾個標籤」多算一個。
       * 季別字樣一定含「Q1～Q4」，用這個分才不會混。
       */
      xLabels: texts
        .filter((t) => t.cls === "trend-tick" && /Q[1-4]/.test(t.text))
        .map((t) => t.text),
      yTicks: texts
        .filter((t) => t.cls === "trend-tick" && !/Q[1-4]/.test(t.text))
        .map((t) => t.text),
    };
  };

  /**
   * 把 SVG 走**與匯出完全相同的路徑**變成點陣圖，再讀像素。
   * 這一段是這支腳本存在的理由：畫面讀得到 styles.css，這條路徑讀不到。
   */
  const rasterize = async (markup) => {
    host.innerHTML = markup;
    const svg = host.querySelector("svg");
    const box = svg.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, box.width, box.height);
    const image = new Image();
    const text = new XMLSerializer().serializeToString(svg);
    await new Promise((done, fail) => {
      image.onload = done;
      image.onerror = fail;
      image.src =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    });
    ctx.drawImage(image, 0, 0, box.width, box.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let near = 0;
    let black = 0;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 245 && g > 245 && b > 245) white += 1;
      /* 折線的青綠 #0f6f68 */
      if (Math.abs(r - 15) < 46 && Math.abs(g - 111) < 46 && Math.abs(b - 104) < 46)
        near += 1;
      /* 樣式掉光時字與點會變成純黑 */
      if (r < 40 && g < 40 && b < 40) black += 1;
    }
    return { near, black, white, total: canvas.width * canvas.height };
  };

  const points = (n) =>
    Array.from({ length: n }, (_, i) => ({
      period: `${113 + Math.floor(i / 4)}Q${(i % 4) + 1}`,
      value: 40 + Math.sin(i) * 12,
      rows: [],
      gradedSize: 12,
      congestedCount: 3,
      size: 12,
    }));

  const cases = [];
  for (const n of [3, 8, 12, 16, 24, 40])
    cases.push({
      name: `單一計畫大圖 ${n} 季（km/h）`,
      markup: trendChartSvg(
        {
          metric: "travel",
          label: "平均旅行速率",
          unit: "km/h",
          digits: 1,
          points: points(n),
        },
        false,
      ),
    });
  for (const n of [8, 16, 24])
    cases.push({
      name: `單一計畫小倍數圖 ${n} 季（秒）`,
      markup: trendChartSvg(
        {
          metric: "totalDelay",
          label: "平均總延滯",
          unit: "秒",
          digits: 1,
          points: points(n),
        },
        true,
      ),
    });
  cases.push({
    name: "單一計畫大圖（佔比 %）",
    markup: trendChartSvg(
      {
        metric: "congestedShare",
        label: "E 級以下路段佔比",
        unit: "%",
        digits: 1,
        points: points(12).map((p) => ({ ...p, value: 20 + (p.value % 40) })),
      },
      false,
    ),
  });
  cases.push({
    name: "單一計畫大圖（無單位的比值）",
    markup: trendChartSvg(
      {
        metric: "ratio",
        label: "平均速限比",
        unit: "",
        digits: 2,
        points: points(10).map((p) => ({ ...p, value: p.value / 50 })),
      },
      false,
    ),
  });
  cases.push({
    name: "單一計畫大圖（序數等級）",
    markup: trendChartSvg(
      {
        metric: "worstLos",
        label: "最差服務水準等級",
        unit: "級",
        digits: 0,
        ordinal: true,
        points: points(10).map((p) => ({ ...p, value: 3 })),
      },
      false,
    ),
  });
  /* 缺季（折線要斷開）也要驗版面，斷線那一段最容易讓標籤算錯位置。 */
  cases.push({
    name: "單一計畫大圖（中間缺 3 季）",
    markup: trendChartSvg(
      {
        metric: "travel",
        label: "平均旅行速率",
        unit: "km/h",
        digits: 1,
        points: points(12).map((p, i) =>
          i > 3 && i < 7 ? { ...p, value: null } : p,
        ),
      },
      false,
    ),
  });
  const cross = [
    "示範捷運延伸線示範標第二期工程",
    "示範市區道路服務水準調查",
    "示範3",
    "示範四號計畫案",
  ].map((name, k) => ({
    projectCode: "P" + k,
    projectName: name,
    label: "平均旅行速率",
    unit: "km/h",
    digits: 1,
    /* 最後一季刻意讓四個計畫幾乎同值——線尾標籤最容易疊在一起的情形。 */
    points: points(14).map((p) => ({
      ...p,
      value: 41 + k * 0.15,
      gradedSize: 12 - k * 3,
    })),
  }));
  cases.push({ name: "跨計畫圖（4 計畫、長名稱、末季幾乎同值）", markup: crossProjectChartSvg(cross) });
  cases.push({ name: "跨計畫圖（2 計畫）", markup: crossProjectChartSvg(cross.slice(0, 2)) });

  const report = [];
  for (const item of cases)
    report.push({ name: item.name, ...layout(item.markup) });

  /* PNG 像素：一張大圖與一張跨計畫圖就足以擋住「樣式沒帶進去」。 */
  const pixels = {
    single: await rasterize(cases[3].markup),
    cross: await rasterize(cases[cases.length - 2].markup),
  };

  /*
   * 匯出的圖片只能有圖，不可以印上說明文字。
   *
   * 使用者的原話：「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，
   * 看到那些應該由簡報者說明的文字展示在上方這樣才奇怪。」
   *
   * 這裡驗的是**匯出程式本身寫成什麼樣**：兩條匯出路徑算畫布高度時，
   * 不可以在圖的高度之外再加任何東西。只驗「圖畫得對」擋不住這件事——
   * 底下多一條文字帶的圖，圖的部分還是對的。
   */
  /*
   * 兩條匯出路徑的原始碼：一條是趨勢圖下載鈕的處理函式（掛在 DOM 屬性上，
   * 用 String() 就讀得出來），另一條是 Manager 共用的 downloadSvgAsPng。
   */
  const source =
    String(document.getElementById("trendDownloadPng")?.onclick || "") +
    "\n" +
    String(typeof downloadSvgAsPng === "function" ? downloadSvgAsPng : "");
  const exportShape = {
    /* 畫布高度只能是 box.height（× 倍率），不可以是 box.height + 別的東西。 */
    heightIsChartOnly:
      !/canvas\.height\s*=\s*\(\s*box\.height\s*\+/.test(source),
    /* 匯出程式裡不可以再出現把文字畫進 canvas 的呼叫。 */
    noFillText: !/ctx\.fillText\s*\(/.test(source),
    noCaptionHelper: !/captionLines\s*\(|wrapCaption\s*\(/.test(source),
    /* 前置檢查：真的讀到程式碼了嗎？讀不到的話下面三項會變成恆真的假通過。 */
    sourceLength: source.length,
  };


  host.remove();
  return { report, pixels, exportShape };
});

/* ── 一、版面 ── */
for (const item of result.report) {
  ok(`${item.name}：文字不可以互相重疊`, !item.error && !item.overlaps.length, (item.overlaps || []).join("、"));
  ok(`${item.name}：文字不可以超出畫布`, !item.error && !item.outside.length, (item.outside || []).join("、"));
  ok(`${item.name}：不可以有空白標籤`, !item.error && item.blanks === 0, `${item.blanks} 個`);
  ok(
    `${item.name}：X 軸一定要有標籤`,
    !item.error && item.xLabels.length >= 2,
    `${(item.xLabels || []).length} 個`,
  );
  ok(
    `${item.name}：縱軸與橫軸都要有名稱`,
    !item.error && (item.axisTitles || []).length === 2,
    (item.axisTitles || []).join(" / "),
  );
}

/* ── 二、有單位的軸一定要把單位寫在名稱裡 ── */
const unitCases = [
  ["單一計畫大圖 3 季（km/h）", "km/h"],
  ["單一計畫小倍數圖 8 季（秒）", "秒"],
  ["單一計畫大圖（佔比 %）", "%"],
  ["跨計畫圖（4 計畫、長名稱、末季幾乎同值）", "km/h"],
];
for (const [name, unit] of unitCases) {
  const item = result.report.find((r) => r.name === name);
  const title = (item?.axisTitles || [])[0] || "";
  ok(
    `「${name}」的縱軸名稱要帶單位（${unit}）`,
    title.includes(unit),
    `實際：${title || "沒有縱軸名稱"}`,
  );
}
const noUnit = result.report.find((r) => r.name === "單一計畫大圖（無單位的比值）");
ok(
  "沒有單位的指標不可以掛一個空括號",
  !((noUnit?.axisTitles || [])[0] || "").includes("（）"),
  (noUnit?.axisTitles || [])[0] || "",
);

/* ── 三、刻度要落在好看的整數上 ── */
const kmh = result.report.find((r) => r.name === "單一計畫大圖 24 季（km/h）");
const ragged = (kmh?.yTicks || []).filter((t) => /\.\d\d/.test(t));
ok(
  "縱軸刻度不可以印成一排小數亂數",
  ragged.length === 0,
  `實際刻度：${(kmh?.yTicks || []).join("、")}`,
);
const digitSet = new Set(
  (kmh?.yTicks || []).map((t) => (String(t).split(".")[1] || "").length),
);
ok("同一條縱軸上的刻度小數位數要一致", digitSet.size <= 1, `位數種類 ${digitSet.size}`);

/* ── 四、匯出成點陣圖之後，圖還在 ── */
/*
 * ⚠️ 這四項才是這支腳本真正的重點。上面的版面量測全部是在畫面上做的，
 * 畫面讀得到 styles.css；匯出那條路徑讀不到。樣式沒有帶進 SVG 時，
 * 上面每一項都會照樣綠燈，而下載下來的圖沒有折線。
 */
const single = result.pixels.single;
ok(
  "匯出成點陣圖之後，折線的顏色一定要出現在像素裡",
  single.near > 400,
  `青綠像素 ${single.near} 個（門檻 400）`,
);
ok(
  "匯出成點陣圖之後，不可以整張都是白的",
  single.white < single.total * 0.995,
  `白色佔 ${((single.white / single.total) * 100).toFixed(2)}%`,
);
ok(
  "匯出成點陣圖之後，不可以出現大片純黑（樣式掉光的徵兆）",
  single.black < single.total * 0.02,
  `純黑佔 ${((single.black / single.total) * 100).toFixed(2)}%`,
);
ok(
  "跨計畫圖匯出成點陣圖之後也要畫得出來",
  result.pixels.cross.white < result.pixels.cross.total * 0.995,
  `白色佔 ${((result.pixels.cross.white / result.pixels.cross.total) * 100).toFixed(2)}%`,
);

/* ── 五、匯出的圖片只能有圖，不可以印上說明文字 ── */
/*
 * 使用者的原話：「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，
 * 看到那些應該由簡報者說明的文字展示在上方這樣才奇怪。」說明是講的，
 * 不是印在投影片上的。
 *
 * 這一項驗的是**匯出程式本身寫成什麼樣**，不是驗圖畫得對不對——
 * 底下多一條文字帶的圖，圖的那一半還是對的，所有版面檢查照樣全綠。
 */
const shape = result.exportShape;
/*
 * ⚠️ 前置檢查。讀不到匯出程式的原始碼時，下面三個「不可以出現 X」
 * 全部會變成恆真的綠字——那是最危險的一種假通過。
 */
ok(
  "前置：要真的讀得到兩條匯出路徑的程式碼",
  shape.sourceLength > 600,
  `讀到 ${shape.sourceLength} 個字元`,
);
ok(
  "匯出的畫布高度只能是圖的高度，不可以再加一條文字帶",
  shape.heightIsChartOnly,
  shape.heightIsChartOnly ? "" : "找到 canvas.height = (box.height + …)",
);
ok(
  "匯出程式裡不可以有把文字畫進圖片的 ctx.fillText",
  shape.noFillText,
  shape.noFillText ? "" : "匯出程式仍在呼叫 ctx.fillText",
);
ok(
  "匯出程式裡不可以再呼叫圖說折行",
  shape.noCaptionHelper,
  shape.noCaptionHelper ? "" : "仍在呼叫 captionLines／wrapCaption",
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(
  problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
