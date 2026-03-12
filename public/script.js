const API_BASE = ''; // Оставляем пустым, браузер сам поймет, что нужно обращаться к своему же серверу

//const API_BASE = 'https://board-odessa.onrender.com';

const tg = window.Telegram.WebApp;

async function initApp() {
    try {
        tg.expand();
        tg.ready(); // Сообщаем Telegram, что приложение готово
        const res = await fetch(`${API_BASE}/api/init`);
        const data = await res.json();
        if (data.cats) renderCategories(data.cats);
        if (data.promos) renderPromos(data.promos);
        loadAds();
    } catch (err) {
        console.error("Ошибка инициализации:", err);
    }
}

async function loadAds(cat = '') {
    try {
        const res = await fetch(`${API_BASE}/api/ads${cat ? '?category='+cat : ''}`);
        const ads = await res.json();
        const main = document.getElementById('adsContainer');
        const vip = document.getElementById('vipContainer');
        
        if (!main || !vip) return;
        main.innerHTML = ''; vip.innerHTML = '';

        ads.forEach(ad => {
            if (ad.isVip && vip) {
                vip.appendChild(createVipCard(ad));
            } else {
                main.appendChild(createCard(ad));
            }
        });
    } catch (err) {
        console.error("Ошибка загрузки объявлений:", err);
    }
}

function showFullAd(ad) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modalBody');
    // Исправили путь к обязанностям (просто ad.duties вместо ad.content.duties)
    const duties = ad.duties || (ad.content ? ad.content.duties : 'Опис відсутній');
    const phone = ad.phone || (ad.content ? ad.content.phone : '********');
    
    const shareUrl = `https://t.me/${tg.initDataUnsafe?.bot_inline_placeholder || 'bot'}/app?startapp=${ad.id}`;
    
    body.innerHTML = `
        <h2>${ad.title}</h2>
        <p>💰 <b>Зарплата:</b> ${ad.salary} грн</p>
        <p>📝 ${duties}</p>
        <hr>
        <p>📞 <b>Контакти:</b> ${phone}</p>
        <button class="main-add-btn" onclick="tg.switchInlineQuery('Дивись вакансію: ${ad.title}')">🚀 Поділитись</button>
    `;
    modal.style.display = 'block';
}



function closeModal() { document.getElementById('modal').style.display = 'none'; }
function renderCategories(cats) { /* ... заполнение селекта ... */ }
window.onload = initApp;

function showHelp() {
    alert ("HELLO HELP!!!!!!");
    tg.showAlert("Smart Job Odessa — сервіс пошуку роботи. Оберіть категорію або додайте своє оголошення через кнопку '+'.");
    
}

