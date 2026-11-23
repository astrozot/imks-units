// Scroll-snap date/time wheels, using astronomical years (including zero).
const ROW = 32;
const pad = n => String(n).padStart(2, '0');
const yearText = n => `${n < 0 ? '−' : ''}${String(Math.abs(n)).padStart(4, '0')}`;
const daysInMonth = (year, month) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
export function mountSkyDateWheels(root, { apply, close }) {
  root.innerHTML = `<div class="coelum-wheel-head"><h3 class="coelum-wheel-title">Date and time</h3><button type="button" class="coelum-btn coelum-wheel-action" data-wheel-close aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="coelum-wheel-tabs" role="group" aria-label="Edit date or time"><button type="button" data-wheel-tab="date" aria-pressed="true">Date</button><button type="button" data-wheel-tab="time" aria-pressed="false">Time</button></div><div class="coelum-wheel-grid" data-wheel-group="date"></div><div class="coelum-wheel-grid" data-wheel-group="time" hidden></div><p class="coelum-wheel-note">Signed years: 0 = 1 BCE, −1 = 2 BCE.</p><p class="coelum-wheel-error" role="status" hidden></p>`;
  let draft = {}, group = 'date';
  const columns = new Map();
  const error = root.querySelector('.coelum-wheel-error');
  const fields = [['year', 'Year', -1000, 3000], ['month', 'Month', 1, 12], ['day', 'Day', 1, 31], ['hour', 'Hour', 0, 23], ['minute', 'Minute', 0, 59], ['second', 'Second', 0, 59]];
  const format = (name, value) => name === 'year' ? yearText(value) : pad(value);
  const mark = column => {
    column.el.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    const selected = column.el.children[draft[column.name] - column.min];
    selected?.setAttribute('aria-selected', 'true');
    if (selected) column.el.setAttribute('aria-activedescendant', selected.id);
  };
  // Only style the rows near the viewport, even for the long year column.
  const curve = column => {
    for (const option of column.curved || []) option.style.transform = '';
    column.curved = [];
    const center = column.el.scrollTop / ROW;
    for (let i = Math.max(0, Math.floor(center) - 4); i <= Math.min(column.el.children.length - 1, Math.ceil(center) + 4); i++) {
      const option = column.el.children[i], distance = i - center;
      option.style.transform = `perspective(240px) rotateX(${-distance * 18}deg) scale(${1 - Math.min(Math.abs(distance), 4) * .045})`;
      column.curved.push(option);
    }
  };
  const commit = () => {
    const { year, month, day, hour, minute, second } = draft;
    const message = apply(`${yearText(year).replace('−', '-')}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`);
    error.textContent = message || '';
    error.hidden = !message;
  };
  const position = column => { column.el.scrollTop = (draft[column.name] - column.min) * ROW; mark(column); curve(column); };
  const fill = column => {
    column.el.innerHTML = Array.from({ length: column.max - column.min + 1 }, (_, i) => {
      const value = i + column.min;
      return `<div role="option" id="${root.id}-${column.name}-${i}" aria-selected="false" data-wheel-value="${value}">${format(column.name, value)}</div>`;
    }).join('');
  };
  const select = (column, value, scroll = true) => {
    value = Math.max(column.min, Math.min(column.max, value));
    const changed = draft[column.name] !== value;
    draft[column.name] = value;
    mark(column);
    if (scroll) position(column);
    if (column.name === 'year' || column.name === 'month') {
      const day = columns.get('day'), max = daysInMonth(draft.year, draft.month);
      if (day.max !== max) {
        day.max = max; draft.day = Math.min(draft.day, max);
        fill(day); position(day);
      }
    }
    if (changed) commit();
  };
  const visibleColumns = () => [...columns.values()].filter(column => column.group === group);
  const flush = () => {
    for (const column of visibleColumns()) select(column, column.min + Math.round(column.el.scrollTop / ROW));
  };
  const setGroup = name => {
    group = name;
    for (const grid of root.querySelectorAll('[data-wheel-group]')) grid.hidden = grid.dataset.wheelGroup !== name;
    for (const tab of root.querySelectorAll('[data-wheel-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.wheelTab === name));
    for (const column of visibleColumns()) position(column);
  };
  for (const [index, [name, label, min, max]] of fields.entries()) {
    const section = document.createElement('div');
    section.className = 'coelum-wheel-column';
    section.innerHTML = `<span class="coelum-wheel-label" id="${root.id}-${name}-label">${label}</span><div class="coelum-wheel-track"><div class="coelum-wheel" role="listbox" tabindex="0" aria-labelledby="${root.id}-${name}-label" data-date-wheel="${name}"></div></div>`;
    const column = { name, min, max, group: index < 3 ? 'date' : 'time', el: section.querySelector('.coelum-wheel') };
    columns.set(name, column);
    root.querySelector(`[data-wheel-group="${column.group}"]`).append(section);
    fill(column);
    column.el.addEventListener('scroll', () => {
      if (!root.hidden && column.group === group) {
        curve(column);
        select(column, column.min + Math.round(column.el.scrollTop / ROW), false);
      }
    }, { passive: true });
    column.el.addEventListener('click', event => {
      if (dragged) { dragged = false; return; }
      const option = event.target.closest('[data-wheel-value]');
      if (option) select(column, Number(option.dataset.wheelValue));
    });
    column.el.addEventListener('keydown', event => {
      const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
      if (event.key in steps || ['Home', 'End'].includes(event.key)) {
        event.preventDefault();
        select(column, event.key === 'Home' ? column.min : event.key === 'End' ? column.max : draft[name] + steps[event.key]);
      }
    });
    // Keep native touch momentum on the rows; headings also support dragging.
    const labelEl = section.querySelector('.coelum-wheel-label');
    labelEl.addEventListener('wheel', event => {
      event.preventDefault();
      column.el.scrollTop += event.deltaY * (event.deltaMode === 1 ? ROW : event.deltaMode === 2 ? column.el.clientHeight : 1);
    }, { passive: false });
    let drag = null, dragged = false;
    section.addEventListener('pointerdown', event => {
      if ((event.pointerType !== 'mouse' && event.target !== labelEl) || event.button !== 0) return;
      drag = { y: event.clientY, top: column.el.scrollTop }; dragged = false;
      if (event.target === labelEl) section.setPointerCapture(event.pointerId);
    });
    section.addEventListener('pointermove', event => {
      if (!drag) return;
      if (Math.abs(event.clientY - drag.y) > 4) {
        dragged = true; section.setPointerCapture(event.pointerId);
        column.el.classList.add('coelum-wheel-dragging');
        column.el.scrollTop = drag.top + drag.y - event.clientY;
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) section.addEventListener(type, () => {
      if (drag && dragged) select(column, column.min + Math.round(column.el.scrollTop / ROW));
      column.el.classList.remove('coelum-wheel-dragging'); drag = null;
    });
    section.addEventListener('pointerleave', () => { if (!dragged) drag = null; });
  }
  for (const tab of root.querySelectorAll('[data-wheel-tab]')) tab.addEventListener('click', () => { flush(); setGroup(tab.dataset.wheelTab); });
  root.querySelector('[data-wheel-close]').addEventListener('click', () => { flush(); close(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); flush(); close(); } });
  return {
    open(text) {
      const values = text.replace('−', '-').match(/^(-?\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/).slice(1).map(Number);
      draft = Object.fromEntries(fields.map(([name], i) => [name, values[i]]));
      const year = columns.get('year'), min = Math.min(-1000, draft.year), max = Math.max(3000, draft.year);
      if (year.min !== min || year.max !== max) { year.min = min; year.max = max; fill(year); }
      const day = columns.get('day'); day.max = daysInMonth(draft.year, draft.month); fill(day);
      root.hidden = false; error.hidden = true; setGroup('date');
      columns.get('year').el.focus({ preventScroll: true });
    },
  };
}
