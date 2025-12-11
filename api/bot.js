// api/bot.js — Telegram Math Bot (Vercel + Redis + Mistral)
// Требуются переменные: TELEGRAM_TOKEN, MISTRAL_API_KEY, REDIS_URL

import { Telegraf } from "telegraf";
import axios from "axios";
import Redis from "ioredis";
import { createCanvas } from "canvas";

// ------------------- CONFIG -------------------
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

const ADMINS = [815509230]; // твой ID

const SYSTEM_PROMPT = `
Ты — продвинутый математический ассистент уровня ChatGPT.
Всегда отвечай строго на русском языке.

Формат ответа:
1) УСЛОВИЕ
2) ТЕОРИЯ
3) РЕШЕНИЕ (пошагово)
4) ОТВЕТ (LaTeX внутри $$...$$)
5) ПРОВЕРКА

Правила:
- Используй только русский язык.
- Все формулы — строго в LaTeX: $$ ... $$.
- При обработке фотографий — распознавай текст, графики, таблицы.
- Если спрашивают «кто создал?» — отвечай: @rafaelkazaryan
`;

// ------------------- REDIS HISTORY -------------------
async function getUserHistory(userId) {
  const raw = await redis.get(`history:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

async function addToHistory(userId, role, content) {
  let hist = await getUserHistory(userId);
  hist.push({ role, content });

  if (hist.length > 30) hist.splice(0, hist.length - 30);

  await redis.set(`history:${userId}`, JSON.stringify(hist));
}

async function clearUserHistory(userId) {
  await redis.del(`history:${userId}`);
}

// ------------------- LIBS -------------------
function extractLatex(text) {
  const matches = text.match(/\$\$(.*?)\$\$/gs);
  if (!matches) return null;
  const cleaned = matches.map(x => x.replace(/\$\$/g, "").trim());
  return cleaned.join("\n\n");
}

function cleanText(text) {
  return text.replace(/\$\$(.*?)\$\$/gs, "").trim();
}

async function generateLatexImage(latex) {
  try {
    const formulas = latex.split("\n\n");

    if (formulas.length === 1) {
      const encoded = encodeURIComponent(formulas[0]);
      const url = `https://latex.codecogs.com/svg.latex?\\huge&space;${encoded}`;
      const r = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(r.data);
    }

    // Multi formula — render on canvas
    const width = 900;
    const height = 200 + formulas.length * 60;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    ctx.font = "bold 30px Arial";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.fillText("Формулы решения", width / 2, 50);

    ctx.font = "20px Arial";
    ctx.textAlign = "left";

    let y = 100;
    for (let f of formulas) {
      ctx.fillText(f, 40, y);
      y += 50;
    }

    return canvas.toBuffer();
  } catch (e) {
    return null;
  }
}

async function callMistral(messages) {
  try {
    const res = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "mistral-large-latest",
        messages,
        max_tokens: 4096,
        temperature: 0,
        top_p: 0.1
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`
        }
      }
    );

    const content = res.data.choices[0].message.content;
    return {
      raw: content,
      text: cleanText(content),
      latex: extractLatex(content)
    };
  } catch (err) {
    console.error("Mistral error:", err?.response?.data || err);
    return null;
  }
}

// ------------------- COMMANDS -------------------
bot.start(async (ctx) => {
  await clearUserHistory(ctx.from.id);
  ctx.reply("🧮 Привет! Отправь задачу или фото. Я решу подробно.");
});

bot.command("clear", async (ctx) => {
  await clearUserHistory(ctx.from.id);
  ctx.reply("История очищена🧹.");
});

bot.command("admin", (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return ctx.reply("Нет доступа");
  ctx.reply("Админ панель.");
});

// ------------------- TEXT -------------------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const msg = ctx.message.text.trim();

  // creator
  if (msg.toLowerCase().includes("кто создал")) {
    return ctx.reply("@rafaelkazaryan");
  }

  await addToHistory(userId, "user", msg);

  const wait = await ctx.reply("🤔 Думаю…");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(await getUserHistory(userId))
  ];

  const result = await callMistral(messages);
  await ctx.deleteMessage(wait.message_id);

  if (!result) return ctx.reply("Ошибка API");

  await addToHistory(userId, "assistant", result.raw);

  // send text
  if (result.text) {
    ctx.reply(result.text);
  }

  // send latex image
  if (result.latex) {
    const img = await generateLatexImage(result.latex);
    if (img) {
      await ctx.replyWithPhoto({ source: img });
    } else {
      ctx.reply("LaTeX:\n" + result.latex);
    }
  }
});

// ------------------- PHOTO -------------------
bot.on("photo", async (ctx) => {
  const userId = ctx.from.id;
  
  const wait = await ctx.reply("🔍 Анализирую фото…");

  const photo = ctx.message.photo.pop();
  const file = await ctx.telegram.getFile(photo.file_id);
  const url = file.file_path
    ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`
    : null;

  await addToHistory(userId, "user", `[Фото] ${url}`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Реши задачу с этого изображения" },
        { type: "image_url", image_url: { url } }
      ]
    }
  ];

  let result = await callMistral(messages);
  await ctx.deleteMessage(wait.message_id);

  if (!result) return ctx.reply("Не удалось обработать фото");

  await addToHistory(userId, "assistant", result.raw);

  ctx.reply(result.text);

  if (result.latex) {
    const img = await generateLatexImage(result.latex);
    if (img) {
      ctx.replyWithPhoto({ source: img });
    }
  }
});

// ------------------- VERCEL HANDLER -------------------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    return res.status(200).send("OK");
  }

  return res.status(200).send("Bot is running.");
}
