#!/data/data/com.termux/files/usr/bin/bash
# SpeedNet — быстрый старт в Termux
set -e
pkg update -y
pkg install -y python openssl libffi
python3 -m pip install -r requirements.txt || python3 -m pip install -r requirements.txt --break-system-packages
[ -f .env ] || cp .env.example .env
echo "== Запуск: http://localhost:${PORT:-5000} =="
exec bash run.sh "${1:-5000}"
