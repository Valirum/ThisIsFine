#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Микросервис уведомлений для ThisIsFine.
Работает как фоновый демон, опрашивает основное приложение и отправляет уведомления в Telegram.
Поддерживает загрузку конфигурации из .env-файла, указанного через --env.
Автоматически применяет временный env (если существует и новее основного).
"""

import os
import sys
import asyncio
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)
from dotenv import load_dotenv
import tempfile

# === Глобальные переменные (инициализируются позже) ===
task_message_ids = {}
warned_tasks = set()
TELEGRAM_BOT_TOKEN = None
CHAT_ID = None
THISISFINE_URL = None
ENV_FILE = None
TMP_ENV_PATH = os.path.join(tempfile.gettempdir(), 'tif_notifier_tmp.env')


def load_config(env_path: Path):
    """Загружает основной .env и, если существует — перекрывает tmp.env."""
    global TELEGRAM_BOT_TOKEN, CHAT_ID, THISISFINE_URL

    if not env_path.exists():
        print(f"Ересь! Основной .env не найден: {env_path}")
        sys.exit(1)

    load_dotenv(env_path, override=False)

    tmp_path = Path(TMP_ENV_PATH)
    if tmp_path.exists():
        # Проверим: новее ли tmp.env основного?
        if tmp_path.stat().st_mtime > env_path.stat().st_mtime:
            print(f"✅ Загружены настройки из временного файла: {TMP_ENV_PATH} (новее {env_path})")
            load_dotenv(tmp_path, override=True)
        else:
            print(f"ℹ️ Временный файл {TMP_ENV_PATH} устарел — используется {env_path}")
    else:
        print(f"ℹ️ Временный файл не найден, используется {env_path}")

    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
    CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
    THISISFINE_URL = os.getenv("THISISFINE_URL", "http://localhost:5000")


def update_task_status(task_id: int, status: str):
    try:
        requests.put(f"{THISISFINE_URL}/tasks/{task_id}", json={"status": status}, timeout=10)
    except Exception as e:
        logger.error(f"Не удалось обновить статус задачи {task_id}: {e}")


def postpone_task(task_id: int, hours: float = 1):
    global warned_tasks
    try:
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        if task_res.status_code != 200:
            return
        task = task_res.json()
        uuid = task.get("uuid")
        if not uuid:
            return

        now = datetime.now(timezone.utc)
        new_planned = now + timedelta(hours=hours)
        deadlines = task.get("deadlines", {})
        deadlines["planned_at"] = new_planned.isoformat().replace("+00:00", "Z")

        res = requests.put(
            f"{THISISFINE_URL}/tasks/{task_id}",
            json={"deadlines": deadlines},
            timeout=10
        )
        if res.status_code == 200:
            warned_tasks = {k for k in warned_tasks if not k.startswith(f"{uuid}_")}
            logger.info(f"Задача {task_id} отложена до {new_planned}. Уведомления сброшены.")
        else:
            logger.error(f"Не удалось отложить задачу {task_id}: {res.status_code} {res.text}")
    except Exception as e:
        logger.error(f"Ошибка при откладывании задачи {task_id}: {e}")


async def check_and_notify(context: ContextTypes.DEFAULT_TYPE):
    global warned_tasks
    bot = context.bot
    chat_id = CHAT_ID
    if not chat_id:
        logger.warning("CHAT_ID не задан — уведомления отключены")
        return

    try:
        res = requests.get(f"{THISISFINE_URL}/notify/pending", timeout=10)
        pending_tasks = res.json() if res.status_code == 200 else []
    except Exception as e:
        logger.error(f"Не удалось получить очередь уведомлений: {e}")
        return

    now = datetime.now(timezone.utc)
    current_warned = set(warned_tasks)

    for task in pending_tasks:
        uuid = task.get("uuid")
        if not uuid:
            continue

        task_id = task["id"]
        title = task["title"]
        notification_type = task.get("notification_type")
        warn_key = f"{uuid}_{notification_type}"
        if warn_key in warned_tasks:
            continue

        text = ""
        btns = None

        if notification_type == "start":
            text = f"🕗 Задача «{title}» пора начинать!"
            btns = InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                [
                    InlineKeyboardButton("+15 мин", callback_data=f"postpone_{task_id}_15"),
                    InlineKeyboardButton("+30 мин", callback_data=f"postpone_{task_id}_30"),
                    InlineKeyboardButton("+1 ч", callback_data=f"postpone_{task_id}_60"),
                    InlineKeyboardButton("+2 ч", callback_data=f"postpone_{task_id}_120")
                ],
                [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
            ])

        elif notification_type == "due_warn":
            text = f"⚠️ У задачи «{title}» осталось мало времени!"
            btns = InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
            ])

        elif notification_type == "overdue":
            text = f"🔥 Задача «{title}» ПРОСРОЧЕНА!"
            btns = InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
            ])

        elif notification_type == "grace_warn":
            text = f"🚨 Последний шанс для «{title}»!"
            btns = InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
            ])

        elif notification_type == "failed":
            text = f"💀 Срок для «{title}» истёк. Задача помечена как FAILED."
            btns = InlineKeyboardMarkup([
                [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
            ])

        else:
            logger.warning(f"Неизвестный тип уведомления: {notification_type}")
            continue

        try:
            msg = await bot.send_message(chat_id=chat_id, text=text, reply_markup=btns)
            if uuid not in task_message_ids:
                task_message_ids[uuid] = []
            task_message_ids[uuid].append({
                "msg_id": msg.message_id,
                "type": "start" if notification_type in ("start", "due_warn", "overdue", "grace_warn") else "done"
            })
            current_warned.add(warn_key)
        except Exception as e:
            logger.error(f"Не удалось отправить уведомление для задачи {task_id}: {e}")

    warned_tasks = current_warned


async def clear_task_messages(bot, chat_id, uuid, action_type=None):
    if uuid not in task_message_ids:
        return

    messages_to_keep = []
    for item in task_message_ids[uuid]:
        msg_id = item["msg_id"]
        msg_type = item["type"]
        if action_type is None or msg_type == action_type:
            try:
                await bot.edit_message_reply_markup(chat_id=chat_id, message_id=msg_id, reply_markup=None)
            except Exception as e:
                logger.warning(f"Не удалось очистить сообщение {msg_id}: {e}")
        else:
            messages_to_keep.append(item)

    if action_type is None:
        del task_message_ids[uuid]
    else:
        if messages_to_keep:
            task_message_ids[uuid] = messages_to_keep
        else:
            del task_message_ids[uuid]


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    bot = context.bot
    chat_id = query.message.chat_id

    if data.startswith("start_"):
        task_id = int(data.split("_")[1])
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        if task_res.status_code == 200:
            task = task_res.json()
            update_task_status(task_id, "inProgress")
            uuid = task.get("uuid")
            if uuid:
                await clear_task_messages(bot, chat_id, uuid, action_type="start")
            await query.edit_message_text(f"✅ Задача «{task['title']}» переведена в «В работе».")
        else:
            await query.edit_message_text("❌ Не удалось обновить статус задачи.")

    elif data.startswith("postpone_"):
        parts = data.split("_")
        task_id = int(parts[1])
        minutes = int(parts[2]) if len(parts) > 2 else 60
        hours = minutes / 60.0
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        if task_res.status_code == 200:
            task = task_res.json()
            postpone_task(task_id, hours=hours)
            delay_str = {15: "15 мин", 30: "30 мин", 60: "1 час", 120: "2 часа"}.get(minutes, f"{hours:g} ч")
            await query.edit_message_text(f"🕗 Задача «{task['title']}» отложена на {delay_str}.")
        else:
            await query.edit_message_text("❌ Не удалось отложить задачу.")

    elif data.startswith("done_"):
        task_id = int(data.split("_")[1])
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        if task_res.status_code == 200:
            task = task_res.json()
            uuid = task.get("uuid")
            update_task_status(task_id, "done")
            if uuid:
                await clear_task_messages(bot, chat_id, uuid, action_type=None)
            await query.edit_message_text(f"🎉 Задача «{task['title']}» выполнена!")
        else:
            await query.edit_message_text("❌ Не удалось завершить задачу.")


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔔 Бот уведомлений ThisIsFine активен.")


def main():
    global ENV_FILE

    parser = argparse.ArgumentParser(description='Микросервис уведомлений ThisIsFine')
    parser.add_argument('--env', type=Path, default=Path("tif.env"), help='Путь к основному .env-файлу')
    args = parser.parse_args()

    ENV_FILE = args.env
    load_config(ENV_FILE)

    if not TELEGRAM_BOT_TOKEN:
        print("⚠️ TELEGRAM_BOT_TOKEN не задан. Бот запущен, но будет ждать конфигурации.")
        print("ℹ️ Задайте токен через UI (/notify/config) и перезапустите бота с тем же --env.")

    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN or "dummy").build()
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CallbackQueryHandler(button_handler))

    job_queue = app.job_queue
    job_queue.run_repeating(check_and_notify, interval=30, first=10)

    logger = logging.getLogger(__name__)
    logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
    logger.info(f"Бот уведомлений запущен с env={ENV_FILE}")

    try:
        app.run_polling()
    except telegram.error.InvalidToken:
        if not TELEGRAM_BOT_TOKEN:
            logger.warning("Токен отсутствует. Бот ожидает конфигурацию. Завершение.")
            sys.exit(0)
        else:
            raise


if __name__ == "__main__":
    main()