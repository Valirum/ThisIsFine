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

export function getTodayMoscowKey() {
    const now = new Date();
    return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }); // "2025-11-06"
}

// Определяет, в какой день отображать задачу
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

    const tasksByDate = {};
    tasks.forEach(task => {
        const displayDate = getDisplayDate(task);
        const dateKey = toMoscowDateKey(displayDate);
        if (!tasksByDate[dateKey]) tasksByDate[dateKey] = [];
        tasksByDate[dateKey].push(task);
    });

    // === Основной цикл по дням периода ===
    const day = new Date(currentStart);
    let currentMonthKey = null;

    while (day <= currentEnd) {
        const dateStr = toMoscowDateKey(day);
        const year = day.getFullYear();
        const month = day.getMonth();
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

        if (monthKey !== currentMonthKey) {
            // === ШАГ 1: Завершаем предыдущий месяц (если он был) ===
            if (currentMonthKey !== null) {
                // Берем последний день предыдущего месяца (вчерашний)
                const lastDayPrev = new Date(day);
                lastDayPrev.setDate(lastDayPrev.getDate() - 1);

                // Сколько дней нужно добавить, чтобы дойти до воскресенья?
                const lastDayOfWeek = lastDayPrev.getDay(); // 0 = Вс, 1 = Пн, ..., 6 = Сб
                const daysAfter = (lastDayOfWeek === 0) ? 0 : (7 - lastDayOfWeek); // до Вс

                if (daysAfter > 0) {
                    const phantomStart = new Date(lastDayPrev);
                    phantomStart.setDate(phantomStart.getDate() + 1); // первый день следующего месяца
                    for (let i = 0; i < daysAfter; i++) {
                        const phantomDate = new Date(phantomStart);
                        phantomDate.setDate(phantomStart.getDate() + i);
                        const phantomDateStr = toMoscowDateKey(phantomDate);
                        renderDayElement(phantomDate, phantomDateStr, true);
                    }
                }
            }

            // === ШАГ 2: Рисуем заголовок текущего месяца ===
            currentMonthKey = monthKey;
            const monthHeader = document.createElement('div');
            monthHeader.className = 'month-header';
            monthHeader.style.gridColumn = '1 / -1';
            monthHeader.textContent = `${MONTH_NAMES[month]} ${year}`;
            calendarEl.appendChild(monthHeader);

            // === ШАГ 3: Выравниваем начало текущего месяца по понедельнику ===
            const firstDayOfMonth = new Date(year, month, 1);
            const firstDayOfWeek = firstDayOfMonth.getDay(); // 0 = Вс
            const daysBefore = (firstDayOfWeek === 0) ? 6 : firstDayOfWeek - 1; // Пн = 0

            if (daysBefore > 0) {
                const phantomStart = new Date(firstDayOfMonth);
                phantomStart.setDate(phantomStart.getDate() - daysBefore); // первое число минус N дней
                for (let i = 0; i < daysBefore; i++) {
                    const phantomDate = new Date(phantomStart);
                    phantomDate.setDate(phantomStart.getDate() + i);
                    const phantomDateStr = toMoscowDateKey(phantomDate);
                    renderDayElement(phantomDate, phantomDateStr, true);
                }
            }
        }

        // === ШАГ 4: Рендерим текущий день ===
        const dayTasks = tasksByDate[dateStr] || [];
        renderDayElement(day, dateStr, false, dayTasks);

        day.setDate(day.getDate() + 1);
    }

    // === ШАГ 5: После цикла — завершаем последний месяц до воскресенья ===
    if (currentMonthKey !== null) {
        const lastDay = new Date(currentEnd);
        const lastDayOfWeek = lastDay.getDay(); // 0 = Вс
        const daysAfter = (lastDayOfWeek === 0) ? 0 : (7 - lastDayOfWeek);

        if (daysAfter > 0) {
            const phantomStart = new Date(lastDay);
            phantomStart.setDate(phantomStart.getDate() + 1);
            for (let i = 0; i < daysAfter; i++) {
                const phantomDate = new Date(phantomStart);
                phantomDate.setDate(phantomStart.getDate() + i);
                const phantomDateStr = toMoscowDateKey(phantomDate);
                renderDayElement(phantomDate, phantomDateStr, true);
            }
        }
    }
}

async function renderDayElement(date, dateKey, isOutside, tasks = null) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    // Определяем, является ли этот день сегодняшним
    const isToday = dateKey === getTodayMoscowKey();

    // Фильтруем задачи: только те, чья дата отображения совпадает с dateKey
    const validTasks = (tasks || []).filter(task => {
        const displayDate = getDisplayDate(task);
        const taskDateKey = toMoscowDateKey(displayDate);
        return taskDateKey === dateKey;
    });

    const dayEl = document.createElement('div');
    dayEl.className = `day ${isOutside ? 'day--outside' : ''} ${isToday ? 'day--today' : ''}`;
    dayEl.dataset.date = dateKey;

    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = date.getDate();
    dayEl.appendChild(dayNumber);

    // Контейнер для задач (изначально скрыт у фантомов)
    const tasksContainer = document.createElement('div');
    tasksContainer.className = 'tasks-container';
    tasksContainer.style.display = isOutside ? 'none' : 'block';

    // Рендерим только валидные задачи
    if (!isOutside && validTasks.length > 0) {
        if (useCompactView) {
            renderCompactTasks(tasksContainer, validTasks);
        } else {
            renderTextualTasks(tasksContainer, validTasks);
        }
    }
    dayEl.appendChild(tasksContainer);

    // Обработка фантомных дней
    if (isOutside) {
        let tasksFetched = validTasks.length > 0;

        dayEl.addEventListener('mouseenter', async () => {
            // Превращаем в обычный день через класс
            dayEl.classList.remove('day--outside');

            // Подгружаем задачи, если ещё не загружены
            if (!tasksFetched) {
                const startIso = new Date(`${dateKey}T00:00:00`).toISOString();
                const endIso = new Date(`${dateKey}T23:59:59.999Z`).toISOString();

                try {
                    const res = await fetch(`/tasks?due_from=${encodeURIComponent(startIso)}&due_to=${encodeURIComponent(endIso)}`);
                    const fetchedTasks = await res.json();

                    // Фильтруем полученные задачи по дате отображения!
                    const filteredFetched = fetchedTasks.filter(task => {
                        const displayDate = getDisplayDate(task);
                        return toMoscowDateKey(displayDate) === dateKey;
                    });

                    // Обновляем контейнер
                    tasksContainer.innerHTML = '';
                    if (filteredFetched.length > 0) {
                        if (useCompactView) {
                            renderCompactTasks(tasksContainer, filteredFetched);
                        } else {
                            renderTextualTasks(tasksContainer, filteredFetched);
                        }
                    }
                    tasksFetched = true;
                } catch (err) {
                    console.warn('Ошибка загрузки задач для фантома:', dateKey, err);
                }
            }

            // Показываем задачи
            tasksContainer.style.display = 'block';
        });

        dayEl.addEventListener('mouseleave', () => {
            // Возвращаем фантомный класс — стили вернутся автоматически
            dayEl.classList.add('day--outside');
            tasksContainer.style.display = 'none';
        });
    }

    // Клик — всегда подгружает с фильтрацией
    dayEl.addEventListener('click', async () => {
        let finalTasks = validTasks;
        if (isOutside && !tasksFetched) {
            const startIso = new Date(`${dateKey}T00:00:00`).toISOString();
            const endIso = new Date(`${dateKey}T23:59:59.999Z`).toISOString();
            const res = await fetch(`/tasks?due_from=${encodeURIComponent(startIso)}&due_to=${encodeURIComponent(endIso)}`);
            const rawTasks = await res.json();
            finalTasks = rawTasks.filter(task => toMoscowDateKey(getDisplayDate(task)) === dateKey);
        }

        window.dispatchEvent(new CustomEvent('day-clicked', {
            detail: { date: dateKey, tasks: finalTasks }
        }));
    });

    calendarEl.appendChild(dayEl);
}

function renderCompactTasks(container, tasks) {
    const sortedTasks = [...tasks].sort((a, b) => {
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
        badge.className = `task-indicator priority-${task.priority} status-${task.status.toLowerCase()}`;
        badgeContainer.appendChild(badge);
    });

    if (tasks.length > maxBadges) {
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
        more.textContent = `+${tasks.length - maxBadges}`;
        badgeContainer.appendChild(more);
    }

    container.appendChild(badgeContainer);
}

function renderTextualTasks(container, tasks) {
    const sortedTasks = [...tasks].sort((a, b) => {
        const timeA = getDisplayDate(a).getTime();
        const timeB = getDisplayDate(b).getTime();
        if (timeA !== timeB) return timeA - timeB;
        const order = { routine: 0, high: 1, critical: 2 };
        return order[b.priority] - order[a.priority];
    });

    sortedTasks.forEach(task => {
        const taskLine = document.createElement('div');
        taskLine.className = 'task-line';
        taskLine.classList.add(`status-${task.status.toLowerCase()}`);

        const displayDate = getDisplayDate(task);
        const timeStr = formatTime(displayDate.toISOString());
        const MAX_TITLE_LENGTH = 18;
        let titlePart = task.title.length > MAX_TITLE_LENGTH
            ? task.title.substring(0, MAX_TITLE_LENGTH - 1).trim() + '…'
            : task.title;

        taskLine.innerHTML = `
            <span class="task-title">${titlePart}</span>
            ${timeStr ? `<span class="task-time">${timeStr}</span>` : ''}
        `;

        taskLine.style.display = 'flex';
        taskLine.style.justifyContent = 'space-between';
        taskLine.style.alignItems = 'center';
        taskLine.style.gap = '0.5rem';
        taskLine.style.whiteSpace = 'nowrap';
        taskLine.style.overflow = 'hidden';
        taskLine.title = `${task.title} [${task.status}] — ${displayDate.toLocaleString('ru-RU')}`;
        taskLine.style.backgroundColor = SOFT_BACKGROUNDS[task.priority] || '#2a2a2a';
        taskLine.style.borderLeft = `3px solid ${PRIORITY_COLORS[task.priority] || '#666'}`;

        taskLine.addEventListener('click', (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('task-clicked', { detail: { task } }));
        });

        container.appendChild(taskLine);
    });
}