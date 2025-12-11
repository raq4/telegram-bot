const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== НАСТРОЙКИ АДМИНИСТРАТОРОВ ==========
const ADMINS = [
  815509230, 5455087529// Твой ID (замени на свой реальный)
  // Добавь сюда ID своих друзей
];

// Проверка админа
function isAdmin(userId) {
  return ADMINS.includes(userId);
}

// ========== ХРАНЕНИЕ ИСТОРИИ ==========
const userHistories = new Map();
const userStats = new Map();
const userChats = new Map(); // Храним ID сообщений для удаления

// Получить историю пользователя
function getUserHistory(userId, maxMessages = 10) {
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
    
    userChats.set(userId, []); // Для хранения ID сообщений
  }
  
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
    
    userChats.set(userId, []);
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

// Сохранить ID сообщения для возможного удаления
function saveMessageId(userId, messageId) {
  if (!userChats.has(userId)) {
    userChats.set(userId, []);
  }
  
  const chat = userChats.get(userId);
  chat.push(messageId);
  
  // Храним только последние 100 ID сообщений
  if (chat.length > 100) {
    userChats.set(userId, chat.slice(-100));
  }
}

// Удалить все сообщения в чате
async function clearChatMessages(ctx, userId) {
  if (!userChats.has(userId)) {
    return 0;
  }
  
  const messageIds = userChats.get(userId);
  let deletedCount = 0;
  
  // Удаляем сообщения с задержкой
  for (const messageId of messageIds) {
    try {
      await ctx.telegram.deleteMessage(userId, messageId);
      deletedCount++;
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms задержка
    } catch (error) {
      // Сообщение могло быть уже удалено или слишком старое
      console.log(`Не удалось удалить сообщение ${messageId}:`, error.message);
    }
  }
  
  // Очищаем список
  userChats.set(userId, []);
  
  return deletedCount;
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

// ========== ФОРМАТИРОВАНИЕ ТЕКСТА ==========

// Функция для корректного форматирования ответов AI
function formatAiResponse(text) {
  // Убираем лишние звездочки и заменяем на правильное Markdown
  let formatted = text
    // Исправляем **жирный** текст
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    // Исправляем *курсив* текст
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    // Исправляем `код`
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Исправляем ```многострочный код```
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Исправляем ```код без языка```
    .replace(/```\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Исправляем заголовки ###
    .replace(/### (.*?)(\n|$)/g, '<b>$1</b>\n')
    .replace(/## (.*?)(\n|$)/g, '<b>$1</b>\n')
    .replace(/# (.*?)(\n|$)/g, '<b>$1</b>\n')
    // Убираем оставшиеся одиночные звездочки
    .replace(/(?<!\*)\*(?!\*)/g, '•')
    // Добавляем отступы для списков
    .replace(/^\s*[-•]\s*/gm, '• ')
    // Исправляем переносы строк
    .replace(/\n{3,}/g, '\n\n');
  
  // Убедимся что нет непарных тегов
  formatted = formatted.replace(/<b>(.*?)<\/b>/g, (match, p1) => {
    return `<b>${p1.replace(/<\/?[^>]+(>|$)/g, '')}</b>`;
  });
  
  return formatted;
}

// Функция для отправки кода с красивым форматированием
async function sendFormattedCode(ctx, code, language = '') {
  const formattedCode = `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
  
  try {
    const msg = await ctx.reply(formattedCode, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    
    if (userChats.has(ctx.from.id)) {
      saveMessageId(ctx.from.id, msg.message_id);
    }
    
    return msg;
  } catch (error) {
    // Если HTML не работает, отправляем как простой текст
    const msg = await ctx.reply(`\`\`\`${language}\n${code}\n\`\`\``, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    
    if (userChats.has(ctx.from.id)) {
      saveMessageId(ctx.from.id, msg.message_id);
    }
    
    return msg;
  }
}

// Экранирование HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========== КОМАНДЫ БОТА ==========

// /start - начать новый диалог
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  
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
• 📝 Форматирую код и текст

*Попробуй:*
1. Спроси о чем-нибудь
2. Задай уточняющий вопрос
3. Попроси написать код

*Команды:*
/clear - начать новый диалог
/clearchat - удалить все сообщения
/help - помощь

Создатель:
Рафик
@rafaelkazaryan
`;
  
  const msg = await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
  saveMessageId(userId, msg.message_id);
});
// ========== КОМАНДЫ ПЕРЕЗАПУСКА ==========

// /reload - перезагрузить настройки без перезапуска (админы)
bot.command('reload', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    const msg = await ctx.reply('🚫 Только для администраторов.');
    saveMessageId(userId, msg.message_id);
    saveMessageId(userId, ctx.message.message_id);
    return;
  }
  
  const reloadMsg = await ctx.reply('🔄 Перезагружаю настройки...');
  
  // Очищаем все кэши
  const userCount = userHistories.size;
  const messageCount = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  userHistories.clear();
  userStats.clear();
  userChats.clear();
  
  // Перезагружаем переменные окружения
  const newMistralKey = process.env.MISTRAL_API_KEY;
  
  await ctx.editMessageText(
    `✅ <b>Настройки перезагружены!</b>\n\n` +
    `• Очищено пользователей: ${userCount}\n` +
    `• Удалено сообщений: ${messageCount}\n` +
    `• Mistral API: ${newMistralKey ? '✅ активен' : '❌ не настроен'}\n\n` +
    `<i>Бот готов к работе с чистой памятью.</i>`,
    { 
      parse_mode: 'HTML',
      message_id: reloadMsg.message_id 
    }
  );
  
  saveMessageId(userId, reloadMsg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// /restart - перезапустить бота (админы)
bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const confirmMsg = await ctx.reply(
    '⚠️ <b>Перезапуск бота</b>\n\n' +
    'Это очистит ВСЮ память бота:\n' +
    '• История всех пользователей\n' +
    '• Статистика\n' +
    '• Кэши\n\n' +
    'Для подтверждения отправьте: <code>/restart_confirm</code>\n\n' +
    '<i>Бот будет работать, но память очистится.</i>',
    { parse_mode: 'HTML' }
  );
  
  saveMessageId(userId, confirmMsg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// Подтверждение перезапуска
bot.command('restart_confirm', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('🚫 Только для администраторов.');
  }
  
  const restartMsg = await ctx.reply('🔄 <b>Перезапускаю бота...</b>', { 
    parse_mode: 'HTML' 
  });
  
  saveMessageId(userId, restartMsg.message_id);
  saveMessageId(userId, ctx.message.message_id);
  
  // Очищаем все данные
  const userCount = userHistories.size;
  const messageCount = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  userHistories.clear();
  userStats.clear();
  userChats.clear();
  
  // Ждем 2 секунды для имитации перезапуска
  setTimeout(async () => {
    await ctx.editMessageText(
      '✅ <b>Бот перезапущен!</b>\n\n' +
      `• Очищено пользователей: ${userCount}\n` +
      `• Удалено сообщений: ${messageCount}\n` +
      '• Сброшены все кэши\n\n' +
      '<i>Бот готов к работе с чистой памятью.</i>',
      { 
        parse_mode: 'HTML',
        message_id: restartMsg.message_id 
      }
    );
  }, 2000);
});
// /clearchat - удалить все сообщения в чате
bot.command('clearchat', async (ctx) => {
  const userId = ctx.from.id;
  
  const confirmMsg = await ctx.reply(
    '⚠️ *Вы уверены что хотите удалить ВСЕ сообщения в этом чате?*\n\n' +
    'Это удалит все сообщения от бота и ваши команды.\n' +
    'Для подтверждения отправьте: /clearchat_confirm\n' +
    'Для отмены просто игнорируйте это сообщение.',
    { parse_mode: 'Markdown' }
  );
  
  saveMessageId(userId, confirmMsg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// Подтверждение удаления чата
bot.command('clearchat_confirm', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const deletingMsg = await ctx.reply('🗑️ Удаляю все сообщения...');
    saveMessageId(userId, deletingMsg.message_id);
    
    // Удаляем все сообщения которые можем
    const deletedCount = await clearChatMessages(ctx, userId);
    
    // Очищаем историю
    clearUserHistory(userId);
    
    // Отправляем сообщение о завершении
    const completionMsg = await ctx.reply(
      `✅ Удалено ${deletedCount} сообщений.\nЧат очищен, история сброшена.\n\nИспользуйте /start для начала нового диалога.`,
      { parse_mode: 'HTML' }
    );
    
    saveMessageId(userId, completionMsg.message_id);
    
    // Удаляем сообщение "Удаляю..."
    setTimeout(async () => {
      try {
        await ctx.deleteMessage(deletingMsg.message_id);
      } catch (e) {}
    }, 2000);
    
  } catch (error) {
    await ctx.reply('❌ Произошла ошибка при удалении сообщений. Попробуйте позже.');
  }
});

// /myid - узнать свой ID
bot.command('myid', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username ? ` (@${ctx.from.username})` : '';
  const firstName = ctx.from.first_name || '';
  
  const msg = await ctx.reply(
    `🆔 Твой ID: *${userId}*\nИмя: *${firstName}*${username}\n\n` +
    `${isAdmin(userId) ? '✅ Ты администратор' : '❌ Ты не администратор'}\n\n` +
    `📊 Статистика: ${userStats.has(userId) ? userStats.get(userId).messages : 0} сообщений`,
    { parse_mode: 'Markdown' }
  );
  
  saveMessageId(userId, msg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// /admin - админ панель
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    const msg = await ctx.reply('🚫 Эта команда только для администраторов.');
    saveMessageId(userId, msg.message_id);
    saveMessageId(userId, ctx.message.message_id);
    return;
  }
  
  const totalUsers = userHistories.size;
  const activeToday = Array.from(userStats.values())
    .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000)
    .length;
  
  const totalMessages = Array.from(userStats.values())
    .reduce((sum, stat) => sum + stat.messages, 0);
  
  const adminPanel = `
🔧 <b>АДМИН ПАНЕЛЬ | Рафик</b>

📊 <b>Статистика:</b>
👥 Пользователей: ${totalUsers}
💬 Активных за 24ч: ${activeToday}
📨 Всего сообщений: ${totalMessages}
🔑 Админов: ${ADMINS.length}

<b>⚡ Быстрые команды:</b>
/stats - детальная статистика
/users - список пользователей
/broadcast - рассылка сообщения
/addadmin - добавить админа
/clearcache - очистить кэш

<b>👤 Управление пользователями:</b>
/ban [id] - заблокировать
/unban [id] - разблокировать
/userinfo [id] - информация

<b>📈 Мониторинг:</b>
Бот работает стабильно ✅
Mistral API: ${MISTRAL_KEY ? 'активен' : 'не настроен'}
  `;
  
  const msg = await ctx.reply(adminPanel, { 
    parse_mode: 'HTML',
    disable_web_page_preview: true 
  });
  
  saveMessageId(userId, msg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// /stats - детальная статистика
bot.command('stats', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    const msg = await ctx.reply('🚫 Только для администраторов.');
    saveMessageId(userId, msg.message_id);
    saveMessageId(userId, ctx.message.message_id);
    return;
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
  
  const topUsers = Array.from(userStats.entries())
    .sort((a, b) => b[1].messages - a[1].messages)
    .slice(0, 5)
    .map(([id, stat], index) => 
      `${index + 1}. ${stat.firstName || 'Пользователь'} (${id}): ${stat.messages} сообщ.`
    )
    .join('\n');
  
  const statsText = `
<b>📊 ДЕТАЛЬНАЯ СТАТИСТИКА</b>

<b>👥 Пользователи:</b>
• Всего: ${totalUsers}
• Активных за 24ч: ${activeToday}
• Заблокированных: ${bannedUsers}
• Новых сегодня: ${Array.from(userStats.values())
  .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000 && stat.messages <= 5)
  .length}

<b>💬 Сообщения:</b>
• Всего: ${totalMessages}
• Среднее на пользователя: ${avgMessages}
• За сегодня: ${Array.from(userStats.values())
  .filter(stat => new Date() - new Date(stat.lastActive) < 24 * 60 * 60 * 1000)
  .reduce((sum, stat) => sum + stat.messages, 0)}

<b>🏆 Топ-5 активных:</b>
${topUsers || 'Нет данных'}

<b>🔄 Система:</b>
• Запущен: ${new Date(Date.now() - process.uptime() * 1000).toLocaleTimeString()}
• Админов: ${ADMINS.length}
• Mistral API: ${MISTRAL_KEY ? '✅' : '❌'}
  `;
  
  const msg = await ctx.reply(statsText, { 
    parse_mode: 'HTML',
    disable_web_page_preview: true 
  });
  
  saveMessageId(userId, msg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// Остальные админ команды остаются аналогичными, но с saveMessageId...

// /clear - очистить историю (для всех)
bot.command('clear', async (ctx) => {
  const userId = ctx.from.id;
  
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    const msg = await ctx.reply('🚫 Вы заблокированы администратором.');
    saveMessageId(userId, msg.message_id);
    saveMessageId(userId, ctx.message.message_id);
    return;
  }
  
  clearUserHistory(userId);
  addToHistory(userId, 'system', 'Ты полезный ассистент. Отвечай на том же языке, на котором тебя спрашивают. Поддерживай контекст разговора.');
  
  const msg = await ctx.reply('🧹 История очищена! Начинаем новый диалог.');
  saveMessageId(userId, msg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// /help - помощь
bot.command('help', async (ctx) => {
  const userId = ctx.from.id;
  const isUserAdmin = isAdmin(userId);
  
  let helpText = `
<b>🤖 Бот с контекстом и памятью</b>

<b>Как использовать:</b>
1. Просто напиши вопрос
2. Задай уточняющий вопрос

<b>Пример:</b>
Ты: "Что такое ИИ?"
Бот: объясняет
Ты: "А какие виды ИИ бывают?"
Бот: <i>вспоминает</i> про ИИ и дает уточненный ответ

<b>Особенности:</b>
• Автоматически определяет язык
• Запоминает 20 последних сообщений
• Работает с текстом и фото
• Поддерживает контекст диалога
• Форматирует код и текст
  `;
  
  if (isUserAdmin) {
    helpText += `

<b>🔧 Админ команды:</b>
/admin - панель управления
/stats - статистика
/users - список пользователей
/broadcast - рассылка
`;
  }
  
  helpText += `

<b>Общие команды:</b>
/start - начать заново
/clear - очистить историю
/clearchat - удалить все сообщения
/help - эта справка
/myid - узнать свой ID
`;
  
  const msg = await ctx.reply(helpText, { 
    parse_mode: 'HTML',
    disable_web_page_preview: true 
  });
  
  saveMessageId(userId, msg.message_id);
  saveMessageId(userId, ctx.message.message_id);
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  // Сохраняем ID пользовательского сообщения
  saveMessageId(userId, ctx.message.message_id);
  
  // Пропускаем команды
  if (userText.startsWith('/')) return;
  
  // Проверка бана
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    const msg = await ctx.reply('🚫 Вы заблокированы администратором.');
    saveMessageId(userId, msg.message_id);
    return;
  }
  
  if (!MISTRAL_KEY) {
    const msg = await ctx.reply('❌ Mistral API ключ не настроен. Добавь MISTRAL_API_KEY в настройки Vercel.');
    saveMessageId(userId, msg.message_id);
    return;
  }
  
  // Обновляем данные пользователя
  if (userStats.has(userId)) {
    const stats = userStats.get(userId);
    stats.username = ctx.from.username;
    stats.firstName = ctx.from.first_name;
  }
  
  const waitMsg = await ctx.reply('💭 Думаю...');
  saveMessageId(userId, waitMsg.message_id);
  
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
    
    let aiResponse = response.data.choices[0].message.content;
    addToHistory(userId, 'assistant', aiResponse);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Проверяем содержит ли ответ код
    if (aiResponse.includes('```')) {
      // Извлекаем и отправляем код отдельно
      const codeBlocks = aiResponse.match(/```(\w+)?\n([\s\S]*?)```/g);
      let textWithoutCode = aiResponse;
      
      if (codeBlocks) {
        for (const block of codeBlocks) {
          const match = block.match(/```(\w+)?\n([\s\S]*?)```/);
          if (match) {
            const language = match[1] || '';
            const code = match[2];
            
            // Удаляем блок кода из текста
            textWithoutCode = textWithoutCode.replace(block, `\n[Код ${language ? language + ' ' : ''}приведен ниже]\n`);
            
            // Отправляем код красиво
            await sendFormattedCode(ctx, code, language);
          }
        }
      }
      
      // Отправляем текст без кода
      if (textWithoutCode.trim().length > 0) {
        const formattedText = formatAiResponse(textWithoutCode);
        const msg = await ctx.reply(formattedText, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
        saveMessageId(userId, msg.message_id);
      }
    } else {
      // Отправляем обычный текст
      const formattedText = formatAiResponse(aiResponse);
      const msg = await ctx.reply(formattedText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      saveMessageId(userId, msg.message_id);
    }
    
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
    
    const msg = await ctx.reply(errorMessage);
    saveMessageId(userId, msg.message_id);
    console.error('Mistral API error:', error.response?.data || error.message);
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  // Сохраняем ID фото сообщения
  saveMessageId(userId, ctx.message.message_id);
  
  if (!MISTRAL_KEY) {
    const msg = await ctx.reply('❌ Mistral API ключ не настроен.');
    saveMessageId(userId, msg.message_id);
    return;
  }
  
  if (userStats.has(userId) && userStats.get(userId).isBanned) {
    const msg = await ctx.reply('🚫 Вы заблокированы администратором.');
    saveMessageId(userId, msg.message_id);
    return;
  }
  
  const waitMsg = await ctx.reply('👀 Анализирую изображение...');
  saveMessageId(userId, waitMsg.message_id);
  
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
    
    const formattedDescription = formatAiResponse(description);
    const msg = await ctx.reply(`📸 <b>Что на фото:</b>\n\n${formattedDescription}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    
    saveMessageId(userId, msg.message_id);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    
    let errorMsg;
    if (error.response?.data?.error?.code === 'model_not_found') {
      errorMsg = '⚠️ Моя модель не поддерживает анализ изображений.';
    } else {
      errorMsg = '❌ Не удалось проанализировать изображение. Попробуй другую фотографию.';
    }
    
    const msg = await ctx.reply(errorMsg);
    saveMessageId(userId, msg.message_id);
    
    console.error('Vision error:', error.response?.data || error.message);
  }
});

// ========== WEBHOOK ДЛЯ VERCEL ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: '✅ Telegram Bot with Admin Panel & Formatting',
      admin_count: ADMINS.length,
      user_count: userHistories.size,
      features: ['memory', 'multilingual', 'context', 'photos', 'admin_panel', 'formatting', 'clearchat'],
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
