// index.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;

// --- Telegram Startup Message ---
async function sendStartupMessage() {
  try {
    const token = process.env.TG_BOT_TOKEN;
    const adminId = process.env.ADMIN_USER_ID;
    const now = new Date().toLocaleString();

    const message = `✅ Sol Smart Flow Pro is now LIVE!\n🕒 Started at: ${now}`;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    await axios.post(url, {
      chat_id: adminId,
      text: message,
    });

    console.log("✅ Startup message sent successfully!");
  } catch (err) {
    console.error("❌ Failed to send startup message:", err.message);
  }
}

// --- Simple server to keep Render happy ---
app.get("/", (req, res) => {
  res.send("✅ Sol Smart Flow Pro is running smoothly!");
});

// --- Start everything ---
app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  sendStartupMessage();
});
