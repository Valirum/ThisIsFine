#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Асинхронный демон логики ThisIsFine.
Запускает независимые периодические задачи с разными интервалами.
"""

import asyncio
import aiohttp
import logging
from datetime import datetime, timezone

# === Настройки ===
THISISFINE_URL = "http://localhost:5000"

# Интервалы в секундах
TICK_INTERVAL = 15      # для /logic/process-tick — быстрый
SPAWN_INTERVAL = 30     # для /logic/spawn-recurring — средний
SYNC_INTERVAL = 900     # для /sync/peers/sync — медленный (15 мин)

# Логгер
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ThisIsFine.Logic")


# === Асинхронные задачи ===

async def call_endpoint(session: aiohttp.ClientSession, url: str, name: str):
    """Универсальная функция вызова эндпоинта с логированием."""
    try:
        async with session.post(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 200:
                logger.info(f"✅ {name} — успешно")
            else:
                text = await resp.text()
                logger.error(f"❌ {name} — HTTP {resp.status}: {text}")
    except asyncio.TimeoutError:
        logger.error(f"⏰ {name} — таймаут")
    except Exception as e:
        logger.exception(f"💥 {name} — ошибка: {e}")


async def periodic_process_tick(session: aiohttp.ClientSession):
    """Обновление статусов по времени (planned → overdue → failed)."""
    while True:
        await call_endpoint(session, f"{THISISFINE_URL}/logic/process-tick", "process-tick")
        await asyncio.sleep(TICK_INTERVAL)


async def periodic_spawn_recurring(session: aiohttp.ClientSession):
    """Порождение следующих задач в цепи повторяющихся."""
    while True:
        await call_endpoint(session, f"{THISISFINE_URL}/logic/spawn-recurring", "spawn-recurring")
        await asyncio.sleep(SPAWN_INTERVAL)


async def periodic_sync_peers(session: aiohttp.ClientSession):
    """Фоновая синхронизация с пировыми устройствами."""
    while True:
        # Получаем список пиров
        try:
            async with session.get(f"{THISISFINE_URL}/sync/peers") as resp:
                if resp.status != 200:
                    await asyncio.sleep(SYNC_INTERVAL)
                    continue
                peers = await resp.json()
        except Exception as e:
            logger.warning(f"Не удалось получить список пиров для синхронизации: {e}")
            await asyncio.sleep(SYNC_INTERVAL)
            continue

        if not peers:
            logger.debug("Нет пиров для синхронизации")
            await asyncio.sleep(SYNC_INTERVAL)
            continue

        # Синхронизируем с каждым пиром поочерёдно
        for peer in peers:
            address = peer.get("address")
            if not address:
                continue
            logger.info(f"🔄 Запуск синхронизации с {peer.get('name', address)}")
            try:
                # Отправляем запрос на /sync/peers/sync с указанием адреса
                payload = {"address": address}
                async with session.post(
                    f"{THISISFINE_URL}/sync/peers/sync",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)  # до 1 мин на пир
                ) as resp:
                    if resp.status == 200:
                        logger.info(f"✅ Синхронизация с {address} завершена")
                    else:
                        text = await resp.text()
                        logger.error(f"❌ Синхронизация с {address} провалена: {resp.status} {text}")
            except asyncio.TimeoutError:
                logger.error(f"⏰ Таймаут при синхронизации с {address}")
            except Exception as e:
                logger.exception(f"💥 Ошибка синхронизации с {address}: {e}")

        await asyncio.sleep(SYNC_INTERVAL)


# === Основной запуск ===

async def main():
    logger.info("🧠 Асинхронный демон логики запущен. Хвала Омниссии!")
    async with aiohttp.ClientSession() as session:
        # Запускаем все задачи параллельно
        await asyncio.gather(
            periodic_process_tick(session),
            periodic_spawn_recurring(session),
            periodic_sync_peers(session),
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Демон логики остановлен вручную.")
    except Exception as e:
        logger.exception(f"Критическая ошибка: {e}")