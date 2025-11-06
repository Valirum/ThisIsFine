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
            const task = window.allCachedTasks?.find(t => t.uuid === uuid); // ← сравнение по uuid
            return `
                <span class="tag-item" style="background:var(--bg-header); display:inline-flex; align-items:center; gap:0.3rem;">
                    ${task?.title || `#${uuid.substring(0, 8)}`}
                    <span class="close" style="font-size:1em; padding:0;" data-uuid="${uuid}">×</span>
                </span>
            `;
        }).join('');

        this.container.querySelectorAll('.close').forEach(el => {
            el.addEventListener('click', () => {
                const uuid = el.dataset.uuid; // ← uuid из data
                this.remove(uuid);
            });
        });

        // Обновляем скрытое поле (как CSV из UUID)
        this.hiddenInput.value = this.selectedUuids.join(',');
    }
}