import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";
import 'dotenv/config'; // Загрузка переменных из .env

// ---------- CONFIG ----------
const MAX_HISTORY = 20;
const CONTEXT_LIMIT = 6; // Четное число, чтобы пары user/assistant не разрывались
const SYSTEM_PROMPT = { role: "system", content: "Ты полезный ассистент. Отвечай на русском языке." };

// ---------- REDIS ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- BOT ----------
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ---------- MEMORY FUNCTIONS ----------
async function getHistory(chatId) {
  try {
    const data = await redis.get(`chat:${chatId}`);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Redis Get Error:", e);
    return [];
  }
}

async function saveHistory(chatId, history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY * 2);
    await redis.set(`chat:${chatId}`, trimmed);
    await redis.expire(`chat:${chatId}`, 86400); // Хранить 24 часа
  } catch (e) {
    console.error("Redis Save Error:", e);
  }
}

// ---------- MISTRAL LOGIC ----------
async function askMistral(chatId, text) {
  let history = await getHistory(chatId);
  
  // Добавляем новое сообщение пользователя
  history.push({ role: "user", content: text });

  // Формируем контекст: System + последние N сообщений
  const recentMessages = history.slice(-CONTEXT_LIMIT);
  const messagesForAI = [SYSTEM_PROMPT, ...recentMessages];

  try {
    const response = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "mistral-large-latest",
        messages: messagesForAI,
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
    
    // Сохраняем ответ в историю
    history.push({ role: "assistant", content: answer });
    await saveHistory(chatId, history);

    return answer;
  } catch (e) {
    console.error("Mistral API Error:", e.response?.data || e.message);
    throw new Error("Ошибка нейросети");
  }
}

// ---------- BOT COMMANDS ----------
bot.start((ctx) => {
  ctx.reply("🤖 Бот готов к работе!\n\nПиши мне любые вопросы. Я запоминаю контекст диалога.");
});

bot.command("clear", async (ctx) => {
  await redis.del(`chat:${ctx.chat.id}`);
  ctx.reply("✅ История нашего диалога очищена.");
});

bot.command("history", async (ctx) => {
  const history = await getHistory(ctx.chat.id);
  ctx.reply(`📊 В памяти сообщений: ${history.length}`);
});

// ---------- TEXT HANDLER ----------
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  try {
    // Показываем статус "печатает"
    await ctx.sendChatAction("typing");
    const answer = await askMistral(ctx.chat.id, ctx.message.text);

    // Разбивка длинных сообщений (лимит Telegram ~4096 символов)
    if (answer.length > 4000) {
      const parts = answer.match(/[\s\S]{1,4000}/g);
      for (const p of parts) await ctx.reply(p);
    } else {
      await ctx.reply(answer);
    }
  } catch (e) {
    ctx.reply("❌ Произошла ошибка. Попробуйте позже или очистите историю командой /clear.");
  }
});

// ---------- LAUNCH MODE ----------
// Если есть WEBHOOK_URL, работаем как сервер (Vercel)
// Если нет — запускаемся локально (Long Polling)

if (process.env.WEBHOOK_URL) {
  // Экспорт для Vercel
  export default async function handler(req, res) {
    try {
      if (req.method === "POST") {
        await bot.handleUpdate(req.body);
        res.status(200).send("OK");
      } else {
        const url = `${process.env.WEBHOOK_URL}/api/bot`; // Убедитесь, что путь совпадает с Vercel
        await bot.telegram.setWebhook(url);
        res.status(200).send(`Webhook set to ${url}`);
      }
    } catch (e) {
      console.error(e);
      res.status(500).send("Internal Error");
    }
  }
} else {
  // Локальный запуск
  bot.launch().then(() => console.log("🚀 Бот запущен локально (через Polling)"));
}

// Мягкая остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
