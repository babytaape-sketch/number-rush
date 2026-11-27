
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

// Лёгкий тактильный отклик только после настоящего нажатия.
// Событие click не срабатывает при обычном свайпе/прокрутке.
document.addEventListener("click", event => {
    const target = event.target?.closest(
        "button, [role='button'], .market-item, .collection-item, .achievement-card, .daily-task-card, .shop-package"
    );
    if (!target || target.disabled || target.id === "spin" || target.id === "free-spin-button" || !tg?.HapticFeedback) return;

    try {
        tg.HapticFeedback.impactOccurred("light");
    } catch (_) {
        // Haptic feedback недоступен на некоторых клиентах Telegram.
    }
});

// Вибрация привязана к фактическому прохождению символом очередной позиции.
let lastSlotHapticAt = 0;

function slotStepHaptic(progress) {
    const now = performance.now();
    if (now - lastSlotHapticAt < 48) return;
    lastSlotHapticAt = now;
    try {
        tg?.HapticFeedback?.impactOccurred(progress > 0.82 ? "light" : "soft");
    } catch (_) {}
}

function spinHaptic(useFree) {
    try {
        tg?.HapticFeedback?.impactOccurred(useFree ? "medium" : "heavy");
    } catch (_) {}
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

function formatRubles(value) {
    const amount = Math.floor(Math.abs(Number(value) || 0));
    const lastTwo = amount % 100;
    const last = amount % 10;
    const word = lastTwo >= 11 && lastTwo <= 14 ? "рублей"
        : last === 1 ? "рубль"
        : last >= 2 && last <= 4 ? "рубля"
        : "рублей";
    return amount.toLocaleString("ru-RU") + " " + word;
}

const plateLetters = "АВЕКМНОРСТУХ";
const plateDigits = "0123456789";

const rarityColors = {
    Common: "#b9c3d0",
    Uncommon: "#36d477",
    Rare: "#3294ff",
    Epic: "#ae63ff",
    Legendary: "#ffc247",
};

const rarityNames = {
    Common: "ОБЫЧНЫЙ",
    Uncommon: "НЕОБЫЧНЫЙ",
    Rare: "РЕДКИЙ",
    Epic: "ЭПИЧЕСКИЙ",
    Legendary: "ЛЕГЕНДАРНЫЙ",
    Mythic: "ЛЕГЕНДАРНЫЙ"
};

function setRarityEffect(rarity) {
    const plate = $("plate");
    const rarityLabel = $("rarity");
    const color = rarityColors[rarity] || rarityColors.Common;

    if (!plate || !rarityLabel) return;

    plate.style.setProperty("--rarity-color", color);
    plate.dataset.rarity = rarity;

    if (typeof plate.animate === "function") {
        plate.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }],
            { duration: 420, easing: "ease-out" }
        );
    }

    rarityLabel.style.color = color;
    rarityLabel.classList.remove(
        "rarity-reveal-common", "rarity-reveal-uncommon", "rarity-reveal-rare",
        "rarity-reveal-epic", "rarity-reveal-legendary"
    );
    const rarityClass = ["Common", "Uncommon", "Rare", "Epic", "Legendary"].includes(rarity)
        ? rarity.toLowerCase() : "common";
    rarityLabel.classList.add("rarity-reveal-" + rarityClass);
    rarityLabel.textContent = rarityNames[rarity] || rarity.toUpperCase();
}

function renderPlateAnalysis(analysis) {
    if (!analysis || !analysis.supported) return "";

    const items = [];
    const add = (label, values) => {
        if (!Array.isArray(values) || !values.length) return;
        const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
        if (unique.length) items.push(
            `<p><b>${escapeHtml(label)}:</b> ${unique.map(escapeHtml).join(" · ")}</p>`
        );
    };

    const regionName = String(analysis.region || "").trim();
    const regionCode = String(analysis.region_code || "").trim();
    if (regionName || regionCode) {
        items.push(`<p><b>Регион:</b> ${escapeHtml(regionName || regionCode)}${regionName && regionCode ? ` (${escapeHtml(regionCode)})` : ""}</p>`);
    }

    add("Цифры", analysis.digit_patterns);
    add("Буквы", analysis.letter_patterns);

    if (analysis.lexical && analysis.lexical.reading) {
        const meaning = String(analysis.lexical.meaning || "").trim();
        items.push(`<p><b>Читается:</b> ${escapeHtml(analysis.lexical.reading)}${meaning ? ` — ${escapeHtml(meaning)}` : ""}</p>`);
    }

    const history = (analysis.historical_associations || [])
        .map(item => String(item.association || "").trim())
        .filter(Boolean);
    add("Серия", history);

    const marketLabel = category => {
        if (category === "three_identical_digits") return "Тройные цифры";
        if (category === "three_identical_letters") return "Тройные буквы";
        if (category === "mirror_digits") return "Зеркальные цифры";
        if (category === "round_hundreds") return "Круглая сотня";
        if (category === "first_decade_001_010") return "Число из первой десятки";
        if (category === "word_KOT") return "Читаемое слово «КОТ»";
        if (category.endsWith("_digits")) return "Рыночная комбинация " + category.slice(0, -7);
        if (category.endsWith("_letters")) return "Рыночная серия " + category.slice(0, -8);
        return "";
    };
    if (!items.length) return "";
    return `
        <details class="plate-analysis">
            <summary>Описание номера</summary>
            <div class="plate-analysis-content">
                ${items.join("")}
            </div>
        </details>
    `;
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
    const fontSize = parseFloat(getComputedStyle(element).fontSize) || 36;
    const symbolHeight = fontSize;

    const strip = document.createElement("span");
    strip.className = "slot-strip";

    const windowElement = document.createElement("span");
    windowElement.className = "slot-window";
    windowElement.style.height = `${symbolHeight}px`;
    windowElement.style.overflow = "hidden";

    const totalSymbols = options.totalSymbols || 10;
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
    strip.style.transform = "translate3d(0, 0, 0)";
    strip.style.willChange = "transform";

    if (delay) await sleep(delay);

    const distance = totalSymbols * symbolHeight;
    const start = performance.now();
    let lastCrossedSymbol = 0;

    await new Promise(resolve => {
        function frame(now) {
            const elapsed = Math.min(1, (now - start) / duration);
            const fastPhaseEnd = 0.68;
            const fastDistance = 0.82;
            let progress;

            if (elapsed <= fastPhaseEnd) {
                progress = (elapsed / fastPhaseEnd) * fastDistance;
            } else {
                const brakeProgress = (elapsed - fastPhaseEnd) / (1 - fastPhaseEnd);
                progress = fastDistance + (1 - fastDistance) *
                    (1 - Math.pow(1 - brakeProgress, 2));
            }

            strip.style.transform = `translate3d(0, -${distance * progress}px, 0)`;

            const crossedSymbol = Math.min(
                totalSymbols,
                Math.floor(progress * totalSymbols + 0.0001)
            );
            if (crossedSymbol > lastCrossedSymbol) {
                slotStepHaptic(elapsed);
                lastCrossedSymbol = crossedSymbol;
            }

            if (elapsed < 1) {
                requestAnimationFrame(frame);
            } else {
                strip.style.transform = `translate3d(0, -${distance}px, 0)`;
                resolve();
            }
        }
        requestAnimationFrame(frame);
    });

    strip.style.willChange = "auto";
    element.textContent = finalChar;
}

function chooseSpinMood() {
    const roll = Math.random();
    if (roll < 0.01) return "cinematic";
    if (roll < 0.07) return "showtime";
    if (roll < 0.25) return "suspense";
    return "normal";
}

function isBeautifulPlate(number) {
    const main = String(number).trim().split(/\s+/)[0] || "";
    const digits = main.replace(/[А-ЯЁ]/g, "");
    if (digits.length < 3) return false;

    if (/^(\d)\1+$/.test(digits)) return true;
    if (/012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210/.test(digits)) return true;
    if (digits.length >= 4 && digits === digits.split("").reverse().join("")) return true;
    return false;
}

async function animatePlate(finalPlate, rarity, mood = "normal") {
    const main = document.querySelector(".plate-main");
    const region = document.querySelector(".region-code");
    const plate = $("plate");
    if (!main || !region) return;

    if (plate) {
        plate.classList.remove("spin-reveal", "spin-active", "spin-rarity-common", "spin-rarity-uncommon", "spin-rarity-rare", "spin-rarity-epic", "spin-rarity-legendary");
        void plate.offsetWidth;
        plate.classList.add("spin-active");
    }

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

    // Сначала останавливается регион.
    await Promise.all(regionSlots.map((slot, index) =>
        rollSlot(slot, regionChars[index], { duration: 2100, totalSymbols: 19 })
    ));

    const rarityLevel = {
        Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 4
    }[rarity] ?? 0;

    const moodScale = mood === "cinematic" ? 1.12
        : mood === "showtime" ? 1.08
        : mood === "suspense" ? 1.04 : 1;
    const baseDuration = (2200 + rarityLevel * 140) * moodScale;
    const stopInterval = (260 + rarityLevel * 25) * moodScale;
    const regularDurations = mainSlots.map((_, index) =>
        baseDuration + index * stopInterval
    );
    const latestRegularStop = Math.max(...regularDurations);

    // Два разных случайных разряда выбираются при каждом спине.
    const lateIndexes = [];
    while (lateIndexes.length < Math.min(2, mainSlots.length)) {
        const candidate = Math.floor(Math.random() * mainSlots.length);
        if (!lateIndexes.includes(candidate)) lateIndexes.push(candidate);
    }
    const moodPause = mood === "cinematic" ? 900
        : mood === "showtime" ? 600
        : mood === "suspense" ? 320 : 0;
    const beautiful = isBeautifulPlate(finalPlate);
    if (plate) {
        plate.classList.remove("spin-mood-suspense", "spin-mood-showtime", "spin-mood-cinematic", "spin-beautiful");
        if (mood !== "normal") plate.classList.add("spin-mood-" + mood);
        if (beautiful) plate.classList.add("spin-beautiful");
    }
    const lateDurations = new Map([
        [lateIndexes[0], latestRegularStop + 1900 + rarityLevel * 180],
        [lateIndexes[1], latestRegularStop + 3400 + rarityLevel * 220]
    ]);

    // Эти два случайных символа гарантированно остановятся последними.
    await Promise.all(mainSlots.map((slot, index) =>
        rollSlot(slot, mainChars[index], {
            duration: lateDurations.get(index) || regularDurations[index],
            delay: index === lateIndexes[1] ? moodPause : 0,
            totalSymbols: 19
        })
    ));

    setRarityEffect(rarity);
    const rarityClass = "spin-rarity-" + (["Common", "Uncommon", "Rare", "Epic", "Legendary"].includes(rarity) ? rarity.toLowerCase() : "common");
    if (plate) {
        plate.classList.remove("spin-active");
        plate.classList.add("spin-reveal", rarityClass);
        plate.classList.remove("spin-mood-suspense", "spin-mood-showtime", "spin-mood-cinematic", "spin-beautiful");
        if (mood === "cinematic" || beautiful) {
            try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
        }
    }
    const revealDuration = rarity === "Legendary" ? 2600
        : rarity === "Epic" ? 2100
        : rarity === "Rare" ? 1250
        : rarity === "Uncommon" ? 950 : 750;
    // Возвращаем кнопку генерации на секунду раньше после раскрытия номера.
    await sleep(Math.max(0, Math.max(
        revealDuration,
        mood === "cinematic" ? 1050 : mood === "showtime" ? 850 : 650
    ) - 1000));
    if (plate) plate.classList.remove("spin-reveal", rarityClass);
}

// =========================================================
// БЕСПЛАТНЫЕ ПРОКРУТКИ
// =========================================================

let freeSpinTimer = null;
let freeSpinSeconds = 0;
let bonusSpinProgress = 0;
let bonusSpinsPending = 0;
let currentCoins = 0;
let spinInProgress = false;

function updateSpinAvailability() {
    const button = $("spin");
    const notice = $("spin-cost-notice");
    const insufficient = currentCoins < 1000;
    if (button) button.disabled = spinInProgress || insufficient;
    if (notice) notice.hidden = !insufficient;
}

function updateFreeSpinTimer() {
    const button = $("free-spin-button");
    if (!button) return;

    if (spinInProgress) {
        button.disabled = true;
        return;
    }

    const bonusPending = Number(bonusSpinsPending || 0);
    const bonusProgress = Number(bonusSpinProgress || 0);
    const dailyReady = freeSpinSeconds <= 0;
    const available = bonusPending + (dailyReady ? 1 : 0);

    if (available > 0) {
        button.textContent = available > 1
            ? `🎁 ЗАБРАТЬ ${available} БЕСПЛАТНЫХ СПИНА`
            : (bonusPending > 0
                ? "🎰 БОНУСНЫЙ СПИН ГОТОВ"
                : "🎁 БЕСПЛАТНЫЙ СПИН");
        button.disabled = false;
        return;
    }

    button.disabled = true;
    const hours = Math.floor(freeSpinSeconds / 3600);
    const minutes = Math.floor((freeSpinSeconds % 3600) / 60);
    const seconds = freeSpinSeconds % 60;
    button.textContent = `🎁 ${bonusProgress}/20 · ${hours}ч ${minutes}м ${seconds}с`;
    freeSpinSeconds = Math.max(0, freeSpinSeconds - 1);
}


// =========================================================
// МИНИАТЮРА НОМЕРА
// =========================================================

function createMiniPlate(number, rarity = "Common") {
    const parts = String(number).split(" ");
    const main = parts[0] || "";
    const region = parts[1] || "";

    return `
        <div class="mini-plate" data-rarity="${escapeHtml(rarity)}">
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
        const matchesRarity = rarity === "all" || p.rarity === rarity || (rarity === "Legendary" && p.rarity === "Mythic");
        const matchesFavorite = !favoritesOnly || marketFavorites.has(String(p.listing_id));
        return matchesSearch && matchesRarity && matchesFavorite;
    });

    if (sort === "cheap") rows.sort((a,b) => a.price - b.price);
    if (sort === "expensive") rows.sort((a,b) => b.price - a.price);
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:4};
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
                        <div class="market-plate-wrap">${createMiniPlate(p.number, p.rarity)}</div>
                        <div class="market-meta">
                            <span class="market-rarity" data-rarity="${escapeHtml(p.rarity)}">${escapeHtml(rarityNames[p.rarity] || p.rarity)}</span>
                            ${renderTags(p.tags)}
                            ${renderPlateAnalysis(p.analysis)}
                        </div>
                    </div>
                    <div class="market-price">
                        <strong>${formatRubles(p.price)}</strong>
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
                <div class="price-keypad-display">${formatRubles(0)}</div>
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
                if (value.length < 8) value += digit.dataset.digit;
                display.innerHTML = `${formatRubles(value || 0)}`;
            }
            if (event.target.closest("[data-clear]")) {
                value = value.slice(0, -1);
                display.innerHTML = `${formatRubles(value || 0)}`;
            }
            if (event.target.closest("[data-submit]")) {
                const price = Number(value);
                if (Number.isInteger(price) && price >= 1 && price <= 10000000) finish(price);
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
        const matchesRarity = rarity === "all" || p.rarity === rarity || (rarity === "Legendary" && p.rarity === "Mythic");
        return matchesSearch && matchesRarity;
    });

    if (sort === "cheap") rows.sort((a,b) => Number(a.market_value || 0) - Number(b.market_value || 0));
    if (sort === "expensive") rows.sort((a,b) => Number(b.market_value || 0) - Number(a.market_value || 0));
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:4};
        rows.sort((a,b) => (rank[b.rarity] || 0) - (rank[a.rarity] || 0));
    }
    if (sort === "newest") rows.sort((a,b) => Number(b.id) - Number(a.id));

    const count = $("collection-count");
    if (count) count.textContent = rows.length + " из " + collectionCache.length + " номеров";

    root.innerHTML = rows.length
        ? rows.map(p => `
            <div class="item collection-item">
                <div class="collection-plate-wrap">
                    ${createMiniPlate(p.number, p.rarity)}
                    <small>${escapeHtml(rarityNames[p.rarity] || p.rarity)}</small>
                    ${renderTags(p.tags)}
                    ${renderPlateAnalysis(p.analysis)}
                </div>
                <small class="collection-value">Оценка: ${formatRubles(p.market_value || 0)}</small>
                ${p.is_listed
                    ? '<span class="collection-sale-status">НА ПРОДАЖЕ</span>'
                    : `<div class="collection-actions">
                        <button class="market-action quick-sell" data-quick-sell="${p.id}">ПРОДАТЬ ЗА ${formatRubles(p.quick_sell_price || 0)}</button>
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
    const rarest = me.rarest_plate ? createMiniPlate(me.rarest_plate.number) + '<small>' + escapeHtml(rarityNames[me.rarest_plate.rarity] || me.rarest_plate.rarity) + '</small>' : '<small>Пока нет номеров</small>';
    root.innerHTML = '<div class="profile-heading">' + avatar + '<div><strong>' + escapeHtml(name || "Игрок") + '</strong><small>ID: ' + escapeHtml(me.id) + '</small></div></div>' +
      '<div class="profile-stats">' +
      '<div><small>Баланс</small><b>' + formatRubles(me.coins) + '</b></div>' +
      '<div><small>Номеров сейчас</small><b>' + me.collection_count + '</b></div>' +
      '<div><small>Всего спинов</small><b>' + me.total_spins + '</b></div>' +
      '<div><small>Покупки</small><b>' + me.purchases_count + '</b></div>' +
      '<div><small>Продажи</small><b>' + me.sales_count + '</b></div>' +
      '<div><small>В игре с</small><b>' + date + '</b></div></div>' +
      '<div class="profile-rarest"><small>Самый редкий номер</small><div class="profile-rarest-plate">' + rarest + '</div></div>';
}
let dailyStreakBonusReady = false;

function renderDailyStreak(data) {
    const root = $("daily-streak");
    if (!root) return;
    const rewards = data.rewards || [1000, 1500, 2000, 2500, 3000, 3500, 5000];
    const nextDay = Number(data.next_day || 1);
    const claimed = Boolean(data.claimed_today);
    dailyStreakBonusReady = !claimed;
    root.innerHTML = `
        <div class="streak-card">
            <div class="streak-heading">
                <div>
                    <strong>🔥 Серия ежедневных входов</strong>
                    <p>Заходи каждый день и получай всё больше рублей. Пропуск дня обнулит серию.</p>
                </div>
                <span class="streak-count">${Number(data.streak || 0)} дн.</span>
            </div>
            <div class="streak-rewards">
                ${rewards.map((reward, index) => `
                    <div class="streak-day ${claimed && index + 1 === Number(data.streak) % 7 || claimed && Number(data.streak) % 7 === 0 && index === 6 ? "is-earned" : ""} ${!claimed && index + 1 === nextDay ? "is-next" : ""}">
                        <small>ДЕНЬ ${index + 1}</small>
                        <b>+${formatRubles(reward)}</b>
                    </div>
                `).join("")}
            </div>
            <button class="daily-task-claim streak-claim" id="claim-daily-streak" ${claimed ? "disabled" : ""}>
                ${claimed ? "НАГРАДА СЕГОДНЯ ПОЛУЧЕНА" : "ЗАБРАТЬ +" + formatRubles(data.reward)}
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
    const notificationCount = readyCount + (dailyStreakBonusReady ? 1 : 0);
    const badge = $("daily-task-badge");
    if (badge) {
        badge.textContent = notificationCount > 9 ? "9+" : String(notificationCount);
        badge.hidden = notificationCount === 0;
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
                    <span class="daily-task-reward">+${formatRubles(task.reward)}</span>
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
                    <span class="daily-task-reward">+${formatRubles(item.reward)}</span>
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
    const rublesRoot = $("shop-packages");
    const platesRoot = $("shop-plate-packages");
    if (!rublesRoot || !platesRoot) return;

    const rublePackages = (packages || []).filter(pack => pack.type !== "plate");
    const platePackages = (packages || []).filter(pack => pack.type === "plate");

    rublesRoot.innerHTML = rublePackages.map((pack, index) => `
        <article class="shop-package shop-ruble-card">
            <div class="shop-ruble-art" aria-hidden="true"><span>${index === 0 ? "₽" : index === 1 ? "₽₽" : "₽₽₽"}</span></div>
            <strong>${formatRubles(pack.coins)}</strong>
            <span class="shop-package-price">⭐ ${Number(pack.stars)} Stars</span>
            <button class="shop-buy-button" data-buy-package="${escapeHtml(pack.id)}">КУПИТЬ</button>
        </article>
    `).join("");

    platesRoot.innerHTML = platePackages.map(pack => {
        const title = "ЛЕГЕНДАРНЫЙ";
        const plateLetters = "А777МР";
        const region = "77";
        return `
            <article class="shop-plate-card is-legendary">
                <div class="shop-plate-copy">
                    <span class="shop-rarity-label">◆ ЛЕГЕНДАРНАЯ СЕРИЯ</span>
                    <h4>${title} НОМЕР</h4>
                    <p>Гарантированная редкость</p>
                    <div class="shop-plate-price">⭐ <b>${Number(pack.stars)} Stars</b></div>
                    <button class="shop-buy-button" data-buy-package="${escapeHtml(pack.id)}">КУПИТЬ НОМЕР</button>
                </div>
                <div class="shop-plate-visual" aria-label="Пример российского номерного знака">
                    <div class="shop-real-plate">${createMiniPlate(`${plateLetters} ${region}`)}</div>
                    <span class="shop-plate-caption">ПРИМЕР НОМЕРА</span>
                </div>
            </article>
        `;
    }).join("");
}

$("shop")?.addEventListener("click", event => {
    const tab = event.target.closest("[data-shop-view]");
    if (tab) {
        const view = tab.dataset.shopView;
        document.querySelectorAll("[data-shop-view]").forEach(button => {
            const active = button === tab;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        });
        $("shop-rubles-view")?.classList.toggle("hidden", view !== "rubles");
        $("shop-plates-view")?.classList.toggle("hidden", view !== "plates");
        return;
    }
    const buyButton = event.target.closest("[data-buy-package]");
    if (buyButton) buyStarPackage(buyButton.dataset.buyPackage, buyButton);
});

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
                alert("Оплата принята! Покупка будет добавлена в игру после обработки платежа.");
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

function renderLeaderboard(data) {
    const root = $("leaderboard-content");
    if (!root) return;

    const renderTable = (title, ranking, suffix, icon) => {
        const mine = ranking?.my_rank;
        const rows = ranking?.top || [];
        return `
            <section class="leaderboard-section">
                <h3>${icon} ${title}</h3>
                ${mine ? `<div class="leaderboard-me"><strong>ТВОЁ МЕСТО</strong><b>№${mine.rank}</b><small>${Number(mine.value).toLocaleString("ru-RU")} ${suffix}</small></div>` : ""}
                <div class="leaderboard-list">
                    ${rows.map(player => {
                        const place = player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : player.rank === 3 ? "🥉" : `#${player.rank}`;
                        return `
                            <article class="leaderboard-player ${player.is_me ? "is-me" : ""}">
                                <span class="leaderboard-place">${place}</span>
                                <strong class="leaderboard-name">${escapeHtml(player.username || "Player")}${player.is_me ? " · Вы" : ""}</strong>
                                <b class="leaderboard-score">${Number(player.value).toLocaleString("ru-RU")} <small>${suffix}</small></b>
                            </article>
                        `;
                    }).join("") || '<p class="daily-tasks-note">Пока здесь никого нет.</p>'}
                </div>
            </section>
        `;
    };

    root.innerHTML =
        renderTable("По балансу", data.money, "руб.", "💰") +
        renderTable("По прокруткам", data.spins, "спинов", "🎰");
}

async function refresh() {
    const me = await api("/api/me");
    renderProfile(me);

    freeSpinSeconds = Number(me.free_spin_seconds ?? 0);
    bonusSpinProgress = Number(me.bonus_spin_progress ?? 0);
    bonusSpinsPending = Number(me.bonus_spins_pending ?? 0);
    currentCoins = Number(me.coins ?? 0);
    updateSpinAvailability();

    if (freeSpinTimer) {
        clearInterval(freeSpinTimer);
    }

    updateFreeSpinTimer();
    freeSpinTimer = setInterval(updateFreeSpinTimer, 1000);

    const coinsElement = $("coins");
    const spinsElement = $("spins");

    if (coinsElement) {
        coinsElement.textContent = formatRubles(me.coins);
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

    const leaderboard = await api("/api/leaderboard");
    renderLeaderboard(leaderboard);

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

async function runSpin(spinType = "paid") {
    const useFree = spinType === "daily" || spinType === "bonus";
    if (spinInProgress) return;
    spinInProgress = true;
    spinHaptic(useFree);
    const spinButton = $("spin");
    const freeButton = $("free-spin-button");
    updateSpinAvailability();
    updateFreeSpinTimer();
    if (spinButton) spinButton.disabled = true;
    if (freeButton) freeButton.disabled = true;
    if ($("hint")) $("hint").textContent = "🎰 Барабаны вращаются...";

    try {
        const spinUrl = spinType === "daily" ? "/api/spin?free=true" : spinType === "bonus" ? "/api/spin?bonus=true" : "/api/spin";
        const result = await api(spinUrl, {
            method: "POST"
        });

        const coinsElement = $("coins");
        const spinsElement = $("spins");
        currentCoins = Number(result.coins ?? currentCoins);
        updateSpinAvailability();
        if (coinsElement) coinsElement.textContent = formatRubles(result.coins);
        if (spinsElement) spinsElement.textContent = result.spins;

        const spinMood = chooseSpinMood();
        await animatePlate(result.plate.number, result.plate.rarity, spinMood);
        await refresh();

        const rarityText = rarityNames[result.plate.rarity] || result.plate.rarity.toUpperCase();
        const tags = result.plate.tags || [];
        const analysisRoot = $("plate-analysis");
        if (analysisRoot) analysisRoot.innerHTML = renderPlateAnalysis(result.plate_analysis);
        let message = rarityText;
        if (tags.length > 0) message += " • " + tags.join(" • ");
        $("rarity").textContent = message;
        if ($("hint")) $("hint").textContent = tags.length > 0 ? "✨ " + tags.join(" • ") : "Номер добавлен в коллекцию!";
    } catch (e) {
        if ($("hint")) $("hint").textContent = e.message;
        await refresh().catch(() => {});
    } finally {
        spinInProgress = false;
        updateSpinAvailability();
        updateFreeSpinTimer();
    }
}

$("spin").addEventListener("click", () => runSpin(false));
$("free-spin-button").addEventListener("click", () => {
    if (bonusSpinsPending > 0) runSpin("bonus");
    else if (freeSpinSeconds <= 0) runSpin("daily");
});


// =========================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =========================================================

const moreToggle = $("more-toggle");
const moreNav = $("more-nav");

if (moreToggle && moreNav) {
    moreToggle.addEventListener("click", () => {
        const isOpen = moreNav.classList.toggle("hidden") === false;
        moreToggle.setAttribute("aria-expanded", String(isOpen));
        moreToggle.classList.toggle("active", isOpen);
    });
}

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
        ["collection", "market", "garage", "leaderboard", "daily-tasks", "achievements", "shop", "profile"].forEach(id => {
            const panel = $(id);
            if (panel) panel.classList.toggle("hidden", btn.dataset.tab !== id);
        });
        if (moreNav) moreNav.classList.add("hidden");
        if (moreToggle) {
            moreToggle.setAttribute("aria-expanded", "false");
            moreToggle.classList.remove("active");
        }
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
        if ($("hint")) $("hint").textContent = e.message;
    }
});
