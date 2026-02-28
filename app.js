'use strict';

/**
 * Calendario 2026 — Alek & Cata (v2.3)
 *
 * Reglas:
 * - Lun/Mié/Vie = Musicala
 * - Mar/Jue/Sáb/Dom = rotación Alek/Cata (ignorando sábados Musicala del mes)
 * - 1 sábado al mes = Musicala (por defecto: primer sábado del mes) guardado en meta.monthlySaturday
 * - Editable por día (override) con nota y persiste en localStorage
 *
 * UI:
 * - Resumen mensual (donut + % + balance)
 * - Patrones del mes (racha, findes seguidos, editados)
 *
 * Mejoras v2.3:
 * - ✅ Precalcula regla del año (O(365) en vez de O(365*365))
 * - ✅ Event delegation para clicks del calendario
 * - ✅ Overrides “limpios” (si coincide con regla y no hay nota, no guarda override)
 * - ✅ Import/migración tolerante
 * - ✅ Soporta que btnReset ya no exista
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

const DOW_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

// ---------- State ----------
let store = loadStore(); // { overrides: { 'YYYY-MM-DD': {loc, note} }, meta: { monthlySaturday: { 'YYYY-MM': 'YYYY-MM-DD' } }, version?: string }
ensureDefaults();

let currentMonth = 0; // 0..11

// Cache anual: regla precalculada por día
let YEAR_CACHE = null; // { ruleLocByKey: Map, ruleLocByMonth: Array[12] of Array(dayLoc), editedByMonth: Array[12] ... }

// Cache del mes actual (para UI)
let MONTH_CACHE = null; // { monthIdx, counts, total, pct, edited }

// ---------- DOM ----------
const $grid = document.getElementById('grid');
const $monthTitle = document.getElementById('monthTitle');
const $monthSelect = document.getElementById('monthSelect');
const $stats = document.getElementById('stats');

const $prevMonth = document.getElementById('prevMonth');
const $nextMonth = document.getElementById('nextMonth');
const $btnToday = document.getElementById('btnToday');
// btnReset ya NO existe, lo dejamos opcional
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

// ---- UI V2 (si existe) ----
const $monthBalancePill = document.getElementById('monthBalancePill');
const $monthTotalNights = document.getElementById('monthTotalNights');
const $monthPctAlek = document.getElementById('monthPctAlek');
const $monthPctCata = document.getElementById('monthPctCata');
const $monthPctMusi = document.getElementById('monthPctMusi');
const $monthBalanceHint = document.getElementById('monthBalanceHint');

const $patLongestStreak = document.getElementById('patLongestStreak');
const $patWeekendRuns = document.getElementById('patWeekendRuns');
const $patEditedThisMonth = document.getElementById('patEditedThisMonth');
const $patternsPill = document.getElementById('patternsPill');
const $yearEditedPill = document.getElementById('yearEditedPill');

// Donut segments (SVG circles)
const $donutSegAlek = document.querySelector('.donutSeg.donutAlek');
const $donutSegCata = document.querySelector('.donutSeg.donutCata');
const $donutSegMusi = document.querySelector('.donutSeg.donutMusi');
const $donutTrack = document.querySelector('.donutTrack');

let modalDateKey = null; // YYYY-MM-DD

init();

// ---------- Init ----------
function init(){
  buildMonthSelect();
  rebuildYearCache();         // 🔥 precompute reglas
  jumpToTodayOrJanuary();

  // Nav mes
  if ($prevMonth) $prevMonth.addEventListener('click', () => setMonth(currentMonth - 1));
  if ($nextMonth) $nextMonth.addEventListener('click', () => setMonth(currentMonth + 1));
  if ($btnToday) $btnToday.addEventListener('click', () => jumpToTodayOrJanuary());

  // btnReset ya no debería existir, pero si vuelve a aparecer por ahí, que funcione:
  if ($btnReset){
    $btnReset.addEventListener('click', () => {
      store.overrides = {};
      ensureDefaults(true);
      saveStore();
      rebuildYearCache();
      render();
    });
  }

  if ($btnExport) $btnExport.addEventListener('click', exportJSON);

  if ($fileImport){
    $fileImport.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try{
        const text = await file.text();
        const data = JSON.parse(text);
        store = sanitizeImportedStore(data);
        ensureDefaults();
        saveStore();
        rebuildYearCache();
        render();
      }catch(err){
        alert('No pude importar ese JSON.\n' + (err?.message || err));
      }finally{
        e.target.value = '';
      }
    });
  }

  // Delegación: click en el grid
  if ($grid){
    $grid.addEventListener('click', (e) => {
      const cell = e.target.closest?.('.day[data-date]');
      if (!cell) return;
      if (cell.classList.contains('muted')) return;
      const key = cell.getAttribute('data-date');
      if (!key) return;
      const dateObj = fromIsoKey(key);
      openModal(key, dateObj);
    });
  }

  // Modal handlers
  if ($modalClose) $modalClose.addEventListener('click', closeModal);
  if ($modalOverlay){
    $modalOverlay.addEventListener('click', (e) => {
      if (e.target === $modalOverlay) closeModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $modalOverlay && !$modalOverlay.hidden) closeModal();
  });

  if ($locPicker){
    $locPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-loc]');
      if (!btn) return;
      setActiveLocButton(btn.dataset.loc);
    });
  }

  if ($btnSaveEdit){
    $btnSaveEdit.addEventListener('click', () => {
      if (!modalDateKey) return;
      const loc = getActiveLocButton();
      const note = ($note?.value || '').trim();

      // Si coincide con regla y no hay nota, no guardamos override (storage limpio)
      const ruleLoc = getRuleLocByKey(modalDateKey);
      if (loc === ruleLoc && !note){
        delete store.overrides[modalDateKey];
      } else {
        store.overrides[modalDateKey] = { loc, note };
      }

      saveStore();
      closeModal();
      // Solo invalidamos cache mensual y anual de editados
      rebuildYearCache(true); // true = no recalcular reglas, solo recomputar counters editados
      render();
    });
  }

  if ($btnClearEdit){
    $btnClearEdit.addEventListener('click', () => {
      if (!modalDateKey) return;
      delete store.overrides[modalDateKey];
      saveStore();
      closeModal();
      rebuildYearCache(true);
      render();
    });
  }

  render();
}

// ---------- Rendering ----------
function render(){
  if (!$grid || !$monthTitle || !$monthSelect) return;

  const monthName = `${MONTHS_ES[currentMonth]} ${YEAR}`;
  $monthTitle.textContent = monthName;
  $monthSelect.value = String(currentMonth);

  MONTH_CACHE = null; // invalida cache del mes

  // Render grid
  $grid.innerHTML = '';

  const first = new Date(YEAR, currentMonth, 1);
  const daysInMonth = new Date(YEAR, currentMonth + 1, 0).getDate();

  // Grilla empieza en lunes.
  const jsDow = first.getDay(); // 0..6
  const mondayIndex = (jsDow + 6) % 7; // Dom->6, Lun->0...

  const frag = document.createDocumentFragment();

  // celdas vacías antes
  for(let i=0;i<mondayIndex;i++){
    const cell = document.createElement('div');
    cell.className = 'day muted';
    cell.innerHTML = `<div class="dayTop"><div class="num"></div><div class="badge"></div></div>`;
    frag.appendChild(cell);
  }

  const todayKey = isoKey(new Date());

  for(let d=1; d<=daysInMonth; d++){
    const date = new Date(YEAR, currentMonth, d);
    const key = isoKey(date);

    const eff = getEffectiveForDate(key); // usa cache regla + overrides
    const isEdited = Boolean(store.overrides[key]);

    const locClass = eff.loc === LOC.ALEK ? 'alek'
                   : eff.loc === LOC.CATA ? 'cata'
                   : 'musicala';

    const cell = document.createElement('div');
    cell.className = `day ${locClass} ${key === todayKey ? 'todayRing' : ''}`;
    cell.setAttribute('data-date', key);

    const badgeLabel = shortLoc(eff.loc);

    // Nota: el .dot incluye texto completo; en móviles pequeños tu CSS lo apaga dejando solo el puntico.
    cell.innerHTML = `
      ${isEdited ? `<div class="editedMark" title="Editado"></div>` : ''}
      <div class="dayTop">
        <div class="num">${d}</div>
        <div class="badge ${locClass}" title="${LOC_LABEL[eff.loc]}">${badgeLabel}</div>
      </div>
      <div class="dot" title="${LOC_LABEL[eff.loc]}">${LOC_LABEL[eff.loc]}</div>
    `;

    frag.appendChild(cell);
  }

  $grid.appendChild(frag);

  renderStatsForYear();
  renderMonthInsights();
}

function buildMonthSelect(){
  if (!$monthSelect) return;
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
  currentMonth = (now.getFullYear() === YEAR) ? now.getMonth() : 0;
  render();
}

// ---------- Month Insights ----------
function renderMonthInsights(){
  const hasV2 =
    $monthBalancePill && $monthTotalNights &&
    $monthPctAlek && $monthPctCata && $monthPctMusi &&
    $monthBalanceHint && $patLongestStreak && $patWeekendRuns && $patEditedThisMonth;

  if (!hasV2) return;

  const summary = getMonthSummary(currentMonth);

  $monthTotalNights.textContent = String(summary.total);
  $monthPctAlek.textContent = formatPct(summary.pct[LOC.ALEK]);
  $monthPctCata.textContent = formatPct(summary.pct[LOC.CATA]);
  $monthPctMusi.textContent = formatPct(summary.pct[LOC.MUSICALA]);

  applyMonthBalanceUI(summary);
  renderDonut(summary);

  const patterns = getMonthPatterns(currentMonth);
  renderPatterns(patterns);
}

function getMonthSummary(monthIdx){
  if (MONTH_CACHE && MONTH_CACHE.monthIdx === monthIdx) return MONTH_CACHE;

  const counts = { [LOC.ALEK]:0, [LOC.CATA]:0, [LOC.MUSICALA]:0 };
  let edited = 0;

  const daysInMonth = new Date(YEAR, monthIdx + 1, 0).getDate();
  for(let d=1; d<=daysInMonth; d++){
    const key = `${YEAR}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const eff = getEffectiveForDate(key);
    counts[eff.loc]++;

    if (store.overrides[key]) edited++;
  }

  const total = counts[LOC.ALEK] + counts[LOC.CATA] + counts[LOC.MUSICALA];
  const pct = {
    [LOC.ALEK]: total ? (counts[LOC.ALEK] / total) * 100 : 0,
    [LOC.CATA]: total ? (counts[LOC.CATA] / total) * 100 : 0,
    [LOC.MUSICALA]: total ? (counts[LOC.MUSICALA] / total) * 100 : 0,
  };

  MONTH_CACHE = { monthIdx, counts, total, pct, edited };
  return MONTH_CACHE;
}

function applyMonthBalanceUI(summary){
  const pill = $monthBalancePill;
  const hint = $monthBalanceHint;

  const diff = Math.abs(summary.pct[LOC.ALEK] - summary.pct[LOC.CATA]);

  let level = 'ok';
  let label = '🟢 Equilibrado';
  let msg = 'Van parejitos. Nadie puede reclamar “siempre toca allá”.';

  if (diff > 10 && diff <= 22){
    level = 'warn';
    label = '🟡 Leve inclinación';
    msg = 'Se siente una inclinación. No es grave, pero ya se asoma el “siempre yo”.';
  } else if (diff > 22){
    level = 'bad';
    label = '🔴 Desbalanceado';
    msg = 'Ojo: el mes está cargado para un lado. Esto suele cobrarse con intereses emocionales.';
  }

  if (summary.total <= 0){
    level = 'warn';
    label = '—';
    msg = 'No hay datos para este mes.';
  }

  pill.textContent = label;
  pill.classList.remove('ok','warn','bad');
  pill.classList.add(level);

  const topLoc = getTopLoc(summary.counts);
  const topLabel = topLoc ? LOC_LABEL[topLoc] : '—';
  hint.textContent = `${msg} (Mayoría: ${topLabel})`;
}

function getTopLoc(counts){
  let best = null;
  let bestVal = -1;
  for (const k of Object.keys(counts)){
    if (counts[k] > bestVal){
      best = k;
      bestVal = counts[k];
    }
  }
  return best;
}

function renderDonut(summary){
  if (!$donutSegAlek || !$donutSegCata || !$donutSegMusi || !$donutTrack) return;

  const r = 46;
  const C = 2 * Math.PI * r;

  const a = clamp01(summary.pct[LOC.ALEK] / 100) * C;
  const c = clamp01(summary.pct[LOC.CATA] / 100) * C;
  const m = clamp01(summary.pct[LOC.MUSICALA] / 100) * C;

  $donutTrack.style.strokeDasharray = `${C} ${C}`;
  $donutTrack.style.strokeDashoffset = `0`;

  $donutSegAlek.style.strokeDasharray = `${a} ${Math.max(0, C - a)}`;
  $donutSegAlek.style.strokeDashoffset = `0`;

  $donutSegCata.style.strokeDasharray = `${c} ${Math.max(0, C - c)}`;
  $donutSegCata.style.strokeDashoffset = `${-a}`;

  $donutSegMusi.style.strokeDasharray = `${m} ${Math.max(0, C - m)}`;
  $donutSegMusi.style.strokeDashoffset = `${-(a + c)}`;
}

// ---------- Patterns ----------
function getMonthPatterns(monthIdx){
  const daysInMonth = new Date(YEAR, monthIdx + 1, 0).getDate();

  // Racha más larga mismo lugar
  let longest = { len: 0, loc: null, from: null, to: null };
  let curLen = 0;
  let curLoc = null;
  let curFrom = null;

  for(let d=1; d<=daysInMonth; d++){
    const key = `${YEAR}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const eff = getEffectiveForDate(key);

    if (eff.loc === curLoc){
      curLen++;
    } else {
      if (curLen > longest.len){
        longest = {
          len: curLen,
          loc: curLoc,
          from: curFrom,
          to: `${YEAR}-${String(monthIdx+1).padStart(2,'0')}-${String(d-1).padStart(2,'0')}`
        };
      }
      curLoc = eff.loc;
      curLen = 1;
      curFrom = key;
    }
  }
  if (curLen > longest.len){
    longest = {
      len: curLen,
      loc: curLoc,
      from: curFrom,
      to: `${YEAR}-${String(monthIdx+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`
    };
  }

  // Fines de semana seguidos iguales (sábado/domingo mismo lugar)
  const weekendPairs = [];
  for(let d=1; d<=daysInMonth; d++){
    const satDate = new Date(YEAR, monthIdx, d);
    if (satDate.getDay() !== 6) continue;

    const sunDate = new Date(YEAR, monthIdx, d+1);
    if (sunDate.getMonth() !== monthIdx || sunDate.getDay() !== 0) continue;

    const satKey = isoKey(satDate);
    const sunKey = isoKey(sunDate);

    const satLoc = getEffectiveForDate(satKey).loc;
    const sunLoc = getEffectiveForDate(sunKey).loc;

    weekendPairs.push({ isEqual: satLoc === sunLoc, loc: satLoc === sunLoc ? satLoc : null });
  }

  let bestRun = 0;
  let curRun = 0;
  let bestLoc = null;

  for (const w of weekendPairs){
    if (w.isEqual){
      curRun++;
      if (curRun > bestRun){
        bestRun = curRun;
        bestLoc = w.loc;
      }
    } else {
      curRun = 0;
    }
  }

  // Editados
  let editedThisMonth = 0;
  for(let d=1; d<=daysInMonth; d++){
    const key = `${YEAR}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (store.overrides[key]) editedThisMonth++;
  }

  return {
    longestStreak: longest,
    weekendRun: { len: bestRun, loc: bestLoc },
    editedThisMonth
  };
}

function renderPatterns(patterns){
  // Longest streak
  if (patterns.longestStreak.len <= 0 || !patterns.longestStreak.loc){
    $patLongestStreak.textContent = '—';
  } else {
    const locLabel = LOC_LABEL[patterns.longestStreak.loc] || patterns.longestStreak.loc;
    const range = (patterns.longestStreak.from === patterns.longestStreak.to)
      ? patterns.longestStreak.from
      : `${patterns.longestStreak.from} → ${patterns.longestStreak.to}`;
    $patLongestStreak.textContent = `${patterns.longestStreak.len} días · ${locLabel} · ${range}`;
  }

  // Weekend run
  if (!patterns.weekendRun.len || patterns.weekendRun.len <= 0){
    $patWeekendRuns.textContent = '0';
  } else {
    const locLabel = LOC_LABEL[patterns.weekendRun.loc] || patterns.weekendRun.loc;
    $patWeekendRuns.textContent = `${patterns.weekendRun.len} · (${locLabel})`;
  }

  // Edited
  $patEditedThisMonth.textContent = String(patterns.editedThisMonth);

  if ($patternsPill){
    let txt = '🧊 Estable';
    if (patterns.editedThisMonth >= 6) txt = '🌪️ Caótico';
    else if (patterns.editedThisMonth >= 3) txt = '🌀 Movido';
    $patternsPill.textContent = txt;
  }
}

// ---------- Rules / Effective ----------
function ensureDefaults(forceRecalcMonthlySaturday = false){
  if (!store || typeof store !== 'object') store = {};
  if (!store.overrides || typeof store.overrides !== 'object') store.overrides = {};
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};
  if (!store.meta.monthlySaturday || typeof store.meta.monthlySaturday !== 'object') {
    store.meta.monthlySaturday = {};
  }
  if (!store.version) store.version = '2.3';

  // Sábado musicala del mes: primer sábado por defecto
  for(let m=0; m<12; m++){
    const ym = `${YEAR}-${String(m+1).padStart(2,'0')}`;
    if (!store.meta.monthlySaturday[ym] || forceRecalcMonthlySaturday){
      const firstSat = findNthWeekdayOfMonth(YEAR, m, 6, 1);
      store.meta.monthlySaturday[ym] = isoKey(firstSat);
    }
  }
}

// Retorna efectiva: override si existe; si no, regla precomputada
function getEffectiveForDate(key){
  const ov = store.overrides[key];
  if (ov && ov.loc) return { loc: ov.loc, note: ov.note || '' };
  return { loc: getRuleLocByKey(key), note: '' };
}

function getRuleLocByKey(key){
  if (!YEAR_CACHE) rebuildYearCache();
  return YEAR_CACHE.ruleLocByKey.get(key) || LOC.MUSICALA;
}

// Precalcula reglas del año una sola vez
// modeQuick=true => no recalcula reglas (solo update de contadores no necesarios acá),
// lo dejamos por compatibilidad pero igual recalculamos Map porque es barato (365).
function rebuildYearCache(/*modeQuick=*/){
  const ruleLocByKey = new Map();

  // Precompute: para rotación necesitamos contar solo días rotables (Mar/Jue/Sáb/Dom)
  // excluyendo sábados musicala del mes y excluyendo Lun/Mié/Vie (musicala fijo)
  let rotableIndex = 0;

  const start = new Date(YEAR, 0, 1);
  const end = new Date(YEAR, 11, 31);

  for(let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    const date = new Date(d);
    const key = isoKey(date);
    const dow = date.getDay(); // 0..6
    const month = date.getMonth();
    const ym = `${YEAR}-${String(month+1).padStart(2,'0')}`;

    // Musicala fijo Lun/Mié/Vie
    if (dow === 1 || dow === 3 || dow === 5){
      ruleLocByKey.set(key, LOC.MUSICALA);
      continue;
    }

    // Sábado musicala del mes
    if (dow === 6 && store.meta.monthlySaturday?.[ym] === key){
      ruleLocByKey.set(key, LOC.MUSICALA);
      continue;
    }

    // Rotables: Mar/Jue/Sáb/Dom
    const isRotable = (dow === 2 || dow === 4 || dow === 6 || dow === 0);
    if (isRotable){
      const loc = (rotableIndex % 2 === 0) ? LOC.ALEK : LOC.CATA;
      rotableIndex++;
      ruleLocByKey.set(key, loc);
      continue;
    }

    // fallback (no debería)
    ruleLocByKey.set(key, LOC.MUSICALA);
  }

  YEAR_CACHE = { ruleLocByKey };
  MONTH_CACHE = null;
}

// ---------- Stats ----------
function renderStatsForYear(){
  if (!$stats) return;

  const counts = { [LOC.ALEK]:0, [LOC.CATA]:0, [LOC.MUSICALA]:0 };
  let edited = 0;

  forEachDayOfYear((date) => {
    const key = isoKey(date);
    const eff = getEffectiveForDate(key);
    counts[eff.loc]++;

    if (store.overrides[key]) edited++;
  });

  if ($yearEditedPill){
    $yearEditedPill.textContent = `✍️ ${edited} editados`;
  }

  const monthlySatList = Object.entries(store.meta.monthlySaturday || {})
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
  if ($modalTitle) $modalTitle.textContent = 'Editar día';
  if ($modalSub) $modalSub.textContent = `${key} (${dow})`;

  const eff = getEffectiveForDate(key);
  setActiveLocButton(eff.loc);

  const ov = store.overrides[key];
  if ($note) $note.value = (ov?.note || '');

  if ($modalOverlay) $modalOverlay.hidden = false;
}

function closeModal(){
  if ($modalOverlay) $modalOverlay.hidden = true;
  modalDateKey = null;
  if ($note) $note.value = '';
}

function setActiveLocButton(loc){
  if (!$locPicker) return;
  [...$locPicker.querySelectorAll('button[data-loc]')].forEach(b => {
    b.classList.toggle('active', b.dataset.loc === loc);
  });
}
function getActiveLocButton(){
  if (!$locPicker) return LOC.MUSICALA;
  const btn = $locPicker.querySelector('button.active[data-loc]');
  return btn ? btn.dataset.loc : LOC.MUSICALA;
}

// ---------- Storage ----------
function loadStore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { overrides:{}, meta:{ monthlySaturday:{} }, version: '2.3' };
    const data = JSON.parse(raw);
    return sanitizeImportedStore(data);
  }catch{
    return { overrides:{}, meta:{ monthlySaturday:{} }, version: '2.3' };
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

// Import robusto/migración suave
function sanitizeImportedStore(data){
  if (!data || typeof data !== 'object') throw new Error('JSON inválido (no es objeto).');

  const safe = {
    version: typeof data.version === 'string' ? data.version : '2.3',
    overrides: (data.overrides && typeof data.overrides === 'object') ? data.overrides : {},
    meta: (data.meta && typeof data.meta === 'object') ? data.meta : { monthlySaturday:{} },
  };

  if (!safe.meta.monthlySaturday || typeof safe.meta.monthlySaturday !== 'object'){
    safe.meta.monthlySaturday = {};
  }

  // Limpieza: normaliza overrides (loc válido, note string)
  for (const [k, v] of Object.entries(safe.overrides)){
    if (!isIsoKey(k)) { delete safe.overrides[k]; continue; }
    if (!v || typeof v !== 'object') { delete safe.overrides[k]; continue; }

    const loc = v.loc;
    const note = (v.note || '').toString();

    if (loc !== LOC.ALEK && loc !== LOC.CATA && loc !== LOC.MUSICALA){
      delete safe.overrides[k];
      continue;
    }
    safe.overrides[k] = { loc, note };
  }

  return safe;
}

// ---------- Utilities ----------
function isoKey(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function fromIsoKey(key){
  // key = YYYY-MM-DD
  const [y,m,d] = key.split('-').map(n => parseInt(n, 10));
  return new Date(y, (m||1)-1, d||1);
}

function shortLoc(loc){
  if (loc === LOC.MUSICALA) return 'Mus';
  if (loc === LOC.ALEK) return 'Alek';
  return 'Cata';
}

function formatPct(n){
  if (!isFinite(n)) return '0%';
  return `${Math.round(n)}%`;
}

function clamp01(x){
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function isIsoKey(s){
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
  return new Date(year, month+1, 0);
}

function forEachDayOfYear(fn){
  const start = new Date(YEAR, 0, 1);
  const end = new Date(YEAR, 11, 31);
  for(let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    fn(new Date(d));
  }
}