// themeManager.js

export async function setupThemeManager() {
    const select = document.getElementById('themeSelect');
    if (!select) return;

    try {
        // Загружаем список тем с бэкенда
        const res = await fetch('/themes');
        const themes = await res.json();

        // Очищаем и добавляем опции
        select.innerHTML = '<option value="">По умолчанию</option>';
        themes.forEach(theme => {
            const opt = document.createElement('option');
            opt.value = theme.name;
            opt.textContent = theme.label;
            select.appendChild(opt);
        });
    } catch (err) {
        console.warn('Не удалось загрузить список тем:', err);
    }

    // Загружаем сохранённую тему
    const savedTheme = localStorage.getItem('themeName');
    if (savedTheme) {
        select.value = savedTheme;
        loadTheme(savedTheme);
    }

    // Обработчик изменения
    select.addEventListener('change', (e) => {
        const themeName = e.target.value;
        if (themeName) {
            loadTheme(themeName);
            localStorage.setItem('themeName', themeName);
        } else {
            unloadTheme();
            localStorage.removeItem('themeName');
        }
    });
}

function loadTheme(themeName) {
    unloadTheme();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/static/themes/theme-${themeName}.css`;
    link.id = 'theme-stylesheet';
    document.head.appendChild(link);
}

function unloadTheme() {
    const el = document.getElementById('theme-stylesheet');
    if (el) el.remove();
}