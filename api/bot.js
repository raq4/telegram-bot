const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НОРМАЛЬНЫЙ СТИЛЬ ==========
const NORMAL_STYLE = `Ты — нормальный адекватный помощник. Общаешься как умный друг, который разбирается в технологиях.

ТВОЙ СТИЛЬ:
• Без пафоса и официоза
• Говоришь по делу, но не сухо
• Можешь немного пошутить если уместно
• Не слишком серьезный, не слишком милый
• Как будто помогаешь другу с кодом

КАК ОТВЕЧАТЬ:
- Коротко и ясно
- Если сложный вопрос — объясняй простыми словами
- Если ошибка — говори что не так и как исправить
- Код давай сразу рабочий
- Без воды, сразу к сути

Будь собой — умный, helpful, без понтов.`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: NORMAL_STYLE }
    ]);
  }
  return userHistories.get(userId).slice(-8);
}

function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: NORMAL_STYLE }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 9) {
    history.splice(1, 1);
  }
}

function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ФУНКЦИИ ==========

// Убираем всю воду из ответов
function removeWater(text) {
  const waterPhrases = [
   'Могу углубиться в детали'
  ];
  
  let clean = text;
  waterPhrases.forEach(phrase => {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*?(?=\\n|$)', 'gis');
    clean = clean.replace(regex, '');
  });
  
  // Убираем лишние эмодзи
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}]{2,}/gu, '');
  
  // Убираем двойные переносы
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();
  
  return clean;
}

// Запрос к AI
async function queryMistral(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 1200,
        temperature: 0.5,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );
    
    const answer = response.data.choices[0].message.content;
    
    return {
      success: true,
      answer: removeWater(answer)
    };
    
  } catch (error) {
    return {
      success: false,
      answer: `Не смог получить ответ от AI. Проверь API ключ Mistral.`
    };
  }
}

// ========== КОМАНДЫ ==========

// /start
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`Привет. Я бот, помогаю с кодом и техническими вопросами.\n\n/help - команды\n/clear - сбросить историю\n\nСпрашивай что нужно.`);
});

// /help
bot.help((ctx) => {
  ctx.reply(`Команды:\n/clear - сброс истории\n\nЧто умею:\n• Отвечаю на вопросы\n• Помогаю с кодом\n• Решаю задачи\n• Смотрю фото с задачами\n\nПиши вопрос — отвечу.`);
});

// /clear
bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История сброшена. Можно начинать заново.');
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ Mistral не настроен. Добавь MISTRAL_API_KEY в настройки Vercel.');
  }
  
  const waitMsg = await ctx.reply('Секунду...');
  
  try {
    addToHistory(userId, 'user', userText);
    const historyMessages = getUserHistory(userId);
    
    const result = await queryMistral(historyMessages);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.answer);
      await ctx.deleteMessage(waitMsg.message_id);
      await ctx.reply(result.answer);
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      ctx.reply(result.answer);
    }
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    ctx.reply(`Что-то пошло не так: ${error.message}\nПопробуй еще раз.`);
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const caption = ctx.message.caption || '';
  const waitMsg = await ctx.reply('Смотрю фото...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'задача'}]`);
    
    const prompt = caption ? 
      `На фото задание. Вопрос: "${caption}". Реши задание и ответь на вопрос.` :
      `На фото какое-то задание или текст. Реши что нужно решить, ответь на вопросы если они есть. Без лишних описаний.`;
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.4
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    
    const analysis = removeWater(response.data.choices[0].message.content);
    addToHistory(userId, 'assistant', analysis);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Если анализ получился слишком описательным, упрощаем
    let answer = analysis;
    if (answer.toLowerCase().includes('на фото') && answer.length > 200) {
      const lines = answer.split('\n');
      const solutionLines = lines.filter(line => 
        line.includes('Ответ:') || 
        line.includes('Решение:') ||
        line.match(/\d+\./) ||
        line.includes('=') ||
        line.length < 100
      );
      answer = solutionLines.join('\n') || answer;
    }
    
    await ctx.reply(answer);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    ctx.reply('Не получилось разобрать фото. Попробуй еще раз или опиши что там.');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Normal Telegram Bot',
      style: 'No bullshit, straight to the point',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
