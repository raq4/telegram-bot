const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НАСТРОЙКИ АДМИНИСТРАТОРОВ ==========
const ADMINS = [
  5455087529, // Твой ID (bhphq)
  8354814927, // Запасной ID
];

// Проверка админа
function isAdmin(userId) {
  return ADMINS.includes(userId);
}

// ========== ХРАНЕНИЕ ИСТОРИИ ==========
const userHistories = new Map();

// Получить историю пользователя
function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. ' +
                'Форматируй ответы красиво: используй абзацы, выделяй важное. ' +
                'Не используй маркдаун (**, *, `, #) - пиши чистым текстом.' 
      }
    ]);
  }
  return userHistories.get(userId).slice(-15);
}

// Добавить в историю
function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. ' +
                'Форматируй ответы красиво: используй абзацы, выделяй важное. ' +
                'Не используй маркдаун (**, *, `, #) - пиши чистым текстом.' 
      }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 16) {
    const systemMsg = history[0];
    const otherMsgs = history.slice(1);
    const trimmed = otherMsgs.slice(-15);
    userHistories.set(userId, [systemMsg, ...trimmed]);
  }
}

// Очистить историю
function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ФУНКЦИЯ ФОРМАТИРОВАНИЯ ==========

// Исправляем форматирование AI ответов
function formatResponse(text) {
  let formatted = text;
  
  // Убираем маркдаун разметку
  formatted = formatted
    .replace(/\*\*(.*?)\*\*/g, '$1')          // **жирный** → жирный
    .replace(/\*(.*?)\*/g, '$1')              // *курсив* → курсив
    .replace(/`(.*?)`/g, '«$1»')             // `код` → «код»
    .replace(/```(\w+)?\n([\s\S]*?)```/g, 'Код:\n$2') // ```код``` → Код: код
    .replace(/#{1,6}\s?(.*?)(\n|$)/g, '$1\n') // # Заголовок → Заголовок
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')     // [текст](ссылка) → текст
    .replace(/<\/?[^>]+(>|$)/g, '');          // Удаляем HTML теги
  
  // Заменяем маркеры списков на красивые
  formatted = formatted
    .replace(/^[-*•]\s+/gm, '• ')            // - пункт → • пункт
    .replace(/^\d+\.\s+/gm, (match) => match); // 1. пункт остается
  
  // Добавляем отступы для цитат
  formatted = formatted
    .replace(/^>/gm, '  ▸ ')                  // > цитата →   ▸ цитата
  
  // Улучшаем структуру абзацев
  formatted = formatted
    .replace(/\n{3,}/g, '\n\n')               // Много пустых строк → две
    .replace(/\.\s*\n/g, '.\n\n')             // Точка+перевод → абзац
  
  // Убираем лишние пробелы
  formatted = formatted.trim();
  
  return formatted;
}

// Функция для отправки кода с цитированием
async function sendFormattedMessage(ctx, text) {
  const formatted = formatResponse(text);
  
  // Если текст содержит код, отправляем его с форматированием
  if (formatted.includes('«') && formatted.includes('»')) {
    const codeMatch = formatted.match(/«([^»]+)»/g);
    if (codeMatch) {
      let textWithoutCode = formatted;
      const codes = [];
      
      // Извлекаем код
      codeMatch.forEach((code, index) => {
        const cleanCode = code.replace(/«|»/g, '');
        codes.push(cleanCode);
        textWithoutCode = textWithoutCode.replace(code, `[код ${index + 1}]`);
      });
      
      // Отправляем текст
      if (textWithoutCode.trim()) {
        await ctx.reply(textWithoutCode);
      }
      
      // Отправляем каждый код отдельно как цитату
      for (let i = 0; i < codes.length; i++) {
        await ctx.reply(`Код ${i + 1}:\n\`\`\`\n${codes[i]}\n\`\`\``, {
          parse_mode: 'Markdown'
        });
      }
      return;
    }
  }
  
  // Обычный текст отправляем как есть
  await ctx.reply(formatted);
}

// ========== КОМАНДЫ БОТА ==========

// /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  
  const welcomeText = `👋 Привет, ${ctx.from.first_name || 'друг'}! 

🤖 Я бот с нейросетью Mistral AI.

• Отвечаю на разных языках
• Понимаю контекст разговора
• Форматирую ответы красиво
• Выделяю код и цитаты

Просто напиши вопрос — отвечу подробно и понятно.

Команды:
/clear - начать новый диалог
/help - помощь
${isAdmin(userId) ? '/admin - админ панель' : ''}

Создатель: Рафик
@rafaelkazaryan`;
  
  ctx.reply(welcomeText);
});

// /help
bot.help((ctx) => {
  ctx.reply(`🤖 Помощь по боту

Как использовать:
1. Просто напиши вопрос
2. Бот ответит с учетом контекста
3. Код будет выделен отдельно

Особенности:
• Запоминает 15 последних сообщений
• Красиво форматирует ответы
• Выделяет код в отдельные блоки
• Работает с текстом и фото

Команды:
/start - начать заново
/clear - очистить историю
/help - эта справка
${isAdmin(ctx.from.id) ? '/admin - админ панель' : ''}`);
});

// /clear
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  ctx.reply('✅ История диалога очищена. Начинаем новый разговор.');
});

// /admin
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('Эта команда только для администраторов.');
  }
  
  ctx.reply(`🔧 Админ панель

Статистика:
• Пользователей: ${userHistories.size}
• Активных диалогов: ${userHistories.size}

Команды:
/stats - подробная статистика
/users - список пользователей`);
});

// /stats
bot.command('stats', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('Только для администраторов.');
  }
  
  ctx.reply(`📊 Статистика бота

Пользователи: ${userHistories.size}
Активных диалогов: ${userHistories.size}
Mistral API: ${MISTRAL_KEY ? 'активен' : 'не настроен'}`);
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  // Пропускаем команды
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('Mistral API ключ не настроен. Добавь MISTRAL_API_KEY в настройки Vercel.');
  }
  
  const waitMsg = await ctx.reply('💭 Думаю...');
  
  try {
    // Добавляем вопрос в историю
    addToHistory(userId, 'user', userText);
    
    // Получаем историю для контекста
    const historyMessages = getUserHistory(userId);
    
    // Запрос к Mistral
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: historyMessages,
        max_tokens: 1500,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    
    // Добавляем ответ в историю
    addToHistory(userId, 'assistant', aiResponse);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Отправляем с красивым форматированием
    await sendFormattedMessage(ctx, aiResponse);
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    let errorMessage = 'Ошибка при обработке запроса.';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Время ожидания истекло. Попробуй более короткий вопрос.';
    } else if (error.response?.status === 429) {
      errorMessage = 'Лимит запросов. Подожди немного.';
    }
    
    await ctx.reply(errorMessage);
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('Mistral API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('👀 Анализирую изображение...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    // Добавляем в историю
    addToHistory(userId, 'user', '[Отправил изображение]');
    
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
                text: 'Опиши что на этом изображении. Отвечай на русском языке простым текстом, без разметки.' 
              },
              { 
                type: 'image_url', 
                image_url: { url: imageUrl } 
              }
            ]
          }
        ],
        max_tokens: 800
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
    
    // Добавляем ответ в историю
    addToHistory(userId, 'assistant', `Описание фото: ${description}`);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Форматируем описание фото
    const formattedDesc = formatResponse(description);
    await ctx.reply(`📸 Что на фото:\n\n${formattedDesc}`);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply('Не удалось проанализировать изображение.');
  }
});

// ========== WEBHOOK ДЛЯ VERCEL ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Telegram Bot with proper formatting',
      user_count: userHistories.size,
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
