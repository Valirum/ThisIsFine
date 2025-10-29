// syncManager.js

export async function loadPeers() {
    const res = await fetch('/sync/peers');
    const peers = await res.json();
    const listEl = document.getElementById('peersList');
    if (peers.length === 0) {
        listEl.innerHTML = '<em>Нет сохранённых устройств</em>';
        return;
    }
    listEl.innerHTML = peers.map(p => `
        <div class="peer-item" style="margin: 0.6rem 0; padding: 0.5rem; background: var(--bg-panel); border-radius: 4px;">
            <strong>${p.name}</strong> (${p.address})
            <div style="margin-top: 0.3rem;">
                <button class="btn btn--small sync-peer-btn" data-address="${p.address}">🔄 Синхронизировать</button>
                <button class="btn btn--small" style="background: #3a1f1f;" data-delete="${p.id}">🗑️</button>
            </div>
        </div>
    `).join('');
}

export function setupSyncHandlers() {
    // Открытие модалки
    document.getElementById('openSyncModalBtn')?.addEventListener('click', async () => {
        document.getElementById('syncModal').style.display = 'block';
        await loadPeers();
    });

    // Добавление узла
    document.getElementById('addPeerBtn')?.addEventListener('click', async () => {
        const addr = document.getElementById('syncPeerAddress')?.value.trim();
        const statusEl = document.getElementById('syncAddStatus');
        if (!addr || !addr.includes(':')) {
            statusEl.textContent = 'Укажите адрес в формате IP:порт';
            return;
        }
        try {
            const res = await fetch('/sync/peers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: addr })
            });
            if (res.ok) {
                statusEl.textContent = 'Устройство добавлено!';
                statusEl.style.color = '#8aff8a';
                document.getElementById('syncPeerAddress').value = '';
                await loadPeers();
            } else {
                const err = await res.json();
                statusEl.textContent = `Ошибка: ${err.error}`;
            }
        } catch (e) {
            statusEl.textContent = `Сбой: ${e.message}`;
        }
    });

    // Делегирование: синхронизация и удаление
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('sync-peer-btn')) {
            const addr = e.target.dataset.address;
            const statusEl = document.getElementById('syncStatus');
            try {
                statusEl.textContent = 'Синхронизация...';
                const res = await fetch(`/sync/peers/${encodeURIComponent(addr)}/sync`, { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    statusEl.textContent = `✅ Успешно: получено ${data.tasks_received} задач`;
                } else {
                    const err = await res.json();
                    statusEl.textContent = `❌ Ошибка: ${err.error || 'неизвестно'}`;
                }
            } catch (err) {
                statusEl.textContent = `💥 Сбой сети: ${err.message}`;
            }
        }

        if (e.target.dataset.delete) {
            if (!confirm('Удалить устройство из списка?')) return;
            const id = e.target.dataset.delete;
            await fetch(`/sync/peers/${id}`, { method: 'DELETE' });
            await loadPeers();
        }
    });
}