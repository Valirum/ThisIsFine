// main.js
import { renderCalendar, setPeriodState, setViewMode } from './calendarRenderer.js';
import { loadModals, getAddTaskPicker, getEditTaskPicker } from './modalManager.js';
import { setupFormHandlers } from './taskForms.js';

let currentStart, currentEnd;

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
            if (task) showEditTask(task);
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

    document.getElementById('dayModal').style.display = 'none';
    document.getElementById('taskModal').style.display = 'block';
}

function setupGlobalHandlers() {
    document.querySelectorAll('[data-period]').forEach(btn => {
        btn.addEventListener('click', e => setPeriod(e.target.dataset.period));
    });

    // В main.js → setupGlobalHandlers()
    window.addEventListener('task-clicked', (e) => {
        const { task } = e.detail;
        showEditTask(task);
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
    viewToggle.checked = savedView; // checked = список (не compact)

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