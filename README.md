# NUMBER RUSH v3 — исправленный стартовый проект

В этой версии правильная структура каталогов:
- `app/main.py` — FastAPI backend
- `web/index.html`, `web/style.css`, `web/app.js` — Telegram Mini App интерфейс
- `requirements.txt` — зависимости
- `render.yaml` — пример конфигурации Render

## Запуск локально
Требуется Python 3.11+.

```bash
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```
Откройте http://127.0.0.1:8000

## Загрузка на GitHub
Загрузите ВСЁ содержимое этой папки в корень репозитория, сохраняя папки `app` и `web`.
Не загружайте `.env`. Файл `.env.example` безопасен: в нём только заглушка токена.

## Render
Подключите репозиторий в Render как Web Service. Build command:
`pip install -r requirements.txt`

Start command:
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Для теста оставьте `DEV_MODE=true`. Для публичного запуска обязательно:
1. Установить `DEV_MODE=false`.
2. Добавить `BOT_TOKEN` в Environment Variables Render (не в GitHub).
3. Настроить постоянный диск для SQLite или подключить управляемую базу данных.
4. Настроить HTTPS URL Mini App через BotFather.

## Важно
Это стартовый демонстрационный проект, не готовый коммерческий релиз. DEV_MODE даёт тестового пользователя и не должен оставаться включённым в публичной версии. В текущем прототипе нет Telegram Stars, пользовательских переводов, полноценной админ-панели и защиты от злоупотреблений. Не используйте реальные деньги и не обещайте вывод средств.
