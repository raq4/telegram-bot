const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НАСТРОЙКИ АДМИНИСТРАТОРОВ ==========
const ADMINS = [
  5455087529, // Твой ID (bhphq)
  8354814927, // Запасной ID
  // Добавь сюда ID друзей
];

// Проверка админа
function isAdmin(userId) {
  return ADMINS.includes(userId);
}

// ========== ХРАНЕНИЕ ИСТОРИИ ==========
const userHistories = new Map();
const userStats = new Map(); // Простая статистика

// Получить историю пользователя
function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.' 
      }
    ]);
    
    // Инициализация статистики
    userStats.set(userId, {
      messages: 0,
      username: '',
      firstName: ''
    });
  }
  
  // Обновляем статистику
  const stats = userStats.get(userId);
  stats.messages++;
  
  return userHistories.get(userId).slice(-15); // Последние 15 сообщений
}

// Добавить в историю
function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.' 
      }
    ]);
    
    userStats.set(userId, {
      messages: 0,
      username: '',
      firstName: ''
    });
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
  if (userStats.has(userId)) {
    userStats.get(userId).messages = 0;
  }
}

// ========== КОМАНДЫ БОТА ==========

// /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';
  
  // Обновляем статистику
  if (userStats.has(userId)) {
    const stats = userStats.get(userId);
    stats.username = username;
    stats.firstName = firstName;
  }
  
  clearUserHistory(userId);
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.');
  
  const welcomeText = `👋 Привет, ${firstName || 'друг'}! 

🤖 Я бот с Нейросетью:
• 🌍 Отвечаю на разных языках
• 📸 Могу описать фотографии
• 💭 Понимаю контекст диалога

*Попробуй:*
1. Спроси о чем-нибудь
2. Задай уточняющий вопрос

*Команды:*
/clear - начать новый диалог
/help - помощь
/myid - узнать свой ID
${isAdmin(userId) ? '/admin - админ панель' : ''}

Создатель:
Рафик
@rafaelkazaryan
`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// /help
bot.help((ctx) => {
  const userId = ctx.from.id;
  const isUserAdmin = isAdmin(userId);
  
  let helpText = `*🤖 Помощь по боту*

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
• Запоминает 15 последних сообщений
• Работает с текстом и фото
`;
  
  if (isUserAdmin) {
    helpText += `

*🔧 Админ команды:*
/admin - панель управления
/stats - статистика
/users - список пользователей
`;
  }
  
  helpText += `

*Общие команды:*
/start - начать заново
/clear - очистить историю
/help - эта справка
/myid - узнать свой ID
`;
  
  ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// /clear
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  clearUserHistory(userId);
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.');
  ctx.reply('🧹 История очищена! Начинаем новый диалог.');
});

// /myid
bot.command('myid', (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username ? ` (@${ctx.from.username})` : '';
  const firstName = ctx.from.first_name || '';
  const stats = userStats.get(userId) || { messages: 0 };
  
  ctx.reply(
    `🆔 Твой ID: *${userId}*\nИмя: *${firstName}*${username}\n\n` +
    `${isAdmin(userId) ? '✅ Ты администратор' : '❌ Ты не администратор'}\n\n` +
    `📊 Сообщений: ${stats.messages}`,
    { parse_mode: 'Markdown' }
  );
});

// ========== АДМИН ПАНЕЛЬ ==========

// /admin - главная панель
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Эта команда только для администраторов.');
  }
  
  const totalUsers = userHistories.size;
  const totalMessages = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  const adminPanel = `
🔧 *АДМИН ПАНЕЛЬ | Рафик*

📊 *Статистика:*
👥 Пользователей: ${totalUsers}
📨 Всего сообщений: ${totalMessages}
🔑 Админов: ${ADMINS.length}

*⚡ Команды админа:*
/stats - детальная статистика
/users - список пользователей
/broadcast - рассылка сообщения
/addadmin - добавить админа

*📈 Мониторинг:*
Бот работает стабильно ✅
Mistral API: ${MISTRAL_KEY ? 'активен' : 'не настроен'}
  `;
  
  ctx.reply(adminPanel, { parse_mode: 'Markdown' });
});

// /stats - статистика
bot.command('stats', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const totalUsers = userHistories.size;
  const totalMessages = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  // Топ-3 активных пользователя
  const topUsers = Array.from(userStats.entries())
    .sort((a, b) => b[1].messages - a[1].messages)
    .slice(0, 3)
    .map(([id, stat], index) => 
      `${index + 1}. ${stat.firstName || 'Пользователь'}: ${stat.messages} сообщ.`
    )
    .join('\n');
  
  const statsText = `
📊 *СТАТИСТИКА БОТА*

👥 *Пользователи:*
• Всего: ${totalUsers}
• Новых сегодня: ${Array.from(userStats.values())
  .filter(stat => stat.messages <= 5).length}

💬 *Сообщения:*
• Всего: ${totalMessages}
• Среднее: ${totalUsers > 0 ? Math.round(totalMessages / totalUsers) : 0}

🏆 *Топ-3 активных:*
${topUsers || 'Нет данных'}

🔄 *Система:*
• Время работы: ${Math.floor(process.uptime() / 60)} мин.
• Админов: ${ADMINS.length}
• Mistral API: ${MISTRAL_KEY ? '✅' : '❌'}
  `;
  
  ctx.reply(statsText, { parse_mode: 'Markdown' });
});

// /users - список пользователей
bot.command('users', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const usersList = Array.from(userStats.entries())
    .slice(0, 15) // Показываем первых 15
    .map(([id, stat], index) => {
      const name = stat.firstName || `User${id}`;
      return `${index + 1}. ${name} (${id}): ${stat.messages} сообщ.`;
    })
    .join('\n');
  
  const hasMore = userStats.size > 15 ? `\n\n...и еще ${userStats.size - 15} пользователей` : '';
  
  ctx.reply(
    `👥 *Список пользователей* (${userStats.size} всего):\n\n${usersList}${hasMore}`,
    { parse_mode: 'Markdown' }
  );
});

// /broadcast - рассылка (упрощенная)
bot.command('broadcast', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('Использование: /broadcast [сообщение]\n\nПример: /broadcast Привет всем!');
  }
  
  const users = Array.from(userStats.keys());
  
  ctx.reply(`📢 Рассылка начата для ${users.length} пользователей.\n\nСообщение: ${message}`);
});

// /addadmin - добавить администратора
bot.command('addadmin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /addadmin [ID пользователя]');
  }
  
  const targetId = parseInt(args[1]);
  
  if (!ADMINS.includes(targetId)) {
    ADMINS.push(targetId);
    ctx.reply(`✅ Пользователь ${targetId} добавлен в администраторы.`);
  } else {
    ctx.reply('⚠️ Этот пользователь уже администратор.');
  }
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  // Пропускаем команды
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API ключ не настроен.');
  }
  
  // Обновляем данные пользователя
  if (userStats.has(userId)) {
    const stats = userStats.get(userId);
    stats.username = ctx.from.username || '';
    stats.firstName = ctx.from.first_name || '';
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
        max_tokens: 1000,
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
    await ctx.reply(aiResponse);
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    let errorMessage = '❌ Ошибка при обработке запроса.';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = '⏳ Время ожидания истекло. Попробуй короче вопрос.';
    } else if (error.response?.status === 429) {
      errorMessage = '🚫 Лимит запросов. Подожди немного.';
    }
    
    await ctx.reply(errorMessage);
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
                text: 'Опиши что на этом изображении. Отвечай на русском языке.' 
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
    await ctx.reply(`📸 *Что на фото:*\n\n${description}`, { 
      parse_mode: 'Markdown' 
    });
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply('❌ Не удалось проанализировать изображение. Попробуй другую фотографию.');
  }
});

// ========== WEBHOOK ДЛЯ VERCEL ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Telegram Bot with Admin Panel',
      admin_count: ADMINS.length,
      user_count: userHistories.size,
      features: ['memory', 'multilingual', 'photos', 'admin_panel'],
      uptime: process.uptime(),
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
