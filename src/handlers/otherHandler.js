// src/handlers/otherHandler.js
const config = require('../config');
const { backButton, prettyLine } = require('../utils/helpers');

async function handleOtherMenu(bot, query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const text = `
📦 *Menu Lainnya*
${prettyLine()}
Berikut adalah beberapa tautan komunitas dan channel kami.

Jangan ragu untuk bergabung untuk mendapatkan informasi terbaru, promo, atau berdiskusi dengan anggota lain.
    `;
    const keyboard = [];
    if (config.links.telegramChannel) {
        keyboard.push([{ text: '📣 Channel Telegram', url: config.links.telegramChannel }]);
    }
    if (config.links.telegramGroup) {
        keyboard.push([{ text: '💬 Grup Diskusi Telegram', url: config.links.telegramGroup }]);
    }
    if (config.links.whatsappGroup) {
        keyboard.push([{ text: '📱 Grup WhatsApp', url: config.links.whatsappGroup }]);
    }
    keyboard.push([backButton('⬅️ Kembali', 'back_menu')]);

    await bot.telegram.editMessageText(chatId, messageId, null, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard
        },
        disable_web_page_preview: true
    });
}

module.exports = { handleOtherMenu };