// DateTimePicker.js
export class DateTimePicker {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Контейнер не найден: ${containerId}`);

        // Поле даты
        this.dateInput = document.createElement('input');
        this.dateInput.type = 'date';
        this.dateInput.style.width = '120px';
        this.dateInput.style.marginRight = '8px';

        // === ЧАСЫ ===
        const hourContainer = document.createElement('div');
        hourContainer.style.position = 'relative';
        hourContainer.style.display = 'inline-block';
        hourContainer.style.width = '50px';
        hourContainer.style.marginRight = '4px';

        this.hourInput = document.createElement('input');
        this.hourInput.type = 'text';
        this.hourInput.inputMode = 'numeric';
        this.hourInput.maxLength = 2;
        this.hourInput.style.width = '100%';
        this.hourInput.style.textAlign = 'center';
        this.hourInput.className = 'datetime-input';

        hourContainer.appendChild(this.hourInput);

        // === МИНУТЫ: ТЕКСТОВОЕ ПОЛЕ (БЕЗ СТРЕЛОК) ===
        this.minuteInput = document.createElement('input');
        this.minuteInput.type = 'text';
        this.minuteInput.inputMode = 'numeric';
        this.minuteInput.maxLength = 2;
        this.minuteInput.style.width = '50px';
        this.minuteInput.style.textAlign = 'center';
        this.minuteInput.className = 'datetime-input';

        // Обработчики часов
        this.hourInput.addEventListener('input', (e) => this._handleHourInput(e));
        this.hourInput.addEventListener('click', () => this.hourInput.select());
        this.hourInput.addEventListener('focus', () => this.hourInput.select());

        // Обработчики минут
        this.minuteInput.addEventListener('input', (e) => this._handleMinuteInput(e));
        this.minuteInput.addEventListener('click', () => this.minuteInput.select());
        this.minuteInput.addEventListener('focus', () => this.minuteInput.select());

        // Колёсико
        this.hourInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            this._adjustHour(e.deltaY < 0 ? 1 : -1);
        });
        this.minuteInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            this._adjustMinute(e.deltaY < 0 ? 5 : -5);
        });

        // Сборка
        this.container.replaceChildren(
            this.dateInput,
            document.createTextNode(' '),
            hourContainer,
            document.createTextNode(':'),
            this.minuteInput
        );

        // Инициализация
        if (options.defaultValue) {
            this.setValue(options.defaultValue);
        } else {
            const now = new Date();
            const roundedMin = Math.ceil(now.getMinutes() / 5) * 5;
            this.setValue(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMin));
        }
    }

    _adjustHour(delta) {
        let current = parseInt(this.hourInput.value, 10) || 0;
        if (isNaN(current)) current = 0;
        current = (current + delta + 24) % 24;
        this.hourInput.value = String(current).padStart(2, '0');
    }

    _adjustMinute(delta) {
        let current = parseInt(this.minuteInput.value, 10) || 0;
        if (isNaN(current)) current = 0;
        current += delta;
        if (current < 0) current = 0;
        if (current > 59) current = 59;
        this.minuteInput.value = String(current).padStart(2, '0');
    }

    _handleHourInput(e) {
        let val = e.target.value.replace(/\D/g, '');

        if (val.length > 2) {
            const hourPart = val.substring(0, 2);
            const extraDigit = val.substring(2, 3);

            let hour = parseInt(hourPart, 10);
            if (isNaN(hour)) hour = 0;
            if (hour > 23) hour = 23;
            this.hourInput.value = String(hour).padStart(2, '0');

            this.minuteInput.value = extraDigit;
            this.minuteInput.focus();
            this.minuteInput.select();
        } else if (val.length === 2) {
            let hour = parseInt(val, 10);
            if (hour > 23) hour = 23;
            this.hourInput.value = String(hour).padStart(2, '0');
        } else {
            this.hourInput.value = val;
        }
    }

    _handleMinuteInput(e) {
        let val = e.target.value.replace(/\D/g, '');

        if (val.length > 2) {
            val = val.substring(0, 2);
        }

        if (val.length === 2) {
            let minute = parseInt(val, 10);
            if (isNaN(minute)) minute = 0;
            if (minute > 59) minute = 59;
            this.minuteInput.value = String(minute).padStart(2, '0');
        } else {
            this.minuteInput.value = val;
        }
    }

    setValue(isoStringOrDate) {
        const dt = isoStringOrDate instanceof Date ? isoStringOrDate : new Date(isoStringOrDate);
        if (isNaN(dt.getTime())) return;

        // Получаем локальную дату (без сдвига UTC!)
        const year = dt.getFullYear();
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        this.dateInput.value = `${year}-${month}-${day}`;

        this.hourInput.value = String(dt.getHours()).padStart(2, '0');
        this.minuteInput.value = String(dt.getMinutes()).padStart(2, '0');
    }

    getValue() {
        const datePart = this.dateInput.value;
        const hourRaw = this.hourInput.value.trim();
        const minuteRaw = this.minuteInput.value.trim();

        if (!datePart || hourRaw === '' || minuteRaw === '') {
            return null;
        }

        const hour = parseInt(hourRaw, 10);
        const minute = parseInt(minuteRaw, 10);

        if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return null;
        }

        const localIso = `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        const localDate = new Date(localIso);
        return isNaN(localDate.getTime()) ? null : localDate.toISOString();
    }
}