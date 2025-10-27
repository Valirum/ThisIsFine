// taskForms.js
import { getAddTaskPicker, getEditTaskPicker } from './modalManager.js';

export function setupFormHandlers(onTaskChange) {
    // Обработчик редактирования
    document.getElementById('editTaskForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editPicker = getEditTaskPicker();
        const dueAtIso = editPicker.getValue();
        if (!dueAtIso) {
            alert('Укажите корректную дату и время');
            return;
        }

        const id = document.getElementById('taskId').value;
        const data = {
            title: document.getElementById('taskTitle').value,
            note: document.getElementById('taskNote').value,
            deadlines: { due_at: dueAtIso },
            priority: document.getElementById('taskPriority').value
        };

        const res = await fetch(`/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            alert('Задача обновлена!');
            document.getElementById('taskModal').style.display = 'none';
            onTaskChange();
        } else {
            alert('Ошибка обновления');
        }
    });

    // Обработчик создания
    document.getElementById('createTaskForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const addPicker = getAddTaskPicker();
        const dueAtIso = addPicker.getValue();
        if (!dueAtIso) {
            alert('Укажите корректную дату и время');
            return;
        }

        const tagsInput = document.getElementById('newTaskTags').value;
        const tags = tagsInput
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t);

        const data = {
            title: document.getElementById('newTaskTitle').value,
            note: document.getElementById('newTaskNote').value || null,
            deadlines: { due_at: dueAtIso },
            priority: document.getElementById('newTaskPriority').value,
            tags: tags,
            duration_seconds: 0,
            recurrence_seconds: 0,
            dependencies: []
        };

        const res = await fetch('/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            alert('Задача создана!');
            document.getElementById('addTaskModal').style.display = 'none';
            onTaskChange();
        } else {
            const err = await res.json();
            alert('Ошибка: ' + (err.error || 'неизвестно'));
        }
    });
}