/* ==========================================================
   Calamansi Care — soil monitor
   Sequence: boot screen -> "Sensors initializing" -> readings
   ========================================================== */

// One source of truth. The gauges, the hint labels, the status
// pills and the advice all read from here, so a threshold only
// ever needs changing in one place.
const SENSORS = {
    ph: {
        label: 'Soil pH',
        unit: 'pH',
        decimals: 1,
        scale: [4.0, 8.0],      // gauge range
        ideal: [5.5, 6.5],      // healthy band for calamansi
        simulate: [5.0, 7.2],   // stand-in for the real probe
        low: {
            level: 'warning',
            pill: 'Too acidic',
            title: 'Sweeten the soil',
            body: 'pH is below 5.5. Work agricultural lime into the topsoil a little at a time, then re-test after two weeks — overshooting is harder to undo than undershooting.'
        },
        high: {
            level: 'warning',
            pill: 'Too alkaline',
            title: 'Bring the pH down',
            body: 'pH is above 6.5. Mix in compost or well-rotted manure around the root zone; elemental sulfur works faster if the reading stays high.'
        }
    },
    moisture: {
        label: 'Soil moisture',
        unit: '%',
        decimals: 0,
        scale: [0, 100],
        ideal: [50, 70],
        simulate: [30, 80],
        low: {
            level: 'critical',
            pill: 'Too dry',
            title: 'Water now',
            body: 'Moisture is below 50%. Water slowly at the base until the top 15 cm feels damp, then mulch to slow evaporation.'
        },
        high: {
            level: 'warning',
            pill: 'Too wet',
            title: 'Let it drain',
            body: 'Moisture is above 70%. Hold off watering and check that the pot or bed drains freely — calamansi roots rot in standing water.'
        }
    }
};

const LEVEL_ICON = {
    optimal: 'check-circle-2',
    warning: 'alert-triangle',
    critical: 'alert-circle'
};

const PILL_CLASS = {
    optimal: 'sensor-status status-optimal',
    warning: 'sensor-status status-warning',
    critical: 'sensor-status status-critical'
};

const INIT_STEPS = [
    'Connecting to the soil probe',
    'Calibrating the pH electrode',
    'Reading soil moisture'
];

let previous = {};   // last reading, for the change indicator
let scanning = false;

document.addEventListener('DOMContentLoaded', () => {
    const el = {
        overlay: document.getElementById('loading-overlay'),
        bootFill: document.getElementById('boot-fill'),
        init: document.getElementById('initializing-screen'),
        initStep: document.getElementById('init-step'),
        grid: document.getElementById('dashboard-grid'),
        rescan: document.getElementById('rescan-btn'),
        status: document.getElementById('system-status'),
        statusText: document.getElementById('header-status'),
        time: document.getElementById('reading-time'),
        advisory: document.getElementById('advisory-list')
    };

    lucide.createIcons();
    drawScales();

    // STEP 1 — boot screen, with the progress bar actually moving.
    let progress = 0;
    const bootTimer = setInterval(() => {
        progress = Math.min(progress + 25, 100);
        el.bootFill.style.width = progress + '%';
    }, 400);

    setTimeout(() => {
        clearInterval(bootTimer);
        el.bootFill.style.width = '100%';
        el.overlay.style.opacity = '0';
        el.overlay.style.visibility = 'hidden';
        runScan(el);                         // STEP 2 + 3
    }, 1900);

    el.rescan.addEventListener('click', () => runScan(el));
});

/* --- STEP 2 & 3 --------------------------------------------------- */

function runScan(el) {
    if (scanning) return;
    scanning = true;

    el.rescan.disabled = true;
    el.grid.classList.add('hidden');
    el.init.classList.remove('hidden');
    el.init.setAttribute('aria-busy', 'true');
    setSystemStatus(el, 'busy', 'Scanning');

    // Walk the initializing messages so the wait reports progress
    // instead of just spinning.
    let step = 0;
    el.initStep.textContent = INIT_STEPS[0];
    const stepTimer = setInterval(() => {
        step += 1;
        if (step < INIT_STEPS.length) el.initStep.textContent = INIT_STEPS[step];
    }, 800);

    setTimeout(() => {
        clearInterval(stepTimer);

        const reading = {
            ph: readSensor('ph'),
            moisture: readSensor('moisture')
        };

        const results = {};
        for (const key of Object.keys(SENSORS)) {
            results[key] = render(key, reading[key]);
        }

        renderAdvisory(el.advisory, results);
        el.time.textContent = 'Read at ' + formatTime(new Date());

        previous = reading;

        el.init.classList.add('hidden');
        el.init.setAttribute('aria-busy', 'false');
        el.grid.classList.remove('hidden');

        const worst = worstLevel(results);
        setSystemStatus(
            el,
            worst === 'optimal' ? 'ok' : 'busy',
            worst === 'optimal' ? 'All readings normal' : 'Needs attention'
        );

        lucide.createIcons();
        el.rescan.disabled = false;
        scanning = false;
    }, 2400);
}

/* --- Reading & classification ------------------------------------- */

function readSensor(key) {
    const [min, max] = SENSORS[key].simulate;
    const raw = Math.random() * (max - min) + min;
    return Number(raw.toFixed(SENSORS[key].decimals));
}

function classify(key, value) {
    const s = SENSORS[key];
    if (value < s.ideal[0]) return { level: s.low.level, advice: s.low };
    if (value > s.ideal[1]) return { level: s.high.level, advice: s.high };
    return { level: 'optimal', advice: null };
}

/* --- Rendering ---------------------------------------------------- */

function render(key, value) {
    const s = SENSORS[key];
    const result = classify(key, value);

    document.getElementById(key + '-value').textContent = value.toFixed(s.decimals);

    // Status pill
    const pill = document.getElementById(key + '-status-pill');
    pill.className = PILL_CLASS[result.level];
    pill.innerHTML =
        `<i data-lucide="${LEVEL_ICON[result.level]}"></i>` +
        (result.level === 'optimal' ? 'Healthy' : result.advice.pill);

    // Gauge marker
    const marker = document.getElementById(key + '-marker');
    marker.style.left = percentOf(key, value) + '%';
    marker.dataset.level = result.level;

    // Change since the last scan
    const delta = document.getElementById(key + '-delta');
    if (typeof previous[key] === 'number') {
        const diff = value - previous[key];
        if (Math.abs(diff) < Math.pow(10, -s.decimals) / 2) {
            delta.textContent = 'No change since last scan';
        } else {
            const arrow = diff > 0 ? '▲' : '▼';
            delta.textContent =
                `${arrow} ${Math.abs(diff).toFixed(s.decimals)}${s.unit === '%' ? '%' : ''} since last scan`;
        }
    } else {
        delta.textContent = 'First reading';
    }

    return result;
}

function renderAdvisory(list, results) {
    const items = [];

    for (const key of Object.keys(results)) {
        const { level, advice } = results[key];
        if (advice) items.push({ level, title: advice.title, body: advice.body });
    }

    if (items.length === 0) {
        items.push({
            level: 'optimal',
            title: 'Nothing to do today',
            body: 'pH and moisture are both inside the healthy band for calamansi. Keep to your current watering routine and scan again in a few days.'
        });
    }

    list.innerHTML = items.map(item => `
        <li class="advisory-item" data-level="${item.level}">
            <span class="advisory-icon"><i data-lucide="${LEVEL_ICON[item.level]}"></i></span>
            <div>
                <p class="advisory-title">${item.title}</p>
                <p class="advisory-body">${item.body}</p>
            </div>
        </li>
    `).join('');
}

function drawScales() {
    for (const key of Object.keys(SENSORS)) {
        const s = SENSORS[key];
        const suffix = s.unit === '%' ? '%' : '';

        const band = document.getElementById(key + '-ideal');
        const start = percentOf(key, s.ideal[0]);
        band.style.left = start + '%';
        band.style.width = (percentOf(key, s.ideal[1]) - start) + '%';

        document.getElementById(key + '-scale-min').textContent =
            s.scale[0].toFixed(s.decimals) + suffix;
        document.getElementById(key + '-scale-max').textContent =
            s.scale[1].toFixed(s.decimals) + suffix;
        document.getElementById(key + '-scale-ideal').textContent =
            `healthy ${s.ideal[0].toFixed(s.decimals)}–${s.ideal[1].toFixed(s.decimals)}${suffix}`;
    }
}

/* --- Helpers ------------------------------------------------------ */

function percentOf(key, value) {
    const [min, max] = SENSORS[key].scale;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function worstLevel(results) {
    const order = ['optimal', 'warning', 'critical'];
    return Object.values(results).reduce(
        (worst, r) => (order.indexOf(r.level) > order.indexOf(worst) ? r.level : worst),
        'optimal'
    );
}

function setSystemStatus(el, state, text) {
    el.status.dataset.state = state;
    el.statusText.textContent = text;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}