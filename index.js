const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());
app.use(bot.webhookCallback("/telegram/webhook"));

// ✅ set webhook
bot.telegram.setWebhook(WEBHOOK_URL);

// ✅ test command
bot.start((ctx) => ctx.reply("👋 Hello from Sol SmartFlow Bot — Online!"));

app.get("/", (req, res) => {
  res.send("✅ Sol SmartFlow Bot is running");
});

// ✅ start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
