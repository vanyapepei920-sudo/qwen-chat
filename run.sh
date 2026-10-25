#!/data/data/com.termux/files/usr/bin/bash
# SpeedNet — автозапуск (Termux / Linux / macOS)
set -e
PORT="${1:-5000}"
[ "$PORT" = "--no-browser" ] && PORT=5000
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Python + pip
if ! command -v python3 >/dev/null 2>&1; then
  echo "[run.sh] Python не найден — устанавливаю..."
  if command -v pkg >/dev/null 2>&1; then pkg update -y && pkg install -y python openssl libffi
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y python3 python3-pip
  elif command -v pacman >/dev/null 2>&1; then sudo pacman -Sy --noconfirm python
  elif command -v brew >/dev/null 2>&1; then brew install python
  else echo "Установите Python 3 вручную"; exit 1; fi
fi

# Зависимости (flask)
if ! python3 -c "import flask" 2>/dev/null; then
  echo "[run.sh] Устанавливаю зависимости..."
  python3 -m pip install -r requirements.txt \
    || python3 -m pip install -r requirements.txt --break-system-packages \
    || pip install -r requirements.txt
fi

[ -f .env ] || cp .env.example .env
echo "[run.sh] Запуск SpeedNet на http://localhost:$PORT (Ctrl+C — стоп)"
PORT="$PORT" python3 app.py
