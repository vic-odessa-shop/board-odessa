const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

// ТАРИФЫ И КОНФИГУРАЦИЯ
const TARIFFS = {
    trial: { price: 150, days: 7, reposts: 1, label: 'Пробний' },
    standard: { price: 400, days: 30, reposts: 1, label: 'Стандарт' },
    turbo: { price: 800, days: 30, reposts: 7, label: 'Турбо' }
};

mongoose.connect(process.env.MONGO_URI);

const adSchema = new mongoose.Schema({
    id: String,
    category: String,
    vacancy: String,
    salary: String,
    city: { type: String, default: 'Одеса' },
    address: String,
    duties: String,
    schedule: String,
    phone: String,
    social: String,
    person: String,
    tariff: String,
    isVip: Boolean,
    userId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    expireAt: Date,
    repostsRemaining: Number,
    lastRepostDate: Date
});
const Ad = mongoose.model('Ad', adSchema);

// ДЕТЕКТОР НОМЕРОВ (Анти-хитрость)
function hasHiddenPhone(text) {
    if(!text) return false;
    const phoneRegex = /(039|050|063|066|067|068|073|089|091|092|093|094|095|096|097|098|099|048)\d{7}/g;
    return phoneRegex.test(text.replace(/[\s\-\(\)]/g, ''));
}

// API: ПОЛУЧЕНИЕ ОБЪЯВЛЕНИЙ (Универсальное)
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find({ status: 'active' }).sort({ isVip: -1, createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).send(e.message); }
});

// API: СОЗДАНИЕ ОБЪЯВЛЕНИЯ
app.post('/api/ads/create', async (req, res) => {
    try {
        const d = req.body;
        if (hasHiddenPhone(d.duties) || hasHiddenPhone(d.vacancy)) {
            return res.status(400).json({ error: "Номер телефону дозволено писати тільки в полі 'Телефон'!" });
        }

        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        const t = TARIFFS[d.tariff] || TARIFFS.standard;
        
        const newAd = new Ad({
            ...d,
            id: adId,
            repostsRemaining: t.reposts,
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });

        await newAd.save();

        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID, 
                `🆕 *НОВЕ ОГОЛОШЕННЯ: ${adId}*\n\n` +
                `Тариф: ${t.label} (${t.price} грн)\n` +
                `Термін: ${t.days} днів / ${t.reposts} постів\n` +
                `Категорія: ${d.category}\n` +
                `Вакансія: ${d.vacancy}\n` +
                `Контакт: ${d.person} (${d.phone})`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Опублікувати', `paid_${adId}`)],
                    [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                ])
            });
        }
        res.json({ id: adId, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ОБРАБОТКА КНОПОК БОТА
bot.on('callback_query', async (ctx) => {
    const [action, adId] = ctx.callbackQuery.data.split('_');
    const ad = await Ad.findOne({ id: adId });
    if (!ad) return ctx.answerCbQuery('Оголошення не знайдено');

    if (action === 'paid') {
        ad.status = 'active';
        ad.lastRepostDate = new Date();
        ad.repostsRemaining = Math.max(0, ad.repostsRemaining - 1);
        await ad.save();
        await sendToChannel(ad);
        bot.telegram.sendMessage(ad.userId, `🎉 Ваше оголошення "${ad.vacancy}" активовано!`).catch(()=>{});
        ctx.editMessageText(`✅ Опубліковано ${adId}`);
    } else if (action === 'del') {
        await Ad.deleteOne({ id: adId });
        ctx.editMessageText(`🗑 Видалено ${adId}`);
    }
});

async function sendToChannel(ad) {
    const text = `‼️ *ПОТРІБЕН / ПРОПОНУЮ* ‼️\n\n` +
        `🗂 *Категорія:* ${ad.category}\n` +
        `👤 *Вакансія:* ${ad.vacancy}\n\n` +
        `💰 *Зарплата:* ${ad.salary} грн\n` +
        `🗓 *Графік:* ${ad.schedule}\n` +
        `📍 *Місто:* ${ad.city}\n\n` +
        `🚀 [Подивитись контакти та деталі](https://t.me/${process.env.BOT_USERNAME}?start=${ad.id})`;
    // Замените ID канала на ваш актуальный
    await bot.telegram.sendMessage(process.env.CHANNEL_ID || '-1003719363779', text, { parse_mode: 'Markdown' });
}

// АВТО-МЕНЕДЖЕР (Раз в час)
setInterval(async () => {
    await Ad.updateMany({ expireAt: { $lt: new Date() }, status: 'active' }, { status: 'expired' });
    const toRepost = await Ad.find({ 
        status: 'active', 
        repostsRemaining: { $gt: 0 },
        lastRepostDate: { $lt: new Date(Date.now() - 22 * 60 * 60 * 1000) } 
    });
    for (let ad of toRepost) {
        await sendToChannel(ad);
        ad.repostsRemaining -= 1;
        ad.lastRepostDate = new Date();
        await ad.save();
    }
}, 3600000);

// ANTI-SLEEP (Пинг само себя)
const APP_URL = "https://board-odessa.onrender.com/"; // ВСТАВЬТЕ СВОЙ URL
setInterval(() => {
    axios.get(APP_URL).catch(() => {});
}, 800000);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(process.env.PORT || 3000, () => {
    console.log('Server started');
    bot.launch();
});
