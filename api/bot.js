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
• Как будто помогаешь другу

КАК ОТВЕЧАТЬ:
- Коротко и ясно
- Если сложный вопрос — объясняй простыми словами
- Если ошибка — говори что не так и как исправить
- Без воды, сразу к сути
- Без звездочек * в тексте
- Формулы пиши нормально: y = -x² - x - 2

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

// Убираем всю воду, звездочки и форматируем текст
function cleanText(text) {
  if (!text) return '';
  
  let clean = text;
  
  // Убираем звездочки форматирования (но оставляем умножение если есть числа)
  clean = clean.replace(/\*\*(.*?)\*\*/g, '$1');      // **жирный** → жирный
  clean = clean.replace(/\*(?!\s)(.*?)(?<!\s)\*/g, '$1'); // *курсив* → курсив
  
  // Оставляем звездочки умножения типа 2*3
  clean = clean.replace(/(\d)\s*\*\s*(\d)/g, '$1*$2');
  
  // Исправляем формулы
  clean = clean.replace(/\\\(/g, '').replace(/\\\)/g, ''); // убираем \( и \)
  clean = clean.replace(/y\s*=\s*-x\^2/g, 'y = -x²');
  clean = clean.replace(/y\s*=\s*x\^2/g, 'y = x²');
  clean = clean.replace(/\^2/g, '²');
  clean = clean.replace(/\^3/g, '³');
  
  // Убираем лишние эмодзи (оставляем максимум 1 на абзац)
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}]{2,}/gu, '');
  
  // Убираем шаблонные фразы
  const waterPhrases = [
    'Могу углубиться в детали',
    'Давайте разберемся',
    'Великолепно!'
  ];
  
  waterPhrases.forEach(phrase => {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*?(?=\\n|$)', 'gis');
    clean = clean.replace(regex, '');
  });
  
  // Форматируем списки красиво
  clean = clean.replace(/^\s*[•\-]\s+/gm, '• ');
  clean = clean.replace(/^\s*\d+\.\s+/gm, match => match.trim() + ' ');
  
  // Убираем двойные переносы и пробелы
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.replace(/[ \t]{2,}/g, ' ');
  clean = clean.trim();
  
  // Если есть формулы в конце - отделяем их
  if (clean.includes('=') && clean.includes('x')) {
    const lines = clean.split('\n');
    const formattedLines = lines.map(line => {
      if (line.includes('=') && line.includes('x')) {
        return line.replace(/\s+/g, ' ').trim();
      }
      return line;
    });
    clean = formattedLines.join('\n');
  }
  
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
      answer: cleanText(answer)
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
  ctx.reply(`Привет. Я бот, помогаю с любыми вопросами.\n\n/help - команды\n/clear - сбросить историю\n\nСпрашивай что нужно.`);
});

// /help
bot.help((ctx) => {
  ctx.reply(`Команды:\n/clear - сброс истории\n\nЧто умею:\n• Отвечаю на вопросы\n• Помогаю с кодом\n• Решаю задачи\n• Смотрю фото с задачами\n\nПиши вопрос — отвечу.`);
});

// /clear
bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История сброшена🧹.');
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
      `На фото задание. Вопрос: "${caption}". Реши задание и ответь на вопрос. Без звездочек в ответе, формулы пиши нормально.` :
      `На фото какое-то задание или текст. Реши что нужно решить, ответь на вопросы если они есть. Без лишних описаний и звездочек. Формулы пиши как: y = x² + 2x + 1`;
    
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
    
    const analysis = cleanText(response.data.choices[0].message.content);
    addToHistory(userId, 'assistant', analysis);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Форматируем ответ для задач с сопоставлением
    let answer = analysis;
    
    // Если это задача на сопоставление (А-Б-В и 1-2-3)
    if ((answer.includes('А') && answer.includes('Б') && answer.includes('В')) ||
        (answer.includes('График А') || answer.includes('График Б') || answer.includes('График В'))) {
      
      // Создаем чистый формат
      const lines = answer.split('\n').filter(line => line.trim());
      const cleanLines = lines.map(line => {
        // Убираем все маркдаун
        line = line.replace(/\*\*/g, '');
        line = line.replace(/\*/g, '');
        
        // Форматируем сопоставления
        if (line.includes('А') || line.includes('Б') || line.includes('В')) {
          line = line.replace(/—/g, '→').replace(/соответствует/g, '→');
          line = line.replace(/\s+/g, ' ').trim();
        }
        
        return line;
      });
      
      answer = cleanLines.join('\n');
      
      // Добавляем итоговый ответ если его нет
      if (!answer.includes('Ответ:') && !answer.includes('А →')) {
        const matches = [];
        if (answer.includes('А') && answer.includes('1')) matches.push('А → 1');
        if (answer.includes('Б') && answer.includes('2')) matches.push('Б → 2');
        if (answer.includes('В') && answer.includes('3')) matches.push('В → 3');
        if (answer.includes('А') && answer.includes('3')) matches.push('А → 3');
        if (answer.includes('Б') && answer.includes('1')) matches.push('Б → 1');
        if (answer.includes('В') && answer.includes('2')) matches.push('В → 2');
        
        if (matches.length > 0) {
          answer += '\n\nОтвет:\n' + matches.join('\n');
        }
      }
    }
    
    // Если ответ слишком длинный, упрощаем
    if (answer.length > 1500) {
      const importantParts = answer.split('\n').filter(line => 
        line.includes('Ответ:') || 
        line.includes('→') ||
        line.includes('=') ||
        line.length < 80
      );
      answer = importantParts.join('\n') || answer.substring(0, 1500) + '...';
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
      style: 'Clean text, no stars, no bullshit',
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
