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

// ---------- MISTRAL AI (С ПОДДЕРЖКОЙ ФОТО) ----------
async function askMistral(chatId, text, imageUrl = null) {
  let history = await getHistory(chatId);

  if (history.length === 0) {
    history.push({ role: "system", content: "Ты полезный ассистент. Отвечай на русском языке. Если тебе прислали фото, проанализируй его." });
  }

  // Формируем контент сообщения (текст или текст + фото)
  let userContent;
  if (imageUrl) {
    userContent = [
      { type: "text", text: text || "Что на этом фото?" },
      { type: "image_url", image_url: imageUrl }
    ];
  } else {
    userContent = text;
  }

  history.push({ role: "user", content: userContent });
  
  // Для экономии лимитов берем только последние сообщения
  const context = history.slice(-(CONTEXT_LIMIT * 2 + 1));

  try {
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
    
    // Сохраняем в историю только текст ответа, чтобы не перегружать Redis
    history.push({ role: "assistant", content: answer });
    await saveHistory(chatId, history);

    return answer;
  } catch (e) {
    console.error("Mistral API Error:", e.response?.data || e.message);
    throw e;
  }
}

// ---------- ОБРАБОТКА ТЕКСТА ----------
bot.start((ctx) => ctx.reply("🤖 Бот запущен! Я понимаю текст и вижу фотографии."));

bot.command("clear", async (ctx) => {
  await redis.del(`chat:${ctx.chat.id}`);
  ctx.reply("✅ История очищена");
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  try {
    await ctx.sendChatAction("typing");
    const answer = await askMistral(ctx.chat.id, ctx.message.text);
    await ctx.reply(answer);
  } catch (e) {
    ctx.reply("❌ Ошибка при обработке текста.");
  }
});

// ---------- ОБРАБОТКА ФОТО ----------
bot.on("photo", async (ctx) => {
  try {
    await ctx.sendChatAction("typing");
    
    // Получаем ссылку на самое качественное фото (последнее в массиве)
    const photo = ctx.message.photo.pop();
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const caption = ctx.message.caption || "Что на этом изображении?";

    const answer = await askMistral(ctx.chat.id, caption, link.href);
    await ctx.reply(answer);
  } catch (e) {
    console.error("Photo process error:", e);
    ctx.reply("❌ Не удалось проанализировать фото. Убедитесь, что файл не слишком большой.");
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
    try {
      const url = `https://telegram-bot-lgks.vercel.app/api/bot`;
      await bot.telegram.setWebhook(url);
      res.status(200).send(`Webhook set to: ${url}`);
    } catch (e) {
      res.status(500).send(`Webhook Error: ${e.message}`);
    }
  }
}
