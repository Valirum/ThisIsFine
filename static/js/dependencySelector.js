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
        return `
            <div class="dependency-tag" style="
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                background: var(--bg-header);
                padding: 0.2rem 0.4rem;
                border-radius: 4px;
                border: 1px solid var(--border-accent);
                margin: 0.1rem 0.3rem 0.1rem 0;
            ">
                <span class="dependency-title" style="
                    font-size: 0.85em;
                    color: var(--text-main);
                    max-width: 120px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                ">${title}</span>
                <button type="button" class="close-dependency"
                        data-uuid="${uuid}"
                        title="Удалить зависимость"
                        style="
                            background: none;
                            border: none;
                            color: var(--danger);
                            font-size: 1em;
                            cursor: pointer;
                            padding: 0;
                            line-height: 1;
                            width: 16px;
                            height: 16px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 50%;
                            flex-shrink: 0;
                        ">&times;</button>
            </div>
        `;
    }).join('');

    // Привязываем обработчики только к крестикам
    this.container.querySelectorAll('.close-dependency').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // на всякий случай
            const uuid = btn.dataset.uuid;
            this.remove(uuid);
        });
    });

    // Обновляем скрытое поле
    this.hiddenInput.value = this.selectedUuids.join(',');
}
}