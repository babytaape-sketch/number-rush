# NUMBER RUSH v2 — Telegram Mini App starter

## В комплекте
- Новый neon-интерфейс: генератор, коллекция, рынок.
- FastAPI + SQLite backend.
- Проверка Telegram Mini App initData (HMAC).
- Серверная генерация номеров и редкости.
- Атомарное списание попытки и создание номера.
- Рынок за игровые монеты с атомарной передачей владения.

## Локальный запуск
Python 3.11+, затем:
1. `python -m venv .venv` и активировать окружение.
2. `pip install -r requirements.txt`
3. Скопировать `.env.example` в `.env`.
4. Оставить `DEV_MODE=true` только для локального просмотра.
5. `uvicorn app.main:app --reload`
6. Открыть `http://127.0.0.1:8000`.

## До публичного запуска обязательно
- Установить `DEV_MODE=false`, задать BOT_TOKEN и HTTPS-домен.
- Настроить Mini App URL через BotFather.
- Добавить rate limiting, аудит операций, резервные копии, мониторинг и админ-панель.
- Подключить Telegram Stars отдельным платёжным потоком: invoice (`XTR`), обработка `pre_checkout_query` и подтверждение `successful_payment`. Не начислять товар по клиентскому callback.
- Сейчас рынок работает только за внутриигровые монеты. Stars/P2P-переводы не реализованы.
- Реализовать безопасные предложения обмена/передачи с подтверждением обеих сторон.
- Текущие номера демонстрационные, не дают прав на реальные регистрационные знаки.
- Проверить действующие правила Telegram, требования к цифровым товарам, налоги и законодательство целевых стран.

## API
GET `/api/me`; POST `/api/spin`; GET `/api/collection`; GET `/api/market`;
POST `/api/market/list` с `{ "plate_id": 1, "price": 100 }`;
POST `/api/market/{listing_id}/buy`.
