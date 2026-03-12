const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Раздача статических файлов из папки public
//app.use(express.static('public'));

const path = require('path');

// Это гарантирует, что папка public найдется, даже если мы запускаем код из подпапки

// Папка public находится на один уровень выше, если server.js в папке server
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});




// Чтобы при заходе на корень сайта открывался index.html
//const path = require('path');
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


mongoose.connect(process.env.MONGO_URI);

// --- СХЕМЫ ДАННЫХ ---
const AdSchema = new mongoose.Schema({
    id: String, userId: String, title: String, salary: String, city: String,
    content: Object, status: { type: String, default: 'pending' },
    isVip: { type: Boolean, default: false }, 
    createdAt: { type: Date, default: Date.now },
    expireAt: Date
});
const Ad = mongoose.model('Ad', AdSchema);

const WalletSchema = new mongoose.Schema({
    type: String, number: String, label: String, active: { type: Boolean, default: true },
    useCount: { type: Number, default: 0 }
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const PromoSchema = new mongoose.Schema({ imageUrl: String, link: String, active: { type: Boolean, default: true } });
const Promo = mongoose.model('Promo', PromoSchema);

const bot = new Telegraf(process.env.BOT_TOKEN);

// Логирование входящих сообщений
bot.use((ctx, next) => {
    if (ctx.from) {
        console.log(`📩 Сообщение от: ${ctx.from.username || ctx.from.id}`);
    }
    return next();
});

// Команда СТАРТ с кнопкой открытия доски
bot.start((ctx) => {
    ctx.reply(
        'Вітаємо у Smart Job Odessa! ⚓\nТут ви знайдете актуальну роботу або зможете розмістити свою вакансію.',
        Markup.inlineKeyboard([
            [Markup.button.webApp('🚀 Відкрити Дошку Оголошень', 'https://board-odessa.onrender.com')]
        ])
    );
});

// Команда для проверки статуса админа
bot.command('admin', (ctx) => {
    const isAdmin = ctx.from.id.toString() === process.env.ADMIN_ID;
    if (isAdmin) {
        ctx.reply('✅ Вітаю, шеф! Ви в панелі керування. Тут будуть з’являтися нові оголошення.');
    } else {
        ctx.reply('❌ Доступ обмежено. Ваш ID: ' + ctx.from.id);
    }
});

// Обработка кнопок модерации (активация)
bot.action(/^paid_(.+)$/, async (ctx) => {
    try {
        const adId = ctx.match[1];
        const ad = await Ad.findOneAndUpdate({ id: adId }, { status: 'active' });
        
        if (ad) {
            const text = `🔥 **${ad.title.toUpperCase()}**\n💰 ЗП: ${ad.salary} грн\n📍 Місто: ${ad.city}\n\n👉 [Відкрити в боті](https://t.me/${ctx.botInfo.username}/app?startapp=${ad.id})`;
            await bot.telegram.sendMessage(process.env.CHANNEL_ID, text, { parse_mode: 'Markdown' });
            await ctx.editMessageText(`✅ Оголошення ${adId} активовано!`);
        }
    } catch (e) {
        console.error(e);
        ctx.reply('Помилка при активації.');
    }
});

// Обработка кнопок модерации (удаление)
bot.action(/^del_(.+)$/, async (ctx) => {
    const adId = ctx.match[1];
    await Ad.findOneAndDelete({ id: adId });
    ctx.editMessageText(`🗑 Оголошення ${adId} видалено.`);
});

// Запуск сервера и бота
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер работает на порту ${PORT}`);
});

bot.launch().then(() => {
    console.log("🚀 Бот запущен!");
}).catch((err) => {
    if (err.response && err.response.error_code === 409) {
        console.log("⚠️ Ждем освобождения токена...");
    } else {
        console.error("❌ Ошибка запуска:", err);
    }
});
