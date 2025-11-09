import logging
import uuid
import argparse
from flask import Flask, request, jsonify
from models import db, Task, Tag, TaskStatusLog, PeerDevice
from datetime import datetime, timezone, timedelta
import os
from pathlib import Path
from dotenv import load_dotenv
from dateutil import parser
import requests
import traceback
from tag_suggester import TagSuggester
import threading
import atexit
import tempfile
import sys

# === Глобальные переменные (инициализируются в create_app) ===
TMP_ENV_PATH = None
TELEGRAM_CONFIG = {}
PORT = None
BASE_DIR = None
INSTANCE_DIR = None
NOTIFIED_CACHE = set()
app = None


def cleanup_tmp_env():
    """Удаляет временный env-файл при завершении."""
    global TMP_ENV_PATH
    if TMP_ENV_PATH and os.path.exists(TMP_ENV_PATH):
        os.remove(TMP_ENV_PATH)
        print(f"🧹 Временный файл {TMP_ENV_PATH} удалён.")


def ensure_database_dir(database_url: str, base_dir: Path) -> str:
    if database_url.startswith("sqlite:///"):
        db_path_str = database_url[len("sqlite:///"):]
        if db_path_str.startswith("/./"):
            db_path = base_dir / db_path_str[3:]
        else:
            db_path = Path(db_path_str).resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_path.as_posix()}"
    return database_url


def create_app(env_path: Path):
    global TMP_ENV_PATH, TELEGRAM_CONFIG, PORT, BASE_DIR, INSTANCE_DIR, app

    if not env_path.exists():
        print(f"Ересь! Файл окружения не найден: {env_path}")
        sys.exit(1)

    load_dotenv(env_path, override=True)

    BASE_DIR = Path(__file__).parent.resolve()
    INSTANCE_DIR = BASE_DIR / "instance"
    os.makedirs(INSTANCE_DIR, exist_ok=True)

    # Порт: из .env, иначе 5000
    PORT = int(os.getenv("PORT", "5000"))

    # Временный файл для нотификатора
    TMP_ENV_PATH = os.path.join(tempfile.gettempdir(), 'tif_notifier_tmp.env')
    atexit.register(cleanup_tmp_env)

    # Telegram-конфиг
    TELEGRAM_CONFIG = {
        "bot_token": os.getenv("TELEGRAM_BOT_TOKEN"),
        "chat_id": os.getenv("TELEGRAM_CHAT_ID")
    }

    # База данных
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        DEFAULT_DB_PATH = INSTANCE_DIR / "taskdb.sqlite"
        DATABASE_URL = f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"
    DATABASE_URI = ensure_database_dir(DATABASE_URL, BASE_DIR)

    # Flask
    app = Flask(__name__, static_folder=BASE_DIR / "static")
    app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URI
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)

    return app


def setup_routes(app, env_path: Path):
    global TELEGRAM_CONFIG, TMP_ENV_PATH, PORT, NOTIFIED_CACHE

    suggester_lock = threading.Lock()
    tag_suggester = None

    def create_task_with_log(
        title,
        note=None,
        planned_at=None,
        due_at=None,
        grace_end=None,
        duration_seconds=0,
        priority='routine',
        recurrence_seconds=0,
        dependencies=None,
        status='planned',
        tags=None,
        next_uuid=None,
        task_uuid=None
    ):
        if dependencies is None:
            dependencies = []
        if tags is None:
            tags = []
        if task_uuid is None:
            task_uuid = str(uuid.uuid4())
        task = Task(
            uuid=task_uuid,
            title=title,
            note=note,
            planned_at=planned_at,
            due_at=due_at,
            grace_end=grace_end,
            duration_seconds=duration_seconds,
            priority=priority,
            recurrence_seconds=recurrence_seconds,
            dependencies=dependencies,
            status=status,
            next_uuid=next_uuid
        )
        resolved_tags = []
        for name in tags:
            name = name.strip().lower()
            if not name:
                continue
            tag = Tag.query.filter_by(name=name).first()
            if not tag:
                tag = Tag(name=name)
                db.session.add(tag)
            resolved_tags.append(tag)
        task.tags = resolved_tags
        db.session.add(task)
        db.session.flush()
        log_entry = TaskStatusLog(task_uuid=task.uuid, status=status)
        db.session.add(log_entry)
        return task

    def init_tag_suggester():
        nonlocal tag_suggester
        with app.app_context():
            tasks_from_db = Task.query.all()
            training_data = [
                {
                    "text": f"{task.title} {task.note or ''}",
                    "tags": [tag.name for tag in task.tags]
                }
                for task in tasks_from_db
                if task.tags
            ]
            tag_suggester = TagSuggester(tasks=training_data)

    with app.app_context():
        db.create_all()
        init_tag_suggester()

    # === Эндпоинты ===
    @app.route('/suggest-tags', methods=['POST'])
    def suggest_tags():
        nonlocal tag_suggester
        if tag_suggester is None:
            return jsonify({"suggested_tags": []}), 200
        data = request.get_json()
        text = f"{data.get('title', '').strip()} {data.get('note', '').strip()}".strip()
        if not text:
            return jsonify({"suggested_tags": []}), 200
        with suggester_lock:
            tags = tag_suggester.suggest_tags(text, top_k_tags=3)
        return jsonify({"suggested_tags": tags}), 200

    @app.route('/tags', methods=['GET'])
    def list_tags():
        tags = Tag.query.order_by(Tag.name).all()
        return jsonify([t.to_dict() for t in tags]), 200

    @app.route('/tags/<name>', methods=['PUT'])
    def update_tag(name):
        tag = Tag.query.get_or_404(name)
        data = request.get_json()
        if 'color' in data:
            color = data['color']
            if not color.startswith('#') or len(color) != 7:
                return jsonify({"error": "Цвет должен быть в формате #RRGGBB"}), 400
            tag.color = color
        db.session.commit()
        return jsonify(tag.to_dict()), 200

    @app.route('/tasks', methods=['POST'])
    def create_task():
        data = request.get_json()
        if not data or 'title' not in data or 'deadlines' not in data:
            return jsonify({"error": "Missing required fields: 'title' and 'deadlines'"}), 400
        deadlines = data.get('deadlines', {})
        try:
            due_at = datetime.fromisoformat(deadlines['due_at'].replace('Z', '+00:00'))
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            return jsonify({"error": "Invalid or missing 'due_at' in ISO 8601 format"}), 400
        planned_at = None
        if deadlines.get('planned_at'):
            try:
                planned_at = datetime.fromisoformat(deadlines['planned_at'].replace('Z', '+00:00'))
                if planned_at.tzinfo is None:
                    planned_at = planned_at.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        grace_end = None
        if deadlines.get('grace_end'):
            try:
                grace_end = datetime.fromisoformat(deadlines['grace_end'].replace('Z', '+00:00'))
                if grace_end.tzinfo is None:
                    grace_end = grace_end.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        task_uuid = data.get('uuid')
        if task_uuid and Task.query.filter_by(uuid=task_uuid).first():
            return jsonify({"error": "Task with this UUID already exists"}), 409
        if not task_uuid:
            task_uuid = str(uuid.uuid4())
        tag_names = data.get('tags', [])
        if not isinstance(tag_names, list):
            tag_names = []
        task = create_task_with_log(
            title=data['title'],
            note=data.get('note'),
            planned_at=planned_at,
            due_at=due_at,
            grace_end=grace_end,
            duration_seconds=int(data.get('duration_seconds', 0)),
            priority=data.get('priority', 'routine'),
            recurrence_seconds=int(data.get('recurrence_seconds', 0)),
            dependencies=data.get('dependencies', []),
            status='planned',
            tags=tag_names,
            task_uuid=task_uuid
        )
        db.session.commit()
        task_title = task.title
        task_note = task.note or ''
        task_tag_names = [tag.name for tag in task.tags]

        def update_suggester():
            nonlocal tag_suggester
            with app.app_context():
                if tag_suggester and task_tag_names:
                    text = f"{task_title} {task_note}"
                    with suggester_lock:
                        tag_suggester.add_task(text, task_tag_names)
        threading.Thread(target=update_suggester, daemon=True).start()
        return jsonify(task.to_dict()), 201

    @app.route('/tasks', methods=['GET'])
    def get_tasks():
        tag = request.args.get('tag')
        priority = request.args.get('priority')
        due_from = request.args.get('due_from')
        due_to = request.args.get('due_to')
        if not due_from or not due_to:
            return jsonify({"error": "Требуются параметры due_from и due_to"}), 400
        try:
            start_dt = datetime.fromisoformat(due_from.replace('Z', '+00:00'))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            end_dt = datetime.fromisoformat(due_to.replace('Z', '+00:00'))
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return jsonify({"error": "Неверный формат даты"}), 400
        query = Task.query
        if tag:
            query = query.filter(Task.tags.any(name=tag.strip().lower()))
        if priority:
            query = query.filter(Task.priority == priority)
        query = query.filter(
            db.or_(
                db.and_(Task.planned_at.isnot(None), Task.planned_at >= start_dt, Task.planned_at <= end_dt),
                db.and_(Task.due_at >= start_dt, Task.due_at <= end_dt),
                db.and_(Task.grace_end.isnot(None), Task.grace_end >= start_dt, Task.grace_end <= end_dt),
                db.and_(Task.completed_at.isnot(None), Task.completed_at >= start_dt, Task.completed_at <= end_dt)
            )
        )
        tasks = query.all()
        return jsonify([t.to_dict() for t in tasks]), 200

    @app.route('/tasks/<int:task_id>', methods=['GET'])
    def get_task(task_id):
        task = Task.query.get_or_404(task_id)
        return jsonify(task.to_dict()), 200

    @app.route('/tasks/<int:task_id>', methods=['DELETE'])
    def delete_task(task_id):
        task = Task.query.get_or_404(task_id)
        db.session.delete(task)
        db.session.commit()
        return jsonify({"message": "Задача уничтожена во славу Омниссии"}), 200

    @app.route('/tasks/<int:task_id>', methods=['PUT'])
    def update_task(task_id):
        task = Task.query.get_or_404(task_id)
        data = request.get_json()
        if 'uuid' in data and data['uuid'] != task.uuid:
            return jsonify({"error": "UUID cannot be changed"}), 400
        if 'updated_at' in data:
            remote_updated = parser.isoparse(data['updated_at'])
            if remote_updated.tzinfo is None:
                remote_updated = remote_updated.replace(tzinfo=timezone.utc)
            if remote_updated > task.updated_at:
                task.updated_at = remote_updated
        if 'title' in data:
            task.title = data['title']
        if 'note' in data:
            task.note = data.get('note')
        if 'priority' in data:
            task.priority = data['priority']
        if 'status' in data and data['status'] != task.status:
            new_status = data['status']
            if new_status == 'done' and task.status != 'done':
                task.completed_at = datetime.now(timezone.utc)
            elif new_status != 'done':
                task.corrected_at = None
            task.status = new_status
            log_entry = TaskStatusLog(task_uuid=task.uuid, status=new_status)
            db.session.add(log_entry)
        for field in ['duration_seconds', 'recurrence_seconds']:
            if field in data:
                setattr(task, field, int(data.get(field, 0)))
        if 'dependencies' in data:
            task.dependencies = data.get('dependencies', [])
        if 'deadlines' in data:
            deadlines = data['deadlines']
            if 'due_at' in deadlines:
                try:
                    due_at = datetime.fromisoformat(deadlines['due_at'].replace('Z', '+00:00'))
                    if due_at.tzinfo is None:
                        due_at = due_at.replace(tzinfo=timezone.utc)
                    task.due_at = due_at
                except ValueError:
                    return jsonify({"error": "Invalid due_at format"}), 400
            for key in ['planned_at', 'grace_end']:
                if key in deadlines and deadlines[key]:
                    try:
                        dt = datetime.fromisoformat(deadlines[key].replace('Z', '+00:00'))
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        setattr(task, key, dt)
                    except ValueError:
                        pass
        if 'tags' in data:
            tag_names = data.get('tags', [])
            if not isinstance(tag_names, list):
                tag_names = []
            tags = []
            for name in tag_names:
                name = name.strip().lower()
                if not name:
                    continue
                tag = Tag.query.filter_by(name=name).first()
                if not tag:
                    tag = Tag(name=name)
                    db.session.add(tag)
                tags.append(tag)
            task.tags = tags
        db.session.commit()
        def update_suggester():
            nonlocal tag_suggester
            with app.app_context():
                task = Task.query.get(task_id)
                if task and task.tags:
                    text = f"{task.title} {task.note or ''}"
                    tags = [tag.name for tag in task.tags]
                    with suggester_lock:
                        tag_suggester.add_task(text, tags)
        threading.Thread(target=update_suggester, daemon=True).start()
        return jsonify(task.to_dict()), 200

    @app.route('/')
    def calendar_view():
        return app.send_static_file('index.html')

    @app.route('/tasks/<int:task_id>/status-history', methods=['GET'])
    def get_task_status_history(task_id):
        task = Task.query.get_or_404(task_id)
        logs = TaskStatusLog.query.filter_by(task_uuid=task.uuid).order_by(TaskStatusLog.changed_at).all()
        return jsonify([{
            "status": log.status,
            "changed_at": log.changed_at.isoformat() + 'Z' if log.changed_at else None
        } for log in logs]), 200

    @app.route('/sync/handshake', methods=['GET'])
    def sync_handshake():
        return jsonify({
            "name": os.getenv('DEVICE_NAME', 'ThisIsFine'),
            "device_id": os.getenv('DEVICE_ID') or str(uuid.uuid4()),
            "version": "0.1",
            "address": request.host
        })

    @app.route('/sync/peers', methods=['GET'])
    def list_peers():
        peers = PeerDevice.query.all()
        return jsonify([{
            'id': p.id,
            'name': p.name,
            'address': p.address,
            'device_id': p.device_id,
            'last_sync': p.last_sync.isoformat() + 'Z' if p.last_sync else None
        } for p in peers])

    @app.route('/sync/peers', methods=['POST'])
    def add_peer():
        data = request.get_json()
        addr = data.get('address')
        if not addr or ':' not in addr:
            return jsonify({"error": "Неверный адрес"}), 400
        try:
            res = requests.get(f"http://{addr}/sync/handshake", timeout=3)
            if res.status_code != 200:
                return jsonify({"error": "Устройство не отвечает"}), 400
            info = res.json()
            if PeerDevice.query.filter_by(device_id=info['device_id']).first():
                return jsonify({"error": "Устройство уже добавлено"}), 409
            peer = PeerDevice(name=info['name'], address=addr, device_id=info['device_id'])
            db.session.add(peer)
            db.session.commit()
            return jsonify({"status": "ok", "peer": peer.to_dict()}), 201
        except Exception as e:
            return jsonify({"error": f"Ошибка: {str(e)}"}), 500

    @app.route('/sync/tasks', methods=['GET'])
    def get_all_tasks_for_sync():
        tasks = Task.query.all()
        result = []
        for task in tasks:
            logs = TaskStatusLog.query.filter_by(task_uuid=task.uuid).all()
            result.append({
                "task": task.to_dict(),
                "logs": [{"status": log.status, "changed_at": log.changed_at.isoformat() + 'Z'} for log in logs]
            })
        return jsonify(result)

    @app.route('/sync/tasks', methods=['POST'])
    def receive_sync_tasks():
        if request.headers.get('X-Sync-Token') != os.getenv('SYNC_TOKEN'):
            return jsonify({"error": "Access denied"}), 403
        data = request.get_json()
        if not isinstance(data, list):
            return jsonify({"error": "Expected list of {task, logs}"}), 400
        merge_sync_data(data)
        return jsonify({"status": "ok"}), 200

    @app.route('/sync/peers/<int:peer_id>', methods=['DELETE'])
    def delete_peer(peer_id):
        peer = PeerDevice.query.get_or_404(peer_id)
        db.session.delete(peer)
        db.session.commit()
        return jsonify({"status": "ok"}), 200

    @app.route('/sync/peers/sync', methods=['POST'])
    def sync_with_peer():
        if request.headers.get('X-Sync-Token') != os.getenv('SYNC_TOKEN'):
            return jsonify({"error": "Access denied"}), 403
        data = request.get_json()
        address = data.get('address')
        if not address:
            return jsonify({"error": "address required"}), 400
        peer = PeerDevice.query.filter_by(address=address).first_or_404()
        try:
            remote_url = f"http://{address}"
            remote_tasks = requests.get(f"{remote_url}/sync/tasks", headers={"X-Sync-Token": os.getenv('SYNC_TOKEN')}, timeout=10).json()
            local_sync_data = []
            for task in Task.query.all():
                logs = TaskStatusLog.query.filter_by(task_uuid=task.uuid).all()
                local_sync_data.append({
                    "task": task.to_dict(),
                    "logs": [{"status": log.status, "changed_at": log.changed_at.isoformat() + 'Z'} for log in logs]
                })
            requests.post(f"{remote_url}/sync/tasks", json=local_sync_data, headers={"X-Sync-Token": os.getenv('SYNC_TOKEN')}, timeout=10)
            merge_sync_data(remote_tasks)
            peer.last_sync = datetime.now(timezone.utc)
            db.session.commit()
            return jsonify({"status": "ok", "tasks_received": len(remote_tasks)}), 200
        except Exception as e:
            return jsonify({"error": f"Sync failed: {str(e)}\n{traceback.format_exc()}"}), 500

    def merge_sync_data(sync_data):
        received_tasks = {item["task"]["uuid"]: item for item in sync_data if "task" in item and "uuid" in item["task"]}
        all_uuids = set(received_tasks.keys())
        referenced_uuids = {item["task"].get("next_uuid") for item in received_tasks.values() if item["task"].get("next_uuid") in all_uuids}
        root_uuids = all_uuids - referenced_uuids
        chains = []
        for root_uuid in root_uuids:
            chain = []
            current_uuid = root_uuid
            while current_uuid and current_uuid in received_tasks:
                chain.append(received_tasks[current_uuid]["task"])
                current_uuid = received_tasks[current_uuid]["task"].get("next_uuid")
            if chain:
                chains.append(chain)
        with app.app_context():
            for chain in chains:
                root_task_dict = chain[0]
                local_root = Task.query.filter_by(uuid=root_task_dict['uuid']).first()
                if local_root and local_root.recurrence_seconds > 0:
                    merge_task_chain(local_root, chain, received_tasks)
                else:
                    import_full_chain(chain, received_tasks)
            processed_uuids = {task['uuid'] for chain in chains for task in chain}
            for uuid, item in received_tasks.items():
                if uuid not in processed_uuids:
                    merge_single_task(item["task"], item.get("logs", []))
            db.session.commit()

    def merge_task_chain(local_root, remote_chain, received_tasks):
        remote_updated = parser.isoparse(remote_chain[0]['updated_at'])
        if remote_updated.tzinfo is None:
            remote_updated = remote_updated.replace(tzinfo=timezone.utc)
        local_updated = local_root.updated_at
        if local_updated.tzinfo is None:
            local_updated = local_updated.replace(tzinfo=timezone.utc)
        if remote_updated > local_updated:
            update_task_from_dict(local_root, remote_chain[0])
        local_chain = []
        current = local_root
        while current:
            local_chain.append(current)
            current = Task.query.filter_by(uuid=current.next_uuid).first() if current.next_uuid else None
        min_len = min(len(local_chain), len(remote_chain))
        for i in range(min_len):
            local_task = local_chain[i]
            remote_task_dict = remote_chain[i]
            remote_updated = parser.isoparse(remote_task_dict['updated_at'])
            if remote_updated.tzinfo is None:
                remote_updated = remote_updated.replace(tzinfo=timezone.utc)
            local_updated = local_task.updated_at
            if local_updated.tzinfo is None:
                local_updated = local_updated.replace(tzinfo=timezone.utc)
            if remote_updated > local_updated:
                update_task_from_dict(local_task, remote_task_dict)
                update_task_logs(local_task.uuid, received_tasks[remote_task_dict['uuid']].get("logs", []))
        if len(remote_chain) > min_len:
            last_local = local_chain[-1]
            for i in range(min_len, len(remote_chain)):
                remote_task_dict = remote_chain[i]
                new_task = create_task_from_dict(remote_task_dict)
                if i == min_len:
                    last_local.next_uuid = new_task.uuid
                db.session.add(new_task)
                update_task_logs(new_task.uuid, received_tasks[remote_task_dict['uuid']].get("logs", []))

    def import_full_chain(chain, received_tasks):
        prev_task = None
        for task_dict in chain:
            existing = Task.query.filter_by(uuid=task_dict['uuid']).first()
            if existing:
                update_task_from_dict(existing, task_dict)
                task = existing
            else:
                task = create_task_from_dict(task_dict)
                db.session.add(task)
            if prev_task:
                prev_task.next_uuid = task.uuid
            update_task_logs(task.uuid, received_tasks[task_dict['uuid']].get("logs", []))
            prev_task = task

    def merge_single_task(task_dict, logs_list):
        existing = Task.query.filter_by(uuid=task_dict['uuid']).first()
        if existing:
            local_updated = existing.updated_at
            if local_updated.tzinfo is None:
                local_updated = local_updated.replace(tzinfo=timezone.utc)
            remote_updated = parser.isoparse(task_dict['updated_at'])
            if remote_updated.tzinfo is None:
                remote_updated = remote_updated.replace(tzinfo=timezone.utc)
            if remote_updated > local_updated:
                update_task_from_dict(existing, task_dict)
                task = existing
            else:
                task = existing
        else:
            task = create_task_from_dict(task_dict)
            db.session.add(task)
        update_task_logs(task.uuid, logs_list)
        return task

    def create_task_from_dict(data):
        tag_names = data.get('tags', [])
        tags = []
        for name in tag_names:
            name = name.strip().lower()
            if not name: continue
            tag = Tag.query.filter_by(name=name).first()
            if not tag:
                tag = Tag(name=name)
                db.session.add(tag)
            tags.append(tag)
        task = Task(
            uuid=data['uuid'],
            title=data['title'],
            note=data.get('note'),
            priority=data.get('priority', 'routine'),
            status=data.get('status', 'planned'),
            duration_seconds=int(data.get('duration_seconds', 0)),
            recurrence_seconds=int(data.get('recurrence_seconds', 0)),
            dependencies=data.get('dependencies', []),
            updated_at=parser.isoparse(data['updated_at']),
            completed_at=parser.isoparse(data['completed_at']) if data.get('completed_at') else None
        )
        deadlines = data.get('deadlines', {})
        task.due_at = parser.isoparse(deadlines['due_at'])
        task.planned_at = parser.isoparse(deadlines['planned_at']) if deadlines.get('planned_at') else None
        task.grace_end = parser.isoparse(deadlines['grace_end']) if deadlines.get('grace_end') else None
        task.tags = tags
        return task

    def update_task_from_dict(task, data):
        task.title = data['title']
        task.note = data.get('note')
        task.priority = data.get('priority', task.priority)
        task.status = data.get('status', task.status)
        task.duration_seconds = int(data.get('duration_seconds', task.duration_seconds))
        task.recurrence_seconds = int(data.get('recurrence_seconds', task.recurrence_seconds))
        task.dependencies = data.get('dependencies', task.dependencies)
        remote_updated = parser.isoparse(data['updated_at'])
        if remote_updated.tzinfo is None:
            remote_updated = remote_updated.replace(tzinfo=timezone.utc)
        task.updated_at = remote_updated
        if data.get('completed_at'):
            task.completed_at = parser.isoparse(data['completed_at'])
        else:
            task.completed_at = None
        deadlines = data.get('deadlines', {})
        task.due_at = parser.isoparse(deadlines['due_at'])
        task.planned_at = parser.isoparse(deadlines['planned_at']) if deadlines.get('planned_at') else None
        task.grace_end = parser.isoparse(deadlines['grace_end']) if deadlines.get('grace_end') else None
        tag_names = data.get('tags', [])
        tags = []
        for name in tag_names:
            name = name.strip().lower()
            if not name: continue
            tag = Tag.query.filter_by(name=name).first()
            if not tag:
                tag = Tag(name=name)
                db.session.add(tag)
            tags.append(tag)
        task.tags = tags

    def update_task_logs(task_uuid, logs_list):
        existing_log_keys = set()
        for log in TaskStatusLog.query.filter_by(task_uuid=task_uuid).all():
            key = (log.status, log.changed_at.replace(microsecond=0).replace(tzinfo=timezone.utc))
            existing_log_keys.add(key)
        for log_entry in logs_list:
            try:
                status = log_entry.get("status")
                changed_at_str = log_entry.get("changed_at")
                if not status or not changed_at_str:
                    continue
                changed_at = parser.isoparse(changed_at_str)
                if changed_at.tzinfo is None:
                    changed_at = changed_at.replace(tzinfo=timezone.utc)
                changed_at = changed_at.replace(microsecond=0)
                log_key = (status, changed_at)
                if log_key not in existing_log_keys:
                    new_log = TaskStatusLog(task_uuid=task_uuid, status=status, changed_at=changed_at)
                    db.session.add(new_log)
                    existing_log_keys.add(log_key)
            except:
                continue

    @app.route('/notify/config', methods=['GET'])
    def get_telegram_config():
        return jsonify({
            "bot_token": "●●●●●●●●" if TELEGRAM_CONFIG["bot_token"] else None,
            "chat_id": TELEGRAM_CONFIG["chat_id"]
        })

    @app.route('/notify/config', methods=['POST'])
    def set_telegram_config():
        data = request.get_json()
        bot_token = data.get("bot_token")
        chat_id = data.get("chat_id")
        if not bot_token or not chat_id:
            return jsonify({"error": "Токен и Chat ID обязательны"}), 400
        global TELEGRAM_CONFIG
        TELEGRAM_CONFIG["bot_token"] = bot_token
        TELEGRAM_CONFIG["chat_id"] = chat_id
        try:
            with open(TMP_ENV_PATH, 'w', encoding='utf-8') as f:
                f.write(f"TELEGRAM_BOT_TOKEN={bot_token}\n")
                f.write(f"TELEGRAM_CHAT_ID={chat_id}\n")
                f.write(f"THISISFINE_URL={os.getenv('THISISFINE_URL', 'http://localhost')}\n")
                f.write(f"PORT={PORT}\n")
            return jsonify({"status": "ok", "tmp_env": TMP_ENV_PATH})
        except Exception as e:
            return jsonify({"error": f"Не удалось записать tmp.env: {str(e)}"}), 500

    @app.route('/notify/test', methods=['POST'])
    def test_notify():
        token = TELEGRAM_CONFIG["bot_token"]
        chat_id = TELEGRAM_CONFIG["chat_id"]
        if not token or not chat_id:
            return jsonify({"error": "Настройки Telegram не заданы"}), 400
        try:
            res = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": "✅ Тестовое сообщение от ThisIsFine!"},
                timeout=10
            )
            if res.status_code == 200:
                return jsonify({"status": "ok", "message": "Сообщение отправлено!\nДанные применяются в пределах сессии.\nЕсли вы хотите сделать токен и чат постоянными - впишите их в файл [tif.env].\nДля активации нотификатора запустите [notifier_bot.py]"})
            else:
                return jsonify({"error": f"Ошибка Telegram: {res.json().get('description', 'unknown')}"}), 500
        except Exception as e:
            return jsonify({"error": f"Сбой сети: {str(e)}"}), 500

    @app.route('/themes', methods=['GET'])
    def list_themes():
        themes_dir = BASE_DIR / "static" / "themes"
        if not themes_dir.exists():
            return jsonify([])
        themes = []
        for file in themes_dir.glob("theme-*.css"):
            name = file.stem.replace("theme-", "", 1)
            label = name.capitalize()
            try:
                with open(file, 'r', encoding='utf-8') as f:
                    first_line = f.readline()
                    if first_line.startswith('/*') and 'name:' in first_line:
                        label = first_line.split('name:')[-1].strip().rstrip('*/').strip()
            except:
                pass
            themes.append({"name": name, "label": label})
        return jsonify(themes)

    @app.route('/logic/process-tick', methods=['POST'])
    def process_time_based_transitions():
        now = datetime.now(timezone.utc)
        updated_tasks = []
        overdue_candidates = Task.query.filter(Task.status.notin_(["done", "failed"]), Task.due_at <= now).all()
        for task in overdue_candidates:
            if task.status != "overdue":
                task.status = "overdue"
                log_entry = TaskStatusLog(task_uuid=task.uuid, status="overdue")
                db.session.add(log_entry)
                updated_tasks.append({"uuid": task.uuid, "status": "overdue", "id": task.id})
        failed_candidates = Task.query.filter(Task.status == "overdue", Task.grace_end.isnot(None), Task.grace_end <= now).all()
        for task in failed_candidates:
            task.status = "failed"
            log_entry = TaskStatusLog(task_uuid=task.uuid, status="failed")
            db.session.add(log_entry)
            updated_tasks.append({"uuid": task.uuid, "status": "failed", "id": task.id})
        db.session.commit()
        return jsonify({"processed_at": now.isoformat() + "Z", "updated_tasks": updated_tasks}), 200

    @app.route('/notify/pending', methods=['GET'])
    def get_pending_notifications():
        now = datetime.now(timezone.utc)
        try:
            tasks_resp = requests.get(
                f"http://localhost:{PORT}/tasks?due_from=1970-01-01T00:00:00Z&due_to=2038-01-19T03:14:07Z",
                timeout=10
            )
            tasks_resp.raise_for_status()
            tasks = tasks_resp.json()
        except Exception as e:
            return jsonify({"error": f"Не удалось получить задачи: {e}"}), 500
        pending = []
        for task in tasks:
            uuid = task.get("uuid")
            if not uuid:
                continue
            status = task.get("status")
            deadlines = task.get("deadlines", {})
            duration = task.get("duration_seconds", 0)
            if status == "planned" and deadlines.get("planned_at"):
                planned_at = parser.isoparse(deadlines["planned_at"])
                if planned_at.tzinfo is None:
                    planned_at = planned_at.replace(tzinfo=timezone.utc)
                if now >= planned_at and f"{uuid}_planned" not in NOTIFIED_CACHE:
                    pending.append({**task, "notification_type": "start"})
                    NOTIFIED_CACHE.add(f"{uuid}_planned")
            if duration > 0 and status in ("planned", "inProgress") and deadlines.get("due_at"):
                due_at = parser.isoparse(deadlines["due_at"])
                if due_at.tzinfo is None:
                    due_at = due_at.replace(tzinfo=timezone.utc)
                warn_time = due_at - timedelta(seconds=duration)
                if now >= warn_time and f"{uuid}_due_warn" not in NOTIFIED_CACHE:
                    pending.append({**task, "notification_type": "due_warn"})
                    NOTIFIED_CACHE.add(f"{uuid}_due_warn")
            if status == "overdue" and f"{uuid}_overdue" not in NOTIFIED_CACHE:
                pending.append({**task, "notification_type": "overdue"})
                NOTIFIED_CACHE.add(f"{uuid}_overdue")
            if duration > 0 and deadlines.get("grace_end") and status not in ("done", "failed"):
                grace_end = parser.isoparse(deadlines["grace_end"])
                if grace_end.tzinfo is None:
                    grace_end = grace_end.replace(tzinfo=timezone.utc)
                warn_time = grace_end - timedelta(seconds=duration)
                if now >= warn_time and f"{uuid}_grace_warn" not in NOTIFIED_CACHE:
                    pending.append({**task, "notification_type": "grace_warn"})
                    NOTIFIED_CACHE.add(f"{uuid}_grace_warn")
            if status == "failed" and f"{uuid}_failed" not in NOTIFIED_CACHE:
                pending.append({**task, "notification_type": "failed"})
                NOTIFIED_CACHE.add(f"{uuid}_failed")
        return jsonify(pending), 200

    def spawn_recurring_tasks():
        now = datetime.now(timezone.utc)
        recurring_tasks = Task.query.filter(Task.recurrence_seconds > 0).all()
        for task in recurring_tasks:
            first_planned_log = TaskStatusLog.query.filter_by(task_uuid=task.uuid, status="planned").order_by(TaskStatusLog.changed_at.asc()).first()
            if not first_planned_log:
                continue
            spawn_time = first_planned_log.changed_at
            if spawn_time.tzinfo is None:
                spawn_time = spawn_time.replace(tzinfo=timezone.utc)
            elapsed = (now - spawn_time).total_seconds()
            periods_passed = int(elapsed // task.recurrence_seconds)
            if periods_passed <= 0:
                continue
            if task.next_uuid and Task.query.filter_by(uuid=task.next_uuid).first():
                continue
            delta = timedelta(seconds=task.recurrence_seconds * periods_passed)
            new_planned = None
            if task.planned_at:
                base_planned = task.planned_at
                if base_planned.tzinfo is None:
                    base_planned = base_planned.replace(tzinfo=timezone.utc)
                new_planned = base_planned + delta
            base_due = task.due_at
            if base_due.tzinfo is None:
                base_due = base_due.replace(tzinfo=timezone.utc)
            new_due = base_due + delta
            new_grace = None
            if task.grace_end:
                base_grace = task.grace_end
                if base_grace.tzinfo is None:
                    base_grace = base_grace.replace(tzinfo=timezone.utc)
                new_grace = base_grace + delta
            new_task = create_task_with_log(
                title=task.title,
                note=task.note,
                planned_at=new_planned,
                due_at=new_due,
                grace_end=new_grace,
                duration_seconds=task.duration_seconds,
                priority=task.priority,
                recurrence_seconds=task.recurrence_seconds,
                dependencies=[],
                status="planned",
                tags=[tag.name for tag in task.tags],
                next_uuid=None
            )
            task.next_uuid = new_task.uuid
            db.session.commit()

    @app.route('/logic/spawn-recurring', methods=['POST'])
    def spawn_recurring_tasks_endpoint():
        try:
            spawn_recurring_tasks()
            return jsonify({"status": "ok", "message": "Цепи повторяющихся задач обработаны"}), 200
        except Exception as e:
            logging.error(f"Ошибка в spawn_recurring_tasks: {e}\n{traceback.format_exc()}")
            return jsonify({"error": str(e)}), 500

    @app.route('/tasks/simple', methods=['GET'])
    def get_tasks_simple():
        tasks = db.session.query(Task.id, Task.uuid, Task.title, Task.status, Task.priority).all()
        return jsonify([{"id": t.id, "uuid": t.uuid, "title": t.title, "status": t.status, "priority": t.priority} for t in tasks]), 200

    @app.route('/tasks/search', methods=['GET'])
    def search_tasks():
        query = request.args.get('query', '').strip()
        if not query:
            return jsonify({"results": []}), 200
        words = []
        tag_prefixes = ['#', '№']
        tag_candidates = []
        for part in query.split():
            if any(part.startswith(prefix) for prefix in tag_prefixes):
                for prefix in tag_prefixes:
                    if part.startswith(prefix):
                        tag_part = part[len(prefix):].lower()
                        if tag_part:
                            tag_candidates.append(tag_part)
                        break
            else:
                words.append(part)
        all_tag_names = [t.name for t in Tag.query.with_entities(Tag.name).all()]
        matched_tags = set()
        for candidate in tag_candidates:
            for tag_name in all_tag_names:
                if candidate in tag_name:
                    matched_tags.add(tag_name)
        task_query = Task.query
        if matched_tags:
            task_query = task_query.join(Task.tags).filter(Tag.name.in_(matched_tags)).distinct()
        if words:
            search_text = ' '.join(words).lower()
            task_query = task_query.filter(db.or_(Task.title.ilike(f"%{search_text}%"), Task.note.ilike(f"%{search_text}%")))
        tasks = task_query.limit(20).all()
        return jsonify({"results": [task.to_dict() for task in tasks]}), 200


def main():
    parser = argparse.ArgumentParser(description='Запуск благословенного Flask-сервиса ThisIsFine')
    parser.add_argument('--env', type=Path, default=Path("tif.env"), help='Путь к .env-файлу')
    parser.add_argument('--port', type=int, help='Порт (переопределяет PORT из .env)')
    args = parser.parse_args()

    app = create_app(args.env)
    if args.port is not None:
        global PORT
        PORT = args.port
    setup_routes(app, args.env)
    print(f"Хвала Омниссии! ThisIsFine запущен на порту {PORT} с env={args.env}")
    app.run(debug=True, host='0.0.0.0', port=PORT)


if __name__ == '__main__':
    main()