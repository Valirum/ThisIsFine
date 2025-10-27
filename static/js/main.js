// main.js
import { renderCalendar, setPeriodState, setViewMode } from './calendarRenderer.js';
import { loadModals, getAddTaskPicker, getEditTaskPicker } from './modalManager.js';
import { setupFormHandlers } from './taskForms.js';

let currentStart, currentEnd;
let currentViewedTask = null;

function setPeriod(period) {
    const now = new Date();
    if (period === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        currentStart = new Date(now.getFullYear(), now.getMonth(), diff);
        currentEnd = new Date(currentStart);
        currentEnd.setDate(currentEnd.getDate() + 6);
    } else if (period === 'month') {
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'year') {
        currentStart = new Date(now.getFullYear(), 0, 1);
        currentEnd = new Date(now.getFullYear(), 11, 31);
    }
    setPeriodState(currentStart, currentEnd);
    renderCalendar();
}

function applyCustomRange() {
    const startInput = document.getElementById('start')?.value;
    const endInput = document.getElementById('end')?.value;
    if (!startInput || !endInput) {
        alert('Укажите обе даты');
        return;
    }
    currentStart = new Date(startInput);
    currentEnd = new Date(endInput);
    setPeriodState(currentStart, currentEnd);
    renderCalendar();
}

function toggleViewMode() {
    const isCompact = !JSON.parse(localStorage.getItem('calendarCompactView') ?? 'true');
    localStorage.setItem('calendarCompactView', isCompact);
    setViewMode(isCompact);
    document.getElementById('toggleView').textContent =
        isCompact ? 'Список задач в днях' : 'Кружки приоритетов';
    renderCalendar();
}

function handleDayClick(e) {
    const { date, tasks } = e.detail;
    window._selectedDate = date;

    document.getElementById('modalDate').textContent = `Задачи на ${date}`;
    const listEl = document.getElementById('tasksList');
    listEl.innerHTML = tasks.length
        ? tasks.map(t => {
            const dueTime = new Date(t.deadlines.due_at).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
            return `<div class="task-item" data-task-id="${t.id}">
                ${t.title} [${t.priority}] — ${dueTime}
            </div>`;
        }).join('')
        : '<em>Нет задач</em>';

    document.getElementById('dayModal').style.display = 'block';

    document.querySelectorAll('.task-item').forEach(el => {
        el.addEventListener('click', () => {
            const taskId = Number(el.dataset.taskId);
            const task = tasks.find(t => t.id === taskId);
            if (task) showViewTask(task);
        });
    });
}

function showEditTask(task) {
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskTitle').value = task.title;
    document.getElementById('taskNote').value = task.note || '';
    document.getElementById('taskPriority').value = task.priority;

    const editPicker = getEditTaskPicker();
    editPicker.setValue(task.deadlines.due_at);

    document.getElementById('viewTaskModal').style.display = 'none';
    document.getElementById('dayModal').style.display = 'none';
    document.getElementById('taskModal').style.display = 'block';
}

// В main.js
function showViewTask(task) {
    currentViewedTask = task;
    // Заполняем данные
    document.getElementById('viewTaskId').textContent = task.id;
    document.getElementById('viewTaskTitle').textContent = task.title;

    // Приоритет
    const priorityEl = document.getElementById('viewTaskPriority');
    priorityEl.textContent = task.priority;
    priorityEl.className = `priority-badge ${task.priority}`;

    // Теги
    const tagsEl = document.getElementById('viewTaskTags');
    tagsEl.innerHTML = task.tags.map(tag =>
        `<span class="tag-item">${tag}</span>`
    ).join('');

    // Дедлайны
    document.getElementById('viewTaskDueAt').textContent =
        new Date(task.deadlines.due_at).toLocaleString('ru-RU');

    const plannedAtRow = document.getElementById('viewTaskPlannedAtRow');
    const graceEndRow = document.getElementById('viewTaskGraceEndRow');

    if (task.deadlines.planned_at) {
        plannedAtRow.style.display = 'flex';
        document.getElementById('viewTaskPlannedAt').textContent =
            new Date(task.deadlines.planned_at).toLocaleString('ru-RU');
    } else {
        plannedAtRow.style.display = 'none';
    }

    if (task.deadlines.grace_end) {
        graceEndRow.style.display = 'flex';
        document.getElementById('viewTaskGraceEnd').textContent =
            new Date(task.deadlines.grace_end).toLocaleString('ru-RU');
    } else {
        graceEndRow.style.display = 'none';
    }

    // Длительность
    const duration = task.duration_seconds;
    document.getElementById('viewTaskDuration').textContent =
        duration ? formatDuration(duration) : 'Не указана';

    // Повторение
    const recurrence = task.recurrence_seconds;
    document.getElementById('viewTaskRecurrence').textContent =
        recurrence ? formatDuration(recurrence) : 'Нет';

    // Зависимости
    const depsRow = document.getElementById('viewTaskDependenciesRow');
    if (task.dependencies && task.dependencies.length > 0) {
        depsRow.style.display = 'flex';
        document.getElementById('viewTaskDependencies').textContent =
            task.dependencies.join(', ');
    } else {
        depsRow.style.display = 'none';
    }

    // Описание
    const noteRow = document.getElementById('viewTaskNoteRow');
    if (task.note) {
        noteRow.style.display = 'flex';
        document.getElementById('viewTaskNote').textContent = task.note;
    } else {
        noteRow.style.display = 'none';
    }

    // Показываем форму
    document.getElementById('viewTaskModal').style.display = 'block';
}

// Вспомогательная функция форматирования длительности
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} сек`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins} мин ${secs} сек` : `${mins} мин`;
}

function setupGlobalHandlers() {
    document.querySelectorAll('[data-period]').forEach(btn => {
        btn.addEventListener('click', e => setPeriod(e.target.dataset.period));
    });

    // В main.js → setupGlobalHandlers()
    window.addEventListener('task-clicked', (e) => {
        const { task } = e.detail;
        showViewTask(task);
    });

    // В setupGlobalHandlers()
    document.getElementById('editTaskBtn')?.addEventListener('click', () => {
        if (currentViewedTask) {
            showEditTask(currentViewedTask);
            document.getElementById('viewTaskModal').style.display = 'none';
        }
    });

    document.getElementById('toggleCustomRange')?.addEventListener('click', () => {
        const inputs = document.getElementById('customRangeInputs');
        const isVisible = inputs.style.display === 'block';
        inputs.style.display = isVisible ? 'none' : 'block';
        document.getElementById('toggleCustomRange').textContent = isVisible ? 'Другое…' : 'Скрыть';
    });
    document.getElementById('applyRange')?.addEventListener('click', applyCustomRange);

    // В main.js → setupGlobalHandlers()
    const viewToggle = document.getElementById('viewModeToggle');
    const savedView = JSON.parse(localStorage.getItem('calendarCompactView') ?? 'true');

    // Устанавливаем начальное состояние свитчера
    viewToggle.checked = false; // checked = список (не compact)

    viewToggle.addEventListener('change', () => {
        const isCompact = !viewToggle.checked;
        localStorage.setItem('calendarCompactView', isCompact);
        setViewMode(isCompact);
        renderCalendar();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        }
    });
    document.addEventListener('click', e => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    window.addEventListener('day-clicked', handleDayClick);

    document.getElementById('addTaskBtn')?.addEventListener('click', () => {
        if (!window._selectedDate) return;
        const addPicker = getAddTaskPicker();
        addPicker.setValue(`${window._selectedDate}T12:00:00Z`);
        document.getElementById('dayModal').style.display = 'none';
        document.getElementById('addTaskModal').style.display = 'block';
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadModals();
        setupFormHandlers(() => renderCalendar());
        setupGlobalHandlers();
        setPeriod('week');
    } catch (err) {
        console.error('Ошибка инициализации календаря:', err);
        alert('Не удалось загрузить интерфейс календаря. См. консоль.');
    }
});