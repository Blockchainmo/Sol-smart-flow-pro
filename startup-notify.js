// startup-notify.js — sends message to Telegram when bot turns on
const axios = require("axios");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

(async () => {
  try {
    if (!BOT_TOKEN || !GROUP_CHAT_ID) {
      console.log("Missing Telegram info, skipping message.");
      process.exit(0);
    }

    const message = "✅ Sol Smart Flow Pro V2 is online and tracking wallets live!";
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: GROUP_CHAT_ID, text: message });

    console.log("Message sent to Telegram ✅");
    process.exit(0);
  } catch (err) {
    console.log("Could not send message ❌", err.message);
    process.exit(0);
  }
})();
