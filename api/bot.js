const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НАСТРОЙКИ АДМИНИСТРАТОРОВ ==========
const ADMINS = [
  8354814927, // Твой ID (замени на свой реальный)
  // Добавь сюда ID своих друзей
  // Чтобы узнать ID: напиши боту /myid
];

// Проверка админа
function isAdmin(userId) {
  return ADMINS.includes(userId);
}

// ========== ХРАНЕНИЕ ИСТОРИИ ==========
const userHistories = new Map();
const userStats = new Map(); // Статистика пользователей

// Получить историю пользователя
function getUserHistory(userId, maxMessages = 10) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { 
        role: 'system', 
        content: 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора. Если пользователь спрашивает на русском, отвечай на русском. Если на английском - на английском.' 
      }
    ]);
    
    // Инициализация статистики
    userStats.set(userId, {
      messages: 0,
      lastActive: new Date(),
      username: null,
      firstName: null,
      isBanned: false
    });
  }
  
  // Обновляем статистику
  const stats = userStats.get(userId);
  stats.messages++;
  stats.lastActive = new Date();
  
  const history = userHistories.get(userId);
  return history.slice(-maxMessages);
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
    
    userStats.set(userId, {
      messages: 0,
      lastActive: new Date(),
      username: null,
      firstName: null,
      isBanned: false
    });
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 21) {
    const systemMsg = history[0];
    const otherMsgs = history.slice(1);
    const trimmed = otherMsgs.slice(-20);
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

// Бан пользователя
function banUser(userId) {
  if (userStats.has(userId)) {
    userStats.get(userId).isBanned = true;
    return true;
  }
  return false;
}

// Разбан пользователя
function unbanUser(userId) {
  if (userStats.has(userId)) {
    userStats.get(userId).isBanned = false;
    return true;
  }
  return false;
}

// ========== КОМАНДЫ БОТА ==========

// /start - начать новый диалог
bot.start((ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  
  // Обновляем данные пользователя в статистике
  if (userStats.has(userId)) {
    const stats = userStats.get(userId);
    stats.username = username;
    stats.firstName = firstName;
    stats.isBanned = false;
  }
  
  clearUserHistory(userId);
  
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора.');
  
  const welcomeText = `👋 Привет, ${ctx.from.first_name || 'друг'}! 

🤖 Я бот с Нейросеть:
• 🌍 Отвечаю на разных языках
• 📸 Могу описать фотографии
• 💭 Понимаю контекст диалога

*Попробуй:*
1. Спроси о чем-нибудь
2. Задай уточняющий вопрос

*Команды:*
/clear - начать новый диалог
/help - помощь

Создатель:
Рафик
@rafaelkazaryan
`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// /myid - узнать свой ID
bot.command('myid', (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username ? ` (@${ctx.from.username})` : '';
  const firstName = ctx.from.first_name || '';
  
  ctx.reply(
    `🆔 Твой ID: *${userId}*\nИмя: *${firstName}*${username}\n\n` +
    `${isAdmin(userId) ? '✅ Ты администратор' : '❌ Ты не администратор'}\n\n` +
    `📊 Статистика: ${userStats.has(userId) ? userStats.get(userId).messages : 0} сообщений`,
    { parse_mode: 'Markdown' }
  );
});

// /admin - админ панель
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Эта команда только для администраторов.');
  }
  
  const totalUsers = userHistories.size;
  const activeToday = Array.from(userStats.values())
    .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000)
    .length;
  
  const totalMessages = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  const adminPanel = `
🔧 *АДМИН ПАНЕЛЬ* | Рафик

📊 *Статистика:*
👥 Пользователей: ${totalUsers}
💬 Активных за 24ч: ${activeToday}
📨 Всего сообщений: ${totalMessages}
🔑 Админов: ${ADMINS.length}

*⚡ Быстрые команды:*
/stats - детальная статистика
/users - список пользователей
/broadcast - рассылка сообщения
/addadmin - добавить админа
/clearcache - очистить кэш

*👤 Управление пользователями:*
/ban [id] - заблокировать
/unban [id] - разблокировать
/userinfo [id] - информация

*📈 Мониторинг:*
Бот работает стабильно ✅
Mistral API: ${MISTRAL_KEY ? 'активен' : 'не настроен'}
  `;
  
  ctx.reply(adminPanel, { parse_mode: 'Markdown' });
});

// /stats - детальная статистика
bot.command('stats', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const totalUsers = userHistories.size;
  const activeToday = Array.from(userStats.values())
    .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000)
    .length;
  
  const totalMessages = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  const bannedUsers = Array.from(userStats.values())
    .filter(stat => stat.isBanned).length;
  
  const avgMessages = totalUsers > 0 ? Math.round(totalMessages / totalUsers) : 0;
  
  // Самые активные пользователи
  const topUsers = Array.from(userStats.entries())
    .sort((a, b) => b[1].messages - a[1].messages)
    .slice(0, 5)
    .map(([id, stat], index) => 
      `${index + 1}. ${stat.firstName || 'Пользователь'} (${id}): ${stat.messages} сообщ.`
    )
    .join('\n');
  
  const statsText = `
📊 *ДЕТАЛЬНАЯ СТАТИСТИКА*

👥 *Пользователи:*
• Всего: ${totalUsers}
• Активных за 24ч: ${activeToday}
• Заблокированных: ${bannedUsers}
• Новых сегодня: ${Array.from(userStats.values())
  .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000 && stat.messages <= 5)
  .length}

💬 *Сообщения:*
• Всего: ${totalMessages}
• Среднее на пользователя: ${avgMessages}
• За сегодня: ${Array.from(userStats.values())
  .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000)
  .reduce((sum, stat) => sum + stat.messages, 0)}

🏆 *Топ-5 активных:*
${topUsers || 'Нет данных'}

🔄 *Система:*
• Запущен: ${new Date(Date.now() - process.uptime() * 1000).toLocaleTimeString()}
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
    .slice(0, 20) // Показываем первых 20
    .map(([id, stat], index) => {
      const name = stat.firstName || `User${id}`;
      const status = stat.isBanned ? '🔴' : '🟢';
      const messages = stat.messages;
      const lastSeen = Math.round((new Date() - new Date(stat.lastActive)) / (1000 * 60)); // минут назад
      
      return `${index + 1}. ${status} ${name} (${id}): ${messages} сообщ., ${lastSeen} мин. назад`;
    })
    .join('\n');
  
  const hasMore = userStats.size > 20 ? `\n\n...и еще ${userStats.size - 20} пользователей` : '';
  
  ctx.reply(
    `👥 *Список пользователей* (${userStats.size} всего):\n\n${usersList}${hasMore}\n\n` +
    `Используй /userinfo [id] для подробной информации`,
    { parse_mode: 'Markdown' }
  );
});

// /userinfo [id] - информация о пользователе
bot.command('userinfo', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /userinfo [ID пользователя]');
  }
  
  const targetId = parseInt(args[1]);
  if (!userStats.has(targetId)) {
    return ctx.reply('❌ Пользователь не найден.');
  }
  
  const stat = userStats.get(targetId);
  const history = userHistories.get(targetId) || [];
  const messagesCount = history.length - 1; // минус системное
  
  const lastActive = new Date(stat.lastActive);
  const timeAgo = Math.round((new Date() - lastActive) / (1000 * 60)); // минут назад
  
  const userInfo = `
👤 *Информация о пользователе*

🆔 ID: *${targetId}*
👤 Имя: ${stat.firstName || 'Не указано'}
📛 Юзернейм: ${stat.username ? `@${stat.username}` : 'Не указан'}
🚫 Статус: ${stat.isBanned ? '🔴 Заблокирован' : '🟢 Активен'}

📊 *Статистика:*
• Сообщений всего: ${stat.messages}
• Сообщений в истории: ${messagesCount}
• Последняя активность: ${timeAgo} минут назад
• Первое сообщение: ${history.length > 1 ? 'есть' : 'нет'}

*Действия:*
${stat.isBanned ? 
  `/unban ${targetId} - разблокировать` : 
  `/ban ${targetId} - заблокировать`
}
/clearcache ${targetId} - очистить историю
  `;
  
  ctx.reply(userInfo, { parse_mode: 'Markdown' });
});

// /ban [id] - заблокировать пользователя
bot.command('ban', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /ban [ID пользователя]');
  }
  
  const targetId = parseInt(args[1]);
  if (ADMINS.includes(targetId)) {
    return ctx.reply('❌ Нельзя заблокировать администратора!');
  }
  
  if (banUser(targetId)) {
    ctx.reply(`✅ Пользователь ${targetId} заблокирован.`);
  } else {
    ctx.reply('❌ Пользователь не найден.');
  }
});

// /unban [id] - разблокировать пользователя
bot.command('unban', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /unban [ID пользователя]');
  }
  
  const targetId = parseInt(args[1]);
  if (unbanUser(targetId)) {
    ctx.reply(`✅ Пользователь ${targetId} разблокирован.`);
  } else {
    ctx.reply('❌ Пользователь не найден.');
  }
});

// /addadmin [id] - добавить администратора
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
  
  // Проверяем есть ли такой пользователь
  if (!userStats.has(targetId)) {
    return ctx.reply('❌ Сначала пользователь должен написать боту хотя бы одно сообщение.');
  }
  
  if (!ADMINS.includes(targetId)) {
    ADMINS.push(targetId);
    
    // Сохраняем в статистике что это админ
    const stat = userStats.get(targetId);
    
    ctx.reply(
      `✅ Пользователь ${targetId} (${stat.firstName || 'без имени'}) добавлен в администраторы.\n\n` +
      `Теперь у него есть доступ к командам:\n` +
      `/admin, /stats, /users, /broadcast, /ban, /unban`
    );
  } else {
    ctx.reply('⚠️ Этот пользователь уже администратор.');
  }
});

// /broadcast - рассылка всем пользователям
bot.command('broadcast', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('Использование: /broadcast [сообщение]\n\nПример: /broadcast Привет всем! Обновление бота...');
  }
  
  const users = Array.from(userStats.keys());
  const totalUsers = users.length;
  
  ctx.reply(`📢 Начинаю рассылку для ${totalUsers} пользователей...`);
  
  let sent = 0;
  let failed = 0;
  
  // Рассылаем с задержкой чтобы не превысить лимиты Telegram
  users.forEach((user, index) => {
    setTimeout(async () => {
      try {
        await ctx.telegram.sendMessage(user, `📢 *Сообщение от администратора:*\n\n${message}`, {
          parse_mode: 'Markdown'
        });
        sent++;
      } catch (error) {
        failed++;
      }
      
      // Отчет каждые 10 отправленных
      if ((sent + failed) % 10 === 0 || (sent + failed) === totalUsers) {
        ctx.reply(`📊 Рассылка: ${sent + failed}/${totalUsers} (✅ ${sent}, ❌ ${failed})`);
      }
    }, index * 100); // 100ms задержка между сообщениями
  });
});

// /clearcache - очистить кэш
bot.command('clearcache', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length >= 2) {
    // Очистка конкретного пользователя
    const targetId = parseInt(args[1]);
    if (clearUserHistory(targetId)) {
      ctx.reply(`✅ История пользователя ${targetId} очищена.`);
    } else {
      ctx.reply('❌ Пользователь не найден.');
    }
  } else {
    // Очистка всех неактивных (больше 7 дней)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let cleared = 0;
    
    Array.from(userStats.entries()).forEach(([id, stat]) => {
      if (stat.lastActive < weekAgo && !isAdmin(id)) {
        userHistories.delete(id);
        userStats.delete(id);
        cleared++;
      }
    });
    
    ctx.reply(`🧹 Очищено ${cleared} неактивных пользователей (старше 7 дней).\nОсталось: ${userHistories.size}`);
  }
});

// /clear - очистить историю (для всех)
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  
  // Проверяем бан
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    return ctx.reply('🚫 Вы заблокированы администратором.');
  }
  
  clearUserHistory(userId);
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают.');
  ctx.reply('🧹 История очищена! Начинаем новый диалог.');
});

// /help - помощь
bot.help((ctx) => {
  const userId = ctx.from.id;
  const isUserAdmin = isAdmin(userId);
  
  let helpText = `
*🤖 Бот с контекстом и памятью*

*Как использовать:*
1. Просто напиши вопрос
2. Задай уточняющий вопрос

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
  `;
  
  if (isUserAdmin) {
    helpText += `

*🔧 Админ команды:*
/admin - панель управления
/stats - статистика
/users - список пользователей
/broadcast - рассылка
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

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  // Пропускаем команды
  if (userText.startsWith('/')) return;
  
  // Проверка бана
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    return ctx.reply('🚫 Вы заблокированы администратором.');
  }
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API ключ не настроен. Добавь MISTRAL_API_KEY в настройки Vercel.');
  }
  
  // Обновляем данные пользователя
  if (userStats.has(userId)) {
    const stats = userStats.get(userId);
    stats.username = ctx.from.username;
    stats.firstName = ctx.from.first_name;
  }
  
  const waitMsg = await ctx.reply('💭 Думаю...');
  
  try {
    addToHistory(userId, 'user', userText);
    const historyMessages = getUserHistory(userId, 15);
    
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
        timeout: 35000
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    addToHistory(userId, 'assistant', aiResponse);
    
    await ctx.deleteMessage(waitMsg.message_id);
    await sendLongMessage(ctx, aiResponse);
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
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
  
  // Проверка бана
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    return ctx.reply('🚫 Вы заблокированы администратором.');
  }
  
  const waitMsg = await ctx.reply('👀 Анализирую изображение...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', '[Пользователь отправил изображение]');
    
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
    addToHistory(userId, 'assistant', `Описание изображения: ${description}`);
    
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(`📸 *Что на фото:*\n\n${description}`, { parse_mode: 'Markdown' });
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (error.response?.data?.error?.code === 'model_not_found') {
      await ctx.reply('⚠️ Моя модель не поддерживает анализ изображений.');
    } else {
      await ctx.reply('❌ Не удалось проанализировать изображение. Попробуй другую фотографию.');
    }
    
    console.error('Vision error:', error.response?.data || error.message);
  }
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
async function sendLongMessage(ctx, text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return await ctx.reply(text);
  }
  
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
  
  for (let i = 0; i < parts.length; i++) {
    await ctx.reply(parts[i] + (parts.length > 1 ? `\n\n[${i+1}/${parts.length}]` : ''));
    if (i < parts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

// ========== WEBHOOK ДЛЯ VERCEL ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Telegram Bot with Admin Panel is running',
      admin_count: ADMINS.length,
      user_count: userHistories.size,
      features: ['memory', 'multilingual', 'context', 'photos', 'admin_panel'],
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  }
  
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
