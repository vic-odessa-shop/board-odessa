const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const adSchema = new mongoose.Schema({
    id: String,
    title: String,
    salary: String,
    city: String,
    duties: String,
    phone: String,
    person: String,
    payMethod: String,
    isVip: Boolean,
    totalSum: String,
    userId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Ad = mongoose.model('Ad', adSchema);

// API: Инициализация
app.get('/api/init', (req, res) => {
    res.json({
        cats: [
            {id: 'driver', name: 'Водій 🚗'},
            {id: 'cook', name: 'Кухар 🍳'},
            {id: 'seller', name: 'Продавець 🛍️'},
            {id: 'manager', name: 'Офіс / Менеджер 📁'}
        ],
        prices: { d30: 400, vip: 150 }
    });
});

// API: Список объявлений
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find().sort({ createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).json([]); }
});

// API: Создание
app.post('/api/ads/create', async (req, res) => {
    try {
        const adId = 'v' + Math.floor(1000 + Math.random() * 9000);
        const newAd = new Ad({ ...req.body, id: adId });
        await newAd.save();

        const wallets = [
            {label: 'ПриватБанк', number: '4441 1111 2222 3333'},
            {label: 'MonoBank', number: '5375 4141 0000 1111'}
        ];
        const wallet = wallets[Math.floor(Math.random() * wallets.length)];
        res.json({ id: adId, wallet: wallet });
        
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID, 
                `🆕 *НОВЕ ЗАМОВЛЕННЯ: ${adId}*\n\nПосада: ${req.body.title}\nЗП: ${req.body.salary}\nКонтакт: ${req.body.phone}`, 
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Опублікувати', `paid_${adId}`)],
                        [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                    ])
                }
            );
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ОБРАБОТКА КНОПОК АДМИНА
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [action, adId] = data.split('_');
    const ad = await Ad.findOne({ id: adId });

    if (!ad) return ctx.answerCbQuery('Не знайдено!');

    if (action === 'paid') {
        ad.status = 'active';
        await ad.save();
        
        // Постинг в ваш канал @rabota_odessa_smart (ID: -1003719363779)
        const channelText = `⚓️ *${ad.title.toUpperCase()}*\n\n💰 *Зарплата:* ${ad.salary} грн\n📍 *Місто:* ${ad.city}\n📝 *Обов'язки:* ${ad.duties}\n\n👤 *Роботодавець:* ${ad.person}\n\n🚀 [Подивитись контакти та відгукнутись](https://t.me/odessa_smart_job_bot?start=${adId})`;
        
        try {
            await bot.telegram.sendMessage('-1003719363779', channelText, { parse_mode: 'Markdown' });
            await ctx.editMessageText(`✅ Оголошення ${adId} активовано та відправлено в канал.`);
        } catch (err) {
            console.error("Channel post error:", err);
            await ctx.reply("Помилка відправки в канал. Перевірте права бота.");
        }
    } else if (action === 'del') {
        await Ad.deleteOne({ id: adId });
        await ctx.editMessageText(`🗑 Оголошення ${adId} видалено.`);
    }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
bot.launch();
