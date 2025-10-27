// modalManager.js
import { DateTimePicker } from './DateTimePicker.js';

let addTaskPickerInstance;
let editTaskPickerInstance;

export async function loadModals() {
    const templates = [
        '/static/modals/day-modal.html',
        '/static/modals/task-modal.html',
        '/static/modals/add-task-modal.html'
    ];

    const responses = await Promise.all(templates.map(url => fetch(url)));
    const htmls = await Promise.all(responses.map(res => res.text()));

    const modalsContainer = document.createElement('div');
    modalsContainer.id = 'modals-root';
    modalsContainer.innerHTML = htmls.join('');
    document.body.appendChild(modalsContainer);

    // Инициализация виджетов ПОСЛЕ вставки HTML
    addTaskPickerInstance = new DateTimePicker('addTaskDatetimePicker');
    editTaskPickerInstance = new DateTimePicker('editTaskDatetimePicker');

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