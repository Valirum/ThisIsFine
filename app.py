from flask import Flask, request, jsonify
from models import db, Task, Tag, TaskStatusLog
from datetime import datetime, timezone
import os
from pathlib import Path
from dotenv import load_dotenv

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

# Создаём таблицы при запуске (для пет-проекта — допустимо)
with app.app_context():
    db.create_all()

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
        title=data['title'],
        note=data.get('note'),
        planned_at=planned_at,
        due_at=due_at,
        grace_end=grace_end,
        duration_seconds=int(data.get('duration_seconds', 0)),
        priority=data.get('priority', 'routine'),
        recurrence_seconds=int(data.get('recurrence_seconds', 0)),
        dependencies=data.get('dependencies', [])
    )

    task.tags = tags  # SQLAlchemy сам обновит ассоциативную таблицу

    db.session.add(task)
    db.session.commit()
    print(task, "added")
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


# ОБНОВЛЕНИЕ статуса (или полное обновление)
# Уже существующий PUT /tasks/<id> расширяем поддержкой status
@app.route('/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json()

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
        log_entry = TaskStatusLog(task_id=task.id, status=new_status)
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
    return jsonify(task.to_dict()), 200


@app.route('/')
def calendar_view():
    return app.send_static_file('index.html')


if __name__ == '__main__':
    # Убедимся, что папка instance существует
    os.makedirs('instance', exist_ok=True)
    app.run(debug=True, host='0.0.0.0', port=5000)