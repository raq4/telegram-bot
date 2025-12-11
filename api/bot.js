const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

// Умный промпт для ВОПРОСОВ ПО ФОТО
const PHOTO_QUESTION_PROMPT = `Ты — эксперт, который помогает решать задачи по фотографиям.

КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ ФОТО С ВОПРОСОМ:
1. Сначала ПОНИМАЙ что на фото (задачи, текст, схемы)
2. ОТВЕЧАЙ НА СОДЕРЖАНИЕ фото
3. РЕШАЙ ЗАДАЧИ если они есть
4. ОБЪЯСНЯЙ РЕШЕНИЕ
5. Если фото содержит вопросы — ОТВЕЧАЙ на них

ПРАВИЛА:
• НЕ ПРОСТО ОПИСЫВАЙ фото
• РЕШАЙ ЗАДАЧИ по фото
• ОТВЕЧАЙ на ВОПРОСЫ из фото
• БУДЬ ПОЛЕЗНЫМ
• Если математика — РЕШАЙ с вычислениями
• Если текст — АНАЛИЗИРУЙ и ОТВЕЧАЙ

ФОРМАТ:
📸 На фото вижу: [коротко что на фото]
🧮 Решение/Ответ: [решаем задачи/отвечаем на вопросы]
📝 Пояснение: [объясняем если нужно]

Отвечай на русском.`;

// Промпт для обычных вопросов
const TEXT_PROMPT = `Ты — полезный ассистент. Отвечай подробно и полезно.`;

// Получить историю
function getUserHistory(userId, isPhoto = false) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: TEXT_PROMPT }
    ]);
  }
  
  // Если это вопрос по фото, меняем системный промпт
  const history = userHistories.get(userId);
  if (isPhoto && history[0].content !== PHOTO_QUESTION_PROMPT) {
    history[0].content = PHOTO_QUESTION_PROMPT;
  } else if (!isPhoto && history[0].content !== TEXT_PROMPT) {
    history[0].content = TEXT_PROMPT;
  }
  
  return history.slice(-10);
}

// Добавить в историю
function addToHistory(userId, role, content, isPhotoQuestion = false) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: isPhotoQuestion ? PHOTO_QUESTION_PROMPT : TEXT_PROMPT }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 11) {
    history.splice(1, 1); // Удаляем самое старое сообщение (но не системное)
  }
}

// Очистить историю
function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ФУНКЦИИ ==========

// Анализировать фото и отвечать на вопросы по нему
async function analyzeAndAnswerPhoto(imageUrl, userQuestion = '') {
  try {
    // Формируем промпт в зависимости от того, есть ли вопрос
    let prompt = '';
    if (userQuestion) {
      prompt = `Пользователь спрашивает: "${userQuestion}"\n\nНа фото я вижу учебные задачи. ПОМОГИ РЕШИТЬ ЗАДАЧИ и ответь на вопрос пользователя.\n\nСначала решим задачи из фото, потом ответим на вопрос пользователя.`;
    } else {
      prompt = `На фото математические задачи. РЕШИ ИХ ПОШАГОВО и дай ответы.\n\nНе просто описывай фото — РЕШАЙ ЗАДАЧИ!`;
    }

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
        max_tokens: 2000,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    return {
      success: true,
      answer: response.data.choices[0].message.content,
      model: 'mistral-vision'
    };

  } catch (error) {
    console.error('Photo analysis error:', error.message);
    return {
      success: false,
      error: 'Не удалось проанализировать фото',
      suggestion: 'Попробуйте сфотографировать более четко или задать вопрос текстом.'
    };
  }
}

// Обработка текстовых вопросов
async function queryMistralAI(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 1500,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      answer: response.data.choices[0].message.content
    };

  } catch (error) {
    return {
      success: false,
      error: 'Ошибка при обработке запроса',
      suggestion: 'Попробуйте переформулировать вопрос.'
    };
  }
}

// Форматирование ответа
function formatResponse(text) {
  // Упрощенное форматирование
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '«$1»')
    .trim();
}

// ========== КОМАНДЫ ==========

// /start
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`👋 Привет! Я бот который РЕШАЕТ задачи по фото!\n\n📸 Отправь фото с задачей — я решу её\n📝 Или просто задай вопрос\n\n/clear - очистить историю\n/help - помощь`);
});

// /help
bot.help((ctx) => {
  ctx.reply(`🤖 Как использовать:\n\n1. 📸 Отправь фото с задачей → получу решение\n2. 📝 Напиши вопрос → отвечу\n3. 📸 Фото + вопрос → решу и отвечу\n\nПример: отправь фото с математической задачей — решу её пошагово!`);
});

// /clear
bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('✅ История очищена!');
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('💭 Думаю...');
  
  try {
    addToHistory(userId, 'user', userText, false);
    const historyMessages = getUserHistory(userId, false);
    
    const aiResult = await queryMistralAI(historyMessages);
    
    if (aiResult.success) {
      addToHistory(userId, 'assistant', aiResult.answer, false);
      await ctx.deleteMessage(waitMsg.message_id);
      
      const formatted = formatResponse(aiResult.answer);
      await ctx.reply(formatted);
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      await ctx.reply(`❌ ${aiResult.error}\n💡 ${aiResult.suggestion}`);
    }
    
  } catch (error) {
    if (waitMsg) await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply('❌ Ошибка. Попробуйте еще раз.');
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ API ключ не настроен.');
  }
  
  // Проверяем, есть ли подпись к фото (вопрос)
  const userQuestion = ctx.message.caption || '';
  const hasQuestion = userQuestion.trim().length > 0;
  
  const waitMsg = await ctx.reply(hasQuestion ? 
    '📸 Вижу фото с вопросом... Решаю...' : 
    '📸 Анализирую фото... Решаю задачи...'
  );
  
  try {
    // Получаем ссылку на фото
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    // Добавляем в историю
    const historyMessage = hasQuestion ? 
      `[Фото + вопрос: "${userQuestion}"]` : 
      '[Отправил фото с задачей]';
    addToHistory(userId, 'user', historyMessage, true);
    
    // Анализируем фото и отвечаем на вопросы
    const photoResult = await analyzeAndAnswerPhoto(imageUrl, userQuestion);
    
    if (photoResult.success) {
      // Добавляем ответ в историю
      addToHistory(userId, 'assistant', photoResult.answer, true);
      
      await ctx.deleteMessage(waitMsg.message_id);
      
      // Форматируем и отправляем ответ
      let response = photoResult.answer;
      
      // Убираем лишнее описание если оно есть
      if (response.includes('На фото вижу:')) {
        // Оставляем только решение
        const solutionStart = response.indexOf('Решение:');
        if (solutionStart !== -1) {
          response = response.substring(solutionStart);
        }
      }
      
      // Добавляем заголовок
      const finalResponse = hasQuestion ?
        `📝 *Ответ на ваш вопрос:*\n\n${response}` :
        `✅ *Решение задач с фото:*\n\n${response}`;
      
      await ctx.reply(formatResponse(finalResponse));
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      await ctx.reply(`❌ ${photoResult.error}\n💡 ${photoResult.suggestion}`);
    }
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    console.error('Photo error:', error);
    
    // Альтернатива: просим описать фото текстом
    if (hasQuestion) {
      await ctx.reply(`Не удалось прочитать фото. Задайте вопрос текстом: "${userQuestion}"`);
    } else {
      await ctx.reply('Не удалось прочитать фото. Попробуйте:\n1. Сфотографировать более четко\n2. Или опишите задачу текстом');
    }
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Photo Problem Solver Bot',
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
