// taskSearch.js
let searchMode = 'view'; // или 'select'
let onTaskSelected = null;

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function initTaskSearch() {
    const input = document.getElementById('taskSearchQuery');
    const statusEl = document.getElementById('taskSearchStatus');
    const resultsEl = document.getElementById('taskSearchResults');

    if (!input || !statusEl || !resultsEl) {
        console.warn('Элементы поиска не найдены в DOM');
        return;
    }

    input.addEventListener('input', debounce(async (e) => {
        const q = e.target.value.trim();
        if (!q) {
            resultsEl.innerHTML = '';
            statusEl.textContent = 'Введите запрос...';
            return;
        }
        try {
            statusEl.textContent = 'Поиск...';
            const data = await performSearch(q);
            console.log('Результаты поиска:', data.results); // ← теперь будет видно
            renderSearchResults(data.results || []);
            statusEl.textContent = `Найдено: ${data.results?.length || 0}`;
        } catch (err) {
            console.error('Ошибка поиска:', err);
            statusEl.textContent = `Ошибка: ${err.message}`;
        }
    }, 300));
}


export function openTaskSearch(mode = 'view', callback = null) {
    searchMode = mode;
    onTaskSelected = callback;
    document.getElementById('taskSearchModal').style.display = 'block';
    document.getElementById('taskSearchQuery').value = '';
    document.getElementById('taskSearchResults').innerHTML = '';
    document.getElementById('taskSearchStatus').textContent = 'Введите запрос...';
    document.getElementById('taskSearchQuery').focus();
}

async function performSearch(query) {
    const url = `/tasks/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Ошибка поиска');
    return await res.json(); // { results: [...] }
}

function renderSearchResults(tasks) {
    const el = document.getElementById('taskSearchResults');
    if (tasks.length === 0) {
        el.innerHTML = '<em>Ничего не найдено</em>';
        return;
    }
    el.innerHTML = tasks.map(t => {
        const tagsHtml = (t.tags || []).map(tag => {
            const tagObj = window.allTags?.find(tg => tg.name === tag) || { color: '#4a4a8a' };
            return `<span class="day-task-tag" style="background-color: ${tagObj.color}">${tag}</span>`;
        }).join('');
        return `
            <div class="day-task-item priority-${t.priority} status-${t.status}" data-task-id="${t.id}">
                <div class="day-task-tags">${tagsHtml}</div>
                <div class="day-task-title"><strong>${t.title}</strong></div>
                <div style="font-size:0.8em; color:var(--text-muted);">${t.note?.substring(0,60) || ''}</div>
            </div>
        `;
    }).join('');

    el.querySelectorAll('.day-task-item').forEach(item => {
        item.addEventListener('click', () => {
            const taskId = Number(item.dataset.taskId);
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;

            if (searchMode === 'select' && onTaskSelected) {
                onTaskSelected(task);
                document.getElementById('taskSearchModal').style.display = 'none';
            } else {
                window.dispatchEvent(new CustomEvent('task-clicked', { detail: { task } }));
                document.getElementById('taskSearchModal').style.display = 'none';
            }
        });
    });
}

document.getElementById('taskSearchQuery')?.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const statusEl = document.getElementById('taskSearchStatus');
    if (!q) {
        document.getElementById('taskSearchResults').innerHTML = '';
        statusEl.textContent = 'Введите запрос...';
        return;
    }
    try {
        statusEl.textContent = 'Поиск...';
        const data = await performSearch(q);
        console.log(data.results)
        renderSearchResults(data.results || []);
        statusEl.textContent = `Найдено: ${data.results?.length || 0}`;
    } catch (err) {
        console.error(err.message)
        statusEl.textContent = `Ошибка: ${err.message}`;
    }
}, 300));

// Утилита debounce переиспользуется из main.js