// api/bot.js — Telegram Bot (Vercel + Redis + Mistral)
// ENV: TELEGRAM_TOKEN, MISTRAL_API_KEY, REDIS_URL

import { Telegraf } from "telegraf";
import axios from "axios";
import Redis from "ioredis";
import { createCanvas } from "canvas";

// ------------------- CONFIG -------------------
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

const ADMINS = [815509230];

// ------------------- REDIS HISTORY -------------------
async function getUserHistory(userId) {
  const raw = await redis.get(`history:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

async function addToHistory(userId, role, content) {
  const hist = await getUserHistory(userId);
  hist.push({ role, content });
  if (hist.length > 20) hist.shift();
  await redis.set(`history:${userId}`, JSON.stringify(hist));
}

async function clearUserHistory(userId) {
  await redis.del(`history:${userId}`);
}

// ------------------- LATEX -------------------
function extractLatex(text) {
  const m = text.match(/\$\$(.*?)\$\$/gs);
  if (!m) return null;
  return m.map(x => x.replace(/\$\$/g, "").trim()).join("\n\n");
}

function cleanText(text) {
  return text.replace(/\$\$(.*?)\$\$/gs, "").trim();
}

async function generateLatexImage(latex) {
  try {
    const formulas = latex.split("\n\n");
    const width = 900;
    const height = 120 + formulas.length * 50;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.font = "22px Arial";

    let y = 40;
    for (const f of formulas) {
      ctx.fillText(f, 30, y);
      y += 45;
    }

    return canvas.toBuffer();
  } catch {
    return null;
  }
}

// ------------------- MISTRAL TEXT -------------------
async function callMistralText(messages) {
  const res = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages,
      temperature: 0.7,
      max_tokens: 4096
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const content = res.data.choices[0].message.content;
  return {
    raw: content,
    text: cleanText(content),
    latex: extractLatex(content)
  };
}

// ------------------- MISTRAL VISION -------------------
async function callMistralVision(imageUrl) {
  const res = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "pixtral-12b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Реши задачу с изображения" },
            { type: "image_url", image_url: imageUrl }
          ]
        }
      ],
      max_tokens: 4096
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const content = res.data.choices[0].message.content;
  return {
    raw: content,
    text: cleanText(content),
    latex: extractLatex(content)
  };
}

// ------------------- COMMANDS -------------------
bot.start(async (ctx) => {
  await clearUserHistory(ctx.from.id);
  ctx.reply("Отправь текст или фото с задачей.");
});

bot.command("clear", async (ctx) => {
  await clearUserHistory(ctx.from.id);
  ctx.reply("История очищена.");
});

bot.command("admin", (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  ctx.reply("Admin OK");
});

// ------------------- TEXT -------------------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const msg = ctx.message.text;

  await addToHistory(userId, "user", msg);
  const history = await getUserHistory(userId);

  const wait = await ctx.reply("⏳");

  try {
    const result = await callMistralText(history);
    await ctx.deleteMessage(wait.message_id);

    await addToHistory(userId, "assistant", result.raw);

    if (result.text) await ctx.reply(result.text);
    if (result.latex) {
      const img = await generateLatexImage(result.latex);
      if (img) await ctx.replyWithPhoto({ source: img });
    }
  } catch {
    ctx.reply("Ошибка Mistral API");
  }
});

// ------------------- PHOTO -------------------
bot.on("photo", async (ctx) => {
  const wait = await ctx.reply("🔍");

  const photo = ctx.message.photo.at(-1);
  const file = await ctx.telegram.getFile(photo.file_id);
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;

  try {
    const result = await callMistralVision(url);
    await ctx.deleteMessage(wait.message_id);

    if (result.text) await ctx.reply(result.text);
    if (result.latex) {
      const img = await generateLatexImage(result.latex);
      if (img) await ctx.replyWithPhoto({ source: img });
    }
  } catch {
    ctx.reply("Ошибка обработки изображения");
  }
});

// ------------------- VERCEL -------------------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } else {
    res.status(200).send("Bot running");
  }
}
