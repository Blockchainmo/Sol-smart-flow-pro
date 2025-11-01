// startup-notify.js
require("dotenv").config();
const axios = require("axios");

const token = process.env.TG_BOT_TOKEN; // your Telegram bot token
const adminId = process.env.ADMIN_USER_IDS; // your Telegram user ID or group ID

async function sendStartupMessage() {
  const now = new Date().toLocaleString();
  const message = `✅ Sol Smart Flow Pro is now LIVE!\n🕒 Started at: ${now}`;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: adminId,
      text: message,
    });
    console.log("✅ Startup message sent successfully!");
  } catch (error) {
    console.error("❌ Failed to send startup message:", error.message);
  }
}

sendStartupMessage();
