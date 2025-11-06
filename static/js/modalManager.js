// modalManager.js
import { DateTimePicker } from './DateTimePicker.js';
import { initTaskSearch } from './taskSearch.js';
import { DependencySelector } from './dependencySelector.js';

let addTaskPickerInstance;
let addTaskPlannedPickerInstance;
let addTaskGraceEndPickerInstance;
let editTaskPickerInstance;
let editTaskPlannedPickerInstance;
let editTaskGraceEndPickerInstance;
let addDepsSelector;
let editDepsSelector;

export async function loadModals() {
    const templates = [
        '/static/modals/day-modal.html',
        '/static/modals/task-modal.html',
        '/static/modals/add-task-modal.html',
        '/static/modals/view-task-modal.html',
        '/static/modals/status-story-modal.html',
        '/static/modals/sync-modal.html',
        '/static/modals/notify-modal.html',
        '/static/modals/settings-modal.html',
        '/static/modals/task-search-modal.html'
    ];

    const responses = await Promise.all(templates.map(url => fetch(url)));
    const htmls = await Promise.all(responses.map(res => res.text()));

    const modalsContainer = document.createElement('div');
    modalsContainer.id = 'modals-root';
    modalsContainer.innerHTML = htmls.join('');
    document.body.appendChild(modalsContainer);

    // Для модалки создания
    addTaskPlannedPickerInstance = new DateTimePicker('addPlannedAtDatetimePicker');
    addTaskPickerInstance = new DateTimePicker('addTaskDatetimePicker');
    addTaskGraceEndPickerInstance = new DateTimePicker('addGraceEndDatetimePicker');

      // Для модалки редактирования
    editTaskPlannedPickerInstance = new DateTimePicker('editPlannedAtDatetimePicker');
    editTaskPickerInstance = new DateTimePicker('editTaskDatetimePicker');
    editTaskGraceEndPickerInstance = new DateTimePicker('editGraceEndDatetimePicker');

    initTaskSearch();

    addDepsSelector = new DependencySelector(
        'selectedDependenciesContainer',
        'openSearchForDeps',
        'newTaskDependencies' // ← оставляем скрытое поле для совместимости или валидации
    );

    editDepsSelector = new DependencySelector(
        'editSelectedDependenciesContainer',
        'openSearchForEditDeps',
        'taskDependencies'
    );

    setupModalHandlers();
    setupGlobalModalHandlers();

    return { addTaskPicker: addTaskPickerInstance, editTaskPicker: editTaskPickerInstance };
}


function setupModalHandlers() {
    document.querySelectorAll('.close').forEach(el => {
        el.addEventListener('click', () => {
            const modalId = el.getAttribute('data-modal');
            closeModal(modalId);
        });
    });
}

function setupGlobalModalHandlers() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Экспортируем ГЕТТЕРЫ для доступа извне
export function getAddTaskPicker() {
    return addTaskPickerInstance;
}

export function getEditTaskPicker() {
    return editTaskPickerInstance;
}

export function getAddPlannedTaskPicker() {
    return addTaskPlannedPickerInstance;
}

export function getEditPlannedTaskPicker() {
    return editTaskPlannedPickerInstance;
}

export function getAddGraceEndPlannedTaskPicker() {
    return addTaskGraceEndPickerInstance;
}

export function getEditGraceEndPlannedTaskPicker() {
    return editTaskGraceEndPickerInstance;
}

export function getAddDepsSelector() {
    return addDepsSelector;
}

export function getEditDepsSelector() {
    return editDepsSelector;
}

