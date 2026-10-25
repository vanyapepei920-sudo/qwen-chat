# SpeedNet — спидометр интернета с входом через Google

Полноценный аналог speedtest.net: тест скорости (загрузка/отдача/ping/jitter), 70+ интернет-инструментов, история замеров. Весь бэкенд — один файл `app.py` (Flask), настройки — `.env`. Работает на ПК и в **Termux** на Android.

## 🔐 Вход через Google (обязателен)

Без авторизации сайт недоступен: главная страница и все `/api/*` требуют сессию Google.

**Куда вставить ваш API-ключ (клиент Google OAuth):**
1. Скопируйте `.env.example` → `.env` (или просто создайте `.env`)
2. Впишите две строки:
```
GOOGLE_CLIENT_ID=ваш_клиент_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=ваш_секрет
```
3. Перезапустите сервер (`python app.py`). Готово — на странице входа появится кнопка «Войти через Google».

Как получить ключи: [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth client ID (Web application) → Authorized redirect URI: `http://localhost:5000/oauth2/callback` (или ваш домен).

Дополнительно: `ALLOWED_EMAILS=a@b.com,c@d.com` — пускать только эти адреса. Для локальной разработки без Google можно включить обходной демо-вход: `ALLOW_DEMO_LOGIN=1` (по умолчанию выключен).

## 🚀 Запуск

### Обычный (ПК/сервер)
```bash
pip install -r requirements.txt   # нужен только Flask
cp .env.example .env              # вписать GOOGLE_CLIENT_ID / SECRET
python app.py                     # http://localhost:5000
```

### Termux (Android)
Установите Termux из F-Droid (не из Play Market), затем:
```bash
pkg update && pkg install -y git python openssl libffi
git clone https://github.com/vanyapepei920-sudo/qwen-chat.git
cd qwen-chat
./run.sh          # или bash start-termux.sh
```
`run.sh` сам ставит зависимости и запускает сервер. Доступ: http://localhost:5000.
С другого устройства в Wi-Fi: `BIND_ALL=1 ./run.sh`, откройте `http://IP-телефона:5000` (IP — команда `ifconfig`).

## ⚡ Speedtest REAL v3
Гauge-спидометр до 1 Гбит/с · 8 параллельных потоков download + 4 upload · 15 edge-серверов Cloudflare по городам мира · автовыбор ближайшего POP (гео + реальный пинг) · ручной выбор сервера · ping/jitter/потери · live-график · кнопка Стоп · вердикт A+…F + видео-профиль (SD→8K) · шаринг результата ссылкой и постером · история (localStorage + сервер).

## 🌐 Интернет-функции (70+ эндпоинтов)
- **Скорость**: ping, jitter, download/upload, throughput, QoS, MTU/MTU-path, TLS-benchmark, latency-map, NAT-type, proxy-check
- **IP/гео**: ipinfo, client-geo, geolocate, timezone, headers, useragent, referrer
- **DNS/сеть**: dns, dnssec, dane, bgp, rbl, whois, ports, ping-sweep, traceroute, cidr/subnet-info, websockets-check, cache-test, censorship
- **Полезное**: weather, crypto, exchange, news, rss, search, translate, qr, hash, password, random, email-check, url-analyze, httpstatus, uptime, tld, shortening, internet-health
- **История**: result, history, stats, speed-history-chart

Все функции доступны только после входа. Секреты не коммитятся (`.env` в .gitignore).
