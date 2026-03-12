const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

// Подключение к MongoDB (убедитесь, что MONGO_URI есть в переменных Render)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Упрощенная схема (без строгих правил, чтобы точно сохранилось)
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

// API: Получение объявлений
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find({ status: 'active' }).sort({ createdAt: -1 });
        res.json(ads);
    } catch (e) {
        res.status(500).json([]);
    }
});

// API: Создание объявления
app.post('/api/ads/create', async (req, res) => {
    console.log("📥 Получены данные:", req.body); // Видно в логах Render
    try {
        const adId = 'v' + Math.floor(1000 + Math.random() * 9000);
        
        // Создаем объект объявления
        const newAd = new Ad({
            ...req.body,
            id: adId
        });

        await newAd.save();
        console.log("✅ Объявление сохранено:", adId);

        // Ротатор кошельков
        const wallets = [
            {label: 'ПриватБанк', number: '4441 1111 2222 3333'},
            {label: 'MonoBank', number: '5375 4141 0000 1111'}
        ];
        const wallet = wallets[Math.floor(Math.random() * wallets.length)];

        res.json({ id: adId, wallet: wallet });
        
        // Отправка админу (вам)
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID, 
                `🆕 *НОВЕ ЗАМОВЛЕННЯ: ${adId}*\n\nПосада: ${req.body.title}\nЗП: ${req.body.salary}\nЮзер: ${req.body.userId}`, 
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Активувати', `paid_${adId}`)],
                        [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                    ])
                }
            ).catch(e => console.error("Ошибка отправки админу:", e.message));
        }

    } catch (e) {
        console.error("❌ Ошибка сохранения:", e.message);
        res.status(500).json({ error: "Ошибка базы данных", details: e.message });
    }
});

// Раздача файлов
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

bot.launch().catch(err => console.error("Bot error:", err));
