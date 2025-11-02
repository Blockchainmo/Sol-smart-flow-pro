
// index.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse Telegram webhook JSON
app.use(express.json());

// ---------------- Telegram helpers ----------------
const TG_TOKEN = process.env.TG_BOT_TOKEN;            // e.g. 123456:ABC...
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;      // your Telegram user ID (number)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // optional: must match what you set when creating the webhook

const tgApi = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(chatId, text, extra = {}) {
  try {
    await axios.post(`${tgApi}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: extra.parse_mode || "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("❌ Telegram sendMessage error:", err?.response?.data || err.message);
  }
}

// ---------------- Startup message ----------------
async function sendStartupMessage() {
  try {
    const now = new Date().toLocaleString();
    await tgSend(ADMIN_USER_ID, `✅ <b>Sol Smart Flow Pro is now LIVE!</b>\n🕒 Started: <code>${now}</code>`);
    console.log("✅ Startup message sent.");
  } catch (err) {
    console.error("❌ Failed to send startup message:", err?.response?.data || err.message);
  }
}

// ---------------- Very simple Pump.fun watcher stubs ----------------
// These stubs prove the flow works; you’ll get periodic pings in Telegram.
// You can later replace the internals with real Pump.fun/Helius/Birdeye calls.
let watcherTimer = null;

function startPumpfunWatcher() {
  if (watcherTimer) return; // already running
  watcherTimer = setInterval(async () => {
    // TODO: replace this with real checks to Pump.fun or your indexer.
    await tgSend(ADMIN_USER_ID, "👀 Pump.fun watcher heartbeat… (replace with real signals)");
  }, 60_000); // every minute
  console.log("👀 Pumpfun watcher started.");
}

function stopPumpfunWatcher() {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
    console.log("🛑 Pumpfun watcher stopped.");
  }
}

async function getTrendingText() {
  // TODO: swap this for a real trending fetch (Birdeye/Helius) if you want.
  return (
    "📈 <b>Trending (demo)</b>\n" +
    "• Token A – volume ↑\n" +
    "• Token B – buys ↑\n" +
    "• Token C – holders ↑\n" +
    "<i>(Replace with real data from your API keys.)</i>"
  );
}

// ---------------- Telegram webhook ----------------
// Set your webhook to: https://<your-render-url>/telegram/webhook
app.post("/telegram/webhook", async (req, res) => {
  try {
    // Optional header check (only if you set a secret when creating webhook)
    if (WEBHOOK_SECRET) {
      const got = req.get("x-telegram-bot-api-secret-token") || "";
      if (got !== WEBHOOK_SECRET) {
        console.warn("⚠️ Bad webhook secret header");
        return res.sendStatus(401);
      }
    }

    const update = req.body;
    const msg = update?.message;
    const text = msg?.text?.trim() || "";
    const chatId = msg?.chat?.id;

    // Only react to messages (ignore edits/callbacks, etc.)
    if (!chatId || !text) {
      return res.sendStatus(200);
    }

    // Basic commands
    if (text === "/start") {
      await tgSend(chatId,
        "🤖 <b>Sol Smart Flow Pro</b>\n" +
        "Commands:\n" +
        " • /watch_on – start Pump.fun watcher\n" +
        " • /watch_off – stop Pump.fun watcher\n" +
        " • /trending – show trending (demo)"
      );
    } else if (text === "/watch_on") {
      startPumpfunWatcher();
      await tgSend(chatId, "👀 Pump.fun watcher <b>ON</b>.");
    } else if (text === "/watch_off") {
      stopPumpfunWatcher();
      await tgSend(chatId, "🛑 Pump.fun watcher <b>OFF</b>.");
    } else if (text === "/trending") {
      const t = await getTrendingText();
      await tgSend(chatId, t);
    } else {
      // optional: ignore other text or echo
      // await tgSend(chatId, "I only understand /start /watch_on /watch_off /trending for now.");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err.message);
    res.sendStatus(200); // always 200 to Telegram
  }
});

// Root for Render health check
app.get("/", (_req, res) => {
  res.send("✅ Sol Smart Flow Pro is now live!");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  sendStartupMessage();
});
