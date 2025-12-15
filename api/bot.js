// api/bot.js — Telegram Bot (Vercel + Mistral) с памятью
// ENV: TELEGRAM_TOKEN, MISTRAL_API_KEY, WEBHOOK_URL, REDIS_URL

import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis"; // Используем Upstash Redis для Vercel

// Инициализация Redis
const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// Или для обычного Redis (если у вас свой сервер):
// import { createClient } from "redis";
// const redis = createClient({
//   url: process.env.REDIS_URL
// });
// await redis.connect();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ---------- УТИЛИТЫ ДЛЯ ПАМЯТИ ----------
const MAX_HISTORY = 99; // Максимальное количество сообщений в истории

// Получить историю чата
async function getChatHistory(chatId) {
  try {
    const history = await redis.get(`chat:${chatId}`);
    return history || [];
  } catch (error) {
    console.error("Redis error:", error);
    return [];
  }
}

// Сохранить историю чата
async function saveChatHistory(chatId, history) {
  try {
    // Обрезаем историю до MAX_HISTORY сообщений
    const trimmedHistory = history.slice(-MAX_HISTORY * 2); // *2 потому что user+assistant
    await redis.set(`chat:${chatId}`, trimmedHistory);
    await redis.expire(`chat:${chatId}`, 86400); // TTL 24 часа
  } catch (error) {
    console.error("Redis error:", error);
  }
}

// Очистить историю чата
async function clearChatHistory(chatId) {
  try {
    await redis.del(`chat:${chatId}`);
    return true;
  } catch (error) {
    console.error("Redis error:", error);
    return false;
  }
}

// Добавить сообщение в историю
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

// ---------- MISTRAL TEXT ----------
async function askMistralText(text, chatId) {
  const history = await getChatHistory(chatId);
  
  // Добавляем системное сообщение если история пустая
  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент. Отвечай на русском языке подробно и вежливо."
    });
  }
  
  // Добавляем новый запрос пользователя
  history.push({ role: "user", content: text });
  
  const r = await axios.post(
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

  const answer = r.data.choices[0].message.content;
  
  // Сохраняем ответ ассистента в историю
  history.push({ role: "assistant", content: answer });
  await saveChatHistory(chatId, history);
  
  return answer;
}

// ---------- MISTRAL VISION ----------
async function askMistralVision(imageUrl, chatId, userText = "Реши задачу с изображения") {
  const history = await getChatHistory(chatId);
  
  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент с поддержкой изображений. Анализируй изображения и давай подробные ответы на русском языке."
    });
  }
  
  // Добавляем запрос с изображением
  const visionMessage = {
    role: "user",
    content: [
      { type: "text", text: userText },
      { type: "image_url", image_url: imageUrl }
    ]
  };
  
  history.push(visionMessage);
  
  const r = await axios.post(
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

  const answer = r.data.choices[0].message.content;
  
  // Сохраняем ответ
  history.push({ role: "assistant", content: answer });
  await saveChatHistory(chatId, history);
  
  return answer;
}

// ---------- КОМАНДЫ БОТА ----------
bot.start((ctx) => {
  ctx.reply(
    "🤖 Бот запущен с памятью!\n\n" +
    "Отправляйте текстовые сообщения или фото.\n" +
    "Бот запоминает контекст всей беседы.\n\n" +
    "Команды:\n" +
    "/clear - очистить историю разговора\n" +
    "/history - показать количество сохраненных сообщений"
  );
});

// Команда очистки истории
bot.command("clear", async (ctx) => {
  const chatId = ctx.chat.id;
  const success = await clearChatHistory(chatId);
  
  if (success) {
    await ctx.reply("✅ История разговора очищена. Начинаем новый диалог.");
  } else {
    await ctx.reply("⚠️ Не удалось очистить историю. Попробуйте еще раз.");
  }
});

// Команда проверки истории
bot.command("history", async (ctx) => {
  const chatId = ctx.chat.id;
  const history = await getChatHistory(chatId);
  const messageCount = Math.floor(history.length / 2); // Примерное количество пар вопрос-ответ
  
  await ctx.reply(
    `📊 Статистика диалога:\n` +
    `• Сообщений в истории: ${history.length}\n` +
    `• Примерно диалогов: ${messageCount}\n` +
    `• Используйте /clear чтобы очистить`
  );
});

// Обработка текста
bot.on("text", async (ctx) => {
  // Пропускаем команды
  if (ctx.message.text.startsWith("/")) return;
  
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("⏳ Думаю...");
  
  try {
    const answer = await askMistralText(ctx.message.text, chatId);
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Разбиваем длинные сообщения (Telegram ограничение 4096 символов)
    if (answer.length > 4000) {
      const chunks = answer.match(/[\s\S]{1,4000}/g);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }
  } catch (error) {
    console.error("Text error:", error);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки текста. Попробуйте еще раз.");
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
    
    // Получаем подпись к фото если есть
    const caption = ctx.message.caption || "Что на этом изображении? Опиши подробно.";
    
    const answer = await askMistralVision(imageUrl, chatId, caption);
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (answer.length > 4000) {
      const chunks = answer.match(/[\s\S]{1,4000}/g);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }
  } catch (error) {
    console.error("Photo error:", error);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки изображения. Убедитесь, что фото четкое и не слишком большое.");
  }
});

// ---------- VERCEL HANDLER ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } else {
    await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    res.status(200).send("Webhook set");
  }
}
