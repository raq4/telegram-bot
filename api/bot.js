const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== СТРОГИЙ СТИЛЬ ==========
const STRICT_STYLE = `ТЫ — ПОМОЩНИК ДЛЯ РЕШЕНИЯ ЗАДАЧ.
ОЧЕНЬ ВАЖНЫЕ ПРАВИЛА:
1. ОТВЕЧАЙ КОРОТКО И ПО ДЕЛУ
2. НИКАКИХ ЗВЕЗДОЧЕК (*) В ТЕКСТЕ
3. ФОРМУЛЫ ПИШИ НОРМАЛЬНО: y = -x² - x - 2
4. НИКАКИХ КВАДРАТНЫХ СКОБОК \[ \] И ТЕХ ФОРМАТОВ
5. МИНИМУМ ТЕКСТА, МАКСИМУМ СУТИ
6. НЕ ОБЪЯСНЯЙ ОЧЕВИДНОЕ
7. ЕСЛИ СПРОСЯТ "КТО ТЫ" — ОТВЕТЬ "НЕЙРОСЕТЬ" И ВСЕ

И КОГДА Я ТЕБЕ ОТПРАВЛЯЮ ФОТО С КАКИМ ТО ЗАДАНИЕМ (ЛЮБЫМ) ЛИБО УРАВНЕНИЕМ И Т.Д ПРОСТО РЕШАЙ ЕГО!

ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ:

ПРИМЕР 1 (уравнение):
1/(x-1)² + 3/(x-1) - 10 = 0
Замена: y = 1/(x-1)
y² + 3y - 10 = 0
D = 9 + 40 = 49
y = (-3 ± 7)/2
y₁ = 2, y₂ = -5

1) 1/(x-1) = 2 → x-1 = 1/2 → x = 3/2
2) 1/(x-1) = -5 → x-1 = -1/5 → x = 4/5

Ответ: x = 3/2 и x = 4/5

ПРИМЕР 2 (задача):
Скорость 60 км/ч, время 2 ч.
Расстояние = 60 * 2 = 120 км

ПРИМЕР 3 (сопоставление графиков):
А → 3
Б → 1
В → 2

НИКОГДА НЕ ПИШИ:
• "Дано уравнение:"
• "Сделаем замену:"
• "Таким образом:"
• Квадратные скобки \[ \]
• Звездочки *вот так*
• Много текста про очевидное`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: STRICT_STYLE }
    ]);
  }
  return userHistories.get(userId);
}

function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: STRICT_STYLE }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  // Храним последние 7 сообщений + system prompt
  if (history.length > 8) {
    history.splice(1, 1);
  }
}

function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ОЧИСТКА ТЕКСТА ==========
function cleanText(text) {
  if (!text) return '';
  
  let clean = text;
  
  // Убираем ВСЕ форматы Markdown
  clean = clean.replace(/\*\*/g, '');      // **жирный**
  clean = clean.replace(/\*/g, '');        // *курсив*
  clean = clean.replace(/__/g, '');        // __подчеркивание__
  clean = clean.replace(/~~/g, '');        // ~~зачеркивание~~
  
  // Убираем LaTeX форматы
  clean = clean.replace(/\\\[/g, '');
  clean = clean.replace(/\\\]/g, '');
  clean = clean.replace(/\\\(/g, '');
  clean = clean.replace(/\\\)/g, '');
  
  // Заменяем специальные символы
  clean = clean.replace(/→/g, '→');
  clean = clean.replace(/±/g, '±');
  
  // Форматируем степени
  clean = clean.replace(/\^2/g, '²');
  clean = clean.replace(/\^3/g, '³');
  clean = clean.replace(/\^(\d+)/g, '^$1');
  
  // Убираем шаблонные вводные фразы
  const badPhrases = [
    'Дано уравнение:',
    'Решим это уравнение:',
    'Сделаем замену переменной:',
    'Введем новую переменную:',
    'Таким образом:',
    'Итак:',
    'У нас есть:',
    'Рассмотрим уравнение:',
    'Начнем с того, что',
    'Для решения этого уравнения',
    'Мы видим, что',
    'Обратим внимание, что',
    'Заметим, что',
    'Можно заметить, что'
  ];
  
  badPhrases.forEach(phrase => {
    const regex = new RegExp(phrase, 'gi');
    clean = clean.replace(regex, '');
  });
  
  // Убираем лишние пробелы и переносы
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.replace(/[ \t]{2,}/g, ' ');
  
  // Форматируем списки
  clean = clean.replace(/^\s*[•\-]\s+/gm, '• ');
  clean = clean.replace(/^\s*\d+[\.\)]\s+/gm, '$&');
  
  return clean.trim();
}

// ========== ФОРМАТИРОВАНИЕ ОТВЕТА ==========
function formatAnswer(text) {
  if (!text) return '';
  
  let formatted = cleanText(text);
  
  // Если это решение уравнения, форматируем особым образом
  if (formatted.includes('=') && (formatted.includes('x') || formatted.includes('y'))) {
    // Разбиваем на строки
    const lines = formatted.split('\n').filter(line => line.trim());
    const result = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Пропускаем пустые или излишние строки
      if (!line || line.includes('Таким образом') || line.includes('Итак,')) {
        continue;
      }
      
      // Если строка начинается с числа и скобки, это пункт решения
      if (/^\d+[\)\.]/.test(line)) {
        result.push(line);
      }
      // Если это формула или замена
      else if (line.includes('=') || line.includes('→') || line.includes('Замена:')) {
        result.push(line);
      }
      // Если это ответ
      else if (line.toLowerCase().includes('ответ:') || line.includes('→')) {
        result.push(line);
      }
      // Если короткая строка (формула)
      else if (line.length < 50 && (line.includes('/') || line.includes('±') || line.includes('√'))) {
        result.push(line);
      }
    }
    
    // Если мало строк, возвращаем оригинал
    if (result.length <= 2) {
      return formatted;
    }
    
    // Добавляем "Ответ:" если его нет
    const hasAnswer = result.some(line => 
      line.toLowerCase().includes('ответ:') || 
      (line.includes('x =') && line.includes('и'))
    );
    
    if (!hasAnswer && result.length > 0) {
      const lastLine = result[result.length - 1];
      if (lastLine.includes('x =')) {
        result[result.length - 1] = 'Ответ: ' + lastLine;
      }
    }
    
    return result.join('\n');
  }
  
  // Для задач на сопоставление
  if (formatted.includes('А') && formatted.includes('Б') && formatted.includes('В')) {
    const lines = formatted.split('\n');
    const matches = [];
    
    lines.forEach(line => {
      if (line.includes('А') && line.match(/\d/)) {
        const match = line.match(/([АБВ])[^→]*→?\s*(\d)/);
        if (match) {
          matches.push(`${match[1]} → ${match[2]}`);
        }
      }
    });
    
    if (matches.length >= 2) {
      return matches.join('\n');
    }
  }
  
  return formatted;
}

// ========== ЗАПРОС К AI ==========
async function queryMistral(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 800, // Меньше токенов = короче ответ
        temperature: 0.3, // Ниже температура = меньше "креатива"
        top_p: 0.8,
        frequency_penalty: 0.5, // Штраф за повторения
        presence_penalty: 0.3 // Штраф за новые темы
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
      answer: formatAnswer(answer)
    };
    
  } catch (error) {
    console.error('Mistral error:', error.message);
    return {
      success: false,
      answer: `Ошибка: ${error.message}`
    };
  }
}

// ========== КОМАНДЫ ==========
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`Привет. Я - нейросеть. Пиши свой вопрос — отвечу.\n/clear - очистить историю`);
});

bot.help((ctx) => {
  ctx.reply(`Спроси или отправь фото. Отвечу кратко и по делу.`);
});

bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История очищена🧹.');
});

// ========== ТЕКСТ ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();
  
  // Игнорируем команды
  if (userText.startsWith('/')) return;
  
  // Простые вопросы
  if (userText.toLowerCase().includes('кто ты') || 
      userText.toLowerCase().includes('ты кто') ||
      userText === '?' ||
      userText.toLowerCase() === 'ты') {
    return ctx.reply('Нейросеть.');
  }
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('💭Думаю..');
  
  try {
    addToHistory(userId, 'user', userText);
    const history = getUserHistory(userId);
    
    const result = await queryMistral(history);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.answer);
      
      // Разбиваем длинные ответы
      if (result.answer.length > 2000) {
        const parts = [];
        let currentPart = '';
        const lines = result.answer.split('\n');
        
        for (const line of lines) {
          if ((currentPart + line + '\n').length > 2000) {
            parts.push(currentPart);
            currentPart = line + '\n';
          } else {
            currentPart += line + '\n';
          }
        }
        
        if (currentPart) parts.push(currentPart);
        
        for (let i = 0; i < parts.length; i++) {
          await ctx.reply(parts[i].trim());
          if (i < parts.length - 1) await new Promise(resolve => setTimeout(resolve, 300));
        }
      } else {
        await ctx.reply(result.answer);
      }
    } else {
      await ctx.reply(`Ошибка: ${result.answer}`);
    }
    
  } catch (error) {
    try {
      await ctx.deleteMessage(waitMsg.message_id);
    } catch (e) {}
    
    ctx.reply(`Ошибка: ${error.message}`);
  }
});

// ========== ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const caption = ctx.message.caption || '';
  const waitMsg = await ctx.reply('👀Смотрю фото..');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'задача'}]`);
    
    const prompt = `Реши задачу на фото. ${caption ? `Вопрос: "${caption}".` : ''}
    
ОЧЕНЬ ВАЖНО:
1. ОТВЕЧАЙ ТОЛЬКО РЕШЕНИЕМ И ОТВЕТОМ
2. НИКАКИХ "Дано:", "Решение:", "Ответ:" в начале
3. НИКАКИХ ЗВЕЗДОЧЕК (*) В ТЕКСТЕ
4. ФОРМУЛЫ ПИШИ НОРМАЛЬНО: x², y = kx + b
5. ЕСЛИ ЗАДАЧА НА СОПОСТАВЛЕНИЕ (А, Б, В и 1, 2, 3) — ПИШИ ТОЛЬКО:
А → 1
Б → 2
В → 3

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА ДЛЯ УРАВНЕНИЯ:
1/(x-1)² + 3/(x-1) - 10 = 0
Замена: y = 1/(x-1)
y² + 3y - 10 = 0
D = 9 + 40 = 49
y = (-3 ± 7)/2
y₁ = 2, y₂ = -5

1) 1/(x-1) = 2 → x = 3/2
2) 1/(x-1) = -5 → x = 4/5

Ответ: x = 3/2 и x = 4/5`;
    
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
        max_tokens: 1000,
        temperature: 0.2, // Очень низкая температура для точности
        frequency_penalty: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    
    const analysis = formatAnswer(response.data.choices[0].message.content);
    addToHistory(userId, 'assistant', analysis);
    
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(analysis);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    ctx.reply('Не разобрал фото. Попробуй еще раз или опиши текстом.');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Telegram Math Bot',
      style: 'Кратко, по делу, без воды',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
};
