import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";

// ---------- REDIS ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- BOT ----------
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ---------- CONFIG ----------
const MAX_HISTORY = 20;
const CONTEXT_LIMIT = 5;

// ---------- MEMORY ----------
async function getHistory(chatId) {
  const data = await redis.get(`chat:${chatId}`);
  return Array.isArray(data) ? data : [];
}

async function saveHistory(chatId, history) {
  const trimmed = history.slice(-MAX_HISTORY * 2);
  await redis.set(`chat:${chatId}`, trimmed);
  await redis.expire(`chat:${chatId}`, 86400);
}

async function clearHistory(chatId) {
  await redis.del(`chat:${chatId}`);
}

// ---------- MISTRAL ----------
async function askMistral(chatId, text) {
  let history = await getHistory(chatId);

  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент. Отвечай на русском языке."
    });
  }

  history.push({ role: "user", content: text });

  const context = history.slice(-CONTEXT_LIMIT * 2);

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

// ---------- COMMANDS ----------
bot.start((ctx) => {
  ctx.reply(
    "🤖 Бот запущен\n\n" +
    "Память: 20 сообщений\n\n" +
    "Команды:\n" +
    "/history — показать память\n" +
    "/clear — очистить память"
  );
});

bot.command("clear", async (ctx) => {
  await clearHistory(ctx.chat.id);
  ctx.reply("✅ История очищена");
});

bot.command("history", async (ctx) => {
  const history = await getHistory(ctx.chat.id);
  ctx.reply(
    `📊 В памяти сообщений: ${history.length}\n` +
    `Примерно диалогов: ${Math.floor(history.length / 2)}`
  );
});

// ---------- TEXT ----------
bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  try {
    const answer = await askMistral(ctx.chat.id, text);

    // Telegram лимит
    if (answer.length > 4000) {
      const parts = answer.match(/[\s\S]{1,4000}/g);
      for (const p of parts) {
        await ctx.reply(p);
      }
    } else {
      await ctx.reply(answer);
    }
  } catch (e) {
    console.error(e);
    ctx.reply("❌ Ошибка обработки запроса");
  }
});

// ---------- VERCEL ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("OK");
    } catch (e) {
      console.error(e);
      res.status(500).send("Bot error");
    }
  } else {
    await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    res.status(200).send("Webhook set");
  }
}
