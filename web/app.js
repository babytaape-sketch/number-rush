
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    // Не позволяем вертикальному свайпу случайно сворачивать Mini App.
    if (typeof tg.disableVerticalSwipes === "function") {
        tg.disableVerticalSwipes();
    }
    tg.setHeaderColor("#080b10");
    tg.setBackgroundColor("#080b10");
}

const initData = tg?.initData || "";
const headers = { "Content-Type": "application/json" };

let marketCache = [];
let collectionCache = [];
let marketFavorites = new Set();
try {
    marketFavorites = new Set(JSON.parse(localStorage.getItem("numberRushMarketFavorites") || "[]").map(String));
} catch (_) {
    marketFavorites = new Set();
}

if (initData) {
    headers.Authorization = "tma " + initData;
}

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });

    const data = await res.json().catch(() => ({
        detail: "Server error"
    }));

    if (!res.ok) {
        throw new Error(data.detail || "Request failed");
    }

    return data;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

const plateLetters = "АВЕКМНОРСТУХ";
const plateDigits = "0123456789";

const rarityColors = {
    Common: "#b9c3d0",
    Uncommon: "#36d477",
    Rare: "#3294ff",
    Epic: "#ae63ff",
    Legendary: "#ffc247",
    Mythic: "#ff563f"
};

const rarityNames = {
    Common: "ОБЫЧНЫЙ",
    Uncommon: "НЕОБЫЧНЫЙ",
    Rare: "РЕДКИЙ",
    Epic: "ЭПИЧЕСКИЙ",
    Legendary: "ЛЕГЕНДАРНЫЙ",
    Mythic: "МИФИЧЕСКИЙ"
};

function setRarityEffect(rarity) {
    const plate = $("plate");
    const rarityLabel = $("rarity");
    const color = rarityColors[rarity] || rarityColors.Common;

    if (!plate || !rarityLabel) return;

    plate.style.setProperty("--rarity-color", color);
    plate.dataset.rarity = rarity;

    plate.classList.remove("rarity-flash");
    void plate.offsetWidth;
    plate.classList.add("rarity-flash");

    rarityLabel.style.color = color;
    rarityLabel.textContent = rarityNames[rarity] || rarity.toUpperCase();
}

function renderTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return "";
    }

    return `
        <div class="plate-tags">
            ${tags.map(tag => `
                <span class="plate-tag">${escapeHtml(tag)}</span>
            `).join("")}
        </div>
    `;
}

function randomSymbol(finalChar) {
    const alphabet = plateLetters.includes(finalChar)
        ? plateLetters
        : plateDigits;

    return alphabet[Math.floor(Math.random() * alphabet.length)];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function rollSlot(element, finalChar, options = {}) {
    const duration = options.duration || 2600;
    const delay = options.delay || 0;

    const alphabet = plateLetters.includes(finalChar)
        ? plateLetters
        : plateDigits;

    const fontSize = parseFloat(
        getComputedStyle(element).fontSize
    ) || 36;

    const symbolHeight = fontSize;

    const strip = document.createElement("span");
    strip.className = "slot-strip";

    const windowElement = document.createElement("span");
    windowElement.className = "slot-window";

    windowElement.style.height = `${symbolHeight}px`;
    windowElement.style.overflow = "hidden";

    const totalSymbols = options.totalSymbols || 22;

    for (let i = 0; i < totalSymbols; i++) {
        const symbol = document.createElement("span");
        symbol.className = "slot-symbol";
        symbol.textContent = randomSymbol(finalChar);
        symbol.style.height = `${symbolHeight}px`;
        symbol.style.flexBasis = `${symbolHeight}px`;
        strip.appendChild(symbol);
    }

    const finalSymbol = document.createElement("span");
    finalSymbol.className = "slot-symbol";
    finalSymbol.textContent = finalChar;
    finalSymbol.style.height = `${symbolHeight}px`;
    finalSymbol.style.flexBasis = `${symbolHeight}px`;
    strip.appendChild(finalSymbol);

    windowElement.appendChild(strip);
    element.replaceChildren(windowElement);

    strip.style.transform = "translateY(0)";
    strip.style.willChange = "transform";

    await sleep(delay);

    const distance = totalSymbols * symbolHeight;

    if (strip.animate) {
        const animation = strip.animate(
            [
                { transform: "translate3d(0, 0, 0)" },
                { transform: `translate3d(0, -${distance}px, 0)` }
            ],
            {
                duration,
                easing: "cubic-bezier(.22,.61,.36,1)",
                fill: "forwards"
            }
        );

        await animation.finished;
        animation.cancel();
    } else {
        const start = performance.now();

        await new Promise(resolve => {
            function frame(now) {
                const progress = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - progress, 3);

                strip.style.transform =
                    `translate3d(0, -${distance * eased}px, 0)`;

                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(frame);
        });
    }

    element.textContent = finalChar;
}

async function animatePlate(finalPlate, rarity) {
    const main = document.querySelector(".plate-main");
    const region = document.querySelector(".region-code");

    if (!main || !region) return;

    const parts = finalPlate.trim().split(/\s+/);
    const mainChars = Array.from(parts[0] || "");
    const regionChars = Array.from(parts[1] || "77");

    const mainSlots = mainChars.map(() => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        return slot;
    });

    const regionSlots = regionChars.map(() => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        return slot;
    });

    main.replaceChildren(...mainSlots);
    region.replaceChildren(...regionSlots);

    // Регион всегда останавливается первым.
    await Promise.all(
        regionSlots.map((slot, index) =>
            rollSlot(slot, regionChars[index], {
                duration: 1350,
                totalSymbols: 22
            })
        )
    );

    // Выбираем случайную букву и случайную цифру для дополнительной интриги.
    const letterIndexes = mainChars
        .map((char, index) => plateLetters.includes(char) ? index : -1)
        .filter(index => index >= 0);
    const digitIndexes = mainChars
        .map((char, index) => plateDigits.includes(char) ? index : -1)
        .filter(index => index >= 0);

    const suspenseLetter = letterIndexes.length
        ? letterIndexes[Math.floor(Math.random() * letterIndexes.length)]
        : -1;
    const suspenseDigit = digitIndexes.length
        ? digitIndexes[Math.floor(Math.random() * digitIndexes.length)]
        : -1;

    const rarityLevel = {
        Common: 0,
        Uncommon: 1,
        Rare: 2,
        Epic: 3,
        Legendary: 4,
        Mythic: 5
    }[rarity] ?? 0;

    const baseDuration = 1500 + rarityLevel * 130;
    const stopInterval = 230 + rarityLevel * 25;
    const suspenseExtra = 650 + rarityLevel * 260;

    // Все символы начинают вращаться одновременно.
    // Обычные останавливаются по очереди, выбранные буква и цифра
    // получают случайное дополнительное вращение и задерживают развязку.
    await Promise.all(
        mainSlots.map((slot, index) => {
            const isSuspense = index === suspenseLetter || index === suspenseDigit;
            const isFinalTwo = index >= mainSlots.length - 2;
            const randomExtra = isSuspense
                ? Math.floor(Math.random() * 500)
                : 0;
            const finalTwoExtra = isFinalTwo
                ? 900 + rarityLevel * 220 + Math.floor(Math.random() * 350)
                : 0;

            return rollSlot(slot, mainChars[index], {
                duration: baseDuration + index * stopInterval +
                    (isSuspense ? suspenseExtra + randomExtra : 0) +
                    finalTwoExtra,
                totalSymbols: 22
            });
        })
    );

    setRarityEffect(rarity);
    await sleep(500);
}

// =========================================================
// БЕСПЛАТНЫЕ ПРОКРУТКИ
// =========================================================

let freeSpinTimer = null;
let freeSpinSeconds = 0;

function updateFreeSpinTimer() {
    const status = $("free-spin-status");
    const button = $("free-spin-button");
    if (!status || !button) return;

    if (freeSpinSeconds <= 0) {
        status.textContent = "🎁 Бесплатный спин доступен — нажми кнопку!";
        button.disabled = false;
        return;
    }

    button.disabled = true;
    const hours = Math.floor(freeSpinSeconds / 3600);
    const minutes = Math.floor((freeSpinSeconds % 3600) / 60);
    const seconds = freeSpinSeconds % 60;
    status.textContent = `🎁 Бесплатный спин через ${hours}ч ${minutes}м ${seconds}с`;
    freeSpinSeconds--;
}


// =========================================================
// МИНИАТЮРА НОМЕРА
// =========================================================

function createMiniPlate(number) {
    const parts = String(number).split(" ");
    const main = parts[0] || "";
    const region = parts[1] || "";

    return `
        <div class="mini-plate">
            <div class="mini-plate-main">${escapeHtml(main)}</div>
            <div class="mini-plate-region">
                <div class="mini-region-code">${escapeHtml(region)}</div>
                <div class="mini-region-country">RUS</div>
                <div class="mini-region-flag">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
}


// =========================================================
// ФИЛЬТРЫ И ИЗБРАННОЕ РЫНКА
// =========================================================

function renderMarket() {
    const root = $("market-items");
    if (!root) return;

    const query = ($("market-search")?.value || "").trim().toLowerCase();
    const rarity = $("market-rarity")?.value || "all";
    const sort = $("market-sort")?.value || "newest";
    const favoritesOnly = $("market-favorites-only")?.classList.contains("active");

    let rows = marketCache.filter(p => {
        const matchesSearch = !query ||
            String(p.number).toLowerCase().includes(query) ||
            String(p.rarity_ru || p.rarity).toLowerCase().includes(query) ||
            (p.tags || []).some(tag => String(tag).toLowerCase().includes(query));
        const matchesRarity = rarity === "all" || p.rarity === rarity;
        const matchesFavorite = !favoritesOnly || marketFavorites.has(String(p.listing_id));
        return matchesSearch && matchesRarity && matchesFavorite;
    });

    if (sort === "cheap") rows.sort((a,b) => a.price - b.price);
    if (sort === "expensive") rows.sort((a,b) => b.price - a.price);
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:5};
        rows.sort((a,b) => (rank[b.rarity] || 0) - (rank[a.rarity] || 0));
    }

    const count = $("market-count");
    if (count) count.textContent = rows.length + " предложений";

    root.innerHTML = rows.length
        ? rows.map(p => {
            const favorite = marketFavorites.has(String(p.listing_id));
            return `
                <div class="item market-item">
                    <div class="market-item-info">
                        <div class="market-plate-wrap">${createMiniPlate(p.number)}</div>
                        <div class="market-meta">
                            <span class="market-rarity" data-rarity="${escapeHtml(p.rarity)}">${escapeHtml(rarityNames[p.rarity] || p.rarity)}</span>
                            ${renderTags(p.tags)}
                        </div>
                    </div>
                    <div class="market-price">
                        <strong>${Number(p.price).toLocaleString("ru-RU")} 🪙</strong>
                        <button class="market-action favorite ${favorite ? "is-favorite" : ""}" data-favorite-listing="${p.listing_id}" aria-label="Избранное">${favorite ? "★" : "☆"}</button>
                        ${p.is_mine
                            ? `<button class="market-action cancel" data-cancel-listing="${p.listing_id}">СНЯТЬ</button>`
                            : `<button class="market-action" data-buy-listing="${p.listing_id}">КУПИТЬ</button>`}
                    </div>
                </div>
            `;
        }).join("")
        : '<div class="empty">Ничего не найдено. Измени фильтры или поисковый запрос.</div>';
}

function toggleMarketFavorite(id) {
    const key = String(id);
    if (marketFavorites.has(key)) marketFavorites.delete(key);
    else marketFavorites.add(key);
    try {
        localStorage.setItem("numberRushMarketFavorites", JSON.stringify([...marketFavorites]));
    } catch (_) {}
    renderMarket();
}

["market-search", "market-rarity", "market-sort"].forEach(id => {
    $(id)?.addEventListener("input", renderMarket);
    $(id)?.addEventListener("change", renderMarket);
});
$("market-favorites-only")?.addEventListener("click", () => {
    $("market-favorites-only").classList.toggle("active");
    renderMarket();
});

// =========================================================
// ДЕЙСТВИЯ НА РЫНКЕ
// =========================================================

async function marketAction(action, listingId) {
    try {
        await api(`/api/market/${listingId}/${action}`, {
            method: "POST"
        });

        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

function askMarketPrice() {
    return new Promise(resolve => {
        let value = "";
        const overlay = document.createElement("div");
        overlay.className = "price-keypad-overlay";
        overlay.innerHTML = `
            <div class="price-keypad">
                <div class="price-keypad-title">ЦЕНА НОМЕРА</div>
                <div class="price-keypad-display">0 <span>🪙</span></div>
                <div class="price-keypad-grid">
                    ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-digit="${n}">${n}</button>`).join("")}
                    <button type="button" class="keypad-clear" data-clear="1">⌫</button>
                    <button type="button" data-digit="0">0</button>
                    <button type="button" class="keypad-cancel" data-cancel="1">ОТМЕНА</button>
                </div>
                <button type="button" class="price-keypad-submit" data-submit="1">ВЫСТАВИТЬ</button>
            </div>`;
        const display = overlay.querySelector(".price-keypad-display");
        const finish = result => {
            overlay.remove();
            resolve(result);
        };
        overlay.addEventListener("click", event => {
            if (event.target === overlay || event.target.closest("[data-cancel]")) {
                finish(null);
                return;
            }
            const digit = event.target.closest("[data-digit]");
            if (digit) {
                if (value.length < 7) value += digit.dataset.digit;
                display.innerHTML = `${Number(value || 0).toLocaleString("ru-RU")} <span>🪙</span>`;
            }
            if (event.target.closest("[data-clear]")) {
                value = value.slice(0, -1);
                display.innerHTML = `${Number(value || 0).toLocaleString("ru-RU")} <span>🪙</span>`;
            }
            if (event.target.closest("[data-submit]")) {
                const price = Number(value);
                if (Number.isInteger(price) && price >= 1 && price <= 1000000) finish(price);
            }
        });
        document.body.appendChild(overlay);
    });
}

async function listPlate(plateId) {
    const price = await askMarketPrice();
    if (price === null) return;
    try {
        await api("/api/market/list", {
            method: "POST",
            body: JSON.stringify({ plate_id: plateId, price })
        });
        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

// Кнопки коллекции
async function quickSellPlate(plateId) {
    if (!confirm("Продать этот номер и убрать его из коллекции?")) return;
    try {
        const result = await api(`/api/plates/${plateId}/quick-sell`, {
            method: "POST"
        });
        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

$("items").addEventListener("click", event => {
    const quickButton = event.target.closest("[data-quick-sell]");
    const listButton = event.target.closest("[data-list-plate]");
    if (quickButton) {
        quickSellPlate(Number(quickButton.dataset.quickSell));
        return;
    }
    if (listButton) listPlate(Number(listButton.dataset.listPlate));
});

// Кнопки рынка
$("market-items").addEventListener("click", event => {
    const buyButton = event.target.closest("[data-buy-listing]");
    const cancelButton = event.target.closest("[data-cancel-listing]");

    if (buyButton) {
        marketAction("buy", Number(buyButton.dataset.buyListing));
    }

    if (cancelButton) {
        marketAction("cancel", Number(cancelButton.dataset.cancelListing));
    }
});


function renderCollection() {
    const root = $("items");
    if (!root) return;
    const query = ($("collection-search")?.value || "").trim().toLowerCase();
    const rarity = $("collection-rarity")?.value || "all";
    const sort = $("collection-sort")?.value || "newest";

    let rows = collectionCache.filter(p => {
        const matchesSearch = !query ||
            String(p.number).toLowerCase().includes(query) ||
            String(rarityNames[p.rarity] || p.rarity).toLowerCase().includes(query) ||
            (p.tags || []).some(tag => String(tag).toLowerCase().includes(query));
        const matchesRarity = rarity === "all" || p.rarity === rarity;
        return matchesSearch && matchesRarity;
    });

    if (sort === "cheap") rows.sort((a,b) => Number(a.market_value || 0) - Number(b.market_value || 0));
    if (sort === "expensive") rows.sort((a,b) => Number(b.market_value || 0) - Number(a.market_value || 0));
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:5};
        rows.sort((a,b) => (rank[b.rarity] || 0) - (rank[a.rarity] || 0));
    }
    if (sort === "newest") rows.sort((a,b) => Number(b.id) - Number(a.id));

    const count = $("collection-count");
    if (count) count.textContent = rows.length + " из " + collectionCache.length + " номеров";

    root.innerHTML = rows.length
        ? rows.map(p => `
            <div class="item collection-item">
                <div class="collection-plate-wrap">
                    ${createMiniPlate(p.number)}
                    <small>${escapeHtml(p.rarity)}</small>
                    ${renderTags(p.tags)}
                </div>
                <strong>#${p.id}</strong>
                <small class="collection-value">Оценка: ${Number(p.market_value || 0).toLocaleString("ru-RU")} 🪙</small>
                ${p.is_listed
                    ? '<span class="collection-sale-status">НА ПРОДАЖЕ</span>'
                    : `<div class="collection-actions">
                        <button class="market-action quick-sell" data-quick-sell="${p.id}">ПРОДАТЬ ЗА ${Number(p.quick_sell_price || 0).toLocaleString("ru-RU")} 🪙</button>
                        <button class="market-action" data-list-plate="${p.id}">ВЫСТАВИТЬ</button>
                      </div>`}
            </div>
        `).join("")
        : '<div class="empty">По этим фильтрам номеров нет.</div>';
}

["collection-search", "collection-rarity", "collection-sort"].forEach(id => {
    $(id)?.addEventListener("input", renderCollection);
    $(id)?.addEventListener("change", renderCollection);
});

// =========================================================
// ОБНОВЛЕНИЕ ИГРЫ
// =========================================================

function renderProfile(me) {
    const root = $("profile-content");
    if (!root) return;
    const u = tg?.initDataUnsafe?.user || {};
    const name = u.first_name ? [u.first_name, u.last_name].filter(Boolean).join(" ") : me.username;
    const avatar = u.photo_url
        ? '<img class="profile-avatar" src="' + escapeHtml(u.photo_url) + '" alt="">'
        : '<div class="profile-avatar profile-avatar-placeholder">👤</div>';
    const date = me.created_at ? new Date(me.created_at * 1000).toLocaleDateString("ru-RU") : "—";
    const rarest = me.rarest_plate ? createMiniPlate(me.rarest_plate.number) + '<small>' + escapeHtml(me.rarest_plate.rarity) + '</small>' : '<small>Пока нет номеров</small>';
    root.innerHTML = '<div class="profile-heading">' + avatar + '<div><strong>' + escapeHtml(name || "Игрок") + '</strong><small>ID: ' + escapeHtml(me.id) + '</small></div></div>' +
      '<div class="profile-stats">' +
      '<div><small>Монеты</small><b>' + Number(me.coins).toLocaleString("ru-RU") + ' 🪙</b></div>' +
      '<div><small>Номеров сейчас</small><b>' + me.collection_count + '</b></div>' +
      '<div><small>Всего спинов</small><b>' + me.total_spins + '</b></div>' +
      '<div><small>Покупки</small><b>' + me.purchases_count + '</b></div>' +
      '<div><small>Продажи</small><b>' + me.sales_count + '</b></div>' +
      '<div><small>В игре с</small><b>' + date + '</b></div></div>' +
      '<div class="profile-rarest"><small>Самый редкий номер</small><div class="profile-rarest-plate">' + rarest + '</div></div>';
}
function renderDailyStreak(data) {
    const root = $("daily-streak");
    if (!root) return;
    const rewards = data.rewards || [100, 150, 200, 250, 300, 350, 500];
    const nextDay = Number(data.next_day || 1);
    const claimed = Boolean(data.claimed_today);
    root.innerHTML = `
        <div class="streak-card">
            <div class="streak-heading">
                <div>
                    <strong>🔥 Серия ежедневных входов</strong>
                    <p>Заходи каждый день и забирай всё больше монет. Пропуск дня обнулит серию.</p>
                </div>
                <span class="streak-count">${Number(data.streak || 0)} дн.</span>
            </div>
            <div class="streak-rewards">
                ${rewards.map((reward, index) => `
                    <div class="streak-day ${claimed && index + 1 === Number(data.streak) % 7 || claimed && Number(data.streak) % 7 === 0 && index === 6 ? "is-earned" : ""} ${!claimed && index + 1 === nextDay ? "is-next" : ""}">
                        <small>ДЕНЬ ${index + 1}</small>
                        <b>+${Number(reward).toLocaleString("ru-RU")}</b>
                        <span>🪙</span>
                    </div>
                `).join("")}
            </div>
            <button class="daily-task-claim streak-claim" id="claim-daily-streak" ${claimed ? "disabled" : ""}>
                ${claimed ? "НАГРАДА СЕГОДНЯ ПОЛУЧЕНА" : "ЗАБРАТЬ +" + Number(data.reward).toLocaleString("ru-RU") + " 🪙"}
            </button>
            <small class="streak-footnote">${claimed ? "Возвращайся завтра за следующей наградой." : "Награда доступна один раз в день."}</small>
        </div>
    `;
    const button = $("claim-daily-streak");
    button?.addEventListener("click", async () => {
        button.disabled = true;
        try {
            await api("/api/daily-streak/claim", { method: "POST" });
            await refresh();
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    });
}

function renderDailyTasks(data) {
    const root = $("daily-task-list");
    if (!root) return;
    const readyCount = (data.tasks || []).filter(task => task.completed && !task.claimed).length;
    const badge = $("daily-task-badge");
    if (badge) {
        badge.textContent = readyCount > 9 ? "9+" : String(readyCount);
        badge.hidden = readyCount === 0;
    }
    root.innerHTML = (data.tasks || []).map(task => {
        const progress = Math.min(Number(task.progress || 0), Number(task.target || 1));
        const percent = Math.round(progress / Math.max(1, Number(task.target)) * 100);
        return `
            <article class="daily-task-card ${task.completed ? "is-completed" : ""} ${task.claimed ? "is-claimed" : ""}">
                <div class="daily-task-top">
                    <div>
                        <strong>${escapeHtml(task.title)}</strong>
                        <p>${escapeHtml(task.description)}</p>
                    </div>
                    <span class="daily-task-reward">+${Number(task.reward).toLocaleString("ru-RU")} 🪙</span>
                </div>
                <div class="daily-task-progress"><span style="width:${percent}%"></span></div>
                <div class="daily-task-bottom">
                    <small>${progress} / ${task.target}</small>
                    <b>${task.claimed ? "НАГРАДА ПОЛУЧЕНА" : task.completed ? "ГОТОВО К ПОЛУЧЕНИЮ" : progress > 0 ? "В ПРОЦЕССЕ" : "НЕ НАЧАТО"}</b>
                </div>
                ${task.completed && !task.claimed ? `<button class="daily-task-claim" data-claim-task="${escapeHtml(task.key)}">ЗАБРАТЬ НАГРАДУ</button>` : ""}
            </article>
        `;
    }).join("");
}

async function claimDailyTask(taskKey, button) {
    if (button) button.disabled = true;
    try {
        await api(`/api/daily-tasks/${encodeURIComponent(taskKey)}/claim`, { method: "POST" });
        await refresh();
    } catch (e) {
        alert(e.message);
        if (button) button.disabled = false;
    }
}

$("daily-task-list")?.addEventListener("click", event => {
    const button = event.target.closest("[data-claim-task]");
    if (button) claimDailyTask(button.dataset.claimTask, button);
});


function renderAchievements(data) {
    const root = $("achievement-list");
    if (!root) return;

    const achievements = data.achievements || [];
    const readyCount = achievements.filter(item => item.completed && !item.claimed).length;
    const badge = $("achievement-badge");
    if (badge) {
        badge.textContent = readyCount > 9 ? "9+" : String(readyCount);
        badge.hidden = readyCount === 0;
    }

    root.innerHTML = achievements.map(item => {
        const progress = Math.min(Number(item.progress || 0), Number(item.target || 1));
        const percent = Math.round(progress / Math.max(1, Number(item.target)) * 100);
        return `
            <article class="daily-task-card achievement-card ${item.completed ? "is-completed" : ""} ${item.claimed ? "is-claimed" : ""}">
                <div class="daily-task-top">
                    <div>
                        <strong>🏆 ${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.description)}</p>
                    </div>
                    <span class="daily-task-reward">+${Number(item.reward).toLocaleString("ru-RU")} 🪙</span>
                </div>
                <div class="daily-task-progress"><span style="width:${percent}%"></span></div>
                <div class="daily-task-bottom">
                    <small>${progress.toLocaleString("ru-RU")} / ${Number(item.target).toLocaleString("ru-RU")}</small>
                    <b>${item.claimed ? "НАГРАДА ПОЛУЧЕНА" : item.completed ? "ГОТОВО К ПОЛУЧЕНИЮ" : progress > 0 ? "В ПРОЦЕССЕ" : "НЕ НАЧАТО"}</b>
                </div>
                ${item.completed && !item.claimed ? `<button class="daily-task-claim" data-claim-achievement="${escapeHtml(item.key)}">ЗАБРАТЬ НАГРАДУ</button>` : ""}
            </article>
        `;
    }).join("");
}

async function claimAchievement(key, button) {
    if (button) button.disabled = true;
    try {
        await api(`/api/achievements/${encodeURIComponent(key)}/claim`, { method: "POST" });
        await refresh();
    } catch (e) {
        alert(e.message);
        if (button) button.disabled = false;
    }
}

$("achievement-list")?.addEventListener("click", event => {
    const button = event.target.closest("[data-claim-achievement]");
    if (button) claimAchievement(button.dataset.claimAchievement, button);
});


function renderShop(packages) {
    const root = $("shop-packages");
    if (!root) return;
    root.innerHTML = (packages || []).map(pack => `
        <article class="shop-package">
            <div class="shop-package-icon">🪙</div>
            <strong>${Number(pack.coins).toLocaleString("ru-RU")} монет</strong>
            <span class="shop-package-price">⭐ ${Number(pack.stars)} Stars</span>
            <button class="shop-buy-button" data-buy-package="${escapeHtml(pack.id)}">КУПИТЬ ЗА STARS</button>
        </article>
    `).join("");
}

async function buyStarPackage(packageId, button) {
    if (!tg || typeof tg.openInvoice !== "function") {
        alert("Покупка Stars доступна только внутри Telegram.");
        return;
    }
    button.disabled = true;
    try {
        const invoice = await api(`/api/shop/${encodeURIComponent(packageId)}/invoice`, { method: "POST" });
        tg.openInvoice(invoice.invoice_url, async status => {
            if (status === "paid") {
                alert("Оплата принята! Монеты скоро появятся на балансе.");
                await refresh();
            } else if (status === "failed") {
                alert("Не удалось провести оплату. Попробуй ещё раз.");
            }
            button.disabled = false;
        });
    } catch (error) {
        alert(error.message);
        button.disabled = false;
    }
}

$("shop-packages")?.addEventListener("click", event => {
    const button = event.target.closest("[data-buy-package]");
    if (button) buyStarPackage(button.dataset.buyPackage, button);
});

async function refresh() {
    const me = await api("/api/me");
    renderProfile(me);

    freeSpinSeconds = Number(me.free_spin_seconds ?? 0);

    if (freeSpinTimer) {
        clearInterval(freeSpinTimer);
    }

    updateFreeSpinTimer();
    freeSpinTimer = setInterval(updateFreeSpinTimer, 1000);

    const coinsElement = $("coins");
    const spinsElement = $("spins");

    if (coinsElement) {
        coinsElement.textContent =
            Number(me.coins).toLocaleString("ru-RU");
    }

    if (spinsElement) {
        spinsElement.textContent = me.spins;
    }

   
    // КОЛЛЕКЦИЯ
    collectionCache = await api("/api/collection");
    renderCollection();

    // РЫНОК
    marketCache = await api("/api/market");
    renderMarket();

    const dailyStreak = await api("/api/daily-streak");
    renderDailyStreak(dailyStreak);

    const dailyTasks = await api("/api/daily-tasks");
    renderDailyTasks(dailyTasks);

    const achievements = await api("/api/achievements");
    renderAchievements(achievements);

    const shopPackages = await api("/api/shop");
    renderShop(shopPackages);
}

// =========================================================
// КНОПКА СПИНА
// =========================================================

async function runSpin(useFree) {
    const spinButton = $("spin");
    const freeButton = $("free-spin-button");
    spinButton.disabled = true;
    freeButton.disabled = true;
    $("hint").textContent = "🎰 Барабаны вращаются...";

    try {
        const result = await api(useFree ? "/api/spin?free=true" : "/api/spin", {
            method: "POST"
        });

        const coinsElement = $("coins");
        const spinsElement = $("spins");
        if (coinsElement) coinsElement.textContent = Number(result.coins).toLocaleString("ru-RU");
        if (spinsElement) spinsElement.textContent = result.spins;

        await animatePlate(result.plate.number, result.plate.rarity);
        await refresh();

        const rarityText = rarityNames[result.plate.rarity] || result.plate.rarity.toUpperCase();
        const tags = result.plate.tags || [];
        let message = rarityText;
        if (tags.length > 0) message += " • " + tags.join(" • ");
        $("rarity").textContent = message;
        $("hint").textContent = tags.length > 0 ? "✨ " + tags.join(" • ") : "Номер добавлен в коллекцию!";
    } catch (e) {
        $("hint").textContent = e.message;
        await refresh().catch(() => {});
    } finally {
        spinButton.disabled = false;
        updateFreeSpinTimer();
    }
}

$("spin").addEventListener("click", () => runSpin(false));
$("free-spin-button").addEventListener("click", () => runSpin(true));


// =========================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =========================================================

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b =>
            b.classList.toggle("active", b === btn)
        );

        ["collection", "market", "daily-tasks", "achievements", "shop", "profile"].forEach(id => {
            $(id).classList.toggle("hidden", btn.dataset.tab !== id);
        });
    });
});


// =========================================================
// ПЕРВАЯ ЗАГРУЗКА
// =========================================================

refresh().catch(e => {
    if ($("items")) {
        $("items").textContent = e.message;
    }

    if ($("hint")) {
        $("hint").textContent = e.message;
    }
});
