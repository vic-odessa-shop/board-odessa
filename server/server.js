const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

// База данных (Ad - ваша модель объявления)
const adSchema = new mongoose.Schema({
    id: String,
    title: String,
    salary: String,
    city: String,
    duties: String,
    phone: String,
    status: { type: String, default: 'pending' },
    isVip: Boolean,
    userId: String
});
const Ad = mongoose.model('Ad', adSchema);

// API: Инициализация
app.get('/api/init', (req, res) => {
    res.json({
        cats: [
            {id: 'driver', name: 'Водій 🚗'},
            {id: 'cook', name: 'Кухар 🍳'},
            {id: 'seller', name: 'Продавець 🛍️'}
        ],
        prices: { d30: 400, vip: 150 }
    });
});

// API: Создание объявления
app.post('/api/ads/create', async (req, res) => {
    try {
        const adId = 'v' + Math.floor(Math.random() * 10000);
        const newAd = new Ad({...req.body, id: adId});
        await newAd.save();

        // Ротатор кошельков (пример)
        const wallets = [
            {label: 'ПриватБанк', number: '4441 1111 2222 3333'},
            {label: 'MonoBank', number: '5375 4141 0000 1111'}
        ];
        const wallet = wallets[Math.floor(Math.random() * wallets.length)];

        res.json({ id: adId, wallet: wallet });
        
        // Уведомление админу в бот
        bot.telegram.sendMessage(process.env.ADMIN_ID, `🆕 Нове замовлення: ${adId}\nСума: ${req.body.totalSum} грн`, 
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Активувати', `paid_${adId}`)],
                [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
            ])
        );
    } catch (e) {
        res.status(500).json({error: e.message});
    }
});

// Раздача файлов (с выходом из папки server в корень)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));

bot.start((ctx) => {
    ctx.reply('⚓ Вітаємо у Smart Job!', Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Відкрити Дошку', 'https://board-odessa.onrender.com')]
    ]));
});

bot.launch().catch(err => console.error("Bot error:", err));
