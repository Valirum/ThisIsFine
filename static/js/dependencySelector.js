// dependencySelector.js

export class DependencySelector {
    constructor(containerId, buttonId, hiddenInputId) {
        this.container = document.getElementById(containerId);
        this.button = document.getElementById(buttonId);
        this.hiddenInput = document.getElementById(hiddenInputId);
        this.selectedUuids = []; // ← теперь UUID

        this.button?.addEventListener('click', () => {
            import('./taskSearch.js').then(({ openTaskSearch }) => {
                openTaskSearch('select', (task) => {
                    if (!this.selectedUuids.includes(task.uuid)) { // ← uuid
                        this.selectedUuids.push(task.uuid);
                        this.render();
                    }
                });
            });
        });

        this.render();
    }

    remove(uuid) {
        this.selectedUuids = this.selectedUuids.filter(u => u !== uuid);
        this.render();
    }

    getDependencies() {
        return [...this.selectedUuids]; // копия UUID-ов
    }

    render() {
    this.container.innerHTML = this.selectedUuids.map(uuid => {
        const task = window.allCachedTasks?.find(t => t.uuid === uuid);
        const title = task?.title || `#${uuid.substring(0, 8)}`;
        return `<div class="dependency-tag">`;
    }).join('');

    // Привязываем обработчики только к крестикам
    this.container.querySelectorAll('.close-dependency').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // на всякий случай
            e.preventDefault();
            const uuid = btn.dataset.uuid;
            this.remove(uuid);
        });
    });

    // Обновляем скрытое поле
    this.hiddenInput.value = this.selectedUuids.join(',');
}
}