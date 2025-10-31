export async function setupNotifyHandlers() {
    const modal = document.getElementById('notifyModal');
    const tokenInput = document.getElementById('notifyBotToken');
    const chatInput = document.getElementById('notifyChatId');
    const testBtn = document.getElementById('testNotifyBtn');
    const statusEl = document.getElementById('notifyStatus');

    document.getElementById('openNotifyModalBtn')?.addEventListener('click', async () => {
        modal.style.display = 'block';
        statusEl.textContent = '';

        // Загружаем текущие настройки (из памяти Flask)
        const res = await fetch('/notify/config');
        const config = await res.json();
        tokenInput.value = config.bot_token || '';
        chatInput.value = config.chat_id || '';
    });

    testBtn?.addEventListener('click', async () => {
        const botToken = tokenInput.value.trim();
        const chatId = chatInput.value.trim();

        if (!botToken || !chatId) {
            statusEl.textContent = "Заполните оба поля";
            statusEl.style.color = '#ff8a8a';
            return;
        }

        // Сохраняем конфигурацию во Flask (временно)
        const saveRes = await fetch('/notify/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_token: botToken, chat_id: chatId })
        });

        if (!saveRes.ok) {
            const err = await saveRes.json();
            statusEl.textContent = `Ошибка сохранения: ${err.error}`;
            return;
        }

        // Отправляем тест
        const testRes = await fetch('/notify/test', { method: 'POST' });
        const data = await testRes.json();
        if (testRes.ok) {
            statusEl.textContent = `✅ ${data.message}`;
            statusEl.style.color = '#8aff8a';
        } else {
            statusEl.textContent = `❌ ${data.error}`;
            statusEl.style.color = '#ff8a8a';
        }
    });
}