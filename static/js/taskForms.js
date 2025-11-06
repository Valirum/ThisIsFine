// taskForms.js
import {
   getAddTaskPicker,
   getEditTaskPicker,
   getAddPlannedTaskPicker,
   getEditPlannedTaskPicker,
   getAddGraceEndPlannedTaskPicker,
   getEditGraceEndPlannedTaskPicker,
   getAddDepsSelector,
   getEditDepsSelector
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

    const addDepsSelector = getAddDepsSelector();
    const editDepsSelector = getEditDepsSelector();

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

      // Для planned_at
        let plannedAtIso = null;
        const plannedCheckbox = document.getElementById('addPlannedAtEnabled');
        if (plannedCheckbox?.checked) {
            plannedAtIso = getAddPlannedTaskPicker()?.getValue?.();
        } else {
            const presetContainer = document.getElementById('addPlannedAtPresets');
            const selected = presetContainer?.dataset.selected;
            if (selected && selected !== 'null') {
                const dueAt = new Date(dueAtIso);
                const offsetSec = parseInt(selected);
                const plannedDate = new Date(dueAt.getTime() + offsetSec * 1000);
                plannedAtIso = plannedDate.toISOString();
            }
        }

        // Для duration — значение уже в поле, но можно уточнить:
        let durationSec = parseInt(document.getElementById('newTaskDuration')?.value) || 0;

      const data = {
        title,
        note: document.getElementById('newTaskNote')?.value.trim() || null,
        deadlines: {
          due_at: dueAtIso,
          planned_at: plannedEnabled ? plannedPicker?.getValue?.() : plannedAtIso,
          grace_end: graceEnabled ? gracePicker?.getValue?.() : null
        },
        duration_seconds: parseInt(document.getElementById('newTaskDuration')?.value) || 0,
        priority: document.getElementById('newTaskPriority')?.value || 'routine',
        recurrence_seconds: parseInt(document.getElementById('newTaskRecurrence')?.value) || 0,
        dependencies: addDepsSelector.getDependencies(),
        tags: parseTags(document.getElementById('newTaskTags')?.value),
        status: document.getElementById('taskStatus')?.value || 'planned'
      };

      try {
        const res = await fetch('/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (res.ok) {
          document.getElementById('addTaskModal').style.display = 'none';
          location.reload();

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
        dependencies: editDepsSelector.getDependencies(),
        tags: parseTags(document.getElementById('taskTags')?.value),
        status: document.getElementById('taskStatus')?.value || 'planned'
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

      const pickerDiv = document.getElementById('addPlannedAtDatetimePicker');
        const presetsDiv = document.getElementById('addPlannedAtPresets'); // ← контейнер пресетов

        if (this.checked) {
            // Ручной ввод → показываем пикер, скрываем пресеты
            pickerDiv.style.display = 'block';
            if (presetsDiv) presetsDiv.style.display = 'none';
        } else {
            // Автоматический → скрываем пикер, показываем пресеты
            pickerDiv.style.display = 'none';
            if (presetsDiv) presetsDiv.style.display = 'flex'; // или 'block', но у вас flex
        }
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

    function setupPresetButtons() {
        // === Планируемое начало ===
        const plannedPresetsContainer = document.getElementById('addPlannedAtPresets');
        const editPlannedPresetsContainer = document.getElementById('editPlannedAtPresets'); // если есть в task-modal.html

        const plannedPresets = [
            { label: "-4 ч", value: -14400 },
            { label: "-2 ч", value: -7200 },
            { label: "-1 ч", value: -3600 },
            { label: "-30 мин", value: -1800 },
            { label: "-15 мин", value: -900 },
            { label: "-5 мин", value: -300 },
            { label: "(не задавать)", value: null }
        ];

        function createPresetButtons(container, groupName) {
            if (!container) return;
            container.innerHTML = '';
            let activeValue = null;

            const handleClick = (btn, value) => {
                // Снимаем активность со всех
                container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                // Активируем текущую
                btn.classList.add('active');
                // Сохраняем выбранное значение в data-атрибут контейнера
                container.dataset.selected = value;
            };

            plannedPresets.forEach(p => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'preset-btn';
                btn.textContent = p.label;
                btn.addEventListener('click', () => handleClick(btn, p.value));
                container.appendChild(btn);
            });

            // По умолчанию активна последняя ("не задавать")
            const defaultBtn = container.lastElementChild;
            if (defaultBtn) {
                defaultBtn.classList.add('active');
                container.dataset.selected = 'null';
            }
        }

        createPresetButtons(plannedPresetsContainer, 'planned');
        createPresetButtons(editPlannedPresetsContainer, 'editPlanned');

        // === Продолжительность ===
        const durationPresetsContainer = document.getElementById('addDurationPresets');
        const editDurationPresetsContainer = document.getElementById('editDurationPresets');

        const durationPresets = [
            { label: "5 мин", value: 300 },
            { label: "10 мин", value: 600 },
            { label: "20 мин", value: 1200 },
            { label: "30 мин", value: 1800 },
            { label: "1 ч", value: 3600 },
            { label: "2 ч", value: 7200 },
            { label: "(0 сек)", value: 0 }
        ];

        function createDurationButtons(container) {
            if (!container) return;
            container.innerHTML = '';
            durationPresets.forEach(p => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'preset-btn';
                btn.textContent = p.label;
                btn.addEventListener('click', () => {
                    container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    container.dataset.selected = p.value;
                    // Обновляем поле ввода
                    const input = container.previousElementSibling?.querySelector('input[type="number"]');
                    if (input) input.value = p.value;
                });
                container.appendChild(btn);
            });
            // По умолчанию активна последняя ("0 сек")
            const defaultBtn = container.lastElementChild;
            if (defaultBtn) {
                defaultBtn.classList.add('active');
                container.dataset.selected = '0';
            }
        }

        createDurationButtons(durationPresetsContainer);
        createDurationButtons(editDurationPresetsContainer);


        // === Периодичность ===
        const recurrencePresetsContainer = document.getElementById('addRecurrencePresets');
        const editRecurrencePresetsContainer = document.getElementById('editRecurrencePresets');
        const recurrencePresets = [
            { label: "Каждые 15 мин", value: 900 },
            { label: "Каждый час", value: 3600 },
            { label: "Каждые 2 ч", value: 7200 },
            { label: "Каждые 6 ч", value: 21600 },
            { label: "Ежедневно", value: 86400 },
            { label: "Еженедельно", value: 604800 },
            { label: "(без повтора)", value: 0 }
        ];
        function createRecurrenceButtons(container) {
            if (!container) return;
            container.innerHTML = '';
            recurrencePresets.forEach(p => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'preset-btn';
                btn.textContent = p.label;
                btn.addEventListener('click', () => {
                    container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    container.dataset.selected = p.value;
                    // Обновляем поле ввода
                    const input = container.previousElementSibling?.querySelector('input[type="number"]');
                    if (input) input.value = p.value;
                });
                container.appendChild(btn);
            });
            // По умолчанию активна последняя ("без повтора")
            const defaultBtn = container.lastElementChild;
            if (defaultBtn) {
                defaultBtn.classList.add('active');
                container.dataset.selected = '0';
            }
        }
        createRecurrenceButtons(recurrencePresetsContainer);
        createRecurrenceButtons(editRecurrencePresetsContainer);
    }

    // Вызываем после загрузки модалок
    setupPresetButtons();
}

export async function suggestTags(title, note) {
    try {
        const res = await fetch('/suggest-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, note })
        });
        const data = await res.json();
        return data.suggested_tags || [];
    } catch (err) {
        console.warn('Не удалось получить подсказки тегов:', err);
        return [];
    }
}