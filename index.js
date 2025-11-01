const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const WEBHOOK_URL = process.env.WEBHOOK_URL; // full https://.../telegram/webhook

if (!BOT_TOKEN) {
  console.error("Missing TG_BOT_TOKEN env var");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// basic commands
bot.start(ctx => ctx.reply("👋 Hello from Sol SmartFlow bot"));
bot.command("status", ctx => ctx.reply("✅ Online"));
bot.on("text", ctx => ctx.reply(`You said: ${ctx.message.text}`));

const app = express();
app.use(bodyParser.json());

// Telegram will POST updates here
app.use(bot.webhookCallback("/telegram/webhook"));

// health check
app.get("/", (_req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on :${PORT}`);
  if (WEBHOOK_URL) {
    try {
      await bot.telegram.setWebhook(WEBHOOK_URL);
      console.log(`Webhook set to ${WEBHOOK_URL}`);
    } catch (e) {
      console.error("setWebhook error:", e.response?.data || e.message);
    }
  }
});

module.exports = app;
