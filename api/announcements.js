// api/announcements.js
import * as cheerio from "cheerio";

/* Kaynak domain (doğrulanmış) */
const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const BASE = `${ORIGIN}/view/announcement-list`;

function buildListUrl(id, page = 1) {
  // Upstream cache kırıcı parametre
  const ts = Date.now();
  return `${BASE}?id=${id}&type=1&SearchString=&dates=&date=&page=${page}&_=${ts}`;
}

/* Türkçe ay adları – varyasyonlar dahil */
const TR_AYLAR = {
  ocak:0, şubat:1, subat:1, mart:2, nisan:3, mayıs:4, mayis:4,
  haziran:5, temmuz:6, ağustos:7, agustos:7, eylül:8, eylul:8,
  ekim:9, kasım:10, kasim:10, aralık:11, aralik:11
};
const temiz = (s="") => s.trim().toLowerCase("tr")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g,"");

/* "03 Kasım 2025" | "03.11.2025" | "03/11/2025" hepsini yakala */
function parseTrDate(text = "") {
  const s = text.replace(/\s+/g," ").trim();

  // dd.MM.yyyy | dd/MM/yyyy | dd-MM-yyyy
  const mDot = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (mDot) {
    const d = parseInt(mDot[1],10);
    const m = parseInt(mDot[2],10) - 1;
    const y = parseInt(mDot[3],10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
  }

  // "03 Kasım 2025"
  const mTxt = s.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü\.]+)\s+(\d{4})$/);
  if (mTxt) {
    const d = parseInt(mTxt[1],10);
    const mm = TR_AYLAR[temiz(mTxt[2].replace(/\./g,""))];
    const y = parseInt(mTxt[3],10);
    if (mm !== undefined) {
      const dt = new Date(y, mm, d);
      return isNaN(dt.getTime()) ? new Date(0) : dt;
    }
  }

  return new Date(0);
}

async function fetchPage(listId, page = 1) {
  const res = await fetch(buildListUrl(listId, page), {
    headers: {
      "User-Agent": "GaziDuyuruBot/1.0",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
      "Cache-Control": "no-cache"
    }
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];
  $(".subpage-ann-single").each((idx, el) => {
    const $el = $(el);
    const $a  = $el.find(".subpage-ann-link a").first();
    if (!$a.length) return;

    const href  = $a.attr("href") || "#";
    const url   = href.startsWith("http") ? href : ORIGIN + href;
    const title = $a.text().replace(/\s+/g," ").trim();

    const $d   = $el.find(".subpage-ann-date").first();
    const day  = $d.find(".ann-day").text().trim();
    const mon  = $d.find(".ann-month").text().trim();
    const year = $d.find(".ann-year").text().trim();

    // Öncelik: parçalardan tarih
    let dateText = (day && mon && year) ? `${day} ${mon} ${year}` : "";
    // Olmazsa tüm blok metnini dene
    if (!dateText && $d.length) dateText = $d.text().replace(/\s+/g," ").trim();
    // Son çare: kartın tüm metninde dd.MM.yyyy ara
    if (!dateText) {
      const raw = $el.text().replace(/\s+/g," ").trim();
      const m = raw.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
      if (m) dateText = m[1];
    }

    const dt = parseTrDate(dateText || "01.01.1970");

    out.push({
      listId, title, url,
      dateText: dateText || "Tarih Yok",
      dateISO: dt.toISOString(),
      rank: (page * 10000) + idx
    });
  });

  return out;
}

async function fetchWholeList(listId, maxPages = 6) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const part = await fetchPage(listId, p);
    if (part.length === 0) break;
    all.push(...part);
  }
  return all;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // CDN/cache tamamen kapalı tut
    res.setHeader("Cache-Control", "no-store");

    const lists = (req.query.lists?.toString() || "1,2,3")
      .split(",").map(s => parseInt(s,10)).filter(Boolean);
    const maxPages = parseInt(req.query.maxPages || "5",10);

    const results = await Promise.all(lists.map(id => fetchWholeList(id, maxPages)));
    const flat = results.flat();

    // URL'ye göre benzersizleştir (listeler arası kopyalar)
    const uniq = new Map();
    for (const it of flat) {
      const key = (it.url || "").toLowerCase();
      if (!uniq.has(key)) uniq.set(key, it);
    }
    const all = Array.from(uniq.values());

    // Yeni → Eski; aynı günse sayfadaki sıraya göre
    all.sort((a,b) => {
      const t = new Date(b.dateISO) - new Date(a.dateISO);
      return t !== 0 ? t : (a.rank - b.rank);
    });

    res.status(200).json({ ok:true, count: all.length, items: all });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
}
