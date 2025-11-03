// api/announcements.js
import * as cheerio from "cheerio";

/* Doğru domain */
const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const LIST_URL = (id, page = 1) =>
  `${ORIGIN}/view/announcement-list?id=${id}&type=1&SearchString=&dates=&date=&page=${page}`;

/* Türkçe aylar – aksan/noktasız varyasyonlarla birlikte */
const TR_AYLAR = {
  "ocak":0, "şubat":1, "subat":1, "mart":2, "nisan":3,
  "mayıs":4, "mayis":4, "haziran":5, "temmuz":6,
  "ağustos":7, "agustos":7, "eylül":8, "eylul":8,
  "ekim":9, "kasım":10, "kasim":10, "aralık":11, "aralik":11
};

function temiz(str=""){
  return str.trim()
    .toLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,""); // aksanları sil
}

/* 1) “03 Kasım 2025”  2) “03.11.2025”  3) “03 / 11 / 2025” gibi tüm varyasyonları yakala */
function parseTrDateFlexible(text="") {
  const s = text.replace(/\s+/g," ").trim();

  // dd.MM.yyyy veya dd/MM/yyyy
  const mDot = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (mDot) {
    const d = parseInt(mDot[1],10), mm = parseInt(mDot[2],10)-1, y = parseInt(mDot[3],10);
    const dt = new Date(y, mm, d);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
  }

  // “03 Kasım 2025” (ay adını esnek oku)
  const mTxt = s.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü\.]+)\s+(\d{4})$/);
  if (mTxt) {
    const d = parseInt(mTxt[1],10);
    const ayKey = temiz(mTxt[2].replace(/\./g,""));
    const y = parseInt(mTxt[3],10);
    const mm = TR_AYLAR[ayKey];
    if (mm !== undefined) {
      const dt = new Date(y, mm, d);
      return isNaN(dt.getTime()) ? new Date(0) : dt;
    }
  }

  return new Date(0);
}

/* Bir sayfadaki duyuruları çek (Liste 1’deki farklı tarih biçimlerine uyumlu) */
async function fetchPage(listId, page = 1) {
  const res = await fetch(LIST_URL(listId, page), {
    headers: { "User-Agent": "GaziDuyuruBot/1.0", "Accept-Language":"tr-TR,tr;q=0.9" }
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

    const $d    = $el.find(".subpage-ann-date").first();
    const day   = $d.find(".ann-day").text().trim();
    const mon   = $d.find(".ann-month").text().trim();
    const year  = $d.find(".ann-year").text().trim();

    // 1) Standart parçalardan tarih
    let dateText = "";
    if (day && mon && year) {
      dateText = `${day} ${mon} ${year}`;
    } else if ($d.length) {
      // 2) Tüm metinden ayıkla (Liste 1’de bazen tek blok metin geliyor)
      dateText = $d.text().replace(/\s+/g," ").trim();
    }

    // 3) Çok zorda kalırsa: blok içinde dd.MM.yyyy ara
    if (!dateText) {
      const raw = $el.text().replace(/\s+/g," ").trim();
      const m = raw.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
      if (m) dateText = m[1];
    }

    const dt = parseTrDateFlexible(dateText || "01.01.1970");

    out.push({
      listId,
      title,
      url,
      dateText: dateText || "Tarih Yok",
      dateISO: dt.toISOString(),
      rank: (page * 10000) + idx // sıralamada stabilite
    });
  });

  return out;
}

/* Bir listenin tüm sayfaları (boşa kadar) */
async function fetchWholeList(listId, maxPages = 10) {
  const all = [];
  for (let p=1; p<=maxPages; p++) {
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
    const maxPages = parseInt(req.query.maxPages || "5",10);

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
