window.calendarApp = (function () {

    class DateTimePicker {
        constructor(containerId, options = {}) {
            this.container = document.getElementById(containerId);
            if (!this.container) throw new Error(`Контейнер не найден: ${containerId}`);

            this.dateInput = document.createElement('input');
            this.dateInput.type = 'date';
            this.dateInput.style.width = '120px';
            this.dateInput.style.marginRight = '8px';

            this.hourSelect = document.createElement('select');
            this.hourSelect.style.width = '60px';
            this.hourSelect.style.marginRight = '4px';

            this.minuteSelect = document.createElement('select');
            this.minuteSelect.style.width = '60px';

            // Заполняем часы
            for (let h = 0; h < 24; h++) {
                const opt = document.createElement('option');
                opt.value = String(h).padStart(2, '0');
                opt.textContent = String(h).padStart(2, '0');
                this.hourSelect.appendChild(opt);
            }

            // Заполняем минуты (каждые 5 минут)
            [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach(m => {
                const opt = document.createElement('option');
                opt.value = String(m).padStart(2, '0');
                opt.textContent = String(m).padStart(2, '0');
                this.minuteSelect.appendChild(opt);
            });

            this.container.appendChild(this.dateInput);
            this.container.appendChild(document.createTextNode(' '));
            this.container.appendChild(this.hourSelect);
            this.container.appendChild(document.createTextNode(':'));
            this.container.appendChild(this.minuteSelect);

            // Устанавливаем значение по умолчанию (если задано)
            if (options.defaultValue) {
                this.setValue(options.defaultValue);
            } else {
                // Иначе — текущая дата и ближайшие 5 минут
                const now = new Date();
                const roundedMin = Math.ceil(now.getMinutes() / 5) * 5;
                this.setValue(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMin));
            }
        }

        setValue(isoStringOrDate) {
            const dt = isoStringOrDate instanceof Date
                ? isoStringOrDate
                : new Date(isoStringOrDate);

            if (isNaN(dt.getTime())) return;

            this.dateInput.value = dt.toISOString().split('T')[0];
            this.hourSelect.value = String(dt.getHours()).padStart(2, '0');
            this.minuteSelect.value = String(Math.floor(dt.getMinutes() / 5) * 5).padStart(2, '0');
        }

        getValue() {
            const datePart = this.dateInput.value; // "2025-10-27"
            const hour = this.hourSelect.value;     // "14"
            const minute = this.minuteSelect.value; // "30"
            if (!datePart) return null;
            return `${datePart}T${hour}:${minute}:00Z`;
        }
    }

    let currentStart, currentEnd;

    // Загрузка HTML-фрагментов модальных окон

    async function loadModals() {
        const modalsContainer = document.createElement('div');
        modalsContainer.id = 'modals-root';

        const templates = [
            '/static/modals/day-modal.html',
            '/static/modals/task-modal.html',
            '/static/modals/add-task-modal.html'
        ];

        const responses = await Promise.all(templates.map(url => fetch(url)));
        const htmls = await Promise.all(responses.map(res => res.text()));
        modalsContainer.innerHTML = htmls.join('');

        document.body.appendChild(modalsContainer);
        setupModalHandlers();
        setupFormHandler();

        // Инициализация универсальных виджетов
        addTaskPicker = new DateTimePicker('addTaskDatetimePicker');
        editTaskPicker = new DateTimePicker('editTaskDatetimePicker');
    }

    function setupModalHandlers() {
        document.querySelectorAll('.close').forEach(el => {
            el.addEventListener('click', () => {
                const modalId = el.getAttribute('data-modal');
                closeModal(modalId);
            });
        });
        document.getElementById('addTaskBtn')?.addEventListener('click', () => {
            const date = window._selectedDate; // YYYY-MM-DD
            if (!date) return;

            // Устанавливаем дату в виджет
            const isoWithTime = `${date}T12:00:00Z`; // полдень по умолчанию
            addTaskPicker.setValue(isoWithTime);

            document.getElementById('dayModal').style.display = 'none';
            document.getElementById('addTaskModal').style.display = 'block';
        });
    }

    function setupFormHandler() {
        const form = document.getElementById('editTaskForm');
        if (form) {
            form.addEventListener('submit', handleTaskUpdate);
        }
        document.getElementById('createTaskForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const dueAtIso = addTaskPicker.getValue();
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
            deadlines: { due_at: dueAtIso }, // ← здесь
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
            closeModal('addTaskModal');
            renderCalendar(); // обновить календарь
        } else {
            const err = await res.json();
            alert('Ошибка: ' + (err.error || 'неизвестно'));
        }
    });
    }

    async function handleTaskUpdate(e) {
        e.preventDefault();

        const dueAtIso = editTaskPicker.getValue();
        if (!dueAtIso) {
            alert('Укажите корректную дату и время');
            return;
        }

        const id = document.getElementById('taskId').value;
        const data = {
            title: document.getElementById('taskTitle').value,
            note: document.getElementById('taskNote').value,
            deadlines: {
                due_at: dueAtIso
            },
            priority: document.getElementById('taskPriority').value
        };

        const res = await fetch(`/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            alert('Задача обновлена!');
            closeModal('taskModal');
            renderCalendar();
        } else {
            alert('Ошибка обновления');
        }
    }

    function setPeriod(period) {
        const now = new Date();
        if (period === 'week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            currentStart = new Date(now.setDate(diff));
            currentEnd = new Date(currentStart);
            currentEnd.setDate(currentEnd.getDate() + 6);
        } else if (period === 'month') {
            currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
            currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        } else if (period === 'year') {
            currentStart = new Date(now.getFullYear(), 0, 1);
            currentEnd = new Date(now.getFullYear(), 11, 31);
        }
        renderCalendar();
    }

    async function renderCalendar() {
        const calendarEl = document.getElementById('calendar');
        calendarEl.innerHTML = '';

        const startIso = currentStart.toISOString().split('T')[0];
        const endIso = currentEnd.toISOString().split('T')[0];
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

        // Карта приоритетов для определения цвета
        const priorityOrder = { routine: 0, high: 1, critical: 2 };
        const priorityColors = {
            routine: '#666666',
            high: '#ff9900',
            critical: '#ff3333'
        };

        while (day <= currentEnd) {
            const dateStr = day.toISOString().split('T')[0];
            const monthKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;

            if (monthKey !== currentMonthKey) {
                currentMonthKey = monthKey;

                const monthNames = [
                    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
                ];
                const monthName = monthNames[day.getMonth()];
                const year = day.getFullYear();

                const monthHeader = document.createElement('div');
                monthHeader.className = 'month-header';
                monthHeader.style.gridColumn = '1 / -1';
                monthHeader.style.background = '#252540';
                monthHeader.style.padding = '0.5rem';
                monthHeader.style.marginTop = '1rem';
                monthHeader.style.fontWeight = 'bold';
                monthHeader.textContent = `${monthName} ${year}`;
                calendarEl.appendChild(monthHeader);
            }

            const dayTasks = tasksByDate[dateStr] || [];
            const hasTasks = dayTasks.length > 0;

            const dayEl = document.createElement('div');
            dayEl.className = 'day ' + (hasTasks ? 'has-tasks' : '');
            dayEl.style.position = 'relative';
            dayEl.style.padding = '0.5rem 0.25rem';

            // День месяца
            const dayNumber = document.createElement('div');
            dayNumber.textContent = day.getDate();
            dayNumber.style.zIndex = '1';
            dayNumber.style.position = 'relative';

            dayEl.appendChild(dayNumber);

            if (hasTasks) {
                // Сортируем задачи по приоритету (critical → high → routine), чтобы критические были первыми
                const sortedTasks = [...dayTasks].sort((a, b) => {
                    const order = { routine: 0, high: 1, critical: 2 };
                    return order[b.priority] - order[a.priority];
                });

                // Ограничиваем количество отображаемых кружков (например, до 3–4), чтобы не перегружать
                const maxBadges = 4;
                const tasksToDisplay = sortedTasks.slice(0, maxBadges);

                // Создаём контейнер для кружков
                const badgeContainer = document.createElement('div');
                badgeContainer.style.position = 'absolute';
                badgeContainer.style.bottom = '2px';
                badgeContainer.style.right = '2px';
                badgeContainer.style.display = 'flex';
                badgeContainer.style.gap = '1px'; // минимальный отступ

                tasksToDisplay.forEach(task => {
                    const badge = document.createElement('div');
                    badge.style.width = '8px';
                    badge.style.height = '8px';
                    badge.style.borderRadius = '50%';
                    badge.style.backgroundColor = priorityColors[task.priority] || '#666';
                    badge.style.border = '1px solid #000';
                    badge.style.boxShadow = '0 0 1px #fff';
                    badgeContainer.appendChild(badge);
                });

                // Если задач больше, чем отображаем — добавим "+N"
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
                dayEl.dataset.date = dateStr;
                dayEl.addEventListener('click', () => openDayView(dateStr, dayTasks));
            } else {
                // Внутри renderCalendar(), при создании dayEl:
                dayEl.dataset.date = dateStr; // ← добавьте это ДАЖЕ если задач нет
                dayEl.addEventListener('click', () => openDayView(dateStr, dayTasks));
            }
            calendarEl.appendChild(dayEl);
            day.setDate(day.getDate() + 1);
        }
    }

    function openDayView(date, tasks) {
        document.getElementById('modalDate').textContent = `Задачи на ${date}`;
        const listEl = document.getElementById('tasksList');
        listEl.innerHTML = '';

        if (tasks.length === 0) {
            listEl.innerHTML = '<em>Нет задач</em>';
        } else {
            tasks.forEach(t => {
                const div = document.createElement('div');
                div.className = 'task-item';
                const dueTime = new Date(t.deadlines.due_at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                div.textContent = `${t.title} [${t.priority}] — ${dueTime}`;
                div.addEventListener('click', () => showEditTask(t));
                listEl.appendChild(div);
            });
        }

        // Сохраняем дату для кнопки "Добавить задачу"
        window._selectedDate = date;

        document.getElementById('dayModal').style.display = 'block';
    }

    function showDayTasks(date, tasks) {
    document.getElementById('modalDate').textContent = `Задачи на ${date}`;
    const listEl = document.getElementById('tasksList');
    listEl.innerHTML = '';

    tasks.forEach(t => {
        const div = document.createElement('div');
        div.className = 'task-item';

        // Извлекаем время из due_at
        const dueTime = new Date(t.deadlines.due_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });

        div.textContent = `${t.title} [${t.priority}] — ${dueTime}`;
        div.addEventListener('click', () => showEditTask(t));
        listEl.appendChild(div);
    });

    document.getElementById('dayModal').style.display = 'block';
}

    function showEditTask(task) {
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskTitle').value = task.title;
        document.getElementById('taskNote').value = task.note || '';
        document.getElementById('taskPriority').value = task.priority;

        // Устанавливаем дату и время в универсальный виджет
        editTaskPicker.setValue(task.deadlines.due_at);

        document.getElementById('dayModal').style.display = 'none';
        document.getElementById('taskModal').style.display = 'block';
    }

    function customRange() {
        const start = document.getElementById('start').value;
        const end = document.getElementById('end').value;
        if (!start || !end) return alert('Укажите обе даты');
        currentStart = new Date(start);
        currentEnd = new Date(end);
        renderCalendar();
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }

    // Инициализация
    function init() {
        // Кнопки периода
        document.querySelectorAll('[data-period]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                setPeriod(e.target.getAttribute('data-period'));
            });
        });

        // Кнопка диапазона
        document.getElementById('applyRange')?.addEventListener('click', customRange);

        // Загружаем модальные окна
        loadModals().then(() => {
            setPeriod('week');
        });
    }

    return { init, setPeriod, customRange, closeModal };
})();

document.addEventListener('DOMContentLoaded', () => {
    window.calendarApp.init();
});