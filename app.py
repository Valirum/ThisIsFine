import uuid
import argparse
from flask import Flask, request, jsonify
from models import db, Task, Tag, TaskStatusLog, PeerDevice
from datetime import datetime, timezone
import os
from pathlib import Path
from dotenv import load_dotenv
from dateutil import parser
import requests
import traceback

# === Импорт автоподбора тегов ===
from tag_suggester import TagSuggester
import threading

# Глобальный экземпляр (с локом для потокобезопасности)
suggester_lock = threading.Lock()
tag_suggester = None

load_dotenv()

# Создаём папку instance, если её нет
BASE_DIR = Path(__file__).parent.resolve()
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(exist_ok=True)

DATABASE_PATH = INSTANCE_DIR / "taskdb.sqlite"

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{DATABASE_PATH.as_posix()}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Инициализация предиктора тегов при старте
def init_tag_suggester():
    global tag_suggester
    with app.app_context():
        # Загружаем ВСЕ задачи из БД как обучающие данные
        tasks_from_db = Task.query.all()
        training_data = [
            {
                "text": f"{task.title} {task.note or ''}",
                "tags": [tag.name for tag in task.tags]
            }
            for task in tasks_from_db
            if task.tags  # только задачи с тегами
        ]
        tag_suggester = TagSuggester(tasks=training_data)

# Выполняем инициализацию после создания таблиц
with app.app_context():
    db.create_all()
    init_tag_suggester()

@app.route('/suggest-tags', methods=['POST'])
def suggest_tags():
    """Предлагает теги на основе title + note"""
    global tag_suggester
    if tag_suggester is None:
        return jsonify({"suggested_tags": []}), 200

    data = request.get_json()
    title = data.get('title', '').strip()
    note = data.get('note', '').strip()
    text = f"{title} {note}".strip()

    if not text:
        return jsonify({"suggested_tags": []}), 200

    with suggester_lock:
        tags = tag_suggester.suggest_tags(text, top_k_tags=3)

    return jsonify({"suggested_tags": tags}), 200

# Получить все теги (уже есть, но обновим)
@app.route('/tags', methods=['GET'])
def list_tags():
    tags = Tag.query.order_by(Tag.name).all()
    return jsonify([t.to_dict() for t in tags]), 200

# Обновить цвет тега (опционально, для будущего UI)
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
            pass  # игнорируем некорректное значение

    grace_end = None
    if deadlines.get('grace_end'):
        try:
            grace_end = datetime.fromisoformat(deadlines['grace_end'].replace('Z', '+00:00'))
            if grace_end.tzinfo is None:
                grace_end = grace_end.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    task_uuid = data.get('uuid')
    if task_uuid:
        # Проверяем, не существует ли уже задача с таким UUID
        if Task.query.filter_by(uuid=task_uuid).first():
            return jsonify({"error": "Task with this UUID already exists"}), 409
    else:
        task_uuid = str(uuid.uuid4())

    # Внутри create_task()
    tag_names = data.get('tags', [])
    if not isinstance(tag_names, list):
        tag_names = []

    # Создаём/получаем теги
    tags = []
    for name in tag_names:
        name = name.strip().lower()  # нормализация
        if not name:
            continue
        tag = Tag.query.filter_by(name=name).first()
        if not tag:
            tag = Tag(name=name)
            db.session.add(tag)
        tags.append(tag)


    # Создаём задачу
    task = Task(
        uuid=task_uuid,
        title=data['title'],
        note=data.get('note'),
        planned_at=planned_at,
        due_at=due_at,
        grace_end=grace_end,
        duration_seconds=int(data.get('duration_seconds', 0)),
        priority=data.get('priority', 'routine'),
        recurrence_seconds=int(data.get('recurrence_seconds', 0)),
        dependencies=data.get('dependencies', []),
        status=data.get('status', 'planned')
    )

    task.tags = tags  # SQLAlchemy сам обновит ассоциативную таблицу

    db.session.add(task)
    db.session.commit()

    log_entry = TaskStatusLog(task_uuid=task.uuid, status="planned")
    db.session.add(log_entry)
    db.session.commit()

    task_title = task.title
    task_note = task.note if task.note else ''
    task_tag_names = [tag.name for tag in task.tags]  # сохраняем сейчас, чтобы не делать запрос в другом потоке

    # Обновляем модель автоподбора асинхронно
    def update_suggester():
        global tag_suggester
        with app.app_context():
            if tag_suggester is not None and task_tag_names:
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
        return jsonify({"error": "Неверный формат даты (ожидается ISO 8601)"}), 400

    query = Task.query

    if tag:
        query = query.filter(Task.tags.any(name=tag.strip().lower()))
    if priority:
        query = query.filter(Task.priority == priority)

    # Фильтр: задача отображается, если ЛЮБАЯ из её дат попадает в диапазон
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

# УДАЛЕНИЕ задачи
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

    # Внутри /tasks/<id> PUT
    if 'uuid' in data and data['uuid'] != task.uuid:
        return jsonify({"error": "UUID cannot be changed"}), 400

    # Обновляем updated_at вручную, если пришёл более свежий timestamp
    if 'updated_at' in data:
        remote_updated = parser.isoparse(data['updated_at'])
        if remote_updated.tzinfo is None:
            remote_updated = remote_updated.replace(tzinfo=timezone.utc)
        if remote_updated > task.updated_at:
            task.updated_at = remote_updated
        else:
            # Локальная версия новее — пропускаем обновление?
            # Но если пользователь явно редактирует — всё равно обновляем
            pass

    # Обновляем все поля, включая status
    if 'title' in data:
        task.title = data['title']
    if 'note' in data:
        task.note = data.get('note')
    if 'priority' in data:
        task.priority = data['priority']

    # В update_task()
    if 'status' in data and data['status'] != task.status:
        new_status = data['status']
        if new_status == 'done' and task.status != 'done':
            task.completed_at = datetime.now(timezone.utc)
        elif new_status != 'done':
            task.corrected_at = None
        task.status = new_status  # ← один раз
        log_entry = TaskStatusLog(task_uuid=task.uuid, status=new_status)
        db.session.add(log_entry)

    # Числовые поля
    for field in ['duration_seconds', 'recurrence_seconds']:
        if field in data:
            setattr(task, field, int(data.get(field, 0)))

    if 'dependencies' in data:
        task.dependencies = data.get('dependencies', [])

    # Deadlines
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

    # Теги
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

    # Обновляем модель автоподбора (асинхронно, чтобы не тормозить ответ)
    def update_suggester():
        global tag_suggester
        with app.app_context():
            task = Task.query.get(task_id)  # для update — используйте task_id
            if task and task.tags:
                text = f"{task.title} {task.note or ''}"
                tags = [tag.name for tag in task.tags]
                with suggester_lock:
                    tag_suggester.add_task(text, tags)

    # Запускаем в фоне
    threading.Thread(target=update_suggester, daemon=True).start()

    return jsonify(task.to_dict()), 200

def create_task_from_dict(data):
    # Создаём/получаем теги
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
        updated_at=datetime.fromisoformat(data['updated_at'].replace('Z', '+00:00').replace('+00:00', '+00:00')),
        completed_at=datetime.fromisoformat(data['completed_at'].replace('Z', '+00:00')) if data.get('completed_at') else None
    )

    # Дедлайны
    deadlines = data.get('deadlines', {})
    task.due_at = datetime.fromisoformat(deadlines['due_at'].replace('Z', '+00:00'))
    task.planned_at = datetime.fromisoformat(deadlines['planned_at'].replace('Z', '+00:00')) if deadlines.get('planned_at') else None
    task.grace_end = datetime.fromisoformat(deadlines['grace_end'].replace('Z', '+00:00')) if deadlines.get('grace_end') else None

    task.tags = tags
    db.session.add(task)
    return task

def update_task_from_dict(task, data):
    task.title = data['title']
    task.note = data.get('note')
    task.priority = data.get('priority', task.priority)
    task.status = data.get('status', task.status)
    task.duration_seconds = int(data.get('duration_seconds', task.duration_seconds))
    task.recurrence_seconds = int(data.get('recurrence_seconds', task.recurrence_seconds))
    task.dependencies = data.get('dependencies', task.dependencies)

    # Временные метки
    remote_updated = parser.isoparse(data['updated_at'])
    if remote_updated.tzinfo is None:
        remote_updated = remote_updated.replace(tzinfo=timezone.utc)

    task.updated_at = remote_updated

    if data.get('completed_at'):
        task.completed_at = datetime.fromisoformat(data['completed_at'].replace('Z', '+00:00'))
    else:
        task.completed_at = None

    # Дедлайны
    deadlines = data.get('deadlines', {})
    task.due_at = datetime.fromisoformat(deadlines['due_at'].replace('Z', '+00:00'))
    task.planned_at = datetime.fromisoformat(deadlines['planned_at'].replace('Z', '+00:00')) if deadlines.get('planned_at') else None
    task.grace_end = datetime.fromisoformat(deadlines['grace_end'].replace('Z', '+00:00')) if deadlines.get('grace_end') else None

    # Теги
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
        "address": request.host  # например, "192.168.1.5:5000"
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
        # Проверяем, нет ли уже такого device_id
        if PeerDevice.query.filter_by(device_id=info['device_id']).first():
            return jsonify({"error": "Устройство уже добавлено"}), 409

        peer = PeerDevice(
            name=info['name'],
            address=addr,
            device_id=info['device_id']
        )
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
            "logs": [{
                "status": log.status,
                "changed_at": log.changed_at.isoformat() + 'Z'
            } for log in logs]
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
        # 1. Получаем задачи с удалённого узла
        remote_url = f"http://{address}"
        remote_tasks = requests.get(
            f"{remote_url}/sync/tasks",
            headers={"X-Sync-Token": os.getenv('SYNC_TOKEN')},
            timeout=10
        ).json()

        # 2. Отправляем свои задачи туда
        # СТАЛО (ПРАВИЛЬНО):
        local_sync_data = []
        for task in Task.query.all():
            logs = TaskStatusLog.query.filter_by(task_uuid=task.uuid).all()
            local_sync_data.append({
                "task": task.to_dict(),
                "logs": [{
                    "status": log.status,
                    "changed_at": log.changed_at.isoformat() + 'Z'
                } for log in logs]
            })

        requests.post(
            f"{remote_url}/sync/tasks",
            json=local_sync_data,
            headers={"X-Sync-Token": os.getenv('SYNC_TOKEN')},
            timeout=10
        )


        # 3. Сливаем полученные задачи локально (как в receive_sync_tasks)
        merge_sync_data(remote_tasks)

        # 4. Обновляем last_sync
        peer.last_sync = datetime.now(timezone.utc)
        db.session.commit()

        return jsonify({
            "status": "ok",
            "tasks_received": len(remote_tasks)
        }), 200

    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Network error: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"Sync failed: {str(e)}\n{traceback.format_exc()}"}), 500


def merge_sync_data(sync_payload):
    """Принимает список [{task: ..., logs: [...]}, ...] и сливает с локальной БД"""
    for item in sync_payload:
        task_dict = item.get("task")
        logs_list = item.get("logs", [])

        if not task_dict or 'uuid' not in task_dict:
            continue

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

        if task:
            existing_log_keys = set()
            for log in TaskStatusLog.query.filter_by(task_uuid=task.uuid).all():
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
                    changed_at_sec = changed_at.replace(microsecond=0)
                    log_key = (status, changed_at_sec)
                    if log_key not in existing_log_keys:
                        new_log = TaskStatusLog(
                            task_uuid=task.uuid,
                            status=status,
                            changed_at=changed_at
                        )
                        db.session.add(new_log)
                        existing_log_keys.add(log_key)
                except Exception:
                    continue

    db.session.commit()


if __name__ == '__main__':
    # Убедимся, что папка instance существует
    arg_parser = argparse.ArgumentParser(description='Запуск благословенного Flask-сервиса Омниссии')
    arg_parser.add_argument('--port', type=int, default=5000, help='Порт для священного прослушивания')
    args = arg_parser.parse_args()

    os.makedirs('instance', exist_ok=True)
    app.run(debug=True, host='0.0.0.0', port=args.port)