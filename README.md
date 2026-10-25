# NetPulse 🌐

Сетевой дашборд: ping, traceroute, DNS-тесты, скорость интернета, поиск, история, аккаунты.
Основной проект (версия copied-netpulse) — Flask-сервер + SQLite.

## Запуск локально

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # заполните секреты
python app.py                   # http://127.0.0.1:5000
```

## Переменные окружения (.env)

| Переменная | Назначение |
|---|---|
| GOOGLE_CLIENT_ID / SECRET | Вход через Google (необязательно) |
| GOOGLE_SEARCH_API_KEY / CX | Поиск (необязательно) |
| FLASK_SECRET_KEY | Сессии (сгенерируйте длинную случайную строку) |
| HOST / PORT | Адрес сервера (по умолчанию 127.0.0.1:5000) |

## Публикация в интернет

GitHub Pages умеет только статику, а NetPulse — это Python-сервер, поэтому публикуем на **Render** (бесплатно):

1. Зарегистрируйтесь на https://render.com через GitHub;
2. New → Web Service → выберите этот репозиторий (`vanyapepei920-sudo/qwen-chat`);
3. Runtime: **Python 3**, Build command: `pip install -r requirements.txt`, Start command: `gunicorn app:app --bind 0.0.0.0:$PORT`;
4. Добавьте переменные окружения из `.env.example` в разделе Environment;
5. В `requirements.txt` уже есть gunicorn — после первого деплоя сайт получит адрес вида `https://netpulse.onrender.com`.

Альтернатива: любой хостинг с Python (Railway, Fly.io, VPS).

## Структура

```
app.py            — сервер (Flask): API, страницы, вход через Google, SQLite
templates/        — HTML-страницы (Jinja2)
assets/css, js/   — стили и скрипты фронта
.env.example      — шаблон настроек
requirements.txt  — зависимости
```
