# SpeedNet — спидометр интернета с обязательным входом через Google

Полноценный аналог speedtest.net: тест скорости (загрузка/отдача/ping/jitter), 70+ интернет-инструментов, история замеров. **Сервер не нужен** — сайт работает как один `index.html` (+ `js/`, `css/`) где угодно: GitHub Pages, обычный хостинг, файл на диске или Termux. Все API-функции исполняются прямо в браузере (`js/apibridge.js`).

## 🔐 Вход через Google (обязателен)

Без авторизации через аккаунт Google сайт недоступен: экран входа блокирует интерфейс, а все функции возвращают «нужен вход».

### КУДА ВСТАВИТЬ ВАШ GOOGLE API KEY (три способа — любой)

1️⃣ **В файле `js/auth.js`** (самый простой). Откройте файл, найдите блок `DEFAULTS` (~строка 30) и замените заглушку:
```js
const DEFAULTS = {
  apiKey: "AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // ← сюда ваш ключ AIzaSy...
  clientId: "",    // ← сюда OAuth Client ID вида 123456-xxx.apps.googleusercontent.com
  appId: "",       // необязательно
};
```

2️⃣ **Через адресную строку** (без правки файлов):
```
index.html?key=AIzaSyВАШ_КЛЮЧ&client=1234567890-xxxx.apps.googleusercontent.com
```
Ключи сохранятся в localStorage браузера, адрес очистится.

3️⃣ **На самом сайте**: вкладка «Настройки» → блок «🔑 Google Sign-In» → вставьте значения → Сохранить.

Приоритет: сохранённые (2/3) > ключ из файла. Заглушка `AIzaXXXX...` не считается ключом — пока не вставите настоящий, показывается подсказка.

### Где взять ключ
- [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) → Create credentials → **API key** (начинается с `AIza`)
- Для входа через Google включите Firebase Authentication (Google provider) или OAuth Consent Screen + Credentials → OAuth client ID (Web) — оттуда `clientId`
- ⚠️ Ограничьте ключ: HTTP referrers → домен сайта; разрешите только «Firebase Authentication API» / «Custom Search JSON API»

### Google Custom Search (вкладка «Поиск»)
Тот же API-key работает и для поиска: впишите его одним из способов выше + `cx` (Search Engine ID с programmablesearchengine.google.com) в поле «Ключи Google Custom Search API». Поле ключа можно оставить пустым — возьмётся встроенный.

## 🚀 Запуск

### Просто открыть
Двойной клик по `index.html` или любой статический хостинг (GitHub Pages / Netlify / Vercel).

### Termux (Android)
Установите Termux из F-Droid (не из Play Market), затем:
```bash
pkg update && pkg install -y git python
git clone https://github.com/vanyapepei920-sudo/qwen-chat.git
cd qwen-chat
python -m http.server 8080     # откройте http://localhost:8080
```
Никаких зависимостей и скриптов не требуется — сайт полностью статический.

## ⚡ Speedtest REAL v3
Gauge-спидометр до 1 Гбит/с · 8 параллельных потоков download + 4 upload · 15 edge-серверов Cloudflare по городам мира · автовыбор ближайшего POP (гео + реальный пинг) · ручной выбор сервера · ping/jitter/потери · live-график · кнопка Стоп · вердикт A+…F + видео-профиль (SD→8K) · шаринг ссылкой и постером · история в localStorage.

## 🌐 Интернет-функции (70+, всё в браузере)
- **Скорость**: ping, jitter, download/upload, throughput, QoS, MTU/MTU-path, TLS-benchmark, NAT-type, proxy-check
- **IP/гео**: ipinfo, client-geo, geolocate, timezone, headers, useragent, referrer
- **DNS/сеть**: dns (DoH), dnssec, dane, bgp, rbl, whois, ports, ping-sweep, cidr/subnet-info, websockets-check, cache-test, censorship
- **Полезное**: weather, crypto, exchange, news, rss, search (Google CSE/DDG/Wiki/GitHub/HN), translate, qr, hash, password, random, email-check, url-analyze, httpstatus, tld, internet-health
- **История**: result, history, stats, speed-history-chart

Все функции доступны только после входа через Google. Секретов в репозитории нет.
