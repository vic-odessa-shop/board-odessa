const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const https = require('https');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const BOT_USERNAME = process.env.BOT_USERNAME || 'board_smart_job_bot'; // ВАЖНО

app.use(express.json());

// ТАРИФЫ
const TARIFFS = {
    trial: { price: 150, days: 7, reposts: 1, label: 'Пробний' },
    standard: { price: 400, days: 30, reposts: 1, label: 'Стандарт' },
    turbo: { price: 800, days: 30, reposts: 7, label: 'Турбо' }
};

mongoose.connect(process.env.MONGO_URI);

const adSchema = new mongoose.Schema({
    id: String, category: String, vacancy: String, salary: String,
    city: { type: String, default: 'Одеса' }, duties: String,
    phone: String, person: { type: String, default: 'Роботодавець' },
    tariff: String, isVip: { type: Boolean, default: false },
    userId: String, status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    expireAt: Date, repostsRemaining: Number, lastRepostDate: Date
});
const Ad = mongoose.model('Ad', adSchema);

// API: ПОЛУЧЕНИЕ ВСЕХ ОБЪЯВЛЕНИЙ ДЛЯ ДОСКИ
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find({ status: { $in: ['active', 'pending'] } }).sort({ isVip: -1, createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).send(e.message); }
});

// API: СОЗДАНИЕ
app.post('/api/ads/create', async (req, res) => {
    try {
        const d = req.body;
        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        const t = TARIFFS[d.tariff] || TARIFFS.standard;
        
        const newAd = new Ad({
            ...d, id: adId,
            repostsRemaining: t.reposts,
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });
        await newAd.save();

        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID, 
                `🆕 *НОВА ВАКАНСІЯ: ${adId}*\nТариф: ${t.label}\nСума: ${t.price} грн\nКонтакт: ${d.phone}`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Оплачено (В ЛЕНТУ)', `paid_${adId}`)],
                    [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                ])
            });
        }
        res.json({ id: adId, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ОБРАБОТКА АДМИНКИ
bot.on('callback_query', async (ctx) => {
    const [action, adId] = ctx.callbackQuery.data.split('_');
    const ad = await Ad.findOne({ id: adId });
    if (!ad) return ctx.answerCbQuery('Не знайдено');

    if (action === 'paid') {
        ad.status = 'active';
        ad.lastRepostDate = new Date();
        ad.repostsRemaining = Math.max(0, (ad.repostsRemaining || 1) - 1);
        await ad.save();
        await sendToChannel(ad);
        ctx.editMessageText(`✅ Активовано ${adId}. Пост у каналі.`);
    } else if (action === 'del') {
        await Ad.deleteOne({ id: adId });
        ctx.editMessageText(`🗑 Видалено ${adId}`);
    }
});

async function sendToChannel(ad) {
    const text = `‼️ *ПОТРІБНА ЛЮДИНА* ‼️\n\n` +
        `🗂 *Категорія:* ${ad.category}\n` +
        `👤 *Вакансія:* ${ad.vacancy}\n` +
        `💰 *Зарплата:* ${ad.salary} грн\n` +
        `📍 *Місто:* ${ad.city}\n\n` +
        `🚀 [Переглянути деталі та контакти](https://t.me/${BOT_USERNAME}?start=${ad.id})`;
    await bot.telegram.sendMessage(process.env.CHANNEL_ID, text, { parse_mode: 'Markdown' });
}

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(process.env.PORT || 3000, () => bot.launch());
