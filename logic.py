#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Асинхронный демон логики ThisIsFine.
Запускает независимые периодические задачи с разными интервалами.
Поддерживает загрузку конфигурации из .env-файла.
"""

import asyncio
import aiohttp
import logging
import argparse
from pathlib import Path
from dotenv import load_dotenv
import os
from urllib.parse import urljoin

# === Константы по умолчанию ===
DEFAULT_ENV_FILE = Path("tif.env")

# Интервалы в секундах (неизменны)
TICK_INTERVAL = 15      # для /logic/process-tick — быстрый
SPAWN_INTERVAL = 30     # для /logic/spawn-recurring — средний
SYNC_INTERVAL = 900     # для /sync/peers/sync — медленный (15 мин)

# Глобальные переменные (инициализируются в main)
THISISFINE_URL = None

# Логгер
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ThisIsFine.Logic")


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
    global THISISFINE_URL
    while True:
        url = urljoin(THISISFINE_URL, "/logic/process-tick")
        await call_endpoint(session, url, "process-tick")
        await asyncio.sleep(TICK_INTERVAL)


async def periodic_spawn_recurring(session: aiohttp.ClientSession):
    """Порождение следующих задач в цепи повторяющихся."""
    global THISISFINE_URL
    while True:
        url = urljoin(THISISFINE_URL, "/logic/spawn-recurring")
        await call_endpoint(session, url, "spawn-recurring")
        await asyncio.sleep(SPAWN_INTERVAL)


async def periodic_sync_peers(session: aiohttp.ClientSession):
    """Фоновая синхронизация с пировыми устройствами."""
    global THISISFINE_URL
    while True:
        peers_url = urljoin(THISISFINE_URL, "/sync/peers")
        try:
            async with session.get(peers_url) as resp:
                if resp.status != 200:
                    await asyncio.sleep(SYNC_INTERVAL)
                    continue
                peers = await resp.json()
        except Exception as e:
            logger.warning(f"Не удалось получить список пиров: {e}")
            await asyncio.sleep(SYNC_INTERVAL)
            continue

        if not peers:
            logger.debug("Нет пиров для синхронизации")
            await asyncio.sleep(SYNC_INTERVAL)
            continue

        sync_url = urljoin(THISISFINE_URL, "/sync/peers/sync")
        for peer in peers:
            address = peer.get("address")
            if not address:
                continue
            logger.info(f"🔄 Синхронизация с {peer.get('name', address)}")
            try:
                payload = {"address": address}
                async with session.post(
                    sync_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
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


async def main():
    global THISISFINE_URL

    parser = argparse.ArgumentParser(description='Асинхронный демон логики ThisIsFine')
    parser.add_argument('--env', type=Path, default=DEFAULT_ENV_FILE, help='Путь к .env-файлу')
    args = parser.parse_args()

    env_path = args.env
    if not env_path.exists():
        logger.error(f"Ересь! Файл окружения не найден: {env_path}")
        exit(1)

    load_dotenv(env_path, override=True)

    port = os.getenv("PORT")
    if port:
        try:
            port = int(port)
        except ValueError:
            logger.warning("Неверный PORT в .env, используется 5000")
            port = 5000
    else:
        port = 5000

    THISISFINE_URL = os.getenv("THISISFINE_URL")
    if not THISISFINE_URL:
        THISISFINE_URL = f"http://localhost:{port}"
        logger.info(f"THISISFINE_URL не задан, используется: {THISISFINE_URL}")
    else:
        # Убеждаемся, что URL заканчивается без слэша для корректного urljoin
        if THISISFINE_URL.endswith('/'):
            THISISFINE_URL = THISISFINE_URL.rstrip('/')

    logger.info(f"🧠 Асинхронный демон логики запущен с env={env_path}")
    logger.info(f"🔗 Целевой URL: {THISISFINE_URL}")

    async with aiohttp.ClientSession() as session:
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