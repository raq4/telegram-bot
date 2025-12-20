import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";
import 'dotenv/config';

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const MAX_HISTORY = 20;
const CONTEXT_LIMIT = 5;

// ---------- ФУНКЦИИ ПАМЯТИ ----------
async function getHistory(chatId) {
  try {
    const data = await redis.get(`chat:${chatId}`);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Redis Read Error:", e);
    return [];
  }
}

async function saveHistory(chatId, history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY * 2);
    await redis.set(`chat:${chatId}`, trimmed);
    await redis.expire(`chat:${chatId}`, 86400);
  } catch (e) {
    console.error("Redis Save Error:", e);
  }
}

// ---------- MISTRAL AI ----------
async function askMistral(chatId, text) {
  let history = await getHistory(chatId);

  if (history.length === 0) {
    history.push({ role: "system", content: "Ты полезный ассистент. Отвечай на русском языке." });
  }

  history.push({ role: "user", content: text });
  const context = history.slice(-(CONTEXT_LIMIT * 2 + 1));

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: context,
      max_tokens: 2048
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const answer = response.data.choices[0].message.content;
  history.push({ role: "assistant", content: answer });
  await saveHistory(chatId, history);

  return answer;
}

// ---------- КОМАНДЫ ----------
bot.start((ctx) => ctx.reply("🤖 Бот запущен! Напиши мне что-нибудь."));

bot.command("clear", async (ctx) => {
  await redis.del(`chat:${ctx.chat.id}`);
  ctx.reply("✅ История очищена");
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  try {
    await ctx.sendChatAction("typing");
    const answer = await askMistral(ctx.chat.id, ctx.message.text);
    
    if (answer.length > 4000) {
      const parts = answer.match(/[\s\S]{1,4000}/g);
      for (const p of parts) await ctx.reply(p);
    } else {
      await ctx.reply(answer);
    }
  } catch (e) {
    console.error("Mistral/Bot Error:", e);
    ctx.reply("❌ Ошибка. Попробуй позже или используй /clear");
  }
});

// ---------- VERCEL HANDLER ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("OK");
    } catch (e) {
      console.error(e);
      res.status(500).send("Update Error");
    }
  } else {
    // При GET запросе регистрируем вебхук
    try {
      const url = `https://telegram-bot-lgks.vercel.app/api/bot`;
      await bot.telegram.setWebhook(url);
      res.status(200).send(`Webhook set to: ${url}`);
    } catch (e) {
      res.status(500).send(`Webhook Error: ${e.message}`);
    }
  }
}
