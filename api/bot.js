// api/bot.js — Telegram Bot (Vercel + Mistral) с памятью
// ENV: TELEGRAM_TOKEN, MISTRAL_API_KEY, WEBHOOK_URL, REDIS_URL, REDIS_TOKEN

import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";

// Инициализация Redis
const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ---------- ПАМЯТЬ ЧАТА ----------
const MAX_HISTORY = 99;

async function getChatHistory(chatId) {
  try {
    const history = await redis.get(`chat:${chatId}`);
    return Array.isArray(history) ? history : [];
  } catch (err) {
    console.error("Redis get error:", err);
    return [];
  }
}

async function saveChatHistory(chatId, history) {
  try {
    // Обрезаем до MAX_HISTORY сообщений (user+assistant = пара)
    const trimmed = history.slice(-MAX_HISTORY * 2);
    // Сохраняем в Redis с TTL 24 часа
    await redis.set(`chat:${chatId}`, trimmed);
    await redis.expire(`chat:${chatId}`, 86400);
  } catch (err) {
    console.error("Redis set error:", err);
  }
}

async function addToHistory(chatId, role, content, imageUrl = null) {
  const history = await getChatHistory(chatId);
  let message;
  if (imageUrl) {
    message = {
      role,
      content: [
        { type: "text", text: content || "Реши задачу с изображения" },
        { type: "image_url", image_url: imageUrl }
      ]
    };
  } else {
    message = { role, content };
  }
  history.push(message);
  await saveChatHistory(chatId, history);
  return history;
}

async function clearChatHistory(chatId) {
  try {
    await redis.del(`chat:${chatId}`);
    return true;
  } catch (err) {
    console.error("Redis del error:", err);
    return false;
  }
}

// ---------- Mistral Text ----------
async function askMistralText(text, chatId) {
  const history = await getChatHistory(chatId);

  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент. Отвечай на русском языке подробно и вежливо."
    });
  }

  history.push({ role: "user", content: text });

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: history,
      max_tokens: 4096,
      temperature: 0.7
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const answer = response.data.choices[0].message.content;

  // Сохраняем ответ ассистента
  history.push({ role: "assistant", content: answer });
  await saveChatHistory(chatId, history);

  return answer;
}

// ---------- Mistral Vision ----------
async function askMistralVision(imageUrl, chatId, userText = "Реши задачу с изображения") {
  const history = await getChatHistory(chatId);

  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент с поддержкой изображений. Анализируй изображения и давай подробные ответы на русском языке."
    });
  }

  const visionMessage = {
    role: "user",
    content: [
      { type: "text", text: userText },
      { type: "image_url", image_url: imageUrl }
    ]
  };

  history.push(visionMessage);

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "pixtral-12b",
      messages: history,
      max_tokens: 4096
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
  await saveChatHistory(chatId, history);

  return answer;
}

// ---------- КОМАНДЫ БОТА ----------
bot.start((ctx) => {
  ctx.reply(
    "🤖 Бот запущен с памятью!\n" +
    "Отправляйте текст или фото.\n" +
    "Команды:\n/clear - очистить историю\n/history - показать количество сообщений"
  );
});

bot.command("clear", async (ctx) => {
  const chatId = ctx.chat.id;
  const success = await clearChatHistory(chatId);
  await ctx.reply(success ? "✅ История очищена." : "⚠️ Не удалось очистить историю.");
});

bot.command("history", async (ctx) => {
  const chatId = ctx.chat.id;
  const history = await getChatHistory(chatId);
  await ctx.reply(`📊 Сообщений в памяти: ${history.length}\nПримерно диалогов: ${Math.floor(history.length/2)}`);
});

// Обработка текста
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("⏳ Думаю...");

  try {
    const answer = await askMistralText(ctx.message.text, chatId);
    await ctx.deleteMessage(waitMsg.message_id);

    // Разбиваем длинные сообщения
    if (answer.length > 4000) {
      for (const chunk of answer.match(/[\s\S]{1,4000}/g)) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }
  } catch (err) {
    console.error("Text error:", err);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки текста.");
  }
});

// Обработка фото
bot.on("photo", async (ctx) => {
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("🔍 Анализирую изображение...");

  try {
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
    const caption = ctx.message.caption || "Что на изображении?";

    const answer = await askMistralVision(imageUrl, chatId, caption);
    await ctx.deleteMessage(waitMsg.message_id);

    if (answer.length > 4000) {
      for (const chunk of answer.match(/[\s\S]{1,4000}/g)) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }
  } catch (err) {
    console.error("Photo error:", err);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки изображения.");
  }
});

// ---------- Vercel Handler ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } else {
    await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    res.status(200).send("Webhook set");
  }
}
