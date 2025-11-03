// api/announcements.js
import * as cheerio from "cheerio";

/* Kaynak domain (senin verdiğin doğru adres) */
const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const LIST_URL = (id, page = 1) =>
  `${ORIGIN}/view/announcement-list?id=${id}&type=1&SearchString=&dates=&date=&page=${page}`;

/* Türkçe ay adlarını sağlam parse etmek için esnek harita */
const TR_AYLAR = {
  "ocak":0, "şubat":1, "subat":1, "mart":2, "nisan":3,
  "mayıs":4, "mayis":4, "haziran":5, "temmuz":6,
  "ağustos":7, "agustos":7, "eylül":8, "eylul":8,
  "ekim":9, "kasım":10, "kasim":10, "aralık":11, "aralik":11
};
function temizAy(str = "") {
  // Küçük harfe çevir, aksanları kaldır (ş/ı/ğ varyasyonlarına dayanıklı olsun)
  return str.trim()
    .toLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}
function parseTrDateText(text = "") {
  // Örn: "03 Kasım 2025" → Date
  const m = text.replace(/\s+/g, " ").trim()
    .match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü]+)\s+(\d{4})/);
  if (!m) return new Date(0);
  const gun = parseInt(m[1], 10);
  const ayKey = temizAy(m[2]);
  const yil = parseInt(m[3], 10);
  const ay = TR_AYLAR[ayKey];
  if (ay === undefined) return new Date(0);
  return new Date(yil, ay, gun);
}

/* Bir sayfadaki duyuruları çek */
async function fetchPage(listId, page = 1) {
  const res = await fetch(LIST_URL(listId, page), {
    headers: { "User-Agent": "GaziDuyuruBot/1.0" }
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];
  $(".subpage-ann-single").each((idx, el) => {
    const $el = $(el);
    const $a  = $el.find(".subpage-ann-link a").first();
    if (!$a.length) return;

    const href = $a.attr("href") || "#";
    const url  = href.startsWith("http") ? href : ORIGIN + href;
    const title = $a.text().trim();

    const $d   = $el.find(".subpage-ann-date").first();
    const day  = $d.find(".ann-day").text().trim();
    const mon  = $d.find(".ann-month").text().trim();
    const year = $d.find(".ann-year").text().trim();

    let dateText = "Tarih Yok";
    if (day && mon && year) dateText = `${day} ${mon} ${year}`;
    else if ($d.length) dateText = $d.text().replace(/\s+/g, " ").trim();

    const d = parseTrDateText(dateText);
    out.push({
      title,
      url,
      dateText,
      dateISO: isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString(),
      // stabil sıralama için: sayfa + listedeki sıra
      rank: (page * 10000) + idx
    });
  });
  return out;
}

/* Bir listenin tüm sayfalarını (boş gelene kadar) çek */
async function fetchWholeList(listId, maxPages = 10) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const items = await fetchPage(listId, p);
    if (items.length === 0) break;
    all.push(...items);
  }
  return all;
}

/* API handler */
export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");

    const lists = (req.query.lists?.toString() || "1,2,3")
      .split(",").map(s => parseInt(s, 10)).filter(Boolean);
    const maxPages = parseInt(req.query.maxPages || "5", 10);

    const results = await Promise.all(lists.map(id => fetchWholeList(id, maxPages)));

    // 1) URL'ye göre kopyaları at (1–3 listede aynı duyuru olabilir)
    const uniqByUrl = new Map();
    for (const it of results.flat()) if (!uniqByUrl.has(it.url)) uniqByUrl.set(it.url, it);
    const all = Array.from(uniqByUrl.values());

    // 2) Tarih (desc), aynı günse rank (asc) → en yeni 5 doğru gelsin
    all.sort((a, b) => {
      const t = new Date(b.dateISO) - new Date(a.dateISO);
      if (t !== 0) return t;
      return a.rank - b.rank;
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ ok: true, count: all.length, items: all });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
