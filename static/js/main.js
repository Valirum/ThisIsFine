// main.js
import { renderCalendar, setPeriodState, setViewMode } from './calendarRenderer.js';
import { loadModals, getAddTaskPicker, getEditTaskPicker } from './modalManager.js';
import { setupFormHandlers } from './taskForms.js';

let currentStart, currentEnd;
let currentViewedTask = null;

function setPeriod(period) {
    const now = new Date();

    if (period === 'week') {
        // Получаем начало недели (понедельник) в UTC
        const utcDay = now.getUTCDay(); // 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
        const utcDate = now.getUTCDate();
        const utcMonth = now.getUTCMonth();
        const utcYear = now.getUTCFullYear();

        // Смещение до понедельника (если воскресенье — день 0, то сдвиг на -6)
        const daysToMonday = utcDay === 0 ? -6 : 1 - utcDay;
        const startUTCDate = utcDate + daysToMonday;

        currentStart = new Date(Date.UTC(utcYear, utcMonth, startUTCDate));
        currentEnd = new Date(Date.UTC(utcYear, utcMonth, startUTCDate + 6));
    }
    else if (period === 'month') {
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth();
        currentStart = new Date(Date.UTC(year, month, 1));
        currentEnd = new Date(Date.UTC(year, month + 1, 0)); // последний день месяца
    }
    else if (period === 'year') {
        const year = now.getUTCFullYear();
        currentStart = new Date(Date.UTC(year, 0, 1));
        currentEnd = new Date(Date.UTC(year, 11, 31)); // 31 декабря
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

function populateEditForm(task) {
      // Заполняем скалярные поля по id
      document.getElementById('taskId').value = task.id;
      document.getElementById('taskTitle').value = task.title || '';
      document.getElementById('taskNote').value = task.note || '';

      // Приоритет
      const prioritySelect = document.getElementById('taskPriority');
      if (prioritySelect) {
        prioritySelect.value = task.priority || 'routine';
      }

      // Числовые поля
      document.getElementById('taskDuration').value = task.duration_seconds || 0;
      document.getElementById('taskRecurrence').value = task.recurrence_seconds || 0;

      // Зависимости и теги
      document.getElementById('taskDependencies').value = (task.dependencies || []).join(', ');
      document.getElementById('taskTags').value = (task.tags || []).join(', ');

      // === Работа с датами и чекбоксами ===
      const d = task.deadlines || {};

      // Планируемое начало
      const plannedAtEnabled = !!d.planned_at;
      const plannedCheckbox = document.getElementById('editPlannedAtEnabled');
      const plannedPickerDiv = document.getElementById('editPlannedAtDatetimePicker');

      if (plannedCheckbox) {
        plannedCheckbox.checked = plannedAtEnabled;
        plannedPickerDiv.style.display = plannedAtEnabled ? 'block' : 'none';

        // Если пикер поддерживает setValue — обновляем его
        if (plannedAtEnabled && window.editPlannedAtDatetimePicker?.setValue) {
          window.editPlannedAtDatetimePicker.setValue(d.planned_at);
        }
      }

      // Конец льготного периода
      const graceEndEnabled = !!d.grace_end;
      const graceCheckbox = document.getElementById('editGraceEndEnabled');
      const gracePickerDiv = document.getElementById('editGraceEndDatetimePicker');

      if (graceCheckbox) {
        graceCheckbox.checked = graceEndEnabled;
        gracePickerDiv.style.display = graceEndEnabled ? 'block' : 'none';

        if (graceEndEnabled && window.editGraceEndDatetimePicker?.setValue) {
          window.editGraceEndDatetimePicker.setValue(d.grace_end);
        }
      }

      // Срок выполнения (due_at) — обязателен
      const duePicker = window.editTaskPickerInstance; // или getEditTaskPicker()
      if (d.due_at && duePicker?.setValue) {
        duePicker.setValue(d.due_at);
      }
}

function showEditTask(task) {
    populateEditForm(task);
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
function formatDuration(seconds) {
  if (!seconds) return '0 сек';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let parts = [];
  if (h > 0) parts.push(`${h} ч`);
  if (m > 0) parts.push(`${m} мин`);
  if (s > 0 || parts.length === 0) parts.push(`${s} сек`);
  return parts.join(' ');
}

function showViewTask(task) {
  currentViewedTask = task;

  // ID и заголовок — всегда есть
  document.getElementById('viewTaskId').textContent = task.id;
  document.getElementById('viewTaskTitle').textContent = task.title || 'Безымянная задача';

  // Приоритет
  const priorityEl = document.getElementById('viewTaskPriority');
  const priority = task.priority || 'routine';
  priorityEl.textContent = priority;
  priorityEl.className = `priority-badge ${priority}`;

  // Теги
  const tagsEl = document.getElementById('viewTaskTags');
  const tags = Array.isArray(task.tags) ? task.tags : [];
  if (tags.length > 0) {
    tagsEl.innerHTML = tags.map(tag =>
      `<span class="tag-item">${tag}</span>`
    ).join('');
  } else {
    tagsEl.innerHTML = '<span class="tag-item">—</span>';
  }

  // Срок выполнения (due_at) — обязателен по модели, но на всякий случай
  const dueAt = task.deadlines?.due_at;
  if (dueAt) {
    document.getElementById('viewTaskDueAt').textContent =
      new Date(dueAt).toLocaleString('ru-RU');
  } else {
    document.getElementById('viewTaskDueAt').textContent = 'Конец времён';
  }

  // Планируемое начало (planned_at)
  const plannedAtRow = document.getElementById('viewTaskPlannedAtRow');
  const plannedAt = task.deadlines?.planned_at;
  if (plannedAt) {
    plannedAtRow.style.display = 'flex';
    document.getElementById('viewTaskPlannedAt').textContent =
      new Date(plannedAt).toLocaleString('ru-RU');
  } else {
    plannedAtRow.style.display = 'none'; // или покажите "Не запланировано", если хотите всегда отображать
  }

  // Строгий дедлайн (grace_end)
  const graceEndRow = document.getElementById('viewTaskGraceEndRow');
  const graceEnd = task.deadlines?.grace_end;
  if (graceEnd) {
    graceEndRow.style.display = 'flex';
    document.getElementById('viewTaskGraceEnd').textContent =
      new Date(graceEnd).toLocaleString('ru-RU');
  } else {
    graceEndRow.style.display = 'none';
  }

  // Длительность
  const durationSec = task.duration_seconds || 0;
  document.getElementById('viewTaskDuration').textContent =
    durationSec ? formatDuration(durationSec) : 'Не указана';

  // Повторение
  const recurrenceSec = task.recurrence_seconds || 0;
  document.getElementById('viewTaskRecurrence').textContent =
    recurrenceSec ? formatDuration(recurrenceSec) : 'Нет';

  // Зависимости
  const depsRow = document.getElementById('viewTaskDependenciesRow');
  const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
  if (deps.length > 0) {
    depsRow.style.display = 'flex';
    document.getElementById('viewTaskDependencies').textContent = deps.join(', ');
  } else {
    depsRow.style.display = 'none';
  }

  // Описание (note)
  const noteRow = document.getElementById('viewTaskNoteRow');
  if (task.note) {
    noteRow.style.display = 'flex';
    document.getElementById('viewTaskNote').textContent = task.note;
  } else {
    noteRow.style.display = 'none';
  }

  // Показ модалки
  document.getElementById('viewTaskModal').style.display = 'block';
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