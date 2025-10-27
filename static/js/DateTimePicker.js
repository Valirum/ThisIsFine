// DateTimePicker.js
import { PRIORITY_COLORS } from './utils.js';

export class DateTimePicker {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Контейнер не найден: ${containerId}`);

        this.dateInput = document.createElement('input');
        this.dateInput.type = 'date';
        this.dateInput.style.width = '120px';
        this.dateInput.style.marginRight = '8px';

        this.hourSelect = document.createElement('select');
        this.hourSelect.style.width = '60px';
        this.hourSelect.style.marginRight = '4px';

        this.minuteSelect = document.createElement('select');
        this.minuteSelect.style.width = '60px';

        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('option');
            opt.value = String(h).padStart(2, '0');
            opt.textContent = String(h).padStart(2, '0');
            this.hourSelect.appendChild(opt);
        }

        [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach(m => {
            const opt = document.createElement('option');
            opt.value = String(m).padStart(2, '0');
            opt.textContent = String(m).padStart(2, '0');
            this.minuteSelect.appendChild(opt);
        });

        this.container.replaceChildren(
            this.dateInput,
            document.createTextNode(' '),
            this.hourSelect,
            document.createTextNode(':'),
            this.minuteSelect
        );

        if (options.defaultValue) {
            this.setValue(options.defaultValue);
        } else {
            const now = new Date();
            const roundedMin = Math.ceil(now.getMinutes() / 5) * 5;
            this.setValue(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMin));
        }
    }

    setValue(isoStringOrDate) {
        const dt = isoStringOrDate instanceof Date ? isoStringOrDate : new Date(isoStringOrDate);
        if (isNaN(dt.getTime())) return;

        this.dateInput.value = dt.toISOString().split('T')[0];
        this.hourSelect.value = String(dt.getHours()).padStart(2, '0');
        this.minuteSelect.value = String(Math.floor(dt.getMinutes() / 5) * 5).padStart(2, '0');
    }

    getValue() {
        const datePart = this.dateInput.value;
        const hour = this.hourSelect.value;
        const minute = this.minuteSelect.value;
        return datePart ? `${datePart}T${hour}:${minute}:00Z` : null;
    }
}