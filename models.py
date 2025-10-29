from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()

# Ассоциативная таблица: многие-ко-многим
task_tag = db.Table(
    'task_tag',
    db.Column('task_id', db.Integer, db.ForeignKey('tasks.id'), primary_key=True),
    db.Column('tag_name', db.String(50), db.ForeignKey('tags.name'), primary_key=True)
)

class Tag(db.Model):
    __tablename__ = 'tags'
    name = db.Column(db.String(50), primary_key=True)
    color = db.Column(db.String(7), nullable=False, default='#4a4a8a')  # HEX, например: #ff5555
    # icon = db.Column(db.String(50), nullable=True)  # можно добавить позже

    def __repr__(self):
        return f"<Tag {self.name}>"

    def to_dict(self):
        return {
            "name": self.name,
            "color": self.color
        }

# models.py
class TaskStatusLog(db.Model):
    __tablename__ = 'task_status_log'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False)
    status = db.Column(db.String(20), nullable=False)  # planned, inProgress, done...
    changed_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Task(db.Model):
    __tablename__ = 'tasks'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    note = db.Column(db.Text, nullable=True)
    planned_at = db.Column(db.DateTime(timezone=True), nullable=True)
    due_at = db.Column(db.DateTime(timezone=True), nullable=False)
    grace_end = db.Column(db.DateTime(timezone=True), nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=False, default=0)
    priority = db.Column(db.String(20), nullable=False, default='routine')
    recurrence_seconds = db.Column(db.Integer, nullable=False, default=0)
    dependencies = db.Column(db.JSON, nullable=True, default=list)
    status = db.Column(db.String(20), nullable=False, default='planned')  # planned | inProgress | done | overdue
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Связь с тегами
    tags = db.relationship(
        'Tag',
        secondary=task_tag,
        lazy='subquery',
        backref=db.backref('tasks', lazy=True)
    )

    def to_dict(self):
        def format_dt(dt):
            return dt.isoformat()+'Z' if dt else None
        print(self.completed_at, format_dt(self.completed_at), self.due_at.isoformat())
        return {
            "id": self.id,
            "title": self.title,
            "note": self.note,
            "deadlines": {
                "planned_at": format_dt(self.planned_at),
                "due_at": format_dt(self.due_at),
                "grace_end": format_dt(self.grace_end)
            },
            "duration_seconds": self.duration_seconds,
            "tags": [tag.name for tag in self.tags],
            "priority": self.priority,
            "recurrence_seconds": self.recurrence_seconds,
            "dependencies": self.dependencies or [],
            "status": self.status,
            "completed_at": format_dt(self.completed_at)
        }