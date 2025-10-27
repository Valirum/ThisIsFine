// taskForms.js
import {
   getAddTaskPicker,
   getEditTaskPicker,
   getAddPlannedTaskPicker,
   getEditPlannedTaskPicker,
   getAddGraceEndPlannedTaskPicker,
   getEditGraceEndPlannedTaskPicker
 } from './modalManager.js';

export function setupFormHandlers(onTaskChange) {
    // Утилиты
    function toISO(localDateTimeStr) {
      if (!localDateTimeStr) return null;
      const dt = new Date(localDateTimeStr);
      if (isNaN(dt.getTime())) return null;
      return dt.toISOString(); // Всегда UTC
    }

    function parseDependencies(str) {
      if (!str) return [];
      return str.split(',')
        .map(s => s.trim())
        .filter(s => s !== '' && !isNaN(s))
        .map(Number);
    }

    function parseTags(str) {
      if (!str) return [];
      return str.split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s !== '');
    }

    // === ОБРАБОТЧИК СОЗДАНИЯ ===
    document.getElementById('createTaskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('newTaskTitle')?.value.trim();
      if (!title) {
        alert('Требуется заголовок задачи');
        return;
      }

      // Получаем значения из пикеров
      const duePicker = getAddTaskPicker();
      const plannedPicker = getAddPlannedTaskPicker();
      const gracePicker = getAddGraceEndPlannedTaskPicker();

      const plannedEnabled = document.getElementById('addPlannedAtEnabled')?.checked;
      const graceEnabled = document.getElementById('addGraceEndEnabled')?.checked;

      const dueAtIso = duePicker?.getValue?.();
      if (!dueAtIso) {
        alert('Укажите срок выполнения (due_at)');
        return;
      }

      const data = {
        title,
        note: document.getElementById('newTaskNote')?.value.trim() || null,
        deadlines: {
          due_at: dueAtIso,
          planned_at: plannedEnabled ? plannedPicker?.getValue?.() : null,
          grace_end: graceEnabled ? gracePicker?.getValue?.() : null
        },
        duration_seconds: parseInt(document.getElementById('newTaskDuration')?.value) || 0,
        priority: document.getElementById('newTaskPriority')?.value || 'routine',
        recurrence_seconds: parseInt(document.getElementById('newTaskRecurrence')?.value) || 0,
        dependencies: parseDependencies(document.getElementById('newTaskDependencies')?.value),
        tags: parseTags(document.getElementById('newTaskTags')?.value)
      };
        console.log(data)
      try {
        const res = await fetch('/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (res.ok) {
          document.getElementById('addTaskModal').style.display = 'none';
          location.reload();
          alert('успешно');
        } else {
          const err = await res.json();
          alert('Ошибка создания: ' + (err.error || 'неизвестно'));
        }
      } catch (err) {
        alert('Сбой сети: ' + err.message);
      }
    });

    // === ОБРАБОТЧИК РЕДАКТИРОВАНИЯ ===
    document.getElementById('editTaskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const taskId = document.getElementById('taskId')?.value;
      if (!taskId) {
        alert('ID задачи не найден');
        return;
      }

      const title = document.getElementById('taskTitle')?.value.trim();
      if (!title) {
        alert('Требуется заголовок задачи');
        return;
      }

      const duePicker = getEditTaskPicker();
      const plannedPicker = getEditPlannedTaskPicker();
      const gracePicker = getEditGraceEndPlannedTaskPicker();

      const plannedEnabled = document.getElementById('editPlannedAtEnabled')?.checked;
      const graceEnabled = document.getElementById('editGraceEndEnabled')?.checked;

      const dueAtIso = duePicker?.getValue?.();

      if (!dueAtIso) {
        alert('Укажите срок выполнения (due_at)');
        return;
      }

      const data = {
        title,
        note: document.getElementById('taskNote')?.value.trim() || null,
        deadlines: {
          due_at: dueAtIso,
          planned_at: plannedEnabled ? plannedPicker?.getValue?.() : null,
          grace_end: graceEnabled ? gracePicker?.getValue?.() : null
        },
        duration_seconds: parseInt(document.getElementById('taskDuration')?.value) || 0,
        priority: document.getElementById('taskPriority')?.value || 'routine',
        recurrence_seconds: parseInt(document.getElementById('taskRecurrence')?.value) || 0,
        dependencies: parseDependencies(document.getElementById('taskDependencies')?.value),
        tags: parseTags(document.getElementById('taskTags')?.value)
      };

      try {
        const res = await fetch(`/tasks/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)

        });

        if (res.ok) {
          document.getElementById('taskModal').style.display = 'none';
          location.reload();
        } else {
          const err = await res.json();
          alert('Ошибка обновления: ' + (err.error || 'неизвестно'));
        }
      } catch (err) {
        alert('Сбой сети: ' + err.message);
      }
    });

    // Для формы создания
    document.getElementById('addPlannedAtEnabled')?.addEventListener('change', function() {
      document.getElementById('addPlannedAtDatetimePicker').style.display = this.checked ? 'block' : 'none';
    });

    document.getElementById('addGraceEndEnabled')?.addEventListener('change', function() {
      document.getElementById('addGraceEndDatetimePicker').style.display = this.checked ? 'block' : 'none';
    });

    // Для формы редактирования
    document.getElementById('editPlannedAtEnabled')?.addEventListener('change', function() {
      document.getElementById('editPlannedAtDatetimePicker').style.display = this.checked ? 'block' : 'none';
    });

    document.getElementById('editGraceEndEnabled')?.addEventListener('change', function() {
      document.getElementById('editGraceEndDatetimePicker').style.display = this.checked ? 'block' : 'none';
    });
}