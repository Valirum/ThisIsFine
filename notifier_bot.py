#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Микросервис уведомлений для ThisIsFine.
Работает как фоновый демон, опрашивает основное приложение и отправляет уведомления в Telegram.
"""

import os
import asyncio
import logging
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

load_dotenv("tif.env")

# Попытка загрузить временный env от Flask
import tempfile
TMP_ENV_PATH = os.path.join(tempfile.gettempdir(), 'tif_notifier_tmp.env')
if os.path.exists(TMP_ENV_PATH):
    load_dotenv(TMP_ENV_PATH, override=True)
    print(f"✅ Загружены настройки из временного файла: {TMP_ENV_PATH}")
else:
    print("ℹ️ Временный файл не найден, использую tif.env")


task_message_ids = {}
# === Настройки ===
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
THISISFINE_URL = os.getenv("THISISFINE_URL", "http://localhost:5000")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

# Глобальное хранилище предупреждений
warned_tasks = set()

# --- Вспомогательные функции (без асинхронности, т.к. requests блокирует) ---
def get_all_tasks():
    try:
        res = requests.get(
            f"{THISISFINE_URL}/tasks?due_from=1970-01-01T00:00:00Z&due_to=2038-01-19T03:14:07Z",
            timeout=10
        )
        return res.json() if res.status_code == 200 else []
    except Exception as e:
        logger.error(f"Сбой при запросе к ThisIsFine: {e}")
        return []

def update_task_status(task_id: int, status: str):
    try:
        requests.put(f"{THISISFINE_URL}/tasks/{task_id}", json={"status": status}, timeout=10)
    except Exception as e:
        logger.error(f"Не удалось обновить статус задачи {task_id}: {e}")

def postpone_task(task_id: int, hours: int = 1):
    """Откладывает planned_at на N часов и сбрасывает warned_tasks для этой задачи."""
    global warned_tasks
    print("postpone", task_id)
    try:
        # Получаем текущую задачу
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        print(task_res)
        if task_res.status_code != 200:
            return
        task = task_res.json()
        uuid = task.get("uuid")
        if not uuid:
            return

        # Обновляем planned_at
        now = datetime.now(timezone.utc)
        new_planned = now + timedelta(hours=hours)

        # Формируем deadlines как объект (важно!)
        deadlines = task.get("deadlines", {})
        deadlines["planned_at"] = new_planned.isoformat().replace("+00:00", "Z")

        # Отправляем ТОЛЬКО deadlines и status (если нужно)
        update_data = {
            "deadlines": deadlines
        }
        res = requests.put(
            f"{THISISFINE_URL}/tasks/{task_id}",
            json=update_data,
            timeout=10
        )
        if res.status_code == 200:
            # Сбрасываем уведомления для этой задачи
            warned_tasks = {k for k in warned_tasks if not k.startswith(f"{uuid}_")}
            logger.info(f"Задача {task_id} отложена до {new_planned}. Уведомления сброшены.")
        else:
            logger.error(f"Не удалось отложить задачу {task_id}: {res.status_code} {res.text}")
    except Exception as e:
        logger.error(f"Ошибка при откладывании задачи {task_id}: {e}")

# --- Фоновая задача (работает в том же loop, что и бот) ---
async def check_and_notify(context: ContextTypes.DEFAULT_TYPE):
    global warned_tasks
    bot = context.bot
    chat_id = CHAT_ID
    if not chat_id:
        logger.warning("CHAT_ID не задан — уведомления отключены")
        return

    now = datetime.now(timezone.utc)
    tasks = get_all_tasks()
    current_warned = set(warned_tasks)

    for task in tasks:
        uuid = task.get("uuid")
        if not uuid:
            continue

        status = task.get("status")
        deadlines = task.get("deadlines", {})
        duration = task.get("duration_seconds", 0)
        task_id = task.get("id")
        key_base = f"{uuid}_"

        # 1. Напоминание о старте (только если planned_at задан)
        # 1. Напоминание о старте
        if status == "planned" and deadlines.get("planned_at"):
            planned_at = datetime.fromisoformat(deadlines["planned_at"].replace("Z", "+00:00"))
            if planned_at.tzinfo is None:
                planned_at = planned_at.replace(tzinfo=timezone.utc)
            if now >= planned_at:
                warn_key = f"{uuid}_planned"
                if warn_key not in warned_tasks:
                    # Отправляем уведомление ОДИН РАЗ
                    btns = InlineKeyboardMarkup([
                        [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                        [InlineKeyboardButton("🕗 Отложить на 1ч", callback_data=f"postpone_{task_id}")],
                        [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
                    ])

                    msg = await bot.send_message(chat_id=chat_id, text=f"🕗 Задача «{task['title']}» пора начинать!",
                                           reply_markup=btns)
                    # Сохраняем message_id
                    if uuid not in task_message_ids:
                        task_message_ids[uuid] = []
                    task_message_ids[uuid].append(msg.message_id)
                    current_warned.add(warn_key)

        # 2. Предупреждение: времени в обрез (только если duration > 0)
        # 2. Предупреждение: времени в обрез
        if duration > 0 and status in ("planned", "inProgress") and deadlines.get("due_at"):
            due_at = datetime.fromisoformat(deadlines["due_at"].replace("Z", "+00:00"))
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
            warn_time = due_at - timedelta(seconds=duration)
            if now >= warn_time:
                warn_key = f"{uuid}_due_warn"
                if warn_key not in warned_tasks:
                    btns = InlineKeyboardMarkup([
                        [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                        [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
                    ])
                    msg = await bot.send_message(chat_id=chat_id,
                                           text=f"⚠️ У задачи «{task['title']}» осталось мало времени!",
                                           reply_markup=btns)
                    # Сохраняем message_id
                    if uuid not in task_message_ids:
                        task_message_ids[uuid] = []
                    task_message_ids[uuid].append(msg.message_id)
                    current_warned.add(warn_key)

        # 3. Просрочка: если due_at наступил, а задача не done и не failed
        if status not in ("done", "failed") and deadlines.get("due_at"):
            due_at = datetime.fromisoformat(deadlines["due_at"].replace("Z", "+00:00"))
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
            if now >= due_at and status != "overdue":
                update_task_status(task_id, "overdue")
                btns = InlineKeyboardMarkup([
                    [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                    [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
                ])
                msg = await bot.send_message(chat_id=chat_id, text=f"🔥 Задача «{task['title']}» ПРОСРОЧЕНА!",reply_markup=btns)
                # Сохраняем message_id
                if uuid not in task_message_ids:
                    task_message_ids[uuid] = []
                task_message_ids[uuid].append(msg.message_id)

        # 4. Предупреждение перед окончанием льготы (только если duration > 0 и есть grace_end)
        # 4. Предупреждение перед окончанием льготы
        if duration > 0 and deadlines.get("grace_end") and status not in ("done", "failed"):
            grace_end = datetime.fromisoformat(deadlines["grace_end"].replace("Z", "+00:00"))
            if grace_end.tzinfo is None:
                grace_end = grace_end.replace(tzinfo=timezone.utc)
            warn_time = grace_end - timedelta(seconds=duration)
            if now >= warn_time:
                warn_key = f"{uuid}_grace_warn"
                if warn_key not in warned_tasks:
                    btns = InlineKeyboardMarkup([
                        [InlineKeyboardButton("▶️ Начать", callback_data=f"start_{task_id}")],
                        [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
                    ])
                    msg = await bot.send_message(chat_id=chat_id, text=f"🚨 Последний шанс для «{task['title']}»!",reply_markup=btns)
                    # Сохраняем message_id
                    if uuid not in task_message_ids:
                        task_message_ids[uuid] = []
                    task_message_ids[uuid].append(msg.message_id)
                    current_warned.add(warn_key)

        # 5. Окончание льготы → перевод в failed (если не done)
        if deadlines.get("grace_end") and status not in ("done", "failed"):
            grace_end = datetime.fromisoformat(deadlines["grace_end"].replace("Z", "+00:00"))
            if grace_end.tzinfo is None:
                grace_end = grace_end.replace(tzinfo=timezone.utc)
            if now >= grace_end:
                update_task_status(task_id, "failed")
                btns = InlineKeyboardMarkup([
                    [InlineKeyboardButton("✅ Готово", callback_data=f"done_{task_id}")]
                ])
                msg = await bot.send_message(chat_id=chat_id,
                                       text=f"💀 Срок для «{task['title']}» истёк. Задача помечена как FAILED.",reply_markup=btns)
                # Сохраняем message_id
                if uuid not in task_message_ids:
                    task_message_ids[uuid] = []
                task_message_ids[uuid].append(msg.message_id)

    warned_tasks = current_warned

async def clear_task_messages(bot, chat_id, uuid):
    """Удаляет кнопки из всех сообщений по задаче."""
    if uuid not in task_message_ids:
        return
    for msg_id in task_message_ids[uuid]:
        try:
            await bot.edit_message_reply_markup(
                chat_id=chat_id,
                message_id=msg_id,
                reply_markup=None  # ← убирает кнопки
            )
        except Exception as e:
            logger.warning(f"Не удалось очистить сообщение {msg_id}: {e}")
    # Удаляем из памяти
    del task_message_ids[uuid]

# --- Обработчики ---
async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    bot = context.bot
    chat_id = query.message.chat_id

    if data.startswith("start_"):
        task_id = int(data.split("_")[1])
        update_task_status(task_id, "inProgress")
        await query.edit_message_text("✅ Задача в работе.")
    elif data.startswith("postpone_"):
        task_id = int(data.split("_")[1])
        postpone_task(task_id, hours=1)
        await query.edit_message_text("🕗 Задача отложена на 1 час.")
    elif data.startswith("done_"):
        task_id = int(data.split("_")[1])
        # Получаем задачу, чтобы взять uuid
        task_res = requests.get(f"{THISISFINE_URL}/tasks/{task_id}", timeout=10)
        if task_res.status_code == 200:
            task = task_res.json()
            uuid = task.get("uuid")
            # Завершаем задачу
            update_task_status(task_id, "done")
            # Удаляем кнопки из всех сообщений
            if uuid:
                await clear_task_messages(bot, chat_id, uuid)
            await query.edit_message_text("🎉 Задача выполнена!")
        else:
            await query.edit_message_text("❌ Не удалось завершить задачу.")

async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔔 Бот уведомлений ThisIsFine активен.")

# --- Запуск ---
def main():
    if not TELEGRAM_BOT_TOKEN:
        raise ValueError("Укажите TELEGRAM_BOT_TOKEN в переменных окружения")

    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CallbackQueryHandler(button_handler))

    # Регистрируем фоновую задачу через job queue
    job_queue = app.job_queue
    job_queue.run_repeating(check_and_notify, interval=60, first=10)

    logger.info("Бот уведомлений запущен")
    app.run_polling()

if __name__ == "__main__":
    main()