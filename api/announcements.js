import * as cheerio from "cheerio";

const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const LIST_URL = (id, page = 1) =>
  `${ORIGIN}/view/announcement-list?id=${id}&type=1&SearchString=&dates=&date=&page=${page}`;

const TR_AYLAR = {Ocak:0,Şubat:1,Mart:2,Nisan:3,Mayıs:4,Haziran:5,Temmuz:6,Ağustos:7,Eylül:8,Ekim:9,Kasım:10,Aralık:11};
const parseTrDate = (t="")=>{
  const m = t.trim().match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü]+)\s+(\d{4})/);
  if (!m) return new Date(0);
  const [,d,mon,y]=m;
  return new Date(parseInt(y,10), TR_AYLAR[mon]??0, parseInt(d,10));
};

async function fetchPage(id, p){
  const r = await fetch(LIST_URL(id,p), { headers: { "User-Agent":"GaziDuyuruBot/1.0" } });
  if (!r.ok) return [];
  const html = await r.text();
  const $ = cheerio.load(html);
  const arr = [];
  $(".subpage-ann-single").each((_,el)=>{
    const $el = $(el);
    const $a = $el.find(".subpage-ann-link a").first();
    if(!$a.length) return;

    const href = $a.attr("href")||"#";
    const url = href.startsWith("http") ? href : ORIGIN + href;
    const title = $a.text().trim();

    const $d = $el.find(".subpage-ann-date").first();
    const day = $d.find(".ann-day").text().trim();
    const mon = $d.find(".ann-month").text().trim();
    const year= $d.find(".ann-year").text().trim();
    const dateText = (day && mon && year) ? `${day} ${mon} ${year}`
                   : ($d.text().replace(/\s+/g," ").trim() || "Tarih Yok");

    arr.push({ title, url, dateText, dateISO: parseTrDate(dateText).toISOString() });
  });
  return arr;
}

export default async function handler(req, res){
  try{
    res.setHeader("Access-Control-Allow-Origin","*");
    const lists = (req.query.lists?.toString() || "1,2,3").split(",").map(s=>parseInt(s,10)).filter(Boolean);
    const maxPages = parseInt(req.query.maxPages || "5",10);

    const results = await Promise.all(lists.map(async id=>{
      const all=[]; for(let p=1;p<=maxPages;p++){ const pg=await fetchPage(id,p); if(pg.length===0) break; all.push(...pg); }
      return all;
    }));
    const items = results.flat().sort((a,b)=> new Date(b.dateISO)-new Date(a.dateISO));

    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ ok:true, count: items.length, items });
  }catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
}
