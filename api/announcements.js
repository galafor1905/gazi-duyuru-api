// api/announcements.js
import * as cheerio from "cheerio";

/* Kaynak domain (doğru adres) */
const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const LIST_URL = (id, page = 1) =>
  `${ORIGIN}/view/announcement-list?id=${id}&type=1&SearchString=&dates=&date=&page=${page}`;

/* Türkçe + İngilizce aylar – aksan/noktasız varyasyonlarla birlikte */
const TR_EN_MONTHS = {
  // TR
  ocak:0, şubat:1, subat:1, mart:2, nisan:3, mayıs:4, mayis:4, haziran:5, temmuz:6,
  ağustos:7, agustos:7, eylül:8, eylul:8, ekim:9, kasım:10, kasim:10, aralık:11, aralik:11,
  // EN
  january:0, february:1, march:2, april:3, may:4, june:5, july:6,
  august:7, september:8, october:9, november:10, december:11
};
const clean = (s="") => s.trim()
  .toLowerCase("tr")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,""); // aksanları sil

/* "03.11.2025", "03/11/2025", "03-11-2025", "03 Kasım 2025", "22 August 2024" hepsini yakala */
function parseFlexibleDate(text = "") {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (!s) return new Date(0);

  // dd[./-]MM[./-]yyyy
  const mDMY = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (mDMY) {
    const d = parseInt(mDMY[1],10);
    const m = parseInt(mDMY[2],10) - 1;
    const y = parseInt(mDMY[3],10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
  }

  // dd Month yyyy  (TR ya da EN ay adı)
  const mText = s.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü\.]+)\s+(\d{4})/);
  if (mText) {
    const d = parseInt(mText[1],10);
    const mm = TR_EN_MONTHS[clean(mText[2].replace(/\./g,""))];
    const y = parseInt(mText[3],10);
    if (mm !== undefined) {
      const dt = new Date(y, mm, d);
      return isNaN(dt.getTime()) ? new Date(0) : dt;
    }
  }
  return new Date(0);
}

/* 🔎 Detay sayfasından tarihi çek (fallback) */
async function fetchDetailDateISO(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "GaziDuyuruBot/1.0",
        "Accept-Language":"tr-TR,tr;q=0.9"
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Sayfada genelde başlığın hemen altında "22 August 2024 | 17:00" gibi bir satır oluyor.
    // Tüm metinden makul bir tarih çekelim:
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    // 1) dd[./-]MM[./-]yyyy ara
    let dt = parseFlexibleDate(bodyText);
    if (dt.getTime() > 0) return dt.toISOString();

    // 2) Halen bulunamadıysa bazı blokları dene (başlık altı)
    const candidates = [];
    $('[class*="date"], [class*="time"], h1, h2, .content, .detail, .page-content')
      .each((_, el) => candidates.push($(el).text()));
    for (const t of candidates) {
      const d = parseFlexibleDate(t);
      if (d.getTime() > 0) return d.toISOString();
    }

    return null;
  } catch {
    return null;
  }
}

/* Bir sayfadaki duyuruları çek – GENİŞLETİLMİŞ seçici ile */
async function fetchPage(listId, page = 1) {
  const res = await fetch(LIST_URL(listId, page), {
    headers: { "User-Agent": "GaziDuyuruBot/1.0", "Accept-Language":"tr-TR,tr;q=0.9" }
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];

  // 1) Önce klasik kart yapısı (varsa)
  $(".subpage-ann-single").each((idx, el) => {
    const $el = $(el);
    const $a  = $el.find("a[href]").first(); // genişlettik
    if (!$a.length) return;

    const href  = $a.attr("href") || "#";
    const url   = href.startsWith("http") ? href : ORIGIN + href;
    const title = $a.text().replace(/\s+/g," ").trim();

    const $d    = $el.find(".subpage-ann-date").first();
    const day   = $d.find(".ann-day").text().trim();
    const mon   = $d.find(".ann-month").text().trim();
    const year  = $d.find(".ann-year").text().trim();

    let dateText = "";
    if (day && mon && year) dateText = `${day} ${mon} ${year}`;
    if (!dateText && $d.length) dateText = $d.text().replace(/\s+/g," ").trim();
    if (!dateText) {
      const raw = $el.text().replace(/\s+/g," ").trim();
      const m = raw.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
      if (m) dateText = m[1];
    }

    let dt = parseFlexibleDate(dateText);
    out.push({
      listId, title, url,
      dateText: dateText || "Tarih Yok",
      dateISO: isNaN(dt.getTime()) ? new Date(0).toISOString() : dt.toISOString(),
      rank: (page * 10000) + idx
    });
  });

  // 2) Klasik kartla yakalanmayan "üstteki 1–2 özel duyuru" için:
  //    Listede görünen tüm duyuru linklerini ara.
  const links = new Set(out.map(x => x.url.toLowerCase()));
  $("a[href*='/view/announcement/']").each((idx, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : ORIGIN + href;
    const key = url.toLowerCase();
    if (links.has(key)) return; // zaten eklendi

    const title = $(a).text().replace(/\s+/g," ").trim();
    if (!title) return;

    // Tarihi kartın yakınından tahmin etmeyi dene
    let contextText = $(a).closest("li, .row, .col, .container, .content, .subpage-ann-single").text();
    contextText = (contextText || "").replace(/\s+/g," ").trim();
    let dt = parseFlexibleDate(contextText);

    out.push({
      listId, title, url,
      dateText: dt.getTime() > 0 ? contextText : "Tarih Yok",
      dateISO: dt.getTime() > 0 ? dt.toISOString() : new Date(0).toISOString(),
      rank: (page * 10000) + (1000 + idx) // ikinci dal ekleri alta
    });
    links.add(key);
  });

  // 3) Tarihi hâlâ 1970 (geçersiz) kalan öğeler için detay sayfasından tarih çek (yalnızca ilk 8 tanesine)
  const needDetail = out.filter(x => new Date(x.dateISO).getTime() <= 0).slice(0, 8);
  await Promise.all(needDetail.map(async it => {
    const iso = await fetchDetailDateISO(it.url);
    if (iso) it.dateISO = iso;
  }));

  return out;
}

/* Bir listenin tüm sayfaları (boşa kadar) */
async function fetchWholeList(listId, maxPages = 10) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const items = await fetchPage(listId, p);
    if (items.length === 0) break;
    all.push(...items);
  }
  return all;
}

/* API */
export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");

    const lists = (req.query.lists?.toString() || "1,2,3")
      .split(",").map(s => parseInt(s,10)).filter(Boolean);
    const maxPages = parseInt(req.query.maxPages || "5", 10);

    const results = await Promise.all(lists.map(id => fetchWholeList(id, maxPages)));
    const flat = results.flat();

    /* URL’ye göre benzersizleştir (listeler arası kopyaları at) */
    const uniq = new Map();
    for (const it of flat) {
      const key = (it.url || "").toLowerCase();
      if (!uniq.has(key)) uniq.set(key, it);
    }
    const all = Array.from(uniq.values());

    /* Yeni → eski; aynı günse önce gelen üste (rank) */
    all.sort((a,b) => {
      const t = new Date(b.dateISO) - new Date(a.dateISO);
      if (t !== 0) return t;
      return a.rank - b.rank;
    });

    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ ok:true, count: all.length, items: all });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
}
