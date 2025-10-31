import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const PORT = process.env.PORT || 3000;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);

const DATA_DIR = "./data";
const SUBS_FILE = path.join(DATA_DIR,"subscribers.json");
const DEV_FILE = path.join(DATA_DIR,"dev-history.json");
const PROVEN_FILE = path.join(DATA_DIR,"proven-devs.json");
const ALERT_LOG = path.join(DATA_DIR,"alerts-log.json");

ensureDir(DATA_DIR);
const subs = loadJson(SUBS_FILE, []);
const devdb = loadJson(DEV_FILE, {});
const proven = new Set(loadJson(PROVEN_FILE, []));
const alerts = loadJson(ALERT_LOG, []);

function ensureDir(d){ try{ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); }catch{} }
function loadJson(file, def){ try{ return fs.existsSync(file)? JSON.parse(fs.readFileSync(file,"utf8")):def; }catch{return def;} }
function saveJson(file, data){ try{ fs.writeFileSync(file, JSON.stringify(data,null,2)); }catch{} }

async function tgSend(chatId, text){
  if(!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  try{
    await fetch(url,{method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ chat_id: chatId, text, parse_mode:"Markdown" })});
  }catch{}
}
async function tgBroadcast(text){ await Promise.all(subs.map(id => tgSend(id, text))); }

function recordDevToken(devId, mint){
  if(!devId) return;
  const now = Date.now();
  const rec = devdb[devId] || { devId, tokens:[], firstSeen:now, lastActive:now, rugs:0 };
  if(!rec.tokens.find(t=>t.mint===mint)) rec.tokens.push({ mint, firstSeen:now });
  rec.lastActive = now;
  devdb[devId] = rec;
  saveJson(DEV_FILE, devdb);
}
function computeDevRiskScore(devId){
  const rec = devdb[devId]; if(!rec) return undefined;
  let s = 50;
  const ageDays = (Date.now()-rec.firstSeen)/(1000*60*60*24);
  if(ageDays>90 && rec.rugs===0) s+=10;
  s -= Math.min(3, rec.rugs)*25;
  const weekAgo = Date.now()-7*24*3600*1000;
  const weekCount = rec.tokens.filter(t=>t.firstSeen>=weekAgo).length;
  if(weekCount>3) s-=10;
  if(rec.tokens.length>=5 && rec.rugs===0) s+=10;
  return Math.max(0, Math.min(100,s));
}
function addProven(devId){ if(!devId) return; proven.add(devId); saveJson(PROVEN_FILE,[...proven]); }
function removeProven(devId){ proven.delete(devId); saveJson(PROVEN_FILE,[...proven]); }

function computeRugScore(snap){
  let s = 50;
  if(snap.mintAuthorityRevoked===true) s+=10;
  else if(snap.mintAuthorityRevoked===false) s-=30;
  else s-=5;
  if(typeof snap.top10Pct==="number"){
    if(snap.top10Pct>50) s-=45;
    else if(snap.top10Pct>35) s-=25;
    else if(snap.top10Pct<=25) s+=10;
  } else s-=5;
  const tvl = snap.tvlUsd ?? 0;
  if(tvl<10000) s-=40; else if(tvl<50000) s-=20; else s+=10;
  if(snap.lpLocked===true) s+=20; else if(snap.lpLocked===false) s-=10;
  if(typeof snap.devRiskScore==="number"){
    const delta = Math.max(-15, Math.min(15, Math.round((snap.devRiskScore-50)/50*15)));
    s+=delta;
  }
  return Math.max(0, Math.min(100,s));
}
function scoreSignal(usdIn, tvlUsd){
  let s=50;
  if(!tvlUsd) return 40;
  const pct = Math.min(20, (usdIn/tvlUsd)*100);
  s += Math.round(pct/2);
  if(tvlUsd>100000) s+=10;
  return Math.max(0, Math.min(100,s));
}

async function jupPriceUsd(mint){
  try{
    const res = await fetch(`https://price.jup.ag/v6/price?ids=${encodeURIComponent(mint)}`);
    if(!res.ok) return undefined;
    const j = await res.json();
    return j?.data?.[mint]?.price;
  }catch{return undefined;}
}
async function birdeyeOverview(mint, apiKey){
  if(!apiKey) return {};
  try{
    const res = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}&chain=solana`,
      { headers: { "X-API-KEY": apiKey, "accept":"application/json" }});
    if(!res.ok) return {};
    const j = await res.json();
    return j?.data || {};
  }catch{return {};}
}
async function birdeyePairs(mint, apiKey){
  if(!apiKey) return [];
  try{
    const res = await fetch(`https://public-api.birdeye.so/defi/pairs_by_address?address=${encodeURIComponent(mint)}&chain=solana`,
      { headers: { "X-API-KEY": apiKey, "accept":"application/json" }});
    if(!res.ok) return [];
    const j = await res.json();
    return j?.data || [];
  }catch{return [];}
}

const app = express();
app.use(express.json({ limit:"1mb" }));

app.get("/health", (_req,res)=>res.json({ ok:true }));

app.post("/telegram/webhook", async (req,res)=>{
  try{
    const update = req.body;
    const msg = update?.message || update?.edited_message;
    const chatId = String(msg?.chat?.id ?? "");
    const userId = String(msg?.from?.id ?? "");
    const text = (msg?.text||"").trim();

    if(text.startsWith("/start")){
      await tgSend(chatId,"Hey! Use /status, /subscribe, /unsubscribe.\nAdmin: /admin_proven_list");
    } else if(text.startsWith("/status")){
      await tgSend(chatId,"✅ Online. Webhook connected.");
    } else if(text.startsWith("/subscribe")){
      if(!subs.includes(chatId)) subs.push(chatId), saveJson(SUBS_FILE, subs);
      await tgSend(chatId,"✅ Subscribed.");
    } else if(text.startsWith("/unsubscribe")){
      const i = subs.indexOf(chatId); if(i>=0) subs.splice(i,1), saveJson(SUBS_FILE, subs);
      await tgSend(chatId,"❌ Unsubscribed.");
    } else if(text.startsWith("/admin_proven_add")){
      if(!ADMIN_USER_IDS.includes(userId)) await tgSend(chatId,"⛔ Admin only.");
      else { const devId=text.replace("/admin_proven_add","").trim(); if(!devId) await tgSend(chatId,"Usage: /admin_proven_add <devId>");
             else { addProven(devId); await tgSend(chatId,`✅ Added to Proven: \`${devId}\``); } }
    } else if(text.startsWith("/admin_proven_remove")){
      if(!ADMIN_USER_IDS.includes(userId)) await tgSend(chatId,"⛔ Admin only.");
      else { const devId=text.replace("/admin_proven_remove","").trim(); if(!devId) await tgSend(chatId,"Usage: /admin_proven_remove <devId>");
             else { removeProven(devId); await tgSend(chatId,`🗑️ Removed: \`${devId}\``); } }
    } else if(text.startsWith("/admin_proven_list")){
      if(!ADMIN_USER_IDS.includes(userId)) await tgSend(chatId,"⛔ Admin only.");
      else { const list=[...proven]; await tgSend(chatId, list.length? `*Proven Devs*\n${list.map(d=>"- \`"+d+"\`").join("\n")}`:"(none)"); }
    } else {
      await tgSend(chatId,"Commands: /start /status /subscribe /unsubscribe");
    }

    res.sendStatus(200);
  }catch{ res.sendStatus(200); }
});

app.listen(PORT, ()=>console.log(`Sol SmartFlow PRO-lite on :${PORT}`));
