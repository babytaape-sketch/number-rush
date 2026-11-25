import hashlib
import hmac
import json
import os
import random
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

RARITIES = [
    ("Common", 60.0, 10),
    ("Uncommon", 25.0, 25),
    ("Rare", 10.0, 60),
    ("Epic", 4.0, 150),
    ("Legendary", 0.9, 500),
    ("Mythic", 0.1, 2000),
]

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
    spins INTEGER NOT NULL DEFAULT 5,
    created_at INTEGER NOT NULL,
    last_free_spin_at INTEGER NOT NULL DEFAULT 0
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
        """)
init_db()
with db() as con:
    columns = [row["name"] for row in con.execute(
        "PRAGMA table_info(users)"
    ).fetchall()]

    if "last_free_spin_at" not in columns:
        con.execute(
            "ALTER TABLE users ADD COLUMN last_free_spin_at INTEGER NOT NULL DEFAULT 0"
        )

def validate_init_data(raw: str):
    if DEV_MODE:
        return {"id": 10001, "first_name": "Demo Player", "username": "demo"}
    if not BOT_TOKEN:
        raise HTTPException(500, "BOT_TOKEN is not configured")
    try:
        pairs = dict(parse_qsl(raw, keep_blank_values=True))
        received_hash = pairs.pop("hash")
        auth_date = int(pairs.get("auth_date", "0"))
        if time.time() - auth_date > 86400:
            raise ValueError("initData expired")
        data_check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
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
    username = user.get("username") or user.get("first_name") or "Player"
    with db() as con:
        con.execute(
            "INSERT OR IGNORE INTO users(user_id, username, coins, spins, created_at) VALUES(?,?,?,?,?)",
            (uid, username, 100, 5, int(time.time()))
        )
        con.execute("UPDATE users SET username=? WHERE user_id=?", (username, uid))
        row = con.execute("SELECT * FROM users WHERE user_id=?", (uid,)).fetchone()
    return row

LETTERS = "АВЕКМНОРСТУХ"

RARITIES = [
    ("Common", 60.0, 10),
    ("Uncommon", 25.0, 25),
    ("Rare", 10.0, 60),
    ("Epic", 4.0, 150),
    ("Legendary", 0.9, 500),
    ("Mythic", 0.1, 2000),
]

RARITY_NAMES = {
    "Common": "Обычная",
    "Uncommon": "Необычная",
    "Rare": "Редкая",
    "Epic": "Эпическая",
    "Legendary": "Легендарная",
    "Mythic": "Мифическая",
}

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
    "Омская область": ["55", "155"],
    "Хабаровский край": ["27", "127"],
    "Амурская область": ["28", "128"],
    "Камчатский край": ["41", "82"],
    "Сахалинская область": ["65", "165"],
    "Якутия": ["14", "114"],
    "Бурятия": ["03", "103"],
    "Забайкальский край": ["75", "80"],
    "Крым": ["82", "777"],
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
    "Другие регионы": 22,
}

GOLD_SERIES = [
    "ААА", "ВВВ", "ЕЕЕ", "ККК", "МММ", "ННН",
    "ООО", "РРР", "ССС", "ТТТ", "УУУ", "ХХХ"
]

GOV_SERIES = [
    "АМР", "АКР", "АОО", "ВОО", "МОС", "ВМР",
    "ВОР", "ЕКХ", "ЕКР", "ЕРР", "КОО", "ККР",
    "ММР", "НАА", "НКХ", "НРС", "АММ", "МРС"
]

WORD_SERIES = [
    "ВАМ", "ВАУ", "ХАМ", "УХА", "ЕДА",
    "НОТ", "ВОТ", "ТАМ", "ОСА", "ЕЖА"
]


def pick_region():
    regions = []
    weights = []

    for name, codes in REGIONS.items():
        weight = REGION_WEIGHTS.get(name, 1)
        for code in codes:
            regions.append((code, name))
            weights.append(weight / len(codes))

    return random.choices(regions, weights=weights, k=1)[0]


def generate_letters():
    chance = random.random()

    if chance < 0.005:
        return random.choice(GOV_SERIES)

    if chance < 0.019:
        return random.choice(GOLD_SERIES)

    if chance < 0.075:
        letter = random.choice(LETTERS)
        return random.choice(LETTERS) + letter + letter

    if chance < 0.085:
        return random.choice(WORD_SERIES)

    return "".join(random.choices(LETTERS, k=3))


def generate_digits():
    chance = random.random()

    if chance < 0.55:
        return "".join(random.choices("0123456789", k=3))

    if chance < 0.72:
        return "".join(random.choices("067895", k=3))

    if chance < 0.80:
        digit = random.choice("0123456789")
        return digit * 2 + random.choice("0123456789")

    if chance < 0.86:
        digit = random.choice("0123456789")
        return digit + random.choice("0123456789") + digit

    if chance < 0.895:
        start = random.randint(1, 7)
        return str(start) + str(start + 1) + str(start + 2)

    if chance < 0.93:
        digit = random.choice("0123456789")
        return digit * 3

    if chance < 0.955:
        return "00" + random.choice("123456789")

    if chance < 0.985:
        return random.choice("123456789") + "00"

    return random.choice(["007", "100", "200", "300", "500", "700", "800", "900"])


def get_plate_tags(letters, digits):
    points = 0
    tags = []

    if digits == "000":
        points += 110
        tags.append("Три нуля")

    if len(set(digits)) == 1:
        points += 100
        tags.append("Три одинаковые цифры")
    elif digits[0] == digits[2]:
        points += 45
        tags.append("Зеркальные цифры")

    if digits in ["123", "234", "345", "456", "567", "678", "789"]:
        points += 35
        tags.append("Цифровая лесенка")

    if digits in ["007", "077", "100", "200", "300", "500", "700", "800", "900"]:
        points += 90
        tags.append("Особая комбинация")

    if digits.endswith("00") or digits.startswith("00"):
        points += 45
        tags.append("Круглые цифры")

    if digits[0] == digits[1] or digits[1] == digits[2]:
        points += 22
        tags.append("Парные цифры")

    for digit in digits:
        if digit in "0689":
            points += 7

    if letters in GOLD_SERIES:
        points += 95
        tags.append("Золотая серия")
    elif letters in GOV_SERIES:
        points += 210
        tags.append("Государственная серия")
    elif letters in WORD_SERIES:
        points += 60
        tags.append("Словесная серия")
    elif letters[0] == letters[1] or letters[1] == letters[2]:
        points += 25
        tags.append("Повтор букв")

    return points, tags


def get_rarity(points):
    if points >= 250:
        return "Mythic"
    if points >= 150:
        return "Legendary"
    if points >= 95:
        return "Epic"
    if points >= 45:
        return "Rare"
    if points >= 22:
        return "Uncommon"
    return "Common"


def generate_plate_details():
    letters = generate_letters()
    digits = generate_digits()
    region_code, region_name = pick_region()

    points, tags = get_plate_tags(letters, digits)
    rarity = get_rarity(points)

    base_price = random.randint(70, 140)
    price = base_price * (3 if points >= 250 else 1)

    return {
        "number": f"{letters[0]}{digits}{letters[1:]} {region_code}",
        "rarity": rarity,
        "rarity_ru": RARITY_NAMES[rarity],
        "points": points,
        "tags": tags,
        "price": price,
        "region": region_code,
        "region_name": region_name,
    }


def generate_plate():
    return generate_plate_details()["number"]
@app.get("/")
def home():
    return FileResponse(WEB_DIR / "index.html")

@app.get("/health")
def health():
    return {"ok": True, "service": "NUMBER RUSH"}

app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

@app.get("/api/me")
def me(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    now = int(time.time())

    with db() as con:
        count = con.execute(
            "SELECT COUNT(*) n FROM plates WHERE owner_id=?",
            (user["user_id"],)
        ).fetchone()["n"]

        row = con.execute(
            "SELECT last_free_spin_at FROM users WHERE user_id=?",
            (user["user_id"],)
        ).fetchone()

    seconds_left = max(
        0,
        86400 - (now - row["last_free_spin_at"])
    )

    return {
        "id": user["user_id"],
        "username": user["username"],
        "coins": user["coins"],
        "spins": user["spins"],
        "collection_count": count,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }

@app.post("/api/spin")
def spin(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]
    now = int(time.time())

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        row = con.execute(
            "SELECT coins, spins, last_free_spin_at FROM users WHERE user_id=?",
            (uid,)
        ).fetchone()

        free_spin_ready = (
            row["last_free_spin_at"] == 0
            or now - row["last_free_spin_at"] >= 86400
        )

        used_free_spin = False
        used_paid_spin = False

        if free_spin_ready:
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
        reward = next(r for n, c, r in RARITIES if n == rarity)
        con.execute(
            "UPDATE users SET coins=coins+? WHERE user_id=?",
            (reward, uid)
        )

        cur = con.execute(
            "INSERT INTO plates(owner_id, number, rarity, created_at) VALUES(?,?,?,?)",
            (uid, number, rarity, now)
        )

        plate_id = cur.lastrowid

        updated = con.execute(
            "SELECT coins, spins, last_free_spin_at FROM users WHERE user_id=?",
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
            "rarity": rarity
        },
        "reward": reward,
        "coins": updated["coins"],
        "spins": updated["spins"],
        "used_free_spin": used_free_spin,
        "used_paid_spin": used_paid_spin,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }
    return {"plate": {"id": plate_id, "number": number, "rarity": rarity}, "reward": reward, "coins": updated["coins"], "spins": updated["spins"]}

@app.get("/api/collection")
def collection(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    with db() as con:
        rows = con.execute("SELECT id, number, rarity, created_at FROM plates WHERE owner_id=? ORDER BY id DESC", (user["user_id"],)).fetchall()
    return [dict(r) for r in rows]

@app.get("/api/market")
def market(authorization: str | None = Header(default=None)):
    current_user(authorization)
    with db() as con:
        rows = con.execute("""SELECT l.id AS listing_id, l.price, p.number, p.rarity, p.id AS plate_id
                              FROM listings l JOIN plates p ON p.id=l.plate_id
                              ORDER BY l.id DESC""").fetchall()
    return [dict(r) for r in rows]

class ListingRequest(BaseModel):
    plate_id: int
    price: int

@app.post("/api/market/list")
def list_plate(payload: ListingRequest, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    if payload.price < 1 or payload.price > 1000000:
        raise HTTPException(400, "Price must be between 1 and 1,000,000 coins")
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        plate = con.execute("SELECT id FROM plates WHERE id=? AND owner_id=?", (payload.plate_id, user["user_id"])).fetchone()
        if not plate:
            con.rollback()
            raise HTTPException(404, "Plate not found in your collection")
        try:
            con.execute("INSERT INTO listings(plate_id, seller_id, price, created_at) VALUES(?,?,?,?)",
                        (payload.plate_id, user["user_id"], payload.price, int(time.time())))
            con.commit()
        except sqlite3.IntegrityError:
            con.rollback()
            raise HTTPException(409, "This plate is already listed")
    return {"ok": True}

@app.post("/api/market/{listing_id}/buy")
def buy_listing(listing_id: int, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        listing = con.execute("SELECT * FROM listings WHERE id=?", (listing_id,)).fetchone()
        if not listing:
            con.rollback()
            raise HTTPException(404, "Listing not found")
        if listing["seller_id"] == uid:
            con.rollback()
            raise HTTPException(400, "You cannot buy your own listing")
        buyer = con.execute("SELECT coins FROM users WHERE user_id=?", (uid,)).fetchone()
        if buyer["coins"] < listing["price"]:
            con.rollback()
            raise HTTPException(400, "Not enough coins")
        con.execute("UPDATE users SET coins=coins-? WHERE user_id=?", (listing["price"], uid))
        con.execute("UPDATE users SET coins=coins+? WHERE user_id=?", (listing["price"], listing["seller_id"]))
        con.execute("UPDATE plates SET owner_id=? WHERE id=?", (uid, listing["plate_id"]))
        con.execute("DELETE FROM listings WHERE id=?", (listing_id,))
        con.commit()
    return {"ok": True}

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
                text = message.get("text", "")

                if text.startswith("/start"):
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
                        "text": "Добро пожаловать в NUMBER RUSH! Готов испытать удачу?",
                        "reply_markup": keyboard
                    })

        except Exception:
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
