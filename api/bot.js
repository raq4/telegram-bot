const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== ХРАНЕНИЕ ИСТОРИИ ==========
// В памяти (очистится при перезапуске сервера)
// Для постоянного хранения нужен Redis
const userHistories = new Map(); // userId -> [{role, content}]

// Получить историю пользователя
function getUserHistory(userId, maxMessages = 10) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора. Если пользователь спрашивает на русском, отвечай на русском. Если на английском - на английском.' 
      }
    ]);
  }
  const history = userHistories.get(userId);
  return history.slice(-maxMessages); // Последние сообщения
}

// Добавить сообщение в историю
function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора. Если пользователь спрашивает на русском, отвечай на русском. Если на английском - на английском.' 
      }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  // Ограничиваем историю 20 сообщениями (включая системное)
  if (history.length > 21) { // 1 системное + 20 сообщений
    // Удаляем самое старое, но не системное сообщение
    const systemMsg = history[0];
    const otherMsgs = history.slice(1);
    const trimmed = otherMsgs.slice(-20);
    userHistories.set(userId, [systemMsg, ...trimmed]);
  }
}

// Очистить историю
function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== КОМАНДЫ БОТА ==========

// /start - начать новый диалог
bot.start((ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  
  // Добавляем системное сообщение
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора.');
  
  const welcomeText = `👋 Привет, ${ctx.from.first_name || 'друг'}! 

🤖 Я бот с *памятью и контекстом*:
• 🧠 Запоминаю наши разговоры
• 🌍 Отвечаю на твоем языке
• 📸 Могу описать фотографии
• 💭 Понимаю контекст диалога

*Попробуй:*
1. Спроси о чем-нибудь
2. Задай уточняющий вопрос
3. Я вспомню предыдущее сообщение

*Команды:*
/clear - начать новый диалог
/help - помощь
`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// /clear - очистить историю
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.');
  ctx.reply('🧹 История очищена! Начинаем новый диалог.');
});

// /help - помощь
bot.help((ctx) => {
  ctx.reply(`
*🤖 Бот с контекстом и памятью*

*Как использовать:*
1. Просто напиши вопрос
2. Задай уточняющий вопрос
3. Бот вспомнит предыдущие сообщения

*Пример:*
Ты: "Что такое ИИ?"
Бот: объясняет
Ты: "А какие виды ИИ бывают?"
Бот: *вспоминает* про ИИ и дает уточненный ответ

*Особенности:*
• Автоматически определяет язык
• Запоминает 20 последних сообщений
• Работает с текстом и фото
• Поддерживает контекст диалога

*Команды:*
/start - начать заново
/clear - очистить историю
/help - эта справка
  `, { parse_mode: 'Markdown' });
});

// /context - показать текущий контекст
bot.command('context', (ctx) => {
  const userId = ctx.from.id;
  const history = getUserHistory(userId, 5);
  
  if (history.length <= 1) {
    return ctx.reply('📭 История диалога пуста.');
  }
  
  const contextText = history
    .filter(msg => msg.role !== 'system')
    .map((msg, i) => {
      const prefix = msg.role === 'user' ? '👤 Ты' : '🤖 Я';
      const shortText = msg.content.length > 40 
        ? msg.content.substring(0, 40) + '...' 
        : msg.content;
      return `${i+1}. ${prefix}: ${shortText}`;
    })
    .join('\n');
  
  ctx.reply(`*Текущий контекст:*\n\n${contextText}\n\nВсего сообщений: ${history.length - 1}`, {
    parse_mode: 'Markdown'
  });
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  // Пропускаем команды
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API ключ не настроен. Добавь MISTRAL_API_KEY в настройки Vercel.');
  }
  
  // Показываем статус
  const waitMsg = await ctx.reply('💭 Запоминаю вопрос и думаю...');
  
  try {
    // Добавляем вопрос пользователя в историю
    addToHistory(userId, 'user', userText);
    
    // Получаем историю для контекста
    const historyMessages = getUserHistory(userId, 15);
    
    console.log(`📝 User ${userId}: история ${historyMessages.length} сообщений`);
    
    // Отправляем запрос к Mistral с контекстом
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: historyMessages,
        max_tokens: 1500,
        temperature: 0.7,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 35000 // 35 секунд
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    
    // Добавляем ответ AI в историю
    addToHistory(userId, 'assistant', aiResponse);
    
    // Удаляем сообщение "Думаю..."
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Отправляем ответ (разбиваем если длинный)
    await sendLongMessage(ctx, aiResponse);
    
  } catch (error) {
    // Удаляем сообщение "Думаю..."
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    // Удаляем последний вопрос из истории если ошибка
    const history = userHistories.get(userId);
    if (history && history.length > 1 && history[history.length - 1].role === 'user') {
      history.pop();
    }
    
    let errorMessage = '❌ Ошибка при обработке запроса. ';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage += 'Время ожидания истекло. Попробуй более короткий вопрос.';
    } else if (error.response?.status === 401) {
      errorMessage += 'Неверный Mistral API ключ.';
    } else if (error.response?.status === 429) {
      errorMessage += 'Слишком много запросов. Подожди немного.';
    } else if (error.response?.data?.error?.message) {
      errorMessage += error.response.data.error.message;
    } else {
      errorMessage += 'Попробуй еще раз.';
    }
    
    await ctx.reply(errorMessage);
    console.error('Mistral API error:', error.response?.data || error.message);
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
    
    // Добавляем в историю что пользователь отправил фото
    addToHistory(userId, 'user', '[Пользователь отправил изображение]');
    
    // Запрос к Mistral Vision
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: 'Подробно опиши что изображено на этой фотографии. Будь внимателен к деталям. Отвечай на русском языке.' 
              },
              { 
                type: 'image_url', 
                image_url: { url: imageUrl } 
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    
    const description = response.data.choices[0].message.content;
    
    // Добавляем описание в историю
    addToHistory(userId, 'assistant', `Описание изображения: ${description}`);
    
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(`📸 *Что на фото:*\n\n${description}`, { parse_mode: 'Markdown' });
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (error.response?.data?.error?.code === 'model_not_found') {
      await ctx.reply('⚠️ Моя модель не поддерживает анализ изображений. Нужна модель Mistral с поддержкой Vision.');
    } else {
      await ctx.reply('❌ Не удалось проанализировать изображение. Попробуй другую фотографию.');
    }
    
    console.error('Vision error:', error.response?.data || error.message);
  }
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Отправка длинных сообщений (разбивает на части)
async function sendLongMessage(ctx, text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return await ctx.reply(text);
  }
  
  // Разбиваем по предложениям
  const parts = [];
  let currentPart = '';
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  for (const sentence of sentences) {
    if ((currentPart + sentence).length > maxLength && currentPart.length > 0) {
      parts.push(currentPart.trim());
      currentPart = sentence;
    } else {
      currentPart += (currentPart ? ' ' : '') + sentence;
    }
  }
  
  if (currentPart.trim().length > 0) {
    parts.push(currentPart.trim());
  }
  
  // Отправляем части с задержкой
  for (let i = 0; i < parts.length; i++) {
    await ctx.reply(parts[i] + (parts.length > 1 ? `\n\n[${i+1}/${parts.length}]` : ''));
    if (i < parts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

// ========== WEBHOOK ДЛЯ VERCEL ==========
module.exports = async (req, res) => {
  // GET запрос - проверка работоспособности
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Context-aware Telegram Bot is running',
      features: ['memory', 'multilingual', 'context', 'photos'],
      active_users: userHistories.size,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  }
  
  // POST запрос - обработка от Telegram
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
