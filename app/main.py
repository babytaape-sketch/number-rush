
import hashlib
import hmac
import json
import os
import random
import re
import sqlite3
import time
import threading
from pathlib import Path
from urllib.parse import parse_qsl
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
DB_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "number_rush.db"))
DEV_MODE = os.getenv("DEV_MODE", "true").lower() == "true"
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

app = FastAPI(title="NUMBER RUSH API")


# =========================================================
# РЕДКОСТИ И НАГРАДЫ
# =========================================================

RARITIES = [
    ("Common", 75.0, 10),
    ("Uncommon", 17.0, 25),
    ("Rare", 6.0, 60),
    ("Epic", 1.7, 150),
    ("Legendary", 0.25, 500),
    ("Mythic", 0.05, 2000),
]

RARITY_NAMES = {
    "Common": "Обычная",
    "Uncommon": "Необычная",
    "Rare": "Редкая",
    "Epic": "Эпическая",
    "Legendary": "Легендарная",
    "Mythic": "Мифическая",
}

RARITY_ORDER = [
    "Common",
    "Uncommon",
    "Rare",
    "Epic",
    "Legendary",
    "Mythic",
]

RARITY_REWARDS = {
    name: reward
    for name, chance, reward in RARITIES
}


# =========================================================
# БАЗА ДАННЫХ
# =========================================================

def db():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL DEFAULT 'Player',
            coins INTEGER NOT NULL DEFAULT 100,
            spins INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_free_spin_at INTEGER NOT NULL DEFAULT 0,
            total_spins INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS plates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL,
            number TEXT NOT NULL,
            rarity TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate_id INTEGER NOT NULL UNIQUE,
            seller_id TEXT NOT NULL,
            price INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS market_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate_id INTEGER NOT NULL,
            buyer_id TEXT NOT NULL,
            seller_id TEXT NOT NULL,
            price INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_task_progress (
            user_id TEXT NOT NULL,
            task_date TEXT NOT NULL,
            task_key TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            claimed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, task_date, task_key)
        );
        """)


init_db()

with db() as con:
    columns = [
        row["name"]
        for row in con.execute("PRAGMA table_info(users)").fetchall()
    ]

    if "last_free_spin_at" not in columns:
        con.execute(
            "ALTER TABLE users ADD COLUMN last_free_spin_at "
            "INTEGER NOT NULL DEFAULT 0"
        )

    if "total_spins" not in columns:
        con.execute(
            "ALTER TABLE users ADD COLUMN total_spins "
            "INTEGER NOT NULL DEFAULT 0"
        )

    con.execute("""CREATE TABLE IF NOT EXISTS app_migrations (migration_id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)""")
    if not con.execute("SELECT 1 FROM app_migrations WHERE migration_id=?", ("remove_initial_five_spins",)).fetchone():
        con.execute("UPDATE users SET spins=0")
        con.execute("INSERT INTO app_migrations (migration_id, applied_at) VALUES (?, ?)", ("remove_initial_five_spins", int(time.time())))


DAILY_TASKS = [
    {"key": "spin_5", "title": "Сделать 5 прокруток", "description": "Используй бесплатные или платные прокрутки", "target": 5, "reward": 150},
    {"key": "sell_1", "title": "Продать 1 номер", "description": "Продай номер через рынок или быструю продажу", "target": 1, "reward": 100},
    {"key": "rare_1", "title": "Получить редкий номер", "description": "Получи номер редкости Rare или выше", "target": 1, "reward": 250},
]


def daily_task_date(now=None):
    return time.strftime("%Y-%m-%d", time.gmtime(now or time.time()))


def update_daily_task(con, uid, task_key, now=None):
    task = next((item for item in DAILY_TASKS if item["key"] == task_key), None)
    if not task:
        return

    today = daily_task_date(now)
    con.execute(
        """INSERT OR IGNORE INTO daily_task_progress
        (user_id, task_date, task_key, progress, claimed)
        VALUES (?, ?, ?, 0, 0)""",
        (uid, today, task_key)
    )
    row = con.execute(
        """SELECT progress, claimed FROM daily_task_progress
        WHERE user_id=? AND task_date=? AND task_key=?""",
        (uid, today, task_key)
    ).fetchone()

    if row["claimed"] or row["progress"] >= task["target"]:
        return

    progress = min(task["target"], row["progress"] + 1)
    con.execute(
        """UPDATE daily_task_progress SET progress=?
        WHERE user_id=? AND task_date=? AND task_key=?""",
        (progress, uid, today, task_key)
    )


@app.get("/api/daily-tasks")
def get_daily_tasks(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    today = daily_task_date()

    with db() as con:
        for task in DAILY_TASKS:
            con.execute(
                """INSERT OR IGNORE INTO daily_task_progress
                (user_id, task_date, task_key, progress, claimed)
                VALUES (?, ?, ?, 0, 0)""",
                (user["user_id"], today, task["key"])
            )
        rows = con.execute(
            """SELECT task_key, progress, claimed FROM daily_task_progress
            WHERE user_id=? AND task_date=?""",
            (user["user_id"], today)
        ).fetchall()

    progress = {row["task_key"]: dict(row) for row in rows}
    return {
        "date": today,
        "tasks": [
            {
                **task,
                "progress": progress[task["key"]]["progress"],
                "completed": int(progress[task["key"]]["progress"]) >= task["target"],
                "claimed": bool(progress[task["key"]]["claimed"]),
            }
            for task in DAILY_TASKS
        ]
    }


@app.post("/api/daily-tasks/{task_key}/claim")
def claim_daily_task(task_key: str, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    task = next((item for item in DAILY_TASKS if item["key"] == task_key), None)
    if not task:
        raise HTTPException(404, "Задание не найдено")

    today = daily_task_date()
    with db() as con:
        row = con.execute(
            """SELECT progress, claimed FROM daily_task_progress
            WHERE user_id=? AND task_date=? AND task_key=?""",
            (user["user_id"], today, task_key)
        ).fetchone()

        if not row or row["progress"] < task["target"]:
            raise HTTPException(400, "Сначала выполни задание")
        if row["claimed"]:
            raise HTTPException(400, "Награда уже получена")

        claimed_update = con.execute(
            """UPDATE daily_task_progress SET claimed=1
            WHERE user_id=? AND task_date=? AND task_key=? AND claimed=0""",
            (user["user_id"], today, task_key)
        )
        if claimed_update.rowcount != 1:
            raise HTTPException(400, "Награда уже получена")
        con.execute(
            "UPDATE users SET coins=coins+? WHERE user_id=?",
            (task["reward"], user["user_id"])
        )

    return {"ok": True, "reward": task["reward"]}


# =========================================================
# TELEGRAM АВТОРИЗАЦИЯ
# =========================================================

def validate_init_data(raw: str):
    if DEV_MODE:
        return {
            "id": 10001,
            "first_name": "Demo Player",
            "username": "demo"
        }

    if not BOT_TOKEN:
        raise HTTPException(500, "BOT_TOKEN is not configured")

    try:
        pairs = dict(parse_qsl(raw, keep_blank_values=True))
        received_hash = pairs.pop("hash")
        auth_date = int(pairs.get("auth_date", "0"))

        if time.time() - auth_date > 86400:
            raise ValueError("initData expired")

        data_check = "\n".join(
            f"{k}={v}" for k, v in sorted(pairs.items())
        )

        secret_key = hmac.new(
            b"WebAppData",
            BOT_TOKEN.encode(),
            hashlib.sha256
        ).digest()

        calculated = hmac.new(
            secret_key,
            data_check.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(calculated, received_hash):
            raise ValueError("bad signature")

        return json.loads(pairs["user"])

    except Exception:
        raise HTTPException(401, "Invalid Telegram initData")


def current_user(authorization: str | None):
    raw = (authorization or "").removeprefix("tma ").strip()

    if not raw and not DEV_MODE:
        raise HTTPException(401, "Open this app from Telegram")

    user = validate_init_data(raw)

    uid = str(user.get("id", "demo"))
    username = (
        user.get("username")
        or user.get("first_name")
        or "Player"
    )

    with db() as con:
        con.execute(
            """
            INSERT OR IGNORE INTO users
            (user_id, username, coins, spins, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (uid, username, 100, 0, int(time.time()))
        )

        con.execute(
            "UPDATE users SET username=? WHERE user_id=?",
            (username, uid)
        )

        row = con.execute(
            "SELECT * FROM users WHERE user_id=?",
            (uid,)
        ).fetchone()

    return row


# =========================================================
# ГЕНЕРАТОР НОМЕРОВ
# =========================================================

LETTERS = "АВЕКМНОРСТУХ"

REGIONS = {
    "Москва": ["77", "97", "99", "177", "197", "199", "777", "797", "799"],
    "Московская область": ["50", "90", "150", "190", "750", "790"],
    "Санкт-Петербург": ["78", "98", "178", "198"],
    "Ленинградская область": ["47", "147"],
    "Татарстан": ["16", "116", "716"],
    "Краснодарский край": ["23", "93", "123", "193"],
    "Свердловская область": ["66", "96", "196"],
    "Ростовская область": ["61", "161"],
    "Нижегородская область": ["52", "152"],
    "Самарская область": ["63", "163"],
    "Челябинская область": ["74", "174"],
    "Башкортостан": ["02", "102"],
    "Пермский край": ["59", "159"],
    "Красноярский край": ["24", "84", "124"],
    "Новосибирская область": ["54", "154"],
    "Омская область": ["55", "155"],
    "Воронежская область": ["36", "136"],
    "Волгоградская область": ["34", "134"],
    "Саратовская область": ["64", "164"],
    "Тюменская область": ["72", "172"],
    "Приморский край": ["25", "125"],
    "Иркутская область": ["38", "85", "138"],
    "Ханты-Мансийский АО": ["86", "186"],
    "Ямало-Ненецкий АО": ["89"],
    "Кемеровская область": ["42", "142"],
    "Алтайский край": ["22", "122"],
    "Оренбургская область": ["56", "156"],
    "Тульская область": ["71", "171"],
    "Тверская область": ["69", "169"],
    "Ярославская область": ["76", "176"],
    "Рязанская область": ["62", "162"],
    "Калужская область": ["40", "140"],
    "Белгородская область": ["31", "131"],
    "Курская область": ["46", "146"],
    "Орловская область": ["57", "157"],
    "Липецкая область": ["48", "148"],
    "Тамбовская область": ["68", "168"],
    "Пензенская область": ["58", "158"],
    "Ульяновская область": ["73", "173"],
    "Кировская область": ["43", "143"],
    "Удмуртия": ["18", "118"],
    "Чувашия": ["21", "121"],
    "Марий Эл": ["12", "112"],
    "Мордовия": ["13", "113"],
    "Карелия": ["10", "110"],
    "Архангельская область": ["29", "129"],
    "Вологодская область": ["35", "135"],
    "Мурманская область": ["51", "151"],
    "Новгородская область": ["53", "153"],
    "Псковская область": ["60", "160"],
    "Калининградская область": ["39", "91"],
    "Курганская область": ["45", "145"],
    "Хабаровский край": ["27", "127"],
    "Амурская область": ["28", "128"],
    "Камчатский край": ["41", "82"],
    "Сахалинская область": ["65", "165"],
    "Якутия": ["14", "114"],
    "Бурятия": ["03", "103"],
    "Забайкальский край": ["75", "80"],
    "Крым": ["82"],
    "Севастополь": ["92"],
}

REGION_WEIGHTS = {
    "Москва": 12,
    "Московская область": 10,
    "Санкт-Петербург": 8,
    "Краснодарский край": 7,
    "Татарстан": 6,
    "Свердловская область": 5,
    "Ростовская область": 5,
    "Нижегородская область": 4,
    "Самарская область": 4,
    "Челябинская область": 4,
    "Башкортостан": 4,
    "Красноярский край": 3,
    "Новосибирская область": 3,
    "Приморский край": 3,
}

# Серии, которые учитываются только с указанными кодами.
SPECIAL_SERIES = {
    "АМР": ["97"],
    "ЕКХ": ["77", "97", "99", "177", "197", "199"],
    "СКР": ["197", "199"],
    "ХКХ": ["77"],
    "ОВЕ": ["77"],
    "КОО": ["77"],
    "АКР": ["177"],
    "ВКР": ["177"],
    "ААА": ["77", "99"],
    "ООО": ["77"],
    "МММ": ["50", "90"],
    "ССС": ["77", "97", "99"],
}

GOLD_SERIES = [
    "ААА", "ВВВ", "ЕЕЕ", "ККК",
    "МММ", "ННН", "ООО", "РРР",
    "ССС", "ТТТ", "УУУ", "ХХХ"
]

WORD_SERIES = [
    "ВАМ", "ВАУ", "ХАМ", "УХА", "ЕДА",
    "НОТ", "ВОТ", "ТАМ", "ОСА", "ЕЖА"
]

SPECIAL_DIGITS = {
    "000", "001", "007", "100",
    "111", "222", "333", "444",
    "555", "666", "700", "777",
    "800", "888", "900", "999"
}

LADDER_DIGITS = {
    "123", "234", "345", "456",
    "567", "678", "789"
}

BEAUTIFUL_DIGITS = SPECIAL_DIGITS | LADDER_DIGITS


def pick_region():
    regions = []
    weights = []

    for name, codes in REGIONS.items():
        weight = REGION_WEIGHTS.get(name, 1)

        for code in codes:
            regions.append((code, name))
            weights.append(weight / len(codes))

    return random.choices(regions, weights=weights, k=1)[0]


def pick_special_series():
    series = random.choice(list(SPECIAL_SERIES.keys()))
    region = random.choice(SPECIAL_SERIES[series])

    region_name = next(
        (
            name for name, codes in REGIONS.items()
            if region in codes
        ),
        "Москва"
    )

    return series, region, region_name


def random_letters(ordinary=False):
    while True:
        letters = "".join(random.choices(LETTERS, k=3))

        if ordinary:
            if letters in SPECIAL_SERIES or letters in GOLD_SERIES:
                continue

            if letters[0] == letters[1] or letters[1] == letters[2]:
                continue

        return letters


def random_digits():
    return "".join(random.choices("0123456789", k=3))


# =========================================================
# ХАРАКТЕРИСТИКИ И ОПРЕДЕЛЕНИЕ РЕДКОСТИ
# =========================================================

def is_special_series(letters, region_code):
    return (
        letters in SPECIAL_SERIES
        and region_code in SPECIAL_SERIES[letters]
    )


def classify_plate(letters, digits, region_code):
    special = is_special_series(letters, region_code)

    if special and digits in BEAUTIFUL_DIGITS:
        return "Mythic"

    if special:
        return "Legendary"

    if digits in ("000", "777"):
        return "Legendary"

    if (
        digits in SPECIAL_DIGITS
        or len(set(digits)) == 1
    ):
        return "Epic"

    if digits in LADDER_DIGITS or digits[0] == digits[2]:
        return "Rare"

    if (
        digits[0] == digits[1]
        or digits[1] == digits[2]
        or letters[0] == letters[1]
        or letters[1] == letters[2]
    ):
        return "Uncommon"

    return "Common"


def get_plate_tags(letters, digits, region_code=None):
    tags = []

    if digits == "000":
        tags.append("Три нуля")

    if len(set(digits)) == 1:
        tags.append("Три одинаковые цифры")
    elif digits[0] == digits[2]:
        tags.append("Зеркальные цифры")

    if digits in LADDER_DIGITS:
        tags.append("Цифровая лесенка")

    if digits in SPECIAL_DIGITS:
        tags.append("Особая комбинация")

    if digits.startswith("00") or digits.endswith("00"):
        tags.append("Круглые цифры")

    if digits[0] == digits[1] or digits[1] == digits[2]:
        if len(set(digits)) != 1:
            tags.append("Парные цифры")

    if region_code and is_special_series(letters, region_code):
        tags.append("Специальная серия")

    elif letters in SPECIAL_SERIES:
        tags.append("Известная серия")

    elif letters in GOLD_SERIES:
        tags.append("Тройные буквы")

    if letters in WORD_SERIES:
        tags.append("Словесная серия")

    if (
        letters[0] == letters[1]
        or letters[1] == letters[2]
    ):
        if letters not in GOLD_SERIES:
            tags.append("Повтор букв")

    return tags


def get_number_features(number):
    """
    Определяет характеристики номера.
    Работает и со старыми номерами из базы данных.
    """

    try:
        parts = number.strip().split()

        if len(parts) != 2:
            return []

        body = parts[0]
        region_code = parts[1]

        if len(body) != 6:
            return []

        letters = body[0] + body[4:6]
        digits = body[1:4]

        if not re.fullmatch(r"[АВЕКМНОРСТУХ]{3}", letters):
            return []

        if not re.fullmatch(r"\d{3}", digits):
            return []

        return get_plate_tags(letters, digits, region_code)

    except Exception:
        return []


def calculate_plate_value(number, rarity):
    """Детерминированная оценка с учётом редкости и особенностей номера."""
    base_values = {
        "Common": 90, "Uncommon": 180, "Rare": 360,
        "Epic": 750, "Legendary": 1600, "Mythic": 3500
    }
    parts = str(number).strip().split()
    if len(parts) != 2 or len(parts[0]) != 6:
        return base_values.get(rarity, 90)
    body, region = parts
    letters = body[0] + body[4:6]
    digits = body[1:4]
    value = float(base_values.get(rarity, 90))
    tags = get_plate_tags(letters, digits, region)

    if len(set(digits)) == 1:
        value *= 2.8
    elif digits in SPECIAL_DIGITS:
        value *= 2.2
    elif digits in LADDER_DIGITS:
        value *= 1.9
    elif digits[0] == digits[2]:
        value *= 1.55
    elif digits[0] == digits[1] or digits[1] == digits[2]:
        value *= 1.25
    if digits in {"000", "007", "100", "777", "888", "999"}:
        value *= 1.35

    if letters in SPECIAL_SERIES and region in SPECIAL_SERIES[letters]:
        value *= 2.4
    elif letters in GOLD_SERIES:
        value *= 1.8
    elif letters in WORD_SERIES:
        value *= 1.45
    elif len(set(letters)) == 1:
        value *= 1.6
    elif letters[0] == letters[1] or letters[1] == letters[2]:
        value *= 1.2

    region_name = next((name for name, codes in REGIONS.items() if region in codes), "")
    region_weight = REGION_WEIGHTS.get(region_name, 1)
    value *= 1 + min(region_weight, 12) * 0.025
    if len(region) == 3:
        value *= 1.12
    if region in {"77", "97", "99", "177", "197", "199", "777", "799"}:
        value *= 1.2

    value *= 1 + min(len(tags), 5) * 0.08
    return max(10, int(round(value / 5) * 5))


def calculate_quick_sell_price(number, rarity):
    return max(5, int(calculate_plate_value(number, rarity) * 0.70))


# =========================================================
# ГЕНЕРАЦИЯ НОМЕРОВ ПОД КОНКРЕТНУЮ РЕДКОСТЬ
# =========================================================

def generate_plate_details():
    rarity = random.choices(
        [item[0] for item in RARITIES],
        weights=[item[1] for item in RARITIES],
        k=1
    )[0]

    region_code, region_name = pick_region()

    if rarity == "Common":
        while True:
            letters = random_letters(ordinary=True)
            digits = random_digits()

            if classify_plate(letters, digits, region_code) == "Common":
                break

    elif rarity == "Uncommon":
        digits = random.choice([
            "110", "112", "122", "211",
            "221", "233", "344", "455",
            "566", "677", "788", "899"
        ])
        letters = random_letters(ordinary=True)

    elif rarity == "Rare":
        digits = random.choice([
            "101", "202", "303", "404",
            "505", "606", "707", "808",
            "909", "123", "234", "345",
            "456", "567", "678", "789"
        ])
        letters = random_letters(ordinary=True)

    elif rarity == "Epic":
        digits = random.choice([
            "111", "222", "333", "444",
            "555", "666", "888", "999",
            "001", "007", "100", "200",
            "300", "500", "700", "800", "900"
        ])
        letters = random_letters(ordinary=True)

    elif rarity == "Legendary":
        if random.random() < 0.65:
            letters, region_code, region_name = pick_special_series()
            digits = random.choice([
                "123", "234", "345", "456",
                "567", "678", "789"
            ])
        else:
            letters = random_letters(ordinary=True)
            digits = random.choice(["000", "777"])

    else:  # Mythic
        letters, region_code, region_name = pick_special_series()
        digits = random.choice([
            "000", "001", "007", "100",
            "111", "222", "333", "444",
            "555", "666", "700", "777",
            "800", "888", "900", "999",
            "123", "234", "345", "456",
            "567", "678", "789"
        ])

    # Дополнительная проверка: номер должен соответствовать редкости.
    actual_rarity = classify_plate(letters, digits, region_code)

    if actual_rarity != rarity:
        # Защита от случайного несоответствия.
        # Повторно генерируем корректную комбинацию.
        return generate_plate_details()

    tags = get_plate_tags(letters, digits, region_code)

    number = f"{letters[0]}{digits}{letters[1:]} {region_code}"

    return {
        "number": number,
        "rarity": rarity,
        "rarity_ru": RARITY_NAMES[rarity],
        "points": len(tags),
        "tags": tags,
        "price": random.randint(70, 140),
        "region": region_code,
        "region_name": region_name,
    }


def generate_plate():
    return generate_plate_details()["number"]


# =========================================================
# ОСНОВНЫЕ СТРАНИЦЫ
# =========================================================

@app.get("/")
def home():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/health")
def health():
    return {"ok": True, "service": "NUMBER RUSH"}


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


# =========================================================
# ПРОФИЛЬ ИГРОКА
# =========================================================

@app.get("/api/me")
def me(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    now = int(time.time())
    uid = user["user_id"]

    with db() as con:
        count = con.execute(
            "SELECT COUNT(*) n FROM plates WHERE owner_id=?", (uid,)
        ).fetchone()["n"]
        rarest = con.execute(
            """SELECT number, rarity FROM plates WHERE owner_id=?
            ORDER BY CASE rarity WHEN 'Mythic' THEN 6
            WHEN 'Legendary' THEN 5 WHEN 'Epic' THEN 4
            WHEN 'Rare' THEN 3 WHEN 'Uncommon' THEN 2 ELSE 1 END DESC,
            id DESC LIMIT 1""", (uid,)
        ).fetchone()
        sales = con.execute(
            "SELECT COUNT(*) n FROM market_transactions WHERE seller_id=?", (uid,)
        ).fetchone()["n"]
        purchases = con.execute(
            "SELECT COUNT(*) n FROM market_transactions WHERE buyer_id=?", (uid,)
        ).fetchone()["n"]
        row = con.execute(
            "SELECT last_free_spin_at, total_spins FROM users WHERE user_id=?", (uid,)
        ).fetchone()

    seconds_left = max(0, 86400 - (now - row["last_free_spin_at"]))
    return {
        "id": uid, "username": user["username"], "coins": user["coins"],
        "spins": user["spins"], "total_spins": row["total_spins"],
        "collection_count": count, "created_at": user["created_at"],
        "rarest_plate": dict(rarest) if rarest else None,
        "purchases_count": purchases, "sales_count": sales,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }


# =========================================================
# ПРОКРУТКА
# =========================================================

@app.post("/api/spin")
def spin(free: bool = False, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]
    now = int(time.time())

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        row = con.execute(
            """
            SELECT coins, spins, last_free_spin_at
            FROM users WHERE user_id=?
            """,
            (uid,)
        ).fetchone()

        free_spin_ready = (
            row["last_free_spin_at"] == 0
            or now - row["last_free_spin_at"] >= 86400
        )

        used_free_spin = False
        used_paid_spin = False

        if free:
            if not free_spin_ready:
                con.rollback()
                raise HTTPException(400, "Бесплатный спин пока недоступен.")
            used_free_spin = True
            con.execute(
                "UPDATE users SET last_free_spin_at=? WHERE user_id=?",
                (now, uid)
            )

        elif row["spins"] > 0:
            con.execute(
                "UPDATE users SET spins=spins-1 WHERE user_id=?",
                (uid,)
            )

        elif row["coins"] >= 100:
            used_paid_spin = True

            con.execute(
                "UPDATE users SET coins=coins-100 WHERE user_id=?",
                (uid,)
            )

        else:
            con.rollback()
            raise HTTPException(
                400,
                "Not enough coins. One spin costs 100 coins."
            )

        plate_data = generate_plate_details()

        number = plate_data["number"]
        rarity = plate_data["rarity"]
        reward = 0  # За выпадение номера монеты не начисляются.

        con.execute(
            "UPDATE users SET total_spins=total_spins+1 WHERE user_id=?",
            (uid,)
        )

        cur = con.execute(
            """
            INSERT INTO plates(owner_id, number, rarity, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (uid, number, rarity, now)
        )

        plate_id = cur.lastrowid
        update_daily_task(con, uid, "spin_5", now)
        if rarity in ("Rare", "Epic", "Legendary", "Mythic"):
            update_daily_task(con, uid, "rare_1", now)

        updated = con.execute(
            """
            SELECT coins, spins, last_free_spin_at
            FROM users WHERE user_id=?
            """,
            (uid,)
        ).fetchone()

        con.commit()

    seconds_left = max(
        0,
        86400 - (now - updated["last_free_spin_at"])
    )

    return {
        "plate": {
            "id": plate_id,
            "number": number,
            "rarity": rarity,
            "rarity_ru": RARITY_NAMES[rarity],
            "tags": plate_data["tags"],
            "points": plate_data["points"],
            "region": plate_data["region"],
            "region_name": plate_data["region_name"],
        },
        "reward": reward,
        "coins": updated["coins"],
        "spins": updated["spins"],
        "used_free_spin": used_free_spin,
        "used_paid_spin": used_paid_spin,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }


# =========================================================
# КОЛЛЕКЦИЯ
# =========================================================

@app.get("/api/collection")
def collection(authorization: str | None = Header(default=None)):
    user = current_user(authorization)

    with db() as con:
        rows = con.execute(
            """
            SELECT
                p.id, p.number, p.rarity, p.created_at,
                EXISTS(
                    SELECT 1 FROM listings l WHERE l.plate_id=p.id
                ) AS is_listed
            FROM plates p
            WHERE p.owner_id=?
            ORDER BY p.id DESC
            """,
            (user["user_id"],)
        ).fetchall()

    result = []

    for row in rows:
        item = dict(row)
        item["rarity_ru"] = RARITY_NAMES.get(
            item["rarity"],
            item["rarity"]
        )
        item["tags"] = get_number_features(item["number"])
        item["market_value"] = calculate_plate_value(item["number"], item["rarity"])
        item["quick_sell_price"] = calculate_quick_sell_price(item["number"], item["rarity"])
        result.append(item)

    return result


@app.post("/api/plates/{plate_id}/quick-sell")
def quick_sell_plate(
    plate_id: int,
    authorization: str | None = Header(default=None)
):
    user = current_user(authorization)
    uid = user["user_id"]

    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        plate = con.execute(
            "SELECT id, number, rarity FROM plates WHERE id=? AND owner_id=?",
            (plate_id, uid)
        ).fetchone()
        if not plate:
            con.rollback()
            raise HTTPException(404, "Номер не найден в коллекции")

        listed = con.execute(
            "SELECT 1 FROM listings WHERE plate_id=?",
            (plate_id,)
        ).fetchone()
        if listed:
            con.rollback()
            raise HTTPException(409, "Сначала снимите номер с рынка")

        price = calculate_quick_sell_price(plate["number"], plate["rarity"])
        now = int(time.time())
        con.execute("UPDATE users SET coins=coins+? WHERE user_id=?", (price, uid))
        con.execute(
            """INSERT INTO market_transactions
            (plate_id, buyer_id, seller_id, price, created_at)
            VALUES (?, 'INSTANT_SALE', ?, ?, ?)""",
            (plate_id, uid, price, now)
        )
        con.execute("DELETE FROM plates WHERE id=?", (plate_id,))
        update_daily_task(con, uid, "sell_1", now)
        con.commit()

    return {"ok": True, "price": price}


# =========================================================
# РЫНОК
# =========================================================


@app.get("/api/market")
def market(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]

    with db() as con:
        rows = con.execute(
            """
            SELECT
                l.id AS listing_id,
                l.seller_id,
                l.price,
                p.number,
                p.rarity,
                p.id AS plate_id
            FROM listings l
            JOIN plates p ON p.id=l.plate_id
            ORDER BY l.id DESC
            """
        ).fetchall()

    result = []

    for row in rows:
        item = dict(row)
        item["is_mine"] = item["seller_id"] == uid
        item["rarity_ru"] = RARITY_NAMES.get(
            item["rarity"],
            item["rarity"]
        )
        item["tags"] = get_number_features(item["number"])
        result.append(item)

    return result
class ListingRequest(BaseModel):
    plate_id: int
    price: int



@app.post("/api/market/list")
def list_plate(
    payload: ListingRequest,
    authorization: str | None = Header(default=None)
):
    user = current_user(authorization)

    if payload.price < 1 or payload.price > 1000000:
        raise HTTPException(
            400,
            "Price must be between 1 and 1,000,000 coins"
        )

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        plate = con.execute(
            """
            SELECT id FROM plates
            WHERE id=? AND owner_id=?
            """,
            (payload.plate_id, user["user_id"])
        ).fetchone()

        if not plate:
            con.rollback()
            raise HTTPException(
                404,
                "Plate not found in your collection"
            )

        try:
            con.execute(
                """
                INSERT INTO listings
                (plate_id, seller_id, price, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    payload.plate_id,
                    user["user_id"],
                    payload.price,
                    int(time.time())
                )
            )

            con.commit()

        except sqlite3.IntegrityError:
            con.rollback()
            raise HTTPException(
                409,
                "This plate is already listed"
            )

    return {"ok": True}


@app.post("/api/market/{listing_id}/buy")
def buy_listing(
    listing_id: int,
    authorization: str | None = Header(default=None)
):
    user = current_user(authorization)
    uid = user["user_id"]

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        listing = con.execute(
            "SELECT * FROM listings WHERE id=?",
            (listing_id,)
        ).fetchone()

        if not listing:
            con.rollback()
            raise HTTPException(404, "Listing not found")

        if listing["seller_id"] == uid:
            con.rollback()
            raise HTTPException(
                400,
                "You cannot buy your own listing"
            )

        buyer = con.execute(
            "SELECT coins FROM users WHERE user_id=?",
            (uid,)
        ).fetchone()

        if buyer["coins"] < listing["price"]:
            con.rollback()
            raise HTTPException(400, "Not enough coins")

        con.execute(
            "UPDATE users SET coins=coins-? WHERE user_id=?",
            (listing["price"], uid)
        )

        con.execute(
            "UPDATE users SET coins=coins+? WHERE user_id=?",
            (listing["price"], listing["seller_id"])
        )

        con.execute(
            "UPDATE plates SET owner_id=? WHERE id=?",
            (uid, listing["plate_id"])
        )

        con.execute(
            """INSERT INTO market_transactions
            (plate_id, buyer_id, seller_id, price, created_at)
            VALUES (?, ?, ?, ?, ?)""",
            (listing["plate_id"], uid, listing["seller_id"],
             listing["price"], int(time.time()))
        )

        con.execute(
            "DELETE FROM listings WHERE id=?",
            (listing_id,)
        )
        update_daily_task(con, listing["seller_id"], "sell_1", int(time.time()))

        con.commit()

    return {"ok": True}
    
@app.post("/api/market/{listing_id}/cancel")
def cancel_listing(
    listing_id: int,
    authorization: str | None = Header(default=None)
):
    user = current_user(authorization)
    uid = user["user_id"]

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        listing = con.execute(
            "SELECT * FROM listings WHERE id=?",
            (listing_id,)
        ).fetchone()

        if not listing:
            con.rollback()
            raise HTTPException(404, "Listing not found")

        if listing["seller_id"] != uid:
            con.rollback()
            raise HTTPException(
                403,
                "You can cancel only your own listing"
            )

        con.execute(
            "DELETE FROM listings WHERE id=?",
            (listing_id,)
        )

        con.commit()

    return {"ok": True}



# =========================================================
# TELEGRAM-БОТ
# =========================================================

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
WEB_APP_URL = "https://number-rush-5jne.onrender.com"


def telegram_request(method, payload):
    request = Request(
        f"{TELEGRAM_API}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def telegram_polling():
    if not BOT_TOKEN or DEV_MODE:
        return

    offset = 0

    while True:
        try:
            result = telegram_request(
                "getUpdates",
                {"offset": offset, "timeout": 25}
            )

            for update in result.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message")

                if not message:
                    continue

                chat_id = message["chat"]["id"]
                message_text = message.get("text", "")

                if message_text.startswith("/start"):
                    keyboard = {
                        "inline_keyboard": [[
                            {
                                "text": "🎮 Играть в NUMBER RUSH",
                                "web_app": {"url": WEB_APP_URL}
                            }
                        ]]
                    }

                    telegram_request("sendMessage", {
                        "chat_id": chat_id,
                        "text": (
                            "Добро пожаловать в NUMBER RUSH! "
                            "Готов испытать удачу?"
                        ),
                        "reply_markup": keyboard
                    })

        except Exception as exc:
            print(f"Telegram polling error: {exc}")
            time.sleep(5)


@app.on_event("startup")
def start_telegram_bot():
    if not BOT_TOKEN or DEV_MODE:
        print("Telegram bot is disabled")
        return

    try:
        telegram_request("deleteWebhook", {})
        print("Telegram webhook removed")

    except Exception as exc:
        print(f"Webhook error: {exc}")

    threading.Thread(
        target=telegram_polling,
        daemon=True
    ).start()
