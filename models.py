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
    # В будущем: color, icon, created_at и т.д.

    def __repr__(self):
        return f"<Tag {self.name}>"

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

    # Связь с тегами
    tags = db.relationship(
        'Tag',
        secondary=task_tag,
        lazy='subquery',
        backref=db.backref('tasks', lazy=True)
    )

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "note": self.note,
            "deadlines": {
                "planned_at": self.planned_at.isoformat() if self.planned_at else None,
                "due_at": self.due_at.isoformat(),
                "grace_end": self.grace_end.isoformat() if self.grace_end else None
            },
            "duration_seconds": self.duration_seconds,
            "tags": [tag.name for tag in self.tags],
            "priority": self.priority,
            "recurrence_seconds": self.recurrence_seconds,
            "dependencies": self.dependencies or []
        }