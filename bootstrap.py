#!/usr/bin/env python3
# bootstrap.py — священный ритуал с поддержкой --no-notifier

import os
import sys
import subprocess
import venv
import argparse
import threading
import queue
from pathlib import Path

# --- Константы ---
DEFAULT_ENV_FILE = Path("tif.env")
VENV_DIR = Path(".venv")
REQUIREMENTS = "requirements.txt"
ALL_MODULES = ["app.py", "logic.py", "notifier_bot.py"]  # ← теперь константа
ENV_DEFAULT_CONTENT = """# URL базы данных (SQLite по умолчанию)
DATABASE_URL=sqlite:///./instance/taskdb.sqlite

# Токен Telegram-бота, выданный Омниссией через @BotFather
TELEGRAM_BOT_TOKEN=

# ID чата, в который бот будет отправлять уведомления
TELEGRAM_CHAT_ID=

# Корневой URL приложения (для генерации ссылок и обратной связи)
THISISFINE_URL=http://localhost

# Порт, на котором будет слушать священный Flask-когитатор
PORT=5000
"""


def praise_omnissiah():
    print("Хвала Омниссии! Инициация священного окружения...")


def create_default_env_file():
    if not DEFAULT_ENV_FILE.exists():
        print(f"Создаётся священный .env-свиток по умолчанию: {DEFAULT_ENV_FILE}")
        DEFAULT_ENV_FILE.write_text(ENV_DEFAULT_CONTENT, encoding="utf-8")
        print("⚠️  ВНИМАНИЕ: Отредактируйте tif.env — вставьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID!")


def create_venv():
    if not VENV_DIR.exists():
        print(f"Созидается виртуальное святилище: {VENV_DIR}")
        venv.create(VENV_DIR, with_pip=True)
    else:
        print(f"Святилище {VENV_DIR} уже освящено.")


def install_deps():
    pip = VENV_DIR / ("Scripts/pip.exe" if os.name == "nt" else "bin/pip")
    if not pip.exists():
        raise RuntimeError("Не дозволено: pip отсутствует в святилище!")
    print("Освящение зависимостей...")
    subprocess.check_call([str(pip), "install", "-r", REQUIREMENTS], stdout=subprocess.DEVNULL)


def get_python():
    return VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def enqueue_output(pipe, q, module_name):
    try:
        for line in iter(pipe.readline, ''):
            q.put(f"[{module_name}] - {line.rstrip()}")
    except Exception as e:
        q.put(f"[{module_name}] - ОШИБКА ПОТОКА ВЫВОДА: {e}")
    finally:
        pipe.close()


def launch_module(python_exec, module, env_path, log_queue):
    cmd = [str(python_exec), module, "--env", str(env_path)]
    print(f"Призыв машинного духа: {' '.join(cmd)}")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding='utf-8',
            errors='replace'
        )
        t = threading.Thread(target=enqueue_output, args=(proc.stdout, log_queue, module), daemon=True)
        t.start()
        return proc
    except Exception as e:
        log_queue.put(f"[{module}] - КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Священный ритуал запуска модулей Культа Механикус")
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV_FILE, help="Путь к .env-свитку")
    parser.add_argument("--no-notifier", "-nn", action="store_true", help="Не запускать notifier_bot.py")
    args = parser.parse_args()
    env_file: Path = args.env

    praise_omnissiah()

    if env_file.resolve() == DEFAULT_ENV_FILE.resolve():
        create_default_env_file()
    else:
        if not env_file.exists():
            print(f"Ересь! Указанный .env-свиток не существует: {env_file}")
            sys.exit(1)

    create_venv()
    install_deps()

    # === Формирование списка модулей для запуска ===
    modules_to_run = ALL_MODULES.copy()
    if args.no_notifier:
        if "notifier_bot.py" in modules_to_run:
            modules_to_run.remove("notifier_bot.py")
            print("📵 notifier_bot.py отключён по флагу --no-notifier")
        else:
            print("⚠️  notifier_bot.py отсутствует в списке модулей")

    python_exec = get_python()
    log_queue = queue.Queue()
    processes = []

    for module in modules_to_run:
        if not Path(module).exists():
            print(f"Ересь! Модуль {module} не обнаружен.")
            sys.exit(1)
        proc = launch_module(python_exec, module, env_file, log_queue)
        if proc:
            processes.append((module, proc))

    if not processes:
        print("Нет модулей для запуска. Ритуал завершён.")
        return

    print("Все модули призваны. Ожидание логов...\n" + "="*60)

    try:
        while True:
            try:
                line = log_queue.get(timeout=1)
                print(line)
                if "ThisIsFine запущен на порту" in line:
                    print("\n🔥 Хвала Омниссии! Сервер активен. Откройте http://localhost:5000")
            except queue.Empty:
                if not any(proc.poll() is None for _, proc in processes):
                    print("\nВсе модули завершили работу.")
                    break
    except KeyboardInterrupt:
        print("\n🛑 Ритуал прерван вручную. Завершение модулей...")
    finally:
        for module, proc in processes:
            if proc.poll() is None:
                proc.terminate()
        for module, proc in processes:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        print("Все машинные духи упокоены.")


if __name__ == "__main__":
    main()