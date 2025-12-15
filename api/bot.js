import { Telegraf } from "telegraf";
import axios from "axios";
import Redis from "ioredis";

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

// ---------- MISTRAL ----------
async function askMistral(text) {
  const r = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: [{ role: "user", content: text }],
      max_tokens: 2048
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`
      }
    }
  );
  return r.data.choices[0].message.content;
}

// ---------- BOT ----------
bot.start((ctx) => ctx.reply("Бот работает"));

bot.on("text", async (ctx) => {
  const wait = await ctx.reply("⏳");
  try {
    const answer = await askMistral(ctx.message.text);
    await ctx.deleteMessage(wait.message_id);
    await ctx.reply(answer);
  } catch (e) {
    await ctx.reply("Ошибка");
  }
});

// ---------- VERCEL ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } else {
    await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    res.status(200).send("Webhook set");
  }
}
