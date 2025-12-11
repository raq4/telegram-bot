const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НАСТРОЙКИ АДМИНИСТРАТОРОВ ==========
const ADMINS = [5455087529, 8354814927];

function isAdmin(userId) {
  return ADMINS.includes(userId);
}

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();
const responseCache = new Map();

// Умный промпт для модели
const SYSTEM_PROMPT = `Ты — экспертный ассистент с глубокими знаниями в программировании, математике, науке и общих вопросах.

ТВОИ ПРИНЦИПЫ:
1. ДАВАЙ ГЛУБОКИЕ, ДЕТАЛЬНЫЕ ОТВЕТЫ
2. РЕШАЙ ЗАДАЧИ ПОШАГОВО
3. ПРОВЕРЯЙ СВОИ ВЫЧИСЛЕНИЯ
4. ФОРМАТИРУЙ ОТВЕТЫ ЧЕТКО:
   • Заголовки - жирным
   • Списки - с маркерами
   • Код - в отдельных блоках
   • Математика - с формулами

СТИЛЬ ОТВЕТА:
• Будь точным и уверенным
• Объясняй сложное простыми словами
• Приводи примеры
• Проверяй логику ответа`;

// Промпт для анализа изображений
const VISION_PROMPT = `Ты — эксперт по анализу изображений. Твоя задача — максимально подробно описать что изображено на фото.

ПРИ АНАЛИЗЕ ИЗОБРАЖЕНИЙ:
1. Опиши ОСНОВНЫЕ ОБЪЕКТЫ (что видишь)
2. Укажи ДЕТАЛИ (цвета, форма, размер)
3. Определи КОНТЕКСТ (где снято, время суток)
4. Проанализируй НАСТРОЕНИЕ/АТМОСФЕРУ
5. Если есть текст — распознай его
6. Если есть лица/люди — опиши (без оценки внешности)
7. Если это скриншот/интерфейс — объясни что на нем
8. Если это документ — попробуй распознать содержание

ФОРМАТ ОТВЕТА:
📸 ОПИСАНИЕ ИЗОБРАЖЕНИЯ:

🏷️ Основные объекты: ...
🎨 Детали: ...
📍 Контекст: ...
💭 Настроение: ...
📝 Текст/надписи: ...
🔍 Дополнительные наблюдения: ...

Отвечай на русском языке. Будь максимально подробным.`;

// Получить историю
function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: SYSTEM_PROMPT }
    ]);
  }
  return userHistories.get(userId).slice(-12);
}

// Добавить в историю
function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: SYSTEM_PROMPT }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 13) {
    const systemMsg = history[0];
    const otherMsgs = history.slice(1);
    const trimmed = otherMsgs.slice(-12);
    userHistories.set(userId, [systemMsg, ...trimmed]);
  }
}

// Очистить историю
function clearUserHistory(userId) {
  userHistories.delete(userId);
  responseCache.delete(userId);
}

// ========== ФУНКЦИИ ОБРАБОТКИ ==========

// Анализ сложности вопроса
function analyzeQuestionComplexity(text) {
  const complexKeywords = ['реши', 'задача', 'уравнение', 'докажи', 'алгоритм', 'формула'];
  let complexity = 1;
  
  complexKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword)) complexity = 2;
  });
  
  if (text.length > 200) complexity = Math.max(complexity, 2);
  
  return complexity;
}

// Получить настройки модели
function getModelSettings(complexity) {
  return {
    model: complexity === 3 ? 'mistral-medium-latest' : 'mistral-small-latest',
    temperature: complexity === 3 ? 0.3 : 0.7,
    max_tokens: complexity === 3 ? 2000 : 1500,
  };
}

// Запрос к Mistral для текста
async function queryMistralAI(messages, complexity) {
  const settings = getModelSettings(complexity);
  
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: settings.model,
        messages: messages,
        max_tokens: settings.max_tokens,
        temperature: settings.temperature,
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 35000
      }
    );
    
    return {
      success: true,
      answer: response.data.choices[0].message.content,
      model: settings.model
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestion: 'Попробуйте переформулировать вопрос.'
    };
  }
}

// Запрос к Mistral для анализа изображений
async function queryMistralVision(imageUrl) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest', // Модель с поддержкой Vision
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 секунд для анализа фото
      }
    );
    
    return {
      success: true,
      description: response.data.choices[0].message.content,
      model: 'mistral-vision'
    };
    
  } catch (error) {
    console.error('Vision API Error:', error.response?.data || error.message);
    
    // Если Vision не поддерживается, пробуем обычную модель
    if (error.response?.data?.error?.code === 'model_not_found') {
      return {
        success: false,
        error: 'Модель не поддерживает анализ изображений',
        suggestion: 'Попробуйте другую фотографию или опишите её текстом.'
      };
    }
    
    return {
      success: false,
      error: 'Не удалось проанализировать изображение',
      suggestion: 'Попробуйте другую фотографию.'
    };
  }
}

// Форматирование ответа
function formatResponse(text) {
  let formatted = text;
  
  // Обрабатываем код
  const codeBlocks = formatted.match(/```(\w+)?\n([\s\S]*?)```/g) || [];
  const codes = [];
  
  codeBlocks.forEach((block, index) => {
    const match = block.match(/```(\w+)?\n([\s\S]*?)```/);
    if (match) {
      const language = match[1] || '';
      const code = match[2];
      codes.push({ language, code, index });
      formatted = formatted.replace(block, `[КОД ${index + 1}]`);
    }
  });
  
  // Обрабатываем форматирование
  formatted = formatted
    .replace(/\*\*(.*?)\*\*/g, '✨ $1 ✨')
    .replace(/\*(?!\*)(.*?)\*/g, '• $1')
    .replace(/`([^`]+)`/g, '«$1»')
    .replace(/#{1,6}\s?(.*?)(\n|$)/g, '📌 $1\n')
    .replace(/^\s*[-*•]\s+/gm, '   • ')
    .trim();
  
  return { text: formatted, codes };
}

// Отправка ответа
async function sendResponse(ctx, aiResult) {
  if (!aiResult.success) {
    return await ctx.reply(`❌ ${aiResult.error}\n\n💡 ${aiResult.suggestion}`);
  }
  
  const { text: formattedText, codes } = formatResponse(aiResult.answer || aiResult.description);
  
  // Отправляем основной текст
  if (formattedText.trim()) {
    await ctx.reply(formattedText);
  }
  
  // Отправляем код отдельно
  for (const code of codes) {
    const codeMessage = `💻 Код (${code.language || 'текст'}):\n\`\`\`${code.language || ''}\n${code.code}\n\`\`\``;
    await ctx.reply(codeMessage, { 
      parse_mode: 'Markdown'
    });
  }
}

// ========== КОМАНДЫ ==========

// /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  
  const welcomeText = `👋 Привет, ${ctx.from.first_name || 'друг'}!

🤖 Я умный бот с возможностями:
• 📝 Глубокие текстовые ответы
• 📸 Анализ изображений
• 🧮 Решение задач
• 💻 Помощь с кодом

📸 *ДЛЯ АНАЛИЗА ФОТО:*
Просто отправь мне любое изображение!

Команды:
/clear - очистить историю
/help - помощь
${isAdmin(userId) ? '/admin - админ' : ''}`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// /help
bot.help((ctx) => {
  ctx.reply(`🤖 Помощь по боту

*Возможности:*
📝 Текстовые вопросы — любые темы
📸 Фотографии — детальный анализ
🧮 Математика — решение задач
💻 Программирование — помощь с кодом

*Как использовать:*
1. Напиши вопрос — получи развернутый ответ
2. Отправь фото — получи описание
3. Задай уточняющий вопрос — бот помнит контекст

*Команды:*
/start - перезапустить
/clear - очистить историю
/help - эта справка`, { parse_mode: 'Markdown' });
});

// /clear
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  ctx.reply('✅ История очищена!');
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API ключ не настроен.');
  }
  
  // Проверяем кэш
  const cacheKey = userText.toLowerCase().trim();
  if (responseCache.has(cacheKey)) {
    await ctx.reply(`💾 Ответ из кэша:\n\n${responseCache.get(cacheKey)}`);
    return;
  }
  
  const waitMsg = await ctx.reply('💭 Думаю...');
  
  try {
    addToHistory(userId, 'user', userText);
    const historyMessages = getUserHistory(userId);
    const complexity = analyzeQuestionComplexity(userText);
    
    const aiResult = await queryMistralAI(historyMessages, complexity);
    
    if (aiResult.success) {
      addToHistory(userId, 'assistant', aiResult.answer);
      
      // Кэшируем
      if (complexity === 1) {
        responseCache.set(cacheKey, aiResult.answer);
        if (responseCache.size > 50) {
          const firstKey = responseCache.keys().next().value;
          responseCache.delete(firstKey);
        }
      }
      
      await ctx.deleteMessage(waitMsg.message_id);
      await sendResponse(ctx, aiResult);
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      await ctx.reply(`❌ ${aiResult.error}\n\n💡 ${aiResult.suggestion}`);
    }
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('👀 Анализирую изображение...');
  
  try {
    // Получаем ссылку на фото (самое качественное)
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    // Добавляем в историю
    addToHistory(userId, 'user', '[Отправил изображение]');
    
    // Анализируем изображение
    const visionResult = await queryMistralVision(imageUrl);
    
    if (visionResult.success) {
      // Добавляем описание в историю
      addToHistory(userId, 'assistant', `Описание фото: ${visionResult.description}`);
      
      await ctx.deleteMessage(waitMsg.message_id);
      
      // Форматируем и отправляем описание
      let description = visionResult.description;
      
      // Улучшаем форматирование для фото
      description = description
        .replace(/📸 ОПИСАНИЕ ИЗОБРАЖЕНИЯ:/g, '📸 *ОПИСАНИЕ ИЗОБРАЖЕНИЯ:*')
        .replace(/🏷️ Основные объекты:/g, '\n🏷️ *Основные объекты:*')
        .replace(/🎨 Детали:/g, '\n🎨 *Детали:*')
        .replace(/📍 Контекст:/g, '\n📍 *Контекст:*')
        .replace(/💭 Настроение:/g, '\n💭 *Настроение:*')
        .replace(/📝 Текст\/надписи:/g, '\n📝 *Текст/надписи:*')
        .replace(/🔍 Дополнительные наблюдения:/g, '\n🔍 *Дополнительные наблюдения:*');
      
      await ctx.reply(description, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      await ctx.reply(`❌ ${visionResult.error}\n\n💡 ${visionResult.suggestion}`);
    }
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    console.error('Photo processing error:', error);
    
    await ctx.reply('❌ Не удалось обработать изображение. Попробуйте другую фотографию.');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Telegram Bot with Vision is running',
      features: ['text_ai', 'image_analysis', 'memory', 'caching'],
      users: userHistories.size,
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
