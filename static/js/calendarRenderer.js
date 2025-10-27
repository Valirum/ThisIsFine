// calendarRenderer.js
import { PRIORITY_COLORS, SOFT_BACKGROUNDS, PRIORITY_ORDER, MONTH_NAMES } from './utils.js';

let currentStart, currentEnd;
let useCompactView = true;

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

export async function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    const startIso = currentStart.toISOString();
    let endIso = currentEnd.toISOString();
    if (endIso.split('T')[1] == "00:00:00.000Z"){
        endIso = endIso.split('T')[0]+"T23:59:59.999Z";}
    console.log(currentStart.toISOString(), currentEnd.toISOString(), startIso, endIso)
    const res = await fetch(`/tasks?due_from=${startIso}&due_to=${endIso}`);
    const tasks = await res.json();

    const tasksByDate = {};
    tasks.forEach(t => {
        const dateKey = t.deadlines.due_at.split('T')[0];
        if (!tasksByDate[dateKey]) tasksByDate[dateKey] = [];
        tasksByDate[dateKey].push(t);
    });

    const day = new Date(currentStart);
    let currentMonthKey = null;

    while (day <= currentEnd) {
        const dateStr = day.toISOString().split('T')[0];
        const monthKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;

        if (monthKey !== currentMonthKey) {
            currentMonthKey = monthKey;
            const monthHeader = document.createElement('div');
            monthHeader.className = 'month-header';
            monthHeader.style.gridColumn = '1 / -1';
            monthHeader.style.background = '#252540';
            monthHeader.style.padding = '0.5rem';
            monthHeader.style.marginTop = '1rem';
            monthHeader.style.fontWeight = 'bold';
            monthHeader.style.textAlign = 'center';
            monthHeader.textContent = `${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`;
            calendarEl.appendChild(monthHeader);
        }

        const dayTasks = tasksByDate[dateStr] || [];
        const dayEl = document.createElement('div');
        dayEl.className = 'day';
        dayEl.style.position = 'relative';
        dayEl.style.display = 'flex';
        dayEl.style.flexDirection = 'column';
        dayEl.style.padding = '0.25rem';
        dayEl.style.minHeight = useCompactView ? '60px' : 'auto';
        dayEl.style.gap = '0.15rem';
        dayEl.dataset.date = dateStr;

        const dayNumber = document.createElement('div');
        dayNumber.textContent = day.getDate();
        dayNumber.style.textAlign = 'right';
        dayNumber.style.fontSize = '0.85em';
        dayNumber.style.color = '#aaa';
        dayNumber.style.fontWeight = 'bold';
        dayEl.appendChild(dayNumber);

        if (useCompactView) {
            // === Режим кружков ===
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
                    badge.style.width = '8px';
                    badge.style.height = '8px';
                    badge.style.borderRadius = '50%';
                    badge.style.backgroundColor = PRIORITY_COLORS[task.priority] || '#666';
                    badge.style.border = '1px solid #000';
                    badge.style.boxShadow = '0 0 1px #fff';
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
            // === Режим текста задач ===
            if (dayTasks.length > 0) {
                const sortedTasks = [...dayTasks].sort((a, b) => {
                    const order = { routine: 0, high: 1, critical: 2 };
                    return order[b.priority] - order[a.priority];
                });

                sortedTasks.forEach(task => {
                    const taskLine = document.createElement('div');
                    const MAX_TITLE_LENGTH = 24;
                    let displayTitle = task.title;
                    if (task.title.length > MAX_TITLE_LENGTH) {
                        displayTitle = task.title.substring(0, MAX_TITLE_LENGTH - 1).trim() + '…';
                    }
                    taskLine.textContent = displayTitle;
                    taskLine.title = task.title;
                    taskLine.style.fontSize = '0.75em';
                    taskLine.style.padding = '0.15rem 0.25rem';
                    taskLine.style.borderRadius = '2px';
                    taskLine.style.color = '#e0e0ff';
                    taskLine.style.backgroundColor = SOFT_BACKGROUNDS[task.priority] || '#2a2a2a';
                    taskLine.style.borderLeft = `3px solid ${PRIORITY_COLORS[task.priority] || '#666'}`;
                    taskLine.style.whiteSpace = 'nowrap';
                    taskLine.style.overflow = 'hidden';
                    taskLine.style.textOverflow = 'ellipsis';

                    // === КРИТИЧЕСКИ ВАЖНО: обработчик клика по задаче ===
                    taskLine.addEventListener('click', (e) => {
                        e.stopPropagation(); // ОСТАНОВИТЬ всплытие!
                        window.dispatchEvent(new CustomEvent('task-clicked', {
                            detail: { task }
                        }));
                    });

                    dayEl.appendChild(taskLine);
                });
            } else {
                dayEl.style.minHeight = '60px';
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