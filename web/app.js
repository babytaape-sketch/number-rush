
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#080b10");
    tg.setBackgroundColor("#080b10");
}

const initData = tg?.initData || "";
const headers = { "Content-Type": "application/json" };

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

    const totalSymbols = 30;

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
                { transform: "translateY(0)" },
                { transform: `translateY(-${distance}px)` }
            ],
            {
                duration,
                easing: "cubic-bezier(.12,.72,.16,1)",
                fill: "forwards"
            }
        );

        await animation.finished;
        animation.cancel();
    } else {
        const start = performance.now();

        await new Promise(resolve => {
            function frame(now) {
                const progress = Math.min(
                    1,
                    (now - start) / duration
                );

                const eased = 1 - Math.pow(1 - progress, 3);

                strip.style.transform =
                    `translateY(-${distance * eased}px)`;

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

    if (!main || !region) {
        console.error("Plate animation: elements not found");
        return;
    }

    const parts = finalPlate.trim().split(/\s+/);
    const mainFinal = parts[0];
    const regionFinal = parts[1] || "77";

    main.replaceChildren();
    region.replaceChildren();

    const slots = [];

    main.style.justifyContent = "center";
    main.style.gap = "0.02em";
    region.style.justifyContent = "center";
    region.style.gap = "0.02em";

    for (const char of mainFinal) {
        const cell = document.createElement("span");
        cell.className = "slot-cell";
        cell.style.flex = "1 1 0";
        cell.style.width = "0";
        main.appendChild(cell);

        slots.push({ element: cell, char });
    }

    for (const char of regionFinal) {
        const cell = document.createElement("span");
        cell.className = "slot-cell";
        cell.style.flex = "1 1 0";
        cell.style.width = "0";
        region.appendChild(cell);

        slots.push({ element: cell, char });
    }

    const rare = rarity === "Legendary" || rarity === "Mythic";
    const epic = rarity === "Epic";

    await Promise.all(
        slots.map((slot, index) => {
            const isLast = index === slots.length - 1;

            return rollSlot(slot.element, slot.char, {
                duration: isLast
                    ? (rare ? 5200 : epic ? 4200 : 3200)
                    : 2300 + index * 250,
                delay: index * 180
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

    if (!status) return;

    if (freeSpinSeconds <= 0) {
        status.textContent = "🎁 Бесплатный спин доступен!";
        return;
    }

    const hours = Math.floor(freeSpinSeconds / 3600);
    const minutes = Math.floor((freeSpinSeconds % 3600) / 60);
    const seconds = freeSpinSeconds % 60;

    status.textContent =
        `🎁 Бесплатный спин через ${hours}ч ${minutes}м ${seconds}с`;

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

async function listPlate(plateId) {
    const price = Number(
        prompt("За сколько монет выставить номер?")
    );

    if (!Number.isInteger(price) || price < 1 || price > 1000000) {
        return;
    }

    try {
        await api("/api/market/list", {
            method: "POST",
            body: JSON.stringify({
                plate_id: plateId,
                price: price
            })
        });

        alert("Номер выставлен на рынок!");
        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

// Кнопки коллекции
$("items").addEventListener("click", event => {
    const button = event.target.closest("[data-list-plate]");
    if (!button) return;

    listPlate(Number(button.dataset.listPlate));
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
    const plates = await api("/api/collection");
    const itemsElement = $("items");

    if (itemsElement) {
        itemsElement.innerHTML = plates.length
            ? plates.map(p => `
                <div class="item collection-item">
                    <div class="collection-plate-wrap">
                        ${createMiniPlate(p.number)}
                        <small>${escapeHtml(p.rarity)}</small>
                        ${renderTags(p.tags)}
                    </div>
                    <strong>#${p.id}</strong>
                    <button
                        class="market-action"
                        data-list-plate="${p.id}"
                    >
                        ВЫСТАВИТЬ
                    </button>
                </div>
            `).join("")
            : '<div class="empty">Пока нет номеров. Сделай первый спин!</div>';
    }

    // РЫНОК
    const market = await api("/api/market");
    const marketElement = $("market-items");

    if (marketElement) {
        marketElement.innerHTML = market.length
            ? market.map(p => `
                <div class="item">
                    <div>
                        <div class="market-plate-wrap">${createMiniPlate(p.number)}</div>
                        <small>${escapeHtml(p.rarity)}</small>
                        ${renderTags(p.tags)}
                    </div>
                    <div class="market-price">
                        <strong>${Number(p.price).toLocaleString("ru-RU")} 🪙</strong>
                        ${
                            p.is_mine
                                ? `<button class="market-action cancel" data-cancel-listing="${p.listing_id}">СНЯТЬ</button>`
                                : `<button class="market-action" data-buy-listing="${p.listing_id}">КУПИТЬ</button>`
                        }
                    </div>
                </div>
            `).join("")
            : '<div class="empty">На рынке пока пусто.</div>';
    }
}

// =========================================================
// КНОПКА СПИНА
// =========================================================

$("spin").addEventListener("click", async () => {
    $("spin").disabled = true;
    $("hint").textContent = "🎰 Барабаны вращаются...";

    try {
        const result = await api("/api/spin", {
            method: "POST"
        });

        await animatePlate(
            result.plate.number,
            result.plate.rarity
        );

        await refresh();

        const rarityText =
            rarityNames[result.plate.rarity] ||
            result.plate.rarity.toUpperCase();

        const tags = result.plate.tags || [];

        let message =
            `${rarityText} • +${result.reward} COINS`;

        if (tags.length > 0) {
            message += " • " + tags.join(" • ");
        }

        $("rarity").textContent = message;

        $("hint").textContent =
            tags.length > 0
                ? "✨ " + tags.join(" • ")
                : "Номер добавлен в коллекцию!";

    } catch (e) {
        $("hint").textContent = e.message;
    } finally {
        $("spin").disabled = false;
    }
});


// =========================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =========================================================

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b =>
            b.classList.toggle("active", b === btn)
        );

        $("collection").classList.toggle(
            "hidden",
            btn.dataset.tab !== "collection"
        );

        $("market").classList.toggle(
            "hidden",
            btn.dataset.tab !== "market"
        );
        $("profile").classList.toggle(
            "hidden",
            btn.dataset.tab !== "profile"
        );
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
