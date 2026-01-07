'use strict';

/**
 * Calendario 2026 — Alek & Cata
 * - Regla fija: Lun/Mié/Vie = Musicala
 * - Rotación equitativa: Mar/Jue/Sáb/Dom alterna Alek/Cata
 * - 1 sábado al mes = Musicala (por defecto: primer sábado del mes)
 * - Editable por día (override) y persiste en localStorage
 */

const YEAR = 2026;
const LS_KEY = 'stayCalendar2026_v1';

const LOC = {
  ALEK: 'ALEK',
  CATA: 'CATA',
  MUSICALA: 'MUSICALA',
};

const LOC_LABEL = {
  [LOC.ALEK]: 'Casa Alek',
  [LOC.CATA]: 'Casa Cata',
  [LOC.MUSICALA]: 'Musicala',
};

const DOW_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']; // JS: 0=Dom

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

// ---------- State ----------
let store = loadStore(); // { overrides: { 'YYYY-MM-DD': {loc, note} }, meta: { monthlySaturday: { 'YYYY-MM': 'YYYY-MM-DD' } } }
ensureDefaults();

let currentMonth = 0; // 0..11

// ---------- DOM ----------
const $grid = document.getElementById('grid');
const $monthTitle = document.getElementById('monthTitle');
const $monthSelect = document.getElementById('monthSelect');
const $stats = document.getElementById('stats');

const $prevMonth = document.getElementById('prevMonth');
const $nextMonth = document.getElementById('nextMonth');
const $btnToday = document.getElementById('btnToday');
const $btnReset = document.getElementById('btnReset');
const $btnExport = document.getElementById('btnExport');
const $fileImport = document.getElementById('fileImport');

const $modalOverlay = document.getElementById('modalOverlay');
const $modalClose = document.getElementById('modalClose');
const $modalTitle = document.getElementById('modalTitle');
const $modalSub = document.getElementById('modalSub');
const $locPicker = document.getElementById('locPicker');
const $note = document.getElementById('note');
const $btnSaveEdit = document.getElementById('btnSaveEdit');
const $btnClearEdit = document.getElementById('btnClearEdit');

let modalDateKey = null; // YYYY-MM-DD

init();

// ---------- Init ----------
function init(){
  buildMonthSelect();
  jumpToTodayOrJanuary();

  $prevMonth.addEventListener('click', () => setMonth(currentMonth - 1));
  $nextMonth.addEventListener('click', () => setMonth(currentMonth + 1));

  $btnToday.addEventListener('click', () => jumpToTodayOrJanuary());

  $btnReset.addEventListener('click', () => {
    // borrar overrides, mantener meta de sábado mensual (porque es parte de reglas pero editable)
    store.overrides = {};
    // si no existe, crear default
    ensureDefaults(true);
    saveStore();
    render();
  });

  $btnExport.addEventListener('click', exportJSON);

  $fileImport.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') throw new Error('JSON inválido');
      if (!data.overrides || !data.meta) throw new Error('Faltan campos esperados (overrides/meta)');

      store = data;
      ensureDefaults(); // asegura estructura mínima
      saveStore();
      render();
    }catch(err){
      alert('No pude importar ese JSON.\n' + (err?.message || err));
    }finally{
      e.target.value = '';
    }
  });

  // Modal handlers
  $modalClose.addEventListener('click', closeModal);
  $modalOverlay.addEventListener('click', (e) => {
    if (e.target === $modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$modalOverlay.hidden) closeModal();
  });

  $locPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-loc]');
    if (!btn) return;
    setActiveLocButton(btn.dataset.loc);
  });

  $btnSaveEdit.addEventListener('click', () => {
    if (!modalDateKey) return;
    const loc = getActiveLocButton();
    const note = ($note.value || '').trim();

    store.overrides[modalDateKey] = { loc, note };
    saveStore();
    closeModal();
    render();
  });

  $btnClearEdit.addEventListener('click', () => {
    if (!modalDateKey) return;
    delete store.overrides[modalDateKey];
    saveStore();
    closeModal();
    render();
  });

  render();
}

// ---------- Rendering ----------
function render(){
  const monthName = `${MONTHS_ES[currentMonth]} ${YEAR}`;
  $monthTitle.textContent = monthName;
  $monthSelect.value = String(currentMonth);

  $grid.innerHTML = '';

  const first = new Date(YEAR, currentMonth, 1);
  const daysInMonth = new Date(YEAR, currentMonth + 1, 0).getDate();

  // Queremos que la grilla empiece en LUNES.
  // JS: 0=Dom..6=Sáb. Convertimos a índice lunes-based (0=Lun..6=Dom)
  const jsDow = first.getDay(); // 0..6
  const mondayIndex = (jsDow + 6) % 7; // Dom->6, Lun->0, Mar->1...

  // celdas vacías antes
  for(let i=0;i<mondayIndex;i++){
    const cell = document.createElement('div');
    cell.className = 'day muted';
    cell.innerHTML = `<div class="dayTop"><div class="num"></div><div class="badge"></div></div>`;
    $grid.appendChild(cell);
  }

  const todayKey = isoKey(new Date());

  for(let d=1; d<=daysInMonth; d++){
    const date = new Date(YEAR, currentMonth, d);
    const key = isoKey(date);

    const effective = getEffectiveForDate(key, date);
    const isEdited = Boolean(store.overrides[key]);

    const cell = document.createElement('div');
    const locClass = effective.loc === LOC.ALEK ? 'alek'
                   : effective.loc === LOC.CATA ? 'cata'
                   : 'musicala';

    cell.className = `day ${locClass} ${key === todayKey ? 'todayRing' : ''}`;
    cell.setAttribute('data-date', key);

    const badgeLabel = shortLoc(effective.loc);
    cell.innerHTML = `
      ${isEdited ? `<div class="editedMark" title="Editado"></div>` : ''}
      <div class="dayTop">
        <div class="num">${d}</div>
        <div class="badge ${locClass}">${badgeLabel}</div>
      </div>
      <div class="dot">${LOC_LABEL[effective.loc]}</div>
    `;

    cell.addEventListener('click', () => openModal(key, date));
    $grid.appendChild(cell);
  }

  renderStatsForYear();
}

function buildMonthSelect(){
  $monthSelect.innerHTML = '';
  MONTHS_ES.forEach((m, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = m;
    $monthSelect.appendChild(opt);
  });
  $monthSelect.addEventListener('change', () => setMonth(parseInt($monthSelect.value, 10)));
}

function setMonth(m){
  if (m < 0) m = 11;
  if (m > 11) m = 0;
  currentMonth = m;
  render();
}

function jumpToTodayOrJanuary(){
  const now = new Date();
  if (now.getFullYear() === YEAR) currentMonth = now.getMonth();
  else currentMonth = 0;
  render();
}

// ---------- Rules engine ----------
function ensureDefaults(forceRecalcMonthlySaturday = false){
  if (!store || typeof store !== 'object') store = {};
  if (!store.overrides || typeof store.overrides !== 'object') store.overrides = {};
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};
  if (!store.meta.monthlySaturday || typeof store.meta.monthlySaturday !== 'object') {
    store.meta.monthlySaturday = {};
  }

  // Definir sábado mensual por defecto: primer sábado de cada mes
  for(let m=0; m<12; m++){
    const ym = `${YEAR}-${String(m+1).padStart(2,'0')}`;
    if (!store.meta.monthlySaturday[ym] || forceRecalcMonthlySaturday){
      const firstSat = findNthWeekdayOfMonth(YEAR, m, 6, 1); // weekday 6=Sáb, nth=1
      store.meta.monthlySaturday[ym] = isoKey(firstSat);
    }
  }
}

// Retorna la ubicación efectiva de una fecha (override si existe, si no, regla)
function getEffectiveForDate(key, dateObj){
  const override = store.overrides[key];
  if (override && override.loc) return override;

  return { loc: getRuleLoc(dateObj), note: '' };
}

function getRuleLoc(dateObj){
  const dow = dateObj.getDay(); // 0 Dom, 1 Lun, 2 Mar, 3 Mié, 4 Jue, 5 Vie, 6 Sáb
  const month = dateObj.getMonth();
  const ym = `${YEAR}-${String(month+1).padStart(2,'0')}`;
  const key = isoKey(dateObj);

  // Lun/Mié/Vie = Musicala
  if (dow === 1 || dow === 3 || dow === 5) return LOC.MUSICALA;

  // 1 sábado al mes = Musicala (por defecto: primer sábado)
  if (dow === 6 && store.meta.monthlySaturday[ym] === key) return LOC.MUSICALA;

  // Mar/Jue/Sáb/Dom = rotación equitativa
  if (dow === 2 || dow === 4 || dow === 6 || dow === 0){
    return rotationLocForDate(dateObj);
  }

  // fallback (no debería pasar)
  return LOC.MUSICALA;
}

// Alterna Alek/Cata en los días rotables (Mar/Jue/Sáb/Dom) ignorando los que caen en Musicala por regla.
function rotationLocForDate(dateObj){
  // Contamos cuántos "días rotables" han ocurrido antes de esta fecha, y alternamos por paridad.
  // Días rotables: Mar/Jue/Sáb/Dom, excepto si ese día es Musicala por regla (sábado mensual).
  const start = new Date(YEAR, 0, 1);
  const target = stripTime(dateObj);

  let count = 0;
  for(let d = new Date(start); d < target; d.setDate(d.getDate() + 1)){
    const dow = d.getDay();
    const isRotable = (dow === 2 || dow === 4 || dow === 6 || dow === 0);

    if (!isRotable) continue;

    // excluir si cae en Musicala por sábado mensual
    if (dow === 6){
      const ym = `${YEAR}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (store.meta.monthlySaturday[ym] === isoKey(d)) continue;
    }

    // excluir si es Lun/Mié/Vie (no aplica igual, pero por si acaso)
    if (dow === 1 || dow === 3 || dow === 5) continue;

    count++;
  }

  // count=0 => primer rotable del año: Alek (si prefieren empezar por Cata, inviertan esto)
  return (count % 2 === 0) ? LOC.ALEK : LOC.CATA;
}

// ---------- Stats ----------
function renderStatsForYear(){
  const counts = { [LOC.ALEK]:0, [LOC.CATA]:0, [LOC.MUSICALA]:0 };
  let edited = 0;

  forEachDayOfYear((date) => {
    const key = isoKey(date);
    const eff = getEffectiveForDate(key, date);
    counts[eff.loc]++;

    if (store.overrides[key]) edited++;
  });

  const monthlySatList = Object.entries(store.meta.monthlySaturday)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([ym, day]) => `${ym}: ${day}`)
    .join('<br>');

  $stats.innerHTML = `
    <div><strong>Totales 2026</strong></div>
    <div>🏠 Casa Alek: <strong>${counts[LOC.ALEK]}</strong> noches</div>
    <div>🏡 Casa Cata: <strong>${counts[LOC.CATA]}</strong> noches</div>
    <div>🎭 Musicala: <strong>${counts[LOC.MUSICALA]}</strong> noches</div>
    <div>✍️ Días editados: <strong>${edited}</strong></div>
    <div style="margin-top:10px; color: rgba(255,255,255,.62); font-size:12px;">
      Sábados “Musicala del mes” (editable vía edición manual del día):<br>
      ${monthlySatList}
    </div>
  `;
}

// ---------- Modal ----------
function openModal(key, dateObj){
  modalDateKey = key;

  const dow = DOW_LABEL[dateObj.getDay()];
  $modalTitle.textContent = 'Editar día';
  $modalSub.textContent = `${key} (${dow})`;

  const eff = getEffectiveForDate(key, dateObj);
  setActiveLocButton(eff.loc);

  const ov = store.overrides[key];
  $note.value = (ov?.note || '');

  $modalOverlay.hidden = false;
}

function closeModal(){
  $modalOverlay.hidden = true;
  modalDateKey = null;
  $note.value = '';
}

function setActiveLocButton(loc){
  [...$locPicker.querySelectorAll('button[data-loc]')].forEach(b => {
    b.classList.toggle('active', b.dataset.loc === loc);
  });
}
function getActiveLocButton(){
  const btn = $locPicker.querySelector('button.active[data-loc]');
  return btn ? btn.dataset.loc : LOC.MUSICALA;
}

// ---------- Storage ----------
function loadStore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { overrides:{}, meta:{ monthlySaturday:{} } };
    const data = JSON.parse(raw);
    return data;
  }catch{
    return { overrides:{}, meta:{ monthlySaturday:{} } };
  }
}

function saveStore(){
  localStorage.setItem(LS_KEY, JSON.stringify(store, null, 2));
}

// ---------- Export / Import ----------
function exportJSON(){
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'calendario-2026-alek-cata-musicala.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Utilities ----------
function isoKey(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function stripTime(date){
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shortLoc(loc){
  if (loc === LOC.MUSICALA) return 'Mus';
  if (loc === LOC.ALEK) return 'Alek';
  return 'Cata';
}

// weekday: 0..6 (Dom..Sáb), month: 0..11, nth=1 => primer weekday del mes
function findNthWeekdayOfMonth(year, month, weekday, nth){
  let count = 0;
  for(let d=1; d<=31; d++){
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === weekday){
      count++;
      if (count === nth) return dt;
    }
  }
  // fallback: último día del mes
  return new Date(year, month+1, 0);
}

function forEachDayOfYear(fn){
  const start = new Date(YEAR, 0, 1);
  const end = new Date(YEAR, 11, 31);
  for(let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    fn(new Date(d));
  }
}
