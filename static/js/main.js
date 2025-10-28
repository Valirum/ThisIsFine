// main.js
import { renderCalendar, setPeriodState, setViewMode } from './calendarRenderer.js';
import { setupFormHandlers, suggestTags } from './taskForms.js';
import {
   getEditTaskPicker,
   getEditPlannedTaskPicker,
   getEditGraceEndPlannedTaskPicker,
   loadModals,
   getAddTaskPicker
 } from './modalManager.js';

let currentStart, currentEnd;
let currentViewedTask = null;

function setPeriod(period, start = null, end = null) {

    localStorage.setItem('calendarPeriod', period);
    if (period === 'custom') {
        localStorage.setItem('customPeriodStart', start);
        localStorage.setItem('customPeriodEnd', end);
        setPeriodState(start, end);
        renderCalendar();
        return;
    }

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
    localStorage.setItem('customPeriodStart', currentStart.toISOString());
    localStorage.setItem('customPeriodEnd', currentEnd.toISOString());
    localStorage.setItem('calendarPeriod', "custom")
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

    if (tasks.length === 0) {
        listEl.innerHTML = '<em>Нет задач</em>';
    } else {
        listEl.innerHTML = tasks.map(t => {
            const dueTime = new Date(t.deadlines.due_at).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });

            // Теги: максимум 2, остальные — в "ещё N"
            const visibleTags = t.tags.slice(0, 2);
            const hiddenCount = t.tags.length - 2;

            const tagsHtml = visibleTags.map(tag => {
                // Цвет тега — из данных, если есть, иначе серый
                const tagObj = window.allTags?.find(tg => tg.name === tag) || { color: '#4a4a8a' };
                return `<span class="day-task-tag" style="background-color: ${tagObj.color}">${tag}</span>`;
            }).join('');

            const moreTagsHtml = hiddenCount > 0
                ? `<span class="day-task-tag day-task-tag--more">+${hiddenCount}</span>`
                : '';

            return `
                <div class="day-task-item priority-${t.priority} status-${t.status}" data-task-id="${t.id}">
                    <div class="day-task-header">
                        <div class="day-task-tags">
                            ${tagsHtml}${moreTagsHtml}
                        </div>
                        <div class="day-task-meta">
                            <span class="priority-badge ${t.priority}">${t.priority}</span>
                            <span class="status-badge ${t.status}">${t.status}</span>
                        </div>
                    </div>
                    <div class="day-task-title">
                        <span>${t.title}</span>
                        <span class="time">${dueTime}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('dayModal').style.display = 'block';

    // Обработчики кликов
    document.querySelectorAll('.day-task-item').forEach(el => {
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

  // Приоритет и статус
  const prioritySelect = document.getElementById('taskPriority');
  if (prioritySelect) prioritySelect.value = task.priority || 'routine';

  const statusSelect = document.getElementById('taskStatus');
  if (statusSelect) statusSelect.value = task.status || 'planned';

  // Числовые поля
  document.getElementById('taskDuration').value = task.duration_seconds || 0;
  document.getElementById('taskRecurrence').value = task.recurrence_seconds || 0;

  // Зависимости и теги
  document.getElementById('taskDependencies').value = (task.dependencies || []).join(', ');
  document.getElementById('taskTags').value = (task.tags || []).join(', ');

  // === Работа с датами ===
  const d = task.deadlines || {};

  // --- Планируемое начало ---
  const plannedAtEnabled = !!d.planned_at;
  const plannedCheckbox = document.getElementById('editPlannedAtEnabled');
  const plannedPickerDiv = document.getElementById('editPlannedAtDatetimePicker');

  if (plannedCheckbox) {
    plannedCheckbox.checked = plannedAtEnabled;
    plannedPickerDiv.style.display = plannedAtEnabled ? 'block' : 'none';

    if (plannedAtEnabled) {
      const picker = getEditPlannedTaskPicker(); // ← ИСПОЛЬЗУЕМ ГЕТТЕР
      if (picker?.setValue) {
        picker.setValue(d.planned_at);
      }
    }
  }

  // --- Крайний срок (grace_end) ---
  const graceEndEnabled = !!d.grace_end;
  const graceCheckbox = document.getElementById('editGraceEndEnabled');
  const gracePickerDiv = document.getElementById('editGraceEndDatetimePicker');

  if (graceCheckbox) {
    graceCheckbox.checked = graceEndEnabled;
    gracePickerDiv.style.display = graceEndEnabled ? 'block' : 'none';

    if (graceEndEnabled) {
      const picker = getEditGraceEndPlannedTaskPicker(); // ← ГЕТТЕР
      if (picker?.setValue) {
        picker.setValue(d.grace_end);
      }
    }
  }

  // --- Срок выполнения (due_at) — обязателен ---
  const duePicker = getEditTaskPicker(); // ← ГЕТТЕР
  if (d.due_at && duePicker?.setValue) {
    duePicker.setValue(d.due_at);
  }

  // === Назначаем обработчики переключения видимости (один раз) ===
  const attachToggle = (checkbox, pickerDiv) => {
    if (!checkbox) return;
    const handler = () => {
      pickerDiv.style.display = checkbox.checked ? 'block' : 'none';
    };
    checkbox.removeEventListener('change', handler);
    checkbox.addEventListener('change', handler);
  };

  attachToggle(plannedCheckbox, plannedPickerDiv);
  attachToggle(graceCheckbox, gracePickerDiv);
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

function showAddTask(date) {
    const addPicker = getAddTaskPicker();
    addPicker.setValue(`${date}T12:00:00Z`);
    document.getElementById('dayModal').style.display = 'none';
    document.getElementById('addTaskModal').style.display = 'block';

    // После открытия модалки
    document.getElementById('newTaskTitle')?.addEventListener('input', debounce(updateTagSuggestions, 500));
    document.getElementById('newTaskNote')?.addEventListener('input', debounce(updateTagSuggestions, 500));

    function updateTagSuggestions() {
        const title = document.getElementById('newTaskTitle')?.value || '';
        const note = document.getElementById('newTaskNote')?.value || '';
        suggestTags(title, note).then(tags => {
            // Показываем подсказку под полем тегов
            const suggestionsEl = document.getElementById('tagSuggestions');
            if (suggestionsEl) {
                suggestionsEl.innerHTML = tags.length
                    ? `Предложить: ${tags.map(t => `<a href="#" class="suggested-tag">${t}</a>`).join(', ')}`
                    : '';
            }
        });
    }

    // Вставляет тег в поле
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggested-tag')) {
            e.preventDefault();
            const tag = e.target.textContent;
            const input = document.getElementById('newTaskTags');
            const current = input.value.split(',').map(s => s.trim()).filter(s => s);
            if (!current.includes(tag)) {
                current.push(tag);
                input.value = current.join(', ');
            }
        }
    });

    // Простой debounce
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

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

  // Внутри showViewTask
    const statusEl = document.getElementById('viewTaskStatus');
    const status = task.status || 'planned';
    statusEl.textContent = status;
    statusEl.className = `priority-badge ${status.toLowerCase()}`;

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

    // Пометить как выполнено
    document.getElementById('markAsDoneBtn')?.addEventListener('click', async () => {
      if (!currentViewedTask) return;
      try {
        const res = await fetch(`/tasks/${currentViewedTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'done' })
        });
        if (res.ok) {
          document.getElementById('viewTaskModal').style.display = 'none';
          location.reload();
        }
      } catch (err) {
        alert('Ошибка: ' + err.message);
      }
    });

    // Удаление
    document.getElementById('deleteTaskBtn')?.addEventListener('click', async () => {
      if (!currentViewedTask || !confirm('Уничтожить задачу навсегда?')) return;
      try {
        const res = await fetch(`/tasks/${currentViewedTask.id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          document.getElementById('viewTaskModal').style.display = 'none';
          location.reload();
        }
      } catch (err) {
        alert('Ошибка удаления: ' + err.message);
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
    viewToggle.checked = !savedView; // checked = список (не compact)
    setViewMode(savedView);

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
        showAddTask(window._selectedDate);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadModals();
        setupFormHandlers(() => renderCalendar());
        setupGlobalHandlers();
        // При инициализации:
        const savedPeriod = localStorage.getItem('calendarPeriod') || 'week';
        let savedStart = localStorage.getItem('customPeriodStart');
        let savedEnd = localStorage.getItem('customPeriodEnd');

        // Преобразуем строки в Date (если есть)
        if (savedStart) savedStart = new Date(savedStart);
        if (savedEnd) savedEnd = new Date(savedEnd);

        setPeriod(savedPeriod, savedStart, savedEnd);

    } catch (err) {
        console.error('Ошибка инициализации календаря:', err);
        alert('Не удалось загрузить интерфейс календаря. См. консоль.');
    }
});