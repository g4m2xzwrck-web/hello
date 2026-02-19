import {
  add,
  deleteTagAndUnset,
  getAll,
  getById,
  mergeTag,
  openDb,
  put,
  remove,
  seedTagsIfNeeded
} from './db.js';

const OPTIONS = {
  focusMin: [15, 20, 25, 30, 35, 40, 45, 50, 60],
  breakMin: [3, 5, 10, 15, 20],
  sets: [1, 2, 3, 4, 5, 6],
  defaultFocusMin: [15, 20, 25, 30, 35, 40, 45, 50, 60],
  defaultBreakMin: [3, 5, 10, 15, 20],
  defaultSets: [1, 2, 3, 4, 5, 6]
};

const state = {
  db: null,
  tags: [],
  sessions: [],
  selectedSessionId: null,
  settings: {
    defaultFocusMin: 25,
    defaultBreakMin: 5,
    defaultSets: 1
  },
  timerConfig: {
    focusMin: 25,
    breakMin: 5,
    sets: 1
  },
  timer: {
    running: false,
    paused: false,
    phase: 'focus',
    currentSet: 1,
    remainingSec: 1500,
    tickHandle: null,
    phaseStartMs: 0,
    pauseStartMs: null,
    pausedTotalSec: 0,
    focusStartedAt: null
  }
};

const $ = (s) => document.querySelector(s);
const els = {
  timerDisplay: $('#timerDisplay'),
  phaseLabel: $('#phaseLabel'),
  selectorBlock: $('#selectorBlock'),
  idleActions: $('#idleActions'),
  runningActions: $('#runningActions'),
  pauseResumeBtn: $('#pauseResumeBtn'),
  startBtn: $('#startBtn'),
  endBtn: $('#endBtn'),
  historyList: $('#historyList'),
  tagList: $('#tagList'),
  optionSheet: $('#optionSheet'),
  sheetTitle: $('#sheetTitle'),
  sheetOptions: $('#sheetOptions'),
  closeSheetBtn: $('#closeSheetBtn'),
  addTagForm: $('#addTagForm'),
  newTagName: $('#newTagName'),
  newTagColor: $('#newTagColor'),
  sessionDialog: $('#sessionDialog'),
  sessionForm: $('#sessionForm'),
  sessionStart: $('#sessionStart'),
  sessionEnd: $('#sessionEnd'),
  sessionTag: $('#sessionTag'),
  sessionMemo: $('#sessionMemo'),
  sessionError: $('#sessionError'),
  deleteSessionBtn: $('#deleteSessionBtn'),
  swUpdateBanner: $('#swUpdateBanner'),
  swUpdateReloadBtn: $('#swUpdateReloadBtn')
};

init();

async function init() {
  state.db = await openDb();
  await seedTagsIfNeeded(state.db);
  loadSettings();
  syncTimerConfigFromSettings();
  await refreshAll();
  bindEvents();
  renderTimer();
  registerSw();
}

function loadSettings() {
  const raw = localStorage.getItem('pomodoroSettings');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      Object.assign(state.settings, parsed);
    } catch {
      localStorage.removeItem('pomodoroSettings');
    }
  }
}

function saveSettings() {
  localStorage.setItem('pomodoroSettings', JSON.stringify(state.settings));
}

function syncTimerConfigFromSettings() {
  state.timerConfig.focusMin = state.settings.defaultFocusMin;
  state.timerConfig.breakMin = state.settings.defaultBreakMin;
  state.timerConfig.sets = state.settings.defaultSets;
}

async function refreshAll() {
  state.tags = (await getAll(state.db, 'tags')).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  state.sessions = (await getAll(state.db, 'sessions')).sort((a, b) => b.startTs - a.startTs);
  renderSelectorValues();
  renderHistory();
  renderTags();
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  document.querySelectorAll('.selector-row').forEach((row) => {
    row.addEventListener('click', () => openOptionSheet(row.dataset.selector));
  });

  els.closeSheetBtn.addEventListener('click', () => els.optionSheet.close());
  els.startBtn.addEventListener('click', startTimer);
  els.pauseResumeBtn.addEventListener('click', togglePause);
  els.endBtn.addEventListener('click', stopTimer);

  els.addTagForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.newTagName.value.trim();
    if (!name) return;
    await add(state.db, 'tags', { name, color: els.newTagColor.value || '#8fb8b3' });
    els.newTagName.value = '';
    await refreshAll();
  });

  els.sessionForm.addEventListener('submit', onSaveSession);
  els.deleteSessionBtn.addEventListener('click', onDeleteSession);
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}

function openOptionSheet(selectorKey) {
  const options = OPTIONS[selectorKey];
  if (!options) return;
  const labels = {
    focusMin: '集中時間（分）',
    breakMin: '休憩時間（分）',
    sets: 'セット数（回）',
    defaultFocusMin: 'デフォルト集中時間（分）',
    defaultBreakMin: 'デフォルト休憩時間（分）',
    defaultSets: 'デフォルトセット数（回）'
  };
  els.sheetTitle.textContent = labels[selectorKey] || '選択';
  els.sheetOptions.innerHTML = '';
  options.forEach((value) => {
    const button = document.createElement('button');
    button.className = 'btn option-btn';
    button.textContent = `${value}`;
    button.addEventListener('click', async () => {
      if (selectorKey.startsWith('default')) {
        state.settings[selectorKey] = value;
        saveSettings();
        if (!state.timer.running) syncTimerConfigFromSettings();
      } else if (!state.timer.running) {
        state.timerConfig[selectorKey] = value;
      }
      renderSelectorValues();
      renderTimer();
      els.optionSheet.close();
    });
    els.sheetOptions.appendChild(button);
  });
  els.optionSheet.showModal();
}

function renderSelectorValues() {
  $('#focusMinValue').textContent = state.timerConfig.focusMin;
  $('#breakMinValue').textContent = state.timerConfig.breakMin;
  $('#setsValue').textContent = state.timerConfig.sets;
  $('#defaultFocusMinValue').textContent = state.settings.defaultFocusMin;
  $('#defaultBreakMinValue').textContent = state.settings.defaultBreakMin;
  $('#defaultSetsValue').textContent = state.settings.defaultSets;
}

function startTimer() {
  if (state.timer.running) return;
  state.timer.running = true;
  state.timer.paused = false;
  state.timer.phase = 'focus';
  state.timer.currentSet = 1;
  state.timer.remainingSec = state.timerConfig.focusMin * 60;
  state.timer.phaseStartMs = Date.now();
  state.timer.pausedTotalSec = 0;
  state.timer.focusStartedAt = Date.now();
  state.timer.pauseStartMs = null;
  els.selectorBlock.classList.add('disabled');
  els.idleActions.classList.add('hidden');
  els.runningActions.classList.remove('hidden');
  els.pauseResumeBtn.textContent = '一時停止';
  startTicking();
  renderTimer();
}

function startTicking() {
  clearInterval(state.timer.tickHandle);
  state.timer.tickHandle = setInterval(tick, 250);
}

function tick() {
  if (!state.timer.running || state.timer.paused) return;
  const elapsed = Math.floor((Date.now() - state.timer.phaseStartMs) / 1000);
  const total = getCurrentPhaseTotalSec();
  state.timer.remainingSec = Math.max(0, total - elapsed);
  renderTimer();
  if (state.timer.remainingSec <= 0) {
    onPhaseComplete();
  }
}

function getCurrentPhaseTotalSec() {
  return (state.timer.phase === 'focus' ? state.timerConfig.focusMin : state.timerConfig.breakMin) * 60;
}

async function onPhaseComplete() {
  clearInterval(state.timer.tickHandle);
  if (state.timer.phase === 'focus') {
    await saveCompletedFocus();
    if (state.timer.currentSet >= state.timerConfig.sets) {
      stopTimer();
      return;
    }
    state.timer.phase = 'break';
    state.timer.remainingSec = state.timerConfig.breakMin * 60;
    state.timer.phaseStartMs = Date.now();
    state.timer.pausedTotalSec = 0;
    state.timer.pauseStartMs = null;
    startTicking();
    renderTimer();
  } else {
    state.timer.phase = 'focus';
    state.timer.currentSet += 1;
    state.timer.remainingSec = state.timerConfig.focusMin * 60;
    state.timer.phaseStartMs = Date.now();
    state.timer.pausedTotalSec = 0;
    state.timer.pauseStartMs = null;
    state.timer.focusStartedAt = Date.now();
    startTicking();
    renderTimer();
  }
}

async function saveCompletedFocus() {
  const endTs = Date.now();
  const session = {
    startTs: state.timer.focusStartedAt,
    endTs,
    pauseTotalSec: state.timer.pausedTotalSec,
    durationSec: Math.max(0, Math.floor((endTs - state.timer.focusStartedAt) / 1000) - state.timer.pausedTotalSec),
    focusMin: state.timerConfig.focusMin,
    breakMin: state.timerConfig.breakMin,
    sets: state.timerConfig.sets,
    memo: '',
    tagId: null
  };
  await add(state.db, 'sessions', session);
  await refreshAll();
}

function togglePause() {
  if (!state.timer.running) return;
  if (!state.timer.paused) {
    state.timer.paused = true;
    state.timer.pauseStartMs = Date.now();
    els.pauseResumeBtn.textContent = '再開';
  } else {
    const pausedSec = Math.floor((Date.now() - state.timer.pauseStartMs) / 1000);
    state.timer.pausedTotalSec += pausedSec;
    state.timer.phaseStartMs += pausedSec * 1000;
    state.timer.paused = false;
    state.timer.pauseStartMs = null;
    els.pauseResumeBtn.textContent = '一時停止';
  }
}

function stopTimer() {
  clearInterval(state.timer.tickHandle);
  state.timer.running = false;
  state.timer.paused = false;
  state.timer.phase = 'focus';
  state.timer.currentSet = 1;
  state.timer.remainingSec = state.timerConfig.focusMin * 60;
  state.timer.phaseStartMs = 0;
  state.timer.pauseStartMs = null;
  state.timer.pausedTotalSec = 0;
  state.timer.focusStartedAt = null;
  els.selectorBlock.classList.remove('disabled');
  els.idleActions.classList.remove('hidden');
  els.runningActions.classList.add('hidden');
  renderTimer();
}

function renderTimer() {
  const sec = state.timer.running ? state.timer.remainingSec : state.timerConfig.focusMin * 60;
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  els.timerDisplay.textContent = `${mm}:${ss}`;
  const phaseJa = state.timer.phase === 'focus' ? '集中' : '休憩';
  const setText = `${state.timer.currentSet}/${state.timerConfig.sets}`;
  els.phaseLabel.textContent = state.timer.running ? `${phaseJa} ${setText}` : `集中 1/${state.timerConfig.sets}`;
}

function renderHistory() {
  if (!state.sessions.length) {
    els.historyList.innerHTML = '<div class="card">履歴がありません</div>';
    return;
  }
  els.historyList.innerHTML = '';
  state.sessions.forEach((s) => {
    const tag = state.tags.find((t) => t.id === s.tagId);
    const card = document.createElement('button');
    card.className = 'card';
    card.innerHTML = `<div><strong>${fmtDateTime(s.startTs)}</strong></div>
      <small>${Math.floor(s.durationSec / 60)}分 ${s.durationSec % 60}秒 / pause ${s.pauseTotalSec}s</small>
      <div><span class="tag-dot" style="background:${tag?.color || '#8fb8b3'}"></span>${tag?.name || '未設定'}</div>`;
    card.addEventListener('click', () => openSessionDialog(s.id));
    els.historyList.appendChild(card);
  });
}

function renderTags() {
  els.tagList.innerHTML = '';
  state.tags.forEach((tag) => {
    const row = document.createElement('div');
    row.className = 'card tag-row';
    row.innerHTML = `<div><span class="tag-dot" style="background:${tag.color || '#8fb8b3'}"></span>${tag.name}</div>`;
    const tools = document.createElement('div');
    tools.className = 'tag-tools';

    const renameBtn = mkBtn('名前変更', async () => {
      const name = prompt('新しいタグ名', tag.name)?.trim();
      if (!name) return;
      await put(state.db, 'tags', { ...tag, name });
      await refreshAll();
    });

    const colorBtn = mkBtn('色', async () => {
      const color = prompt('色コード（#rrggbb）', tag.color || '#8fb8b3')?.trim();
      if (!color) return;
      await put(state.db, 'tags', { ...tag, color });
      await refreshAll();
    });

    const mergeBtn = mkBtn('統合', async () => {
      const candidates = state.tags.filter((t) => t.id !== tag.id);
      if (!candidates.length) return alert('統合先タグがありません');
      const message = candidates.map((t) => `${t.id}: ${t.name}`).join('\n');
      const target = Number(prompt(`統合先IDを入力\n${message}`));
      if (!target) return;
      await mergeTag(state.db, tag.id, target);
      await refreshAll();
    });

    const deleteBtn = mkBtn('削除', async () => {
      if (!confirm('タグを削除します。該当履歴は未設定になります。')) return;
      await deleteTagAndUnset(state.db, tag.id);
      await refreshAll();
    }, 'btn-danger');

    tools.append(renameBtn, colorBtn, mergeBtn, deleteBtn);
    row.appendChild(tools);
    els.tagList.appendChild(row);
  });
}

function mkBtn(text, onClick, className = '') {
  const btn = document.createElement('button');
  btn.className = `btn ${className}`.trim();
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

async function openSessionDialog(id) {
  state.selectedSessionId = id;
  const session = await getById(state.db, 'sessions', id);
  fillTagSelect();
  els.sessionStart.value = toLocalInputValue(session.startTs);
  els.sessionEnd.value = toLocalInputValue(session.endTs);
  els.sessionMemo.value = session.memo || '';
  els.sessionTag.value = session.tagId == null ? '' : String(session.tagId);
  els.sessionError.textContent = '';
  els.sessionDialog.showModal();
}

function fillTagSelect() {
  els.sessionTag.innerHTML = '<option value="">未設定</option>';
  state.tags.forEach((t) => {
    const option = document.createElement('option');
    option.value = String(t.id);
    option.textContent = t.name;
    els.sessionTag.appendChild(option);
  });
}

async function onSaveSession(e) {
  e.preventDefault();
  const id = state.selectedSessionId;
  const session = await getById(state.db, 'sessions', id);
  const startTs = new Date(els.sessionStart.value).getTime();
  const endTs = new Date(els.sessionEnd.value).getTime();
  if (!(endTs > startTs)) {
    els.sessionError.textContent = '終了時刻は開始時刻より後にしてください。';
    return;
  }
  const pauseTotalSec = Number(session.pauseTotalSec || 0);
  const durationSec = Math.max(0, Math.floor((endTs - startTs) / 1000) - pauseTotalSec);
  await put(state.db, 'sessions', {
    ...session,
    startTs,
    endTs,
    pauseTotalSec,
    durationSec,
    memo: els.sessionMemo.value.trim(),
    tagId: els.sessionTag.value ? Number(els.sessionTag.value) : null
  });
  els.sessionDialog.close();
  await refreshAll();
}

async function onDeleteSession() {
  const id = state.selectedSessionId;
  if (!id) return;
  if (!confirm('この履歴を削除しますか？')) return;
  await remove(state.db, 'sessions', id);
  els.sessionDialog.close();
  await refreshAll();
}

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toLocalInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function registerSw() {
  if (!('serviceWorker' in navigator)) return;

  let hasReloadedForUpdate = false;
  let pendingWorker = null;

  const showBanner = () => {
    if (!els.swUpdateBanner) return;
    els.swUpdateBanner.classList.remove('hidden');
  };

  const requestActivation = () => {
    if (pendingWorker) {
      pendingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  };

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      registration.update().catch(() => {});

      if (registration.waiting) {
        pendingWorker = registration.waiting;
        showBanner();
      }

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            pendingWorker = registration.waiting || installingWorker;
            showBanner();
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloadedForUpdate) return;
        hasReloadedForUpdate = true;
        window.location.reload();
      });

      els.swUpdateReloadBtn?.addEventListener('click', requestActivation);
    })
    .catch((e) => console.warn('SW registration failed', e));
}
