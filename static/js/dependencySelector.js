// dependencySelector.js
export class DependencySelector {
    constructor(containerId, buttonId, hiddenInputId) {
    this.container = document.getElementById(containerId);
    this.button = document.getElementById(buttonId);
    this.hiddenInput = document.getElementById(hiddenInputId);
    this.selectedUuids = [];

    // Привязываем обработчик к контейнеру
    this.container.addEventListener('click', (e) => {
        // Если кликнули НЕ по кнопке — игнорируем
        if (!e.target.classList.contains('close-dependency')) {
            return;
        }

        // Теперь проверяем, что клик был именно по кнопке, а не по её фону
        // e.target — это кнопка, e.currentTarget — это контейнер
        const btn = e.target;
        const tagEl = btn.closest('.dependency-tag');
        const uuid = tagEl?.dataset.uuid;

        if (uuid) {
            e.preventDefault();
            e.stopPropagation();
            this.remove(uuid);
        }
    });

    this.button?.addEventListener('click', () => {
        import('./taskSearch.js').then(({ openTaskSearch }) => {
            openTaskSearch('select', (task) => {
                if (!this.selectedUuids.includes(task.uuid)) {
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
        return [...this.selectedUuids];
    }

    render() {
        this.container.innerHTML = this.selectedUuids.map(uuid => {
            const task = window.allCachedTasks?.find(t => t.uuid === uuid);
            const title = task?.title || `#${uuid.substring(0, 8)}`;
            return `
                <div class="dependency-tag" data-uuid="${uuid}">
                    <span class="dependency-title">${title}</span>
                    <button type="button" class="close-dependency" title="Удалить зависимость">&times;</button>
                </div>
            `;
        }).join('');

        // Обновляем скрытое поле
        this.hiddenInput.value = this.selectedUuids.join(',');
    }
}