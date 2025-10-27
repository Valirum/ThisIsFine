from flask import Flask, request, jsonify
from models import db, Task, Tag
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

    query = Task.query

    if tag:
        # ✅ Правильная фильтрация по тегу в many-to-many
        query = query.filter(Task.tags.any(name=tag.strip().lower()))

    if priority:
        query = query.filter(Task.priority == priority)

    if due_from:
        try:
            dt = datetime.fromisoformat(due_from.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            query = query.filter(Task.due_at >= dt)
        except ValueError:
            return jsonify({"error": "Invalid 'due_from' datetime format"}), 400

    if due_to:
        try:
            dt = datetime.fromisoformat(due_to.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            query = query.filter(Task.due_at <= dt)
        except ValueError:
            return jsonify({"error": "Invalid 'due_to' datetime format"}), 400

    tasks = query.order_by(Task.due_at).all()
    return jsonify([t.to_dict() for t in tasks]), 200

@app.route('/tags', methods=['GET'])
def list_tags():
    tags = Tag.query.order_by(Tag.name).all()
    return jsonify([{"name": t.name} for t in tags]), 200


@app.route('/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json()

    # Обновление скалярных полей
    for field in ['title', 'note', 'priority']:
        if field in data:
            setattr(task, field, data[field])

    for field in ['duration_seconds', 'recurrence_seconds']:
        if field in data:
            setattr(task, field, int(data.get(field, 0)))

    if 'dependencies' in data:
        task.dependencies = data.get('dependencies', [])

    # Обработка deadlines
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
                    pass  # игнорируем некорректные

    # Обработка тегов
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