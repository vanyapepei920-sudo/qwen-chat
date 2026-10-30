# Scuarfy Store 🛍

Самостоятельный проект — магазин приложений с Google-входом, категориями,
загрузкой файлов, скачиванием, лайками, отзывами, поиском и автоматическими рекомендациями.

## Возможности
- **Вход через Google** (Google Identity Services) + демо-режим для тестов (`DEMO_LOGIN=True`).
- **Собственный интерфейс** в стиле Microsoft Store: верхняя панель, вкладки, hero-карусель, плитки.
- **Публичный 4-сегментный ID для каждого приложения** вида `a3f2-9c1be4-77ab2-1f09dc34-88ae5b21`
  выдаётся автоматически при публикации; страница приложения — `/store/app/<ID>`.
- **Поиск приложений** — живая строка поиска в шапке (по названию, издателю, описанию).
- **Рекомендации** — формируются автоматически: больше всего лайков ♥, скачиваний ⬇ и хорошие отзывы ★
  (формула: `likes*3 + downloads/5 + rating*votes`). Кнопки «рекомендовать» при публикации нет.
- **Лайки, звёздочные оценки и текстовые отзывы** пользователей.
- **Категории** с отдельными страницами (`/store/category/<id>`), управлением эмодзи.
- **Администрирование**: загрузка .exe/.zip/.apk и других файлов (до `MAX_APP_SIZE_MB`),
  редактирование карточек, замена файлов, удаление, управление категориями и администраторами.

## Секретная активация админ-панели
Кнопки админ-панели в интерфейсе **нет**. Переходите вручную:

```
/admin_streaker
```

Там вводится пароль администратора (берётся из `ADMIN_PASSWORD` в `.env`,
либо задаётся при первом вводе, если переменная пуста). После активации открывается
`/store-admin` (тоже без публичных кнопок — только по прямой ссылке).

## Запуск
```bash
pip install -r requirements.txt
cp .env.example .env      # при необходимости отредактируйте
python app.py             # http://127.0.0.1:5000/store
```

## Запуск на Termux (Android)
Проект полностью совместим с Termux — обязательные зависимости чисто питоновые,
а тяжёлые пакеты (google-auth, PyJWT, cryptography, gunicorn) вынесены из
`requirements.txt`: если они не установлены, приложение автоматически использует
встроенную pure-python проверку подписи RS256 для Google-токенов.

```bash
pkg update && pkg upgrade
pkg install python git
git clone https://github.com/vanyapepei920-sudo/qwen-chat scuarfy-store
cd scuarfy-store
pip install -r requirements.txt   # google-auth ставить НЕ нужно
# Если установка fpdf2 всё же падает (например, из-за Pillow на свежем Python) —
# не страшно: приложение само переключится на текстовые отчёты (.txt) вместо PDF.
# В таком случае можно поставить минимум: pip install flask flask-cors python-dotenv requests
cp .env.example .env              # заполните GOOGLE_CLIENT_ID и ADMIN_PASSWORD
python app.py                     # http://127.0.0.1:5000/store
```

Вход через Google с телефона: в Google Cloud Console добавьте origin
`http://127.0.0.1:5000` (и `http://localhost:5000`) в Authorized JavaScript origins.
Если заходите по локальной сети, задайте `HOST=0.0.0.0` в `.env`.

Совет: выполните `termux-wake-lock`, чтобы сервер не засыпал при сворачивании Termux.

## Структура
```
app.py                  — всё приложение (Flask + SQLite instance/scuarfy.db)
templates/              — base, store, store_app, store_category, store_admin, admin_streaker, auth, ошибки
assets/css/scuarfy.css  — оформление
assets/js/              — global.js, store.js, store_admin.js
uploads/apps|icons      — файлы приложений и иконки
```

## Настройки (.env)
Полный образец со комментариями — в файле [`.env.example`](.env.example).

| Переменная | Назначение |
|---|---|
| GOOGLE_CLIENT_ID | OAuth Client ID Google |
| GOOGLE_CLIENT_SECRET | OAuth Client Secret Google (не требуется для проверки ID-токена) |
| FLASK_SECRET_KEY | ключ сессий |
| FLASK_DEBUG | режим отладки (True/False) |
| SESSION_LIFETIME_HOURS | время жизни сессии, ч |
| HOST / PORT | хост и порт dev-сервера |
| ADMIN_PASSWORD | пароль для /admin_streaker (пусто = задать при первом вводе) |
| DEMO_LOGIN | True — разрешить демо-вход |
| MAX_APP_SIZE_MB | лимит размера загружаемого файла |
