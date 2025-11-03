// api/announcements.js
import * as cheerio from "cheerio";

const ORIGIN = "https://gazi-universitesi.gazi.edu.tr";
const LIST_URL = (id, page = 1) =>
  `${ORIGIN}/view/announcement-list?id=${id}&type=1&SearchString=&dates=&date=&page=${page}`;

/* Türkçe ve İngilizce aylar */
const TR_EN_MONTHS = {
  ocak:0, şubat:1, subat:1, mart:2, nisan:3, mayıs:4, mayis:4,
  haziran:5, temmuz:6, ağustos:7, agustos:7, eylül:8, eylul:8,
  ekim:9, kasım:10, kasim:10, aralık:11, aralik:11,
  january:0,february:1,march:2,april:3,may:4,june:5,july:6,
  august:7,september:8,october:9,november:10,december:11
};
const clean = s=>s.trim().toLowerCase("tr").normalize("NFKD").replace(/[\u0300-\u036f]/g,"");

function parseFlexibleDate(t=""){
  const s=t.replace(/\s+/g," ").trim();
  if(!s) return new Date(0);
  const m1=s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if(m1){const d=+m1[1],m=+m1[2]-1,y=+m1[3];return new Date(y,m,d);}
  const m2=s.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğiöşü\.]+)\s+(\d{4})/);
  if(m2){const d=+m2[1],mm=TR_EN_MONTHS[clean(m2[2].replace(/\./g,""))],y=+m2[3];if(mm!=null)return new Date(y,mm,d);}
  return new Date(0);
}

/* detay sayfasından tarih ve başlık çek */
async function fetchTopAnnouncement(){
  try{
    const res=await fetch(`${ORIGIN}/view/announcement-list?id=1&type=1`);
    if(!res.ok)return null;
    const html=await res.text();
    const $=cheerio.load(html);
    const top=$("a[href*='/view/announcement/']").first();
    if(!top.length)return null;
    const href=top.attr("href");
    const url=href.startsWith("http")?href:ORIGIN+href;
    const title=top.text().trim();
    // detay sayfasından tarih çek
    const det=await fetch(url);
    const detHtml=await det.text();
    const $$=cheerio.load(detHtml);
    const text=$$("body").text();
    const d=parseFlexibleDate(text);
    return {listId:1,title,url,dateText:d.toLocaleDateString("tr-TR"),dateISO:d.toISOString(),rank:0};
  }catch(e){return null;}
}

/* normal sayfa */
async function fetchPage(listId,page=1){
  const res=await fetch(LIST_URL(listId,page),{headers:{"User-Agent":"GaziDuyuruBot/1.0"}});
  if(!res.ok)return[];
  const html=await res.text();
  const $=cheerio.load(html);
  const out=[];
  $(".subpage-ann-single").each((idx,el)=>{
    const $a=$(el).find("a[href]").first(); if(!$a.length)return;
    const href=$a.attr("href"); const url=href.startsWith("http")?href:ORIGIN+href;
    const title=$a.text().trim();
    const day=$(el).find(".ann-day").text().trim();
    const mon=$(el).find(".ann-month").text().trim();
    const year=$(el).find(".ann-year").text().trim();
    let dateText=day&&mon&&year?`${day} ${mon} ${year}`:"";
    if(!dateText){const raw=$(el).text();const m=raw.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);if(m)dateText=m[1];}
    const dt=parseFlexibleDate(dateText);
    out.push({listId,title,url,dateText:dateText||"Tarih Yok",dateISO:dt.toISOString(),rank:(page*10000)+idx});
  });
  return out;
}

/* liste tamı */
async function fetchWholeList(id,maxPages=10){
  const all=[];
  for(let p=1;p<=maxPages;p++){
    const it=await fetchPage(id,p);
    if(!it.length)break;
    all.push(...it);
  }
  // eğer ilk listedeyiz ve hiç/az duyuru varsa fallback ekle
  if(id===1 && all.length<2){
    const top=await fetchTopAnnouncement();
    if(top) all.unshift(top);
  }
  return all;
}

export default async function handler(req,res){
  try{
    res.setHeader("Access-Control-Allow-Origin","*");
    const lists=(req.query.lists?.toString()||"1,2,3").split(",").map(Number).filter(Boolean);
    const maxPages=parseInt(req.query.maxPages||"5",10);
    const results=await Promise.all(lists.map(id=>fetchWholeList(id,maxPages)));
    const flat=results.flat();
    const uniq=new Map();
    for(const it of flat){
      const key=(it.url||"").toLowerCase();
      if(!uniq.has(key))uniq.set(key,it);
    }
    const all=[...uniq.values()];
    all.sort((a,b)=>{
      const t=new Date(b.dateISO)-new Date(a.dateISO);
      return t!==0?t:a.rank-b.rank;
    });
    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ok:true,count:all.length,items:all});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
}
