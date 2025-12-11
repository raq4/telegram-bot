const { Telegraf } = require('telegraf');
const axios = require('axios');
const { createCanvas } = require('canvas'); // Добавляем canvas для генерации формул

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== СТРОГИЙ СТИЛЬ ==========
const STRICT_STYLE = `ТЫ — ПОМОЩНИК ДЛЯ РЕШЕНИЯ ЗАДАЧ.
ОЧЕНЬ ВАЖНЫЕ ПРАВИЛА:
1. ОТВЕЧАЙ КОРОТКО И ПО ДЕЛУ
2. ФОРМУЛЫ ПИШИ В ФОРМАТЕ LATEX:
   - Дроби: \\frac{3}{5} вместо 3/5
   - Степени: x^{2} вместо x²
   - Умножение: \\times вместо × или *
   - Корни: \\sqrt{x+1} вместо √(x+1)
3. ВСЕ МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ ОБОРАЧИВАЙ В $$...$$ 
   Пример: $$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{27}{20} = 1\\frac{7}{20}$$
4. В ОТВЕТЕ ДОЛЖНО БЫТЬ ДВА ВАРИАНТА:
   - Лаконичный текстовый ответ
   - Формулы в формате LaTeX внутри $$...$$
5. НИКАКИХ ЗВЕЗДОЧЕК (*) В ТЕКСТЕ
6. МИНИМУМ ТЕКСТА, МАКСИМУМ СУТИ
7. ЕСЛИ СПРОСЯТ "КТО ТЫ" — ОТВЕТЬ "НЕЙРОСЕТЬ"

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:
Деление дробей. При делении умножаем на обратную дробь.

$$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{3 \\times 9}{5 \\times 4} = \\frac{27}{20} = 1\\frac{7}{20}$$

Ответ: $$1\\frac{7}{20}$$`;

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
  
  if (history.length > 8) {
    history.splice(1, 1);
  }
}

function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ПАРСИНГ LATEX ИЗ ОТВЕТА ==========
function extractLatexFromAnswer(text) {
  if (!text) return null;
  
  // Ищем формулы в формате $$...$$
  const latexMatches = text.match(/\$\$(.*?)\$\$/gs);
  if (!latexMatches || latexMatches.length === 0) return null;
  
  // Берем первую найденную формулу
  let latex = latexMatches[0].replace(/\$\$/g, '').trim();
  
  // Очищаем от лишних пробелов
  latex = latex.replace(/\s+/g, ' ').trim();
  
  return latex;
}

// ========== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ С ФОРМУЛОЙ ==========
async function generateFormulaImage(latexFormula) {
  try {
    // Для генерации изображений с LaTeX используем внешний API
    // Можно использовать QuickLaTeX, CodeCogs или другие сервисы
    
    const encodedFormula = encodeURIComponent(latexFormula);
    
    // Вариант 1: QuickLaTeX (бесплатный)
    const imageUrl = `https://quicklatex.com/latex3.f?${encodedFormula}`;
    
    // Вариант 2: CodeCogs (тоже бесплатный)
    // const imageUrl = `https://latex.codecogs.com/png.latex?\\dpi{200}${encodedFormula}`;
    
    // Скачиваем изображение
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    return response.data; // Возвращаем Buffer с изображением
    
  } catch (error) {
    console.error('Ошибка генерации формулы:', error.message);
    return null;
  }
}

// ========== ОБРАБОТКА ОТВЕТА ==========
function processAnswer(text) {
  if (!text) return { text: '', latex: null };
  
  let cleanText = text;
  
  // Убираем Markdown
  cleanText = cleanText.replace(/\*\*/g, '');
  cleanText = cleanText.replace(/\*/g, '');
  cleanText = cleanText.replace(/__/g, '');
  
  // Извлекаем LaTeX формулы
  const latex = extractLatexFromAnswer(cleanText);
  
  // Убираем LaTeX формулы из текстового ответа
  const textOnly = cleanText.replace(/\$\$(.*?)\$\$/gs, '').trim();
  
  return {
    text: textOnly,
    latex: latex
  };
}

// ========== ЗАПРОС К AI ==========
async function queryMistral(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 1000,
        temperature: 0.3,
        top_p: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const answer = response.data.choices[0].message.content;
    const processed = processAnswer(answer);
    
    return {
      success: true,
      text: processed.text,
      latex: processed.latex
    };
    
  } catch (error) {
    console.error('Mistral error:', error.message);
    return {
      success: false,
      text: `Ошибка: ${error.message}`,
      latex: null
    };
  }
}

// ========== КОМАНДЫ ==========
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`Привет. Я - нейросеть. Пришли задачу — решу с формулами.\n/clear - очистить историю`);
});

bot.help((ctx) => {
  ctx.reply(`Пришли задачу или уравнение. Отвечу текстом и покажу формулы как в учебнике.`);
});

bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История очищена🧹.');
});

// ========== ТЕКСТ ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();
  
  if (userText.startsWith('/')) return;
  
  if (userText.toLowerCase().includes('кто ты') || 
      userText.toLowerCase().includes('ты кто')) {
    return ctx.reply('Нейросеть.');
  }
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('💭 Решаю...');
  
  try {
    addToHistory(userId, 'user', userText);
    const history = getUserHistory(userId);
    
    const result = await queryMistral(history);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.text);
      
      // Отправляем текстовый ответ
      if (result.text) {
        await ctx.reply(result.text);
      }
      
      // Если есть LaTeX формула, генерируем и отправляем изображение
      if (result.latex) {
        try {
          const generatingMsg = await ctx.reply('📐 Генерирую формулу...');
          
          // Пробуем сгенерировать изображение формулы
          const imageBuffer = await generateFormulaImage(result.latex);
          
          if (imageBuffer) {
            await ctx.deleteMessage(generatingMsg.message_id);
            
            // Отправляем изображение с формулой
            await ctx.replyWithPhoto(
              { source: Buffer.from(imageBuffer) },
              { caption: `Формула: ${result.latex}` }
            );
          } else {
            await ctx.editMessageText(generatingMsg.message_id, 
              'Не удалось сгенерировать формулу. Вот она в текстовом виде:\n' + result.latex);
          }
        } catch (imgError) {
          await ctx.reply(`Формула в LaTeX:\n${result.latex}`);
        }
      }
    } else {
      await ctx.reply(result.text);
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
  const waitMsg = await ctx.reply('👀 Смотрю фото...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'задача'}]`);
    
    const prompt = `Реши задачу на фото. ${caption ? `Вопрос: "${caption}".` : ''}
    
ОЧЕНЬ ВАЖНО:
1. ОТВЕЧАЙ ТОЛЬКО РЕШЕНИЕМ И ОТВЕТОМ
2. ВСЕ МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ ПИШИ В ФОРМАТЕ LATEX ВНУТРИ $$...$$
3. ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:
Деление дробей. При делении умножаем на обратную дробь.

$$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{3 \\times 9}{5 \\times 4} = \\frac{27}{20} = 1\\frac{7}{20}$$

Ответ: $$1\\frac{7}{20}$$`;
    
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
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    
    const answer = response.data.choices[0].message.content;
    const processed = processAnswer(answer);
    
    addToHistory(userId, 'assistant', processed.text);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Отправляем текстовый ответ
    if (processed.text) {
      await ctx.reply(processed.text);
    }
    
    // Если есть LaTeX формула, генерируем изображение
    if (processed.latex) {
      try {
        const generatingMsg = await ctx.reply('📐 Генерирую формулу...');
        
        const imageBuffer = await generateFormulaImage(processed.latex);
        
        if (imageBuffer) {
          await ctx.deleteMessage(generatingMsg.message_id);
          
          await ctx.replyWithPhoto(
            { source: Buffer.from(imageBuffer) },
            { caption: `Решение:` }
          );
        } else {
          await ctx.editMessageText(generatingMsg.message_id, 
            'Не удалось сгенерировать формулу. Вот она в текстовом виде:\n' + processed.latex);
        }
      } catch (imgError) {
        await ctx.reply(`Формула в LaTeX:\n${processed.latex}`);
      }
    }
    
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
      features: 'Текстовые ответы + изображения с формулами',
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
