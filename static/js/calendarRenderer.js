// calendarRenderer.js
import { PRIORITY_COLORS, SOFT_BACKGROUNDS, MONTH_NAMES } from './utils.js';

let currentStart, currentEnd;
let useCompactView = true;

function formatTime(dateStr) {
    if (!dateStr) return '';
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // "15:00"
}

export function setPeriodState(start, end) {
    currentStart = start;
    currentEnd = end;
}

export function getPeriodState() {
    return { currentStart, currentEnd };
}

export function setViewMode(compact) {
    useCompactView = compact;
}

function toMoscowDateKey(date) {
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
}

// Определяет, в какой день отображать задачу
// Определяет, в какой день и с каким временем отображать задачу
function getDisplayDate(task) {
    const now = new Date();
    const due = new Date(task.deadlines.due_at);
    const grace = task.deadlines.grace_end ? new Date(task.deadlines.grace_end) : null;
    const planned = task.deadlines.planned_at ? new Date(task.deadlines.planned_at) : null;
    const completed = task.completed_at ? new Date(task.completed_at) : null;

    // 1. Если выполнена — всегда показываем в день завершения
    if (task.status === 'done' && completed) {
        return completed;
    }

    if (task.status === 'failed') {
        // Показываем в день окончания льготы или due_at, если льготы нет
        return grace || due;
    }

    // 2. Если просрочена и есть льгота, и мы ещё в её пределах — показываем grace_end
    if (task.status === 'overdue' && grace && now <= grace) {
        return grace;
    }

    // 3. Для всех остальных статусов — выбираем дату по статусу:
    if (task.status === 'inProgress' || task.status === 'overdue') {
        // В работе или просрочена → срок — due_at
        return due;
    }

    // 4. Для planned — сначала planned_at, если задан, иначе due_at
    if (task.status === 'planned') {
        return planned || due;
    }

    // fallback
    return due;
}

// Форматирует дату как YYYY-MM-DD
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// Визуальные стили по статусу
const STATUS_STYLES = {
    done: { opacity: 0.6, textDecoration: 'line-through' },
    inProgress: { fontWeight: 'bold', border: '1px solid #ffcc00' },
    overdue: { boxShadow: '0 0 4px #ff4444' },
    planned: {}
};

export async function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    const startIso = currentStart.toISOString();
    let endIso = currentEnd.toISOString();
    if (endIso.endsWith('00:00:00.000Z')) {
        endIso = endIso.split('T')[0] + 'T23:59:59.999Z';
    }

    const res = await fetch(`/tasks?due_from=${encodeURIComponent(startIso)}&due_to=${encodeURIComponent(endIso)}`);
    const tasks = await res.json();

    // Группируем задачи по дню отображения
    const tasksByDate = {};
    tasks.forEach(task => {
        const displayDate = getDisplayDate(task);
        const dateKey = toMoscowDateKey(displayDate);
        if (!tasksByDate[dateKey]) tasksByDate[dateKey] = [];
        tasksByDate[dateKey].push(task);
    });

    const day = new Date(currentStart);
    let currentMonthKey = null;

    while (day <= currentEnd) {
        const dateStr = toMoscowDateKey(day);
        const monthKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;

        if (monthKey !== currentMonthKey) {
            currentMonthKey = monthKey;
            const monthHeader = document.createElement('div');
            monthHeader.className = 'month-header';
            monthHeader.style.gridColumn = '1 / -1';
            monthHeader.textContent = `${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`;
            calendarEl.appendChild(monthHeader);
        }

        const dayTasks = tasksByDate[dateStr] || [];
        const dayEl = document.createElement('div');
        dayEl.className = 'day';
        dayEl.dataset.date = dateStr;

        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day.getDate();
        dayEl.appendChild(dayNumber);

        if (useCompactView) {
            // === Компактный режим: кружки с учётом статуса ===
            if (dayTasks.length > 0) {
                const sortedTasks = [...dayTasks].sort((a, b) => {
                    const order = { routine: 0, high: 1, critical: 2 };
                    return order[b.priority] - order[a.priority];
                });

                const maxBadges = 3;
                const tasksToDisplay = sortedTasks.slice(0, maxBadges);

                const badgeContainer = document.createElement('div');
                badgeContainer.style.position = 'absolute';
                badgeContainer.style.bottom = '2px';
                badgeContainer.style.right = '2px';
                badgeContainer.style.display = 'flex';
                badgeContainer.style.gap = '1px';

                tasksToDisplay.forEach(task => {
                    const badge = document.createElement('div');
                    badge.className = 'task-indicator'; // сброс
                    badge.classList.add(`status-${task.status.toLowerCase()}`);
                    badge.style.backgroundColor = PRIORITY_COLORS[task.priority] || '#666';

                    // Визуальный акцент по статусу (например, рамка)
                    if (task.status === 'done') {
                        badge.style.opacity = '0.5';
                    } else if (task.status === 'inProgress') {
                        badge.style.boxShadow = '0 0 2px #ffcc00';
                    } else if (task.status === 'overdue') {
                        badge.style.boxShadow = '0 0 3px #ff4444';
                    }

                    badgeContainer.appendChild(badge);
                });

                if (dayTasks.length > maxBadges) {
                    const more = document.createElement('div');
                    more.style.width = '8px';
                    more.style.height = '8px';
                    more.style.borderRadius = '50%';
                    more.style.backgroundColor = '#aaa';
                    more.style.color = '#000';
                    more.style.fontSize = '6px';
                    more.style.display = 'flex';
                    more.style.alignItems = 'center';
                    more.style.justifyContent = 'center';
                    more.style.fontWeight = 'bold';
                    more.textContent = `+${dayTasks.length - maxBadges}`;
                    badgeContainer.appendChild(more);
                }

                dayEl.appendChild(badgeContainer);
            }
        } else {
            // === Текстовый режим ===
            if (dayTasks.length > 0) {
              const sortedTasks = [...dayTasks].sort((a, b) => {
                const timeA = getDisplayDate(a).getTime();
                const timeB = getDisplayDate(b).getTime();
                if (timeA !== timeB) {
                  return timeA - timeB;
                }
                const order = { routine: 0, high: 1, critical: 2 };
                return order[b.priority] - order[a.priority];
              });
              sortedTasks.forEach(task => {
                const taskLine = document.createElement('div');
                taskLine.className = 'task-line';
                taskLine.classList.add(`status-${task.status.toLowerCase()}`);

                const displayDate = getDisplayDate(task);
                const timeStr = formatTime(displayDate.toISOString());

                // Усечение заголовка
                const MAX_TITLE_LENGTH = 18;
                let titlePart = task.title;
                if (task.title.length > MAX_TITLE_LENGTH) {
                  titlePart = task.title.substring(0, MAX_TITLE_LENGTH - 1).trim() + '…';
                }

                // Гибкая разметка: заголовок слева, время — справа
                taskLine.innerHTML = `
                  <span class="task-title">${titlePart}</span>
                  ${timeStr ? `<span class="task-time">${timeStr}</span>` : ''}
                `;

                // Flex-стили для выравнивания
                taskLine.style.display = 'flex';
                taskLine.style.justifyContent = 'space-between';
                taskLine.style.alignItems = 'center';
                taskLine.style.gap = '0.5rem';
                taskLine.style.whiteSpace = 'nowrap';
                taskLine.style.overflow = 'hidden';

                // Подсказка
                taskLine.title = `${task.title} [${task.status}] — ${displayDate.toLocaleString('ru-RU')}`;

                // Стили по приоритету (уже существующие)
                taskLine.style.backgroundColor = SOFT_BACKGROUNDS[task.priority] || '#2a2a2a';
                taskLine.style.borderLeft = `3px solid ${PRIORITY_COLORS[task.priority] || '#666'}`;

                // Обработчик клика
                taskLine.addEventListener('click', (e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('task-clicked', { detail: { task } }));
                });

                dayEl.appendChild(taskLine);
              });
            }
        }

        dayEl.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('day-clicked', {
                detail: { date: dateStr, tasks: dayTasks }
            }));
        });

        calendarEl.appendChild(dayEl);
        day.setDate(day.getDate() + 1);
    }
}