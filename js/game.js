'use strict';
(() => {
  const LEVELS = window.JT_LEVELS;
  const $ = (s) => document.querySelector(s);
  const W = 360; // 遊戲邏輯寬度，高度依螢幕比例計算
  const SPEEDS = {
    easy: { time: 10, hp: 5 },
    normal: { time: 7, hp: 4 },
    hard: { time: 4.5, hp: 3 },
  };
  const NORMAL_QUESTIONS = 7; // 一局 10 題：7 題一般題 + 魔王 3 題
  const BOSS_HP = 3;
  const ROUND = NORMAL_QUESTIONS + BOSS_HP;
  const LANES = 3; // 每題飛出三顆水果
  const FRUIT_R = 48;
  const PENALTY = 50; // 切錯扣的分數
  const bossImg = new Image();
  bossImg.src = 'assets/boss.png?v=6';
  const JP_FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP","Noto Sans CJK JP","Meiryo",sans-serif';
  const ZH_FONT = '"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif';
  const SPEAKER_SVG = '<svg class="speaker" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

  // ---------- 存檔 ----------
  const SAVE_KEY = 'jt-save-v1';
  const save = { settings: { speed: 'normal', listening: false, sound: true, skipIntro: false, noKanji: false, skin: 'red' }, progress: {}, notebook: [], xp: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) { Object.assign(save.settings, s.settings); Object.assign(save.progress, s.progress); if (s.xp > 0) save.xp = Math.floor(s.xp); if (Array.isArray(s.notebook)) save.notebook = s.notebook.filter((it) => it && it.k && (it.r || it.z)); }
  } catch (e) { /* 沒有存檔或無法讀取時使用預設值 */ }
  if (!SPEEDS[save.settings.speed]) save.settings.speed = 'normal';
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 忽略 */ } };

  // ---------- 工具 ----------
  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const starsHtml = (n) => `<b>${'★'.repeat(n)}</b>${'★'.repeat(3 - n)}`;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 忍者造型與等級 ----------
  // sh/ss/sv：圍巾的色相與飽和度、亮度倍率；o：衣服的顏色調整。lv 為解鎖所需等級
  const SKINS = [
    { id: 'red', name: '紅蓮', lv: 1 },
    { id: 'blue', name: '蒼嵐', lv: 1, sh: 215 },
    { id: 'green', name: '翠風', lv: 1, sh: 140, sv: 0.9 },
    { id: 'purple', name: '紫電', lv: 2, sh: 280 },
    { id: 'gold', name: '黃金', lv: 3, sh: 45, ss: 0.9, sv: 1.25 },
    { id: 'white', name: '白雪', lv: 4, sh: 200, ss: 0.7, sv: 1.2, o: { s: 0.25, va: 0.42, vm: 1.25 } },
    { id: 'crimson', name: '赤鬼', lv: 5, sh: 48, sv: 1.3, o: { h: 355, s: 0.7, va: 0.12, vm: 1.5 } },
  ];
  const LEVEL_XP = [0, 1500, 4000, 8000, 14000]; // 升到各等級所需的累積分數
  const levelOf = (xp) => { let lv = 1; while (lv < LEVEL_XP.length && xp >= LEVEL_XP[lv]) lv++; return lv; };
  const skinById = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
  const currentSkin = () => { const k = skinById(save.settings.skin); return k.lv <= levelOf(save.xp) ? k : SKINS[0]; };
  function xpInfo(xp) {
    const lv = levelOf(xp); const max = lv >= LEVEL_XP.length;
    const lo = LEVEL_XP[lv - 1]; const hi = max ? lo : LEVEL_XP[lv];
    return { lv, max, ratio: max ? 1 : (xp - lo) / (hi - lo), text: max ? `累積 ${xp} 分・已達最高等級` : `累積 ${xp} 分・再 ${hi - xp} 分升級` };
  }

  // 忍者圖：5×2 格，依序為 待機、衝刺、跳躍、橫斬、上斬、月牙斬、迴旋斬、落地、架式、勝利
  const NINJA = { cw: 458, ch: 240, idle: 0, jump: 2, slashes: [3, 4, 5, 6], land: 7, guard: 8, win: 9 };
  const ninjaImg = new Image();
  const skinSheets = {};
  const hsv = (r, g, b) => {
    const mx = Math.max(r, g, b); const d = mx - Math.min(r, g, b);
    let h = 0;
    if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, mx ? d / mx : 0, mx / 255];
  };
  const rgb = (h, s, v) => {
    h = ((h % 360) + 360) % 360 / 60; const i = Math.floor(h); const f = h - i;
    const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [r * 255, g * 255, b * 255];
  };
  // 把畫布上的忍者換成指定造型的顏色
  function recolor(c, skin) {
    if (skin.sh === undefined) return;
    try {
      const x = c.getContext('2d'); const img = x.getImageData(0, 0, c.width, c.height); const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        let [h, sa, v] = hsv(d[i], d[i + 1], d[i + 2]);
        if ((h < 14 || h > 345) && sa > 0.55 && v > 0.2) { // 圍巾
          h = skin.sh; sa = Math.min(1, sa * (skin.ss || 1)); v = Math.min(1, v * (skin.sv || 1));
        } else if (skin.o && sa < 0.5 && v < 0.5 && v > 0.11 && h > 170 && h < 290) { // 衣服
          if (skin.o.h !== undefined) h = skin.o.h;
          sa = skin.o.s; v = Math.min(1, skin.o.va + v * skin.o.vm);
        } else continue;
        const [r, g, b] = rgb(h, sa, v);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      x.putImageData(img, 0, 0);
    } catch (e) { /* 直接開啟檔案時瀏覽器不允許讀取像素，維持原色 */ }
  }
  function skinSheet(skin) {
    if (!ninjaImg.naturalWidth) return null;
    if (!skinSheets[skin.id]) {
      const c = document.createElement('canvas'); c.width = ninjaImg.naturalWidth; c.height = ninjaImg.naturalHeight;
      c.getContext('2d').drawImage(ninjaImg, 0, 0);
      recolor(c, skin);
      skinSheets[skin.id] = c;
    }
    return skinSheets[skin.id];
  }
  // 在小畫布上畫出造型的待機姿勢
  function paintThumb(c, skin) {
    if (!ninjaImg.naturalWidth) return;
    c.width = c.height = 144;
    c.getContext('2d').drawImage(ninjaImg, 108, 0, 240, 240, 0, 0, 144, 144);
    recolor(c, skin);
  }
  function renderSkins() {
    const info = xpInfo(save.xp); const cur = currentSkin();
    $('#lvLabel').textContent = `忍者等級 Lv.${info.lv}`;
    $('#xpLabel').textContent = info.text;
    $('#xpBar').style.width = `${info.ratio * 100}%`;
    $('#skinList').innerHTML = SKINS.map((k) => {
      const locked = k.lv > info.lv;
      return `<button class="skin-card${k.id === cur.id ? ' on' : ''}${locked ? ' locked' : ''}" data-skin="${k.id}"${locked ? ' disabled' : ''}>
        <canvas data-thumb="${k.id}"></canvas><b>${k.name}</b><small>${locked ? `Lv.${k.lv} 解鎖` : k.id === cur.id ? '使用中' : '可使用'}</small></button>`;
    }).join('');
    document.querySelectorAll('#skinList [data-thumb]').forEach((c) => paintThumb(c, skinById(c.dataset.thumb)));
  }
  ninjaImg.onload = () => { if ($('#home').classList.contains('active')) renderSkins(); };
  ninjaImg.src = 'assets/ninja.png?v=6';

  // ---------- 筆記本 ----------
  const itemKey = (it) => (it.r ? `k:${it.k}` : `w:${it.j}|${it.k}`);
  const inNotebook = (it) => save.notebook.some((n) => itemKey(n) === itemKey(it));
  function setNotebook(it, on) {
    const has = inNotebook(it);
    if (on && !has) save.notebook.push(it.r ? { k: it.k, r: it.r } : { j: it.j, k: it.k, z: it.z });
    else if (!on && has) save.notebook = save.notebook.filter((n) => itemKey(n) !== itemKey(it));
    persist();
  }
  const ALL_ITEMS = LEVELS.flatMap((lv) => lv.stages.flatMap((st) => st.items));
  const NOTEBOOK_MIN = 3;

  // 單字列：mark 為 true/false 時顯示答對或答錯
  function wordRow(it, i, mark) {
    const on = inNotebook(it);
    const body = it.r
      ? `<span class="mj" lang="ja">${esc(it.k)}</span><span class="mz">${esc(it.r)}</span>`
      : `<span class="mj" lang="ja">${esc(it.j || it.k)}</span>${it.j ? `<span class="mk" lang="ja">${esc(it.k)}</span>` : ''}<span class="mz">${esc(it.z)}</span>`;
    return `<li class="${mark === false ? 'miss' : ''}">${mark === undefined ? '' : `<span class="mark">${mark ? '○' : '×'}</span>`}${body}`
      + `${synth && save.settings.sound ? `<button class="say-btn" data-say="${i}" aria-label="聽發音">${SPEAKER_SVG}</button>` : ''}`
      + `<button class="nb-btn${on ? ' on' : ''}" data-nb="${i}">${on ? '已加入' : '＋筆記'}</button></li>`;
  }
  // 綁定單字列表的點擊：發音與加入／移出筆記本
  function bindList(el, items, onChange) {
    el.onclick = (e) => {
      const sb = e.target.closest('[data-say]');
      if (sb) return say(items[+sb.dataset.say].k);
      const nb = e.target.closest('[data-nb]');
      if (nb) { const it = items[+nb.dataset.nb]; setNotebook(it, !inNotebook(it)); onChange(); }
    };
  }

  function renderNotebook() {
    const items = save.notebook.slice();
    const n = items.length;
    $('#notebookCount').textContent = n ? `共 ${n} 個` : '';
    $('#notebookEmpty').classList.toggle('hidden', n > 0);
    $('#notebookPlay').disabled = n < NOTEBOOK_MIN;
    $('#notebookHint').textContent = n < NOTEBOOK_MIN ? `至少要有 ${NOTEBOOK_MIN} 個字才能開始特訓` : `從筆記本出 ${ROUND} 題，速度與聽力依首頁設定`;
    const draw = () => { $('#notebookList').innerHTML = items.map((it, i) => wordRow(it, i)).join(''); };
    draw();
    // 在這個畫面取消後先保留在清單上，方便反悔；離開再回來才會消失
    bindList($('#notebookList'), items, () => {
      draw();
      const m = save.notebook.length;
      $('#notebookCount').textContent = m ? `共 ${m} 個` : '';
      $('#notebookPlay').disabled = m < NOTEBOOK_MIN;
      $('#notebookHint').textContent = m < NOTEBOOK_MIN ? `至少要有 ${NOTEBOOK_MIN} 個字才能開始特訓` : `從筆記本出 ${ROUND} 題，速度與聽力依首頁設定`;
    });
    show('notebook');
  }

  // ---------- 語音與音效 ----------
  const synth = window.speechSynthesis;
  let jaVoice = null;
  let voicesChecked = false;
  function findVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    if (vs.length) { voicesChecked = true; jaVoice = vs.find((v) => /^ja/i.test(v.lang)) || null; }
    refreshSettings();
  }
  const listeningAvailable = () => !!synth && !!jaVoice;
  function say(text) {
    if (!synth) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      if (jaVoice) u.voice = jaVoice;
      u.rate = 0.85;
      synth.speak(u);
    } catch (e) { /* 忽略 */ }
  }

  let actx = null;
  function tone(freq, start, dur, type, vol) {
    const o = actx.createOscillator(); const g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    const t = actx.currentTime + start;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  function sfx(name) {
    if (!save.settings.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      if (name === 'slice') { tone(1300, 0, 0.06, 'triangle', 0.07); tone(1900, 0.03, 0.07, 'triangle', 0.05); }
      else if (name === 'boom') { tone(110, 0, 0.35, 'sawtooth', 0.18); tone(70, 0.02, 0.5, 'square', 0.14); tone(45, 0.05, 0.6, 'sawtooth', 0.14); }
      else if (name === 'ok') { tone(660, 0, 0.1, 'triangle', 0.12); tone(990, 0.09, 0.16, 'triangle', 0.12); }
      else if (name === 'bad') { tone(200, 0, 0.25, 'sawtooth', 0.08); tone(150, 0.12, 0.25, 'sawtooth', 0.08); }
      else if (name === 'boss') { tone(220, 0, 0.2, 'square', 0.06); tone(196, 0.2, 0.2, 'square', 0.06); tone(175, 0.4, 0.35, 'square', 0.06); }
      else if (name === 'clear') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, 'triangle', 0.12));
      else if (name === 'over') [392, 330, 262].forEach((f, i) => tone(f, i * 0.2, 0.35, 'triangle', 0.1));
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 畫面切換與選單 ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('#' + id).scrollTop = 0;
  }

  function refreshSettings() {
    const st = save.settings;
    document.querySelectorAll('#speedSeg button').forEach((b) => b.classList.toggle('on', b.dataset.speed === st.speed));
    document.querySelectorAll('#soundSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.sound === 'on') === st.sound));
    $('#soundNote').textContent = st.sound ? '音效與日語發音' : '不會發出任何聲音';
    $('#kanjiToggle').setAttribute('aria-pressed', String(!!st.noKanji));
    const lt = $('#listenToggle');
    const avail = listeningAvailable();
    lt.disabled = !avail || !st.sound;
    lt.setAttribute('aria-pressed', String(avail && st.sound && st.listening));
    $('#listenNote').textContent = !st.sound ? '靜音模式下沒有聽力測驗'
      : avail || !voicesChecked && synth ? '混入「聽發音選答案」的題目' : '這個裝置沒有日語語音，無法使用';
  }

  function levelStars(level) {
    return level.stages.reduce((n, s) => n + ((save.progress[s.id] || {}).stars || 0), 0);
  }

  function renderHome() {
    $('#levelList').innerHTML = LEVELS.map((lv, i) => `
      <button class="level-card" data-level="${i}">
        <span class="level-icon${lv.icon.length > 1 ? ' small' : ''}" lang="ja">${lv.icon}</span>
        <span class="card-main"><div class="card-name">${lv.name}</div><div class="card-desc">${lv.desc}・${lv.stages.length} 關</div></span>
        <span class="card-side">★ ${levelStars(lv)}/${lv.stages.length * 3}</span>
      </button>`).join('');
    renderSkins();
    $('#notebookDesc').textContent = save.notebook.length ? `已收錄 ${save.notebook.length} 個字，可以用來特訓` : '過關後可以把想記的字加進來';
    refreshSettings();
  }

  let curLevel = 0;
  function renderStages(li) {
    curLevel = li;
    const lv = LEVELS[li];
    $('#stagesTitle').textContent = lv.name;
    $('#stageList').innerHTML = lv.stages.map((s, i) => {
      const p = save.progress[s.id] || {};
      return `
      <button class="stage-card" data-stage="${i}">
        <span class="stage-num">${i + 1}</span>
        <span class="card-main"><div class="card-name">${s.name}</div><div class="card-desc">${s.items.length} 個${lv.vocab ? '單字' : '假名'}${p.best ? `・最高 ${p.best} 分` : ''}</div></span>
        <span class="stars">${starsHtml(p.stars || 0)}</span>
      </button>`;
    }).join('');
    show('stages');
  }

  // ---------- 出題 ----------
  const HINTS = {
    k2r: '這個假名怎麼唸？', listen: '聽聽看，是哪一個？（點這裡再聽一次）',
    j2z: '是什麼意思？', z2j: '日文怎麼說？', k2y: '這個漢字怎麼唸？',
  };

  // noKanji：題目是中文時，選項只顯示假名，避免靠漢字猜出答案
  function buildQuestion(item, pool, n, listening, noKanji) {
    const isKana = !!item.r;
    let kind;
    if (listening && Math.random() < 0.3) kind = 'listen';
    else if (isKana) kind = 'k2r';
    else kind = pick(item.j ? ['j2z', 'z2j', 'k2y'] : ['j2z', 'z2j']);

    const opt = (it) => {
      if (isKana) return kind === 'listen' ? { main: it.k, ja: true } : { main: it.r };
      if (kind === 'j2z' || kind === 'listen') return { main: it.z };
      if (kind === 'z2j' && !noKanji) return { main: it.j || it.k, ruby: it.j ? it.k : '', ja: true };
      return { main: it.k, ja: true };
    };
    // 判斷兩個選項是否會讓人分不出來（例如聽力題的 を 與 お 發音相同）
    const key = (it) => {
      if (isKana) return kind === 'listen' ? (it.r === 'wo' ? 'o' : it.r) : it.r;
      if (kind === 'j2z') return it.z + '\u0001' + it.k;
      if (kind === 'listen') return it.k;
      return opt(it).main;
    };
    const seenKeys = new Set([key(item)]);
    const seenMain = new Set([opt(item).main]);
    const seenZ = new Set([item.z]);
    const options = [{ ...opt(item), correct: true }];
    for (const it of shuffle(pool)) {
      if (options.length >= n) break;
      if (it === item) continue;
      const o = opt(it);
      if (seenKeys.has(key(it)) || seenMain.has(o.main)) continue;
      if (!isKana && (seenZ.has(it.z) || it.k === item.k)) continue;
      seenKeys.add(key(it)); seenMain.add(o.main); seenZ.add(it.z);
      options.push(o);
    }
    const prompt = kind === 'listen' ? null
      : kind === 'z2j' ? { text: item.z, ja: false }
        : kind === 'k2y' ? { text: item.j, ja: true }
          : { text: item.k, ja: true };
    const reveal = isKana ? `${item.k} ＝ ${item.r}` : `${item.j ? `${item.j}（${item.k}）` : item.k} ＝ ${item.z}`;
    return { item, kind, options: shuffle(options), prompt, reveal };
  }

  // ---------- 遊戲狀態 ----------
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  let H = 560;
  let g = null; // 目前這一局

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    H = W * r.height / r.width;
  }
  const laneX = (i) => (i + 0.5) * W / LANES;

  // spec 為 { li, si }（一般關卡）或 { notebook: true }（筆記本特訓）
  function startGame(spec) {
    const sp = SPEEDS[save.settings.speed];
    let level = null; let stage;
    if (spec.notebook) stage = { id: 'notebook', name: '筆記本特訓', items: save.notebook.slice() };
    else { level = LEVELS[spec.li]; stage = level.stages[spec.si]; }
    // 抽出本局的題目；字數不足時重複出題補滿
    let plan = [];
    while (plan.length < ROUND) {
      const more = shuffle(stage.items);
      if (plan.length && more.length > 1 && more[0] === plan[plan.length - 1]) more.push(more.shift());
      plan = plan.concat(more);
    }
    plan = plan.slice(0, ROUND);
    show('game');
    resize();
    g = {
      spec, li: spec.li, si: spec.si, level, stage, sp,
      listening: save.settings.sound && save.settings.listening && listeningAvailable(),
      queue: plan.slice(0, NORMAL_QUESTIONS), bossQueue: plan.slice(NORMAL_QUESTIONS), retry: [],
      total: NORMAL_QUESTIONS, done: 0, log: [],
      phase: 'normal', bossHp: BOSS_HP, bossHurt: 0,
      hp: sp.hp, score: 0, combo: 0, mistakes: 0, shake: 0,
      particles: [], halves: [], blasts: [], floats: [], trail: [], wave: null, waves: 0,
      skin: currentSkin(),
      ninja: { x: W / 2, y: H - 14, state: 'idle', t: 0, face: 1, frame: NINJA.idle, sx: 0, sy: 0, tx: 0, ty: 0 },
      banner: { text: stage.name, t: 1.3 },
      clouds: Array.from({ length: 6 }, (_, i) => ({ x: Math.random() * W, y: i * 120 - 60, s: 0.6 + Math.random() * 0.7, v: 18 + Math.random() * 16 })),
      time: 0, paused: false, over: false,
      intro: !save.settings.skipIntro, // 開始前先顯示玩法說明
    };
    $('#introOverlay').classList.toggle('hidden', !g.intro);
    $('#pauseOverlay').classList.add('hidden');
    setPrompt(null);
    updateHud();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function updateHud() {
    $('#hearts').innerHTML = '♥'.repeat(Math.max(0, g.hp)) + `<s>${'♥'.repeat(g.sp.hp - Math.max(0, g.hp))}</s>`;
    const p = $('#progress');
    p.classList.toggle('boss', g.phase === 'boss');
    p.textContent = g.phase === 'boss' ? `魔王 ${Math.max(0, g.bossHp)}/${BOSS_HP}` : `${g.done}/${g.total}${g.combo >= 2 ? `　${g.combo} 連擊` : ''}`;
    $('#score').textContent = g.score;
  }

  function setPrompt(q, feedback) {
    const box = $('#promptBox'); const hint = $('#promptHint'); const text = $('#promptText');
    box.classList.remove('ok', 'bad', 'listen');
    text.className = 'prompt-text';
    text.removeAttribute('lang');
    if (!q) { hint.textContent = ''; text.textContent = ''; return; }
    if (feedback) {
      box.classList.add(feedback === 'ok' ? 'ok' : 'bad');
      hint.textContent = feedback === 'ok' ? '答對了！' : feedback === 'timeout' ? '來不及了！正確答案是' : '答錯了！正確答案是';
      text.textContent = q.reveal;
      text.lang = 'ja';
      text.classList.add(q.reveal.length > 9 ? 'small' : 'mid');
      return;
    }
    hint.textContent = HINTS[q.kind];
    if (q.kind === 'listen') { box.classList.add('listen'); text.innerHTML = SPEAKER_SVG; return; }
    text.textContent = q.prompt.text;
    if (q.prompt.ja) text.lang = 'ja';
    const len = q.prompt.text.length;
    if (len > 7) text.classList.add('small'); else if (len > 4) text.classList.add('mid');
  }

  function spawnWave(item) {
    // 錯誤選項從同類型的字裡挑；筆記本特訓時字可能不夠，改從整個題庫補
    const same = (it) => !!it.r === !!item.r;
    const pool = (g.spec.notebook ? g.stage.items.concat(ALL_ITEMS) : g.stage.items).filter(same);
    const q = buildQuestion(item, pool, LANES, g.listening, save.settings.noKanji);
    const boss = g.phase === 'boss';
    const top = boss ? 218 : 118; // 魔王戰時水果飛得比較低，不擋到魔王
    const order = shuffle([0, 1, 2]);
    const kinds = shuffle([0, 1, 2, 3, 4]);
    g.wave = {
      q, state: 'in', t: 0, rt: 0,
      dur: g.sp.time * (item.r ? 1 : 1.3) * (boss ? 0.85 : 1),
      fruits: q.options.map((o, i) => ({
        opt: o, lane: i, x0: laneX(i), x: laneX(i), y: H + 90, apex: top + Math.random() * 44,
        delay: order[i] * 0.13, ph: Math.random() * 6.28, kind: kinds[i], h: o.ruby ? 50 : 40,
        state: 'alive', live: false, vy: 0, rot: 0,
      })),
    };
    g.waves++;
    setPrompt(q);
    if (g.ninja.state === 'win') setNinja('idle');
    if (q.kind === 'listen') say(item.k);
  }

  function nextWave() {
    if (g.hp <= 0) return finish(false);
    if (g.phase === 'normal') {
      if (!g.queue.length) {
        g.phase = 'boss'; g.wave = null;
        g.banner = { text: '魔王出現了！', t: 1.6 };
        setPrompt(null); sfx('boss'); updateHud();
        return;
      }
      spawnWave(g.queue.shift());
    } else {
      if (g.bossHp <= 0) return finish(true);
      // 魔王優先考前面答錯的字
      spawnWave(g.retry.shift() || g.bossQueue.shift() || pick(g.stage.items));
    }
  }

  function burst(x, y, colors, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = (60 + Math.random() * 200) * (speed || 1);
      g.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, color: pick(colors), r: 3 + Math.random() * 4 });
    }
  }
  const float = (x, y, text, color) => g.floats.push({ x, y, text, color, life: 1 });

  // fruit 為被切到的水果、angle 為刀痕方向；時間到時 fruit 為 null
  function resolve(fruit, angle) {
    const w = g.wave;
    if (!w || w.state !== 'in') return;
    const ok = !!(fruit && fruit.opt.correct);
    const item = w.q.item;
    w.state = 'reveal';
    if (ok) {
      const gain = 100 + Math.round(50 * (1 - w.t / w.dur)) + Math.min(g.combo, 10) * 10;
      g.score += gain;
      g.combo++;
      fruit.state = 'gone';
      const F = FRUITS[fruit.kind];
      for (const side of [-1, 1]) {
        g.halves.push({
          x: fruit.x, y: fruit.y, kind: fruit.kind, a: angle, side,
          vx: -Math.sin(angle) * side * 110, vy: Math.cos(angle) * side * 110 - 140, rot: 0, vr: side * 3.5, life: 1.3,
        });
      }
      burst(fruit.x, fruit.y, [F.flesh, F.skin, '#ffffff'], 18);
      float(fruit.x, fruit.y - 30, `+${gain}`, '#2f9e58');
      w.fruits.forEach((f) => { if (f !== fruit) f.state = 'drop'; });
      if (g.phase === 'boss') {
        g.bossHp--; g.bossHurt = 0.5;
        burst(W / 2, 70, g.bossHp <= 0 ? ['#ffd24d', '#ff8fab'] : ['#ff8fab'], g.bossHp <= 0 ? 60 : 14);
      }
      w.rt = g.phase === 'boss' && g.bossHp <= 0 ? 1.6 : 1.0;
      sfx('ok');
      setPrompt(w.q, 'ok');
    } else {
      g.hp--; g.combo = 0; g.mistakes++;
      g.retry.push(item);
      if (fruit) { // 切錯：像炸彈一樣爆炸並扣分
        const lost = Math.min(PENALTY, g.score);
        g.score -= lost;
        fruit.state = 'gone';
        g.blasts.push({ x: fruit.x, y: fruit.y, t: 0 });
        burst(fruit.x, fruit.y, ['#ff922b', '#ffd43b', '#fa5252', '#495057', '#868e96'], 46, 1.6);
        float(fruit.x, fruit.y - 30, `-${lost}`, '#e03131');
        g.shake = 0.55;
        sfx('boom');
      } else { g.shake = 0.3; sfx('bad'); setNinja('hurt'); }
      w.fruits.forEach((f) => { if (f !== fruit) f.state = f.opt.correct ? 'answer' : 'faded'; });
      w.rt = 2.4;
      setPrompt(w.q, fruit ? 'bad' : 'timeout');
    }
    g.log.push({ item, ok });
    if (g.phase === 'normal') g.done++;
    if (save.settings.sound) say(item.k);
    updateHud();
  }

  // 忍者的動作：idle 待機 → fly 飛向水果 → slash 砍擊 → fall 落回地面 → land 落地 → win 擺姿勢
  // 砍錯時改為 hurt：被炸飛後落回地面
  function setNinja(state) { const n = g.ninja; n.state = state; n.t = 0; n.sx = n.x; n.sy = n.y; }
  // 忍者先飛到水果旁邊，飛到了才真正砍下去
  function strike(fruit, angle) {
    const w = g.wave;
    if (!w || w.state !== 'in') return;
    w.state = 'strike'; w.target = fruit; w.angle = angle;
    const n = g.ninja;
    n.face = fruit.x >= n.x ? 1 : -1;
    if (Math.abs(fruit.x - n.x) < 30) n.face = fruit.x >= W / 2 ? -1 : 1; // 正上方時從外側切入
    n.tx = fruit.x - n.face * 44; n.ty = fruit.y + 66;
    setNinja('fly');
    sfx('slice');
  }
  function updateNinja(dt) {
    const n = g.ninja; const homeY = H - 14;
    n.t += dt;
    const ease = (k) => 1 - Math.pow(1 - Math.min(1, k), 3);
    if (n.state === 'fly') {
      const k = ease(n.t / 0.17);
      n.x = n.sx + (n.tx - n.sx) * k; n.y = n.sy + (n.ty - n.sy) * k;
      n.frame = NINJA.jump;
      if (n.t >= 0.17) {
        const w = g.wave; const f = w.target; const ok = !!f.opt.correct;
        w.state = 'in';
        resolve(f, w.angle);
        n.frame = pick(NINJA.slashes);
        setNinja(ok ? 'slash' : 'hurt');
      }
    } else if (n.state === 'slash') {
      n.x += n.face * 60 * dt; n.y -= 30 * dt; // 砍過去時帶一點慣性
      if (n.t >= 0.3) setNinja('fall');
    } else if (n.state === 'fall') {
      const k = Math.min(1, n.t / 0.32);
      n.x = n.sx + (W / 2 - n.sx) * k; n.y = n.sy + (homeY - n.sy) * k * k;
      n.frame = NINJA.jump;
      if (k >= 1) setNinja('land');
    } else if (n.state === 'land') {
      n.frame = NINJA.land;
      if (n.t >= 0.2) setNinja('win');
    } else if (n.state === 'hurt') {
      const k = Math.min(1, n.t / 0.6);
      n.x = n.sx + (W / 2 - n.sx) * k; n.y = n.sy + (homeY - n.sy) * k * k - Math.sin(k * Math.PI) * 30;
      n.frame = NINJA.guard;
      if (k >= 1) setNinja('idle');
    } else {
      n.x = W / 2; n.y = homeY;
      n.frame = n.state === 'win' ? NINJA.win : NINJA.idle;
      if (n.state === 'idle') n.face = 1;
    }
  }

  // 檢查刀痕（線段）有沒有切到水果
  function trySlice(x1, y1, x2, y2) {
    const w = g.wave;
    if (!w || w.state !== 'in') return;
    const dx = x2 - x1; const dy = y2 - y1; const len2 = dx * dx + dy * dy;
    for (const f of w.fruits) {
      if (f.state !== 'alive' || !f.live) continue;
      const t = len2 ? Math.max(0, Math.min(1, ((f.x - x1) * dx + (f.y - y1) * dy) / len2)) : 0;
      const px = x1 + dx * t - f.x; const py = y1 + dy * t - f.y;
      if (px * px + py * py <= FRUIT_R * FRUIT_R) { strike(f, len2 > 4 ? Math.atan2(dy, dx) : -0.5); return; }
    }
  }

  function finish(win) {
    g.over = true;
    cancelAnimationFrame(raf);
    if (synth) { /* 讓最後一個字唸完，不取消 */ }
    const stars = !win ? 0 : g.mistakes === 0 ? 3 : g.mistakes <= 2 ? 2 : 1;
    const custom = !!g.spec.notebook;
    const p = save.progress[g.stage.id] || { stars: 0, best: 0 };
    const newBest = !custom && win && g.score > (p.best || 0);
    if (win && !custom) { p.stars = Math.max(p.stars || 0, stars); p.best = Math.max(p.best || 0, g.score); save.progress[g.stage.id] = p; persist(); }
    sfx(win ? 'clear' : 'over');
    // 本局得分累積成經驗值，升級時解鎖新造型
    const lvBefore = levelOf(save.xp);
    save.xp += g.score; persist();
    const info = xpInfo(save.xp);
    $('#resLv').textContent = `忍者等級 Lv.${info.lv}`;
    $('#resXp').textContent = `+${g.score} 分・${info.text.split('・')[1]}`;
    $('#resXpBar').style.width = `${info.ratio * 100}%`;
    const gained = SKINS.filter((k) => k.lv > lvBefore && k.lv <= info.lv);
    $('#levelUp').classList.toggle('hidden', info.lv === lvBefore);
    if (info.lv > lvBefore) {
      const newest = gained[gained.length - 1];
      $('#levelUp').innerHTML = `<canvas id="levelUpThumb"></canvas><div><b>升級到 Lv.${info.lv}！</b><span>獲得新造型「${gained.map((k) => k.name).join('」「')}」</span>`
        + `<button class="btn mini" id="wearBtn">換上「${newest.name}」</button></div>`;
      paintThumb($('#levelUpThumb'), newest);
      $('#wearBtn').onclick = () => { save.settings.skin = newest.id; persist(); $('#wearBtn').textContent = '已換上'; $('#wearBtn').disabled = true; };
    }

    $('#resultTitle').textContent = win ? '過關！' : '再挑戰一次吧';
    $('#resultStars').innerHTML = starsHtml(stars);
    $('#resultStars').classList.toggle('hidden', !win);
    $('#resultScore').textContent = g.score;
    $('#resultBest').textContent = custom ? '' : newBest ? '新紀錄！' : p.best ? `（最高 ${p.best}）` : '';

    // 本局出過的所有題目；同一個字出現多次時，只要錯過一次就標為答錯
    const rows = [];
    for (const { item, ok } of g.log) {
      const r = rows.find((x) => x.item === item);
      if (r) r.ok = r.ok && ok; else rows.push({ item, ok });
    }
    const items = rows.map((r) => r.item);
    const drawRows = () => {
      $('#roundList').innerHTML = rows.map((r, i) => wordRow(r.item, i, r.ok)).join('');
      const pending = rows.filter((r) => !r.ok && !inNotebook(r.item)).length;
      $('#addMissedBtn').classList.toggle('hidden', !pending);
      $('#addMissedBtn').textContent = `答錯的 ${pending} 個全部加入筆記本`;
    };
    drawRows();
    bindList($('#roundList'), items, drawRows);
    $('#addMissedBtn').onclick = () => { rows.forEach((r) => { if (!r.ok) setNotebook(r.item, true); }); drawRows(); };
    $('#roundWrap').classList.toggle('hidden', !rows.length);

    const hasNext = !!nextStage();
    $('#nextBtn').classList.toggle('hidden', !win || !hasNext);
    $('#retryBtn').classList.toggle('primary', !win || !hasNext);
    $('#menuBtn').textContent = custom ? '回筆記本' : '回選單';
    show('result');
  }

  function nextStage() {
    if (g.spec.notebook) return null;
    if (g.si + 1 < g.level.stages.length) return [g.li, g.si + 1];
    if (g.li + 1 < LEVELS.length) return [g.li + 1, 0];
    return null;
  }

  // ---------- 更新 ----------
  const RISE = 0.55; // 水果拋上來所花的秒數
  function update(dt) {
    g.time += dt;
    for (const c of g.clouds) { c.y += c.v * dt; if (c.y > H + 60) { c.y = -60; c.x = Math.random() * W; } }
    g.shake = Math.max(0, g.shake - dt); g.bossHurt = Math.max(0, g.bossHurt - dt);

    if (g.banner) {
      g.banner.t -= dt;
      if (g.banner.t <= 0) { g.banner = null; nextWave(); }
    }
    const w = g.wave;
    if (w) {
      const bottom = H + 90;
      if (w.state === 'in') {
        w.t += dt;
        // 水果先快速拋到最高點，再慢慢落下，倒數結束時剛好掉出畫面
        for (const f of w.fruits) {
          const tau = w.t - f.delay;
          if (tau <= 0) continue;
          if (tau < RISE) f.y = bottom + (f.apex - bottom) * (1 - Math.pow(1 - tau / RISE, 3));
          else f.y = f.apex + (bottom - f.apex) * Math.pow(Math.min(1, (tau - RISE) / (w.dur - f.delay - RISE)), 2.4);
          f.live = tau > 0.2 && f.y < H + FRUIT_R * 0.5;
        }
        if (w.t >= w.dur) resolve(null);
      } else if (w.state !== 'strike') { // 忍者飛過去的瞬間時間暫停
        for (const f of w.fruits) if (f.state === 'drop') { f.vy += 1500 * dt; f.y += f.vy * dt; }
        w.rt -= dt;
        if (w.rt <= 0) { g.wave = null; nextWave(); }
      }
      for (const f of w.fruits) { f.x = f.x0 + Math.sin(g.time * 1.2 + f.ph) * 7; f.rot = Math.sin(g.time * 1.6 + f.ph) * 0.18; }
    }
    if (g.over) return;
    updateNinja(dt);
    if (g.over) return;
    for (const h of g.halves) { h.x += h.vx * dt; h.y += h.vy * dt; h.vy += 900 * dt; h.rot += h.vr * dt; h.life -= dt; }
    g.halves = g.halves.filter((h) => h.life > 0);
    for (const p of g.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    g.particles = g.particles.filter((p) => p.life > 0);
    for (const b of g.blasts) b.t += dt;
    g.blasts = g.blasts.filter((b) => b.t < 0.6);
    for (const f of g.floats) { f.y -= 40 * dt; f.life -= dt; }
    g.floats = g.floats.filter((f) => f.life > 0);
    for (const t of g.trail) t.life -= dt;
    g.trail = g.trail.filter((t) => t.life > 0);
  }

  // ---------- 繪圖 ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fit(text, maxW, size, family) {
    for (; size > 10; size--) { ctx.font = `800 ${size}px ${family}`; if (ctx.measureText(text).width <= maxW) break; }
    ctx.font = `800 ${size}px ${family}`;
  }
  function star(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }
  function cloud(x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath();
    ctx.arc(x, y, 18 * s, 0, 7); ctx.arc(x + 20 * s, y - 8 * s, 22 * s, 0, 7); ctx.arc(x + 44 * s, y, 18 * s, 0, 7);
    ctx.fill();
    rr(x - 4 * s, y, 52 * s, 18 * s, 9 * s); ctx.fill();
  }

  // 蘋果、橘子、西瓜、水蜜桃、檸檬
  const FRUITS = [
    { skin: '#ff6b6b', edge: '#e64980', flesh: '#fff3d6' },
    { skin: '#ffa94d', edge: '#f08c00', flesh: '#ffe0a8' },
    { skin: '#69c779', edge: '#37a15a', flesh: '#ff7b8f', stripes: true },
    { skin: '#ffb3c7', edge: '#f783ac', flesh: '#fff0c9' },
    { skin: '#ffe066', edge: '#f5c211', flesh: '#fffbe0' },
  ];
  function drawFruit(f) {
    const F = FRUITS[f.kind]; const r = FRUIT_R;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.globalAlpha = f.state === 'faded' ? 0.3 : 1;
    if (f.state === 'answer') { // 正確答案外面加一圈光
      ctx.strokeStyle = `rgba(79,195,122,${0.6 + 0.4 * Math.sin(g.time * 10)})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, 7); ctx.stroke();
    }
    ctx.save();
    ctx.rotate(f.rot);
    ctx.strokeStyle = '#8a5a3b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -r + 3); ctx.lineTo(3, -r - 9); ctx.stroke();
    ctx.fillStyle = '#69c779'; ctx.beginPath(); ctx.ellipse(13, -r - 6, 10, 5, -0.5, 0, 7); ctx.fill();
    ctx.fillStyle = F.skin; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    if (F.stripes) {
      ctx.save(); ctx.clip();
      ctx.strokeStyle = F.edge; ctx.lineWidth = 7;
      for (const x of [-r * 0.6, 0, r * 0.6]) { ctx.beginPath(); ctx.moveTo(x, -r); ctx.quadraticCurveTo(x * 1.7, 0, x, r); ctx.stroke(); }
      ctx.restore();
    }
    ctx.strokeStyle = F.edge; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r - 1.5, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(-r * 0.42, -r * 0.5, r * 0.24, r * 0.13, -0.6, 0, 7); ctx.fill();
    ctx.restore();
    // 答案牌保持水平，方便閱讀
    const pw = 104; const ph = f.h; const answer = f.state === 'answer';
    ctx.fillStyle = 'rgba(74,64,99,.18)'; rr(-pw / 2, -ph / 2 + 3, pw, ph, 12); ctx.fill();
    ctx.fillStyle = answer ? '#e4fbea' : '#fff'; rr(-pw / 2, -ph / 2, pw, ph, 12); ctx.fill();
    if (answer) { ctx.strokeStyle = '#4fc37a'; ctx.lineWidth = 3; rr(-pw / 2, -ph / 2, pw, ph, 12); ctx.stroke(); }
    ctx.fillStyle = '#4a4063'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fam = f.opt.ja ? JP_FONT : ZH_FONT;
    if (f.opt.ruby) {
      fit(f.opt.ruby, pw - 8, 12, fam); ctx.fillStyle = '#8a80a3'; ctx.fillText(f.opt.ruby, 0, -ph / 2 + 12);
      fit(f.opt.main, pw - 10, 22, fam); ctx.fillStyle = '#4a4063'; ctx.fillText(f.opt.main, 0, -ph / 2 + 33);
    } else {
      fit(f.opt.main, pw - 10, f.opt.ja ? 22 : 20, fam); ctx.fillText(f.opt.main, 0, 1);
    }
    ctx.restore();
  }
  function drawHalf(h) {
    const F = FRUITS[h.kind]; const a0 = h.side > 0 ? 0 : Math.PI;
    ctx.save();
    ctx.translate(h.x, h.y); ctx.rotate(h.a + h.rot);
    ctx.globalAlpha = Math.min(1, h.life * 2);
    ctx.fillStyle = F.skin; ctx.beginPath(); ctx.arc(0, 0, FRUIT_R, a0, a0 + Math.PI); ctx.closePath(); ctx.fill();
    ctx.fillStyle = F.flesh; ctx.beginPath(); ctx.arc(0, 0, FRUIT_R - 7, a0, a0 + Math.PI); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawBlast(b) {
    const k = b.t / 0.6;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ff922b'; ctx.lineWidth = 10 * (1 - k) + 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 24 + k * 170, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, 10 + k * 110, 0, 7); ctx.stroke();
    if (b.t < 0.25) {
      const c = 1 - b.t / 0.25;
      ctx.globalAlpha = c;
      ctx.fillStyle = '#fff3bf'; ctx.beginPath(); ctx.arc(b.x, b.y, 30 + (1 - c) * 60, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function drawTrail() {
    const t = g.trail;
    ctx.lineCap = 'round';
    for (let i = 1; i < t.length; i++) {
      if (t[i].start) continue;
      const k = Math.max(0, t[i].life / 0.22);
      ctx.strokeStyle = `rgba(247,106,140,${0.35 * k})`; ctx.lineWidth = 14 * k;
      ctx.beginPath(); ctx.moveTo(t[i - 1].x, t[i - 1].y); ctx.lineTo(t[i].x, t[i].y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 6 * k;
      ctx.beginPath(); ctx.moveTo(t[i - 1].x, t[i - 1].y); ctx.lineTo(t[i].x, t[i].y); ctx.stroke();
    }
  }

  function drawNinja() {
    const n = g.ninja; const sheet = skinSheet(g.skin);
    const air = n.state === 'fly' || n.state === 'slash' || n.state === 'fall' || n.state === 'hurt';
    const dh = n.state === 'slash' ? 132 : 112; const dw = dh * NINJA.cw / NINJA.ch;
    if (!air) { // 站在地上時的影子
      ctx.fillStyle = 'rgba(74,64,99,.18)'; ctx.beginPath(); ctx.ellipse(n.x, H - 12, 34, 7, 0, 0, 7); ctx.fill();
    }
    if (n.state === 'hurt' && Math.floor(g.time * 18) % 2) return;
    ctx.save();
    ctx.translate(n.x, n.y + (n.state === 'idle' ? Math.sin(g.time * 3) * 1.5 : 0));
    if (n.state === 'hurt') { ctx.translate(0, -50); ctx.rotate(n.t * 9 * -n.face); ctx.translate(0, 50); }
    ctx.scale(n.face, 1);
    if (sheet) {
      ctx.drawImage(sheet, (n.frame % 5) * NINJA.cw, Math.floor(n.frame / 5) * NINJA.ch, NINJA.cw, NINJA.ch, -dw / 2, -dh * 0.93, dw, dh);
    } else { // 圖片還沒載入時的替代圖形
      ctx.fillStyle = '#4a4063'; ctx.beginPath(); ctx.arc(0, -40, 22, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  function drawBoss() {
    const hurt = g.bossHurt > 0;
    const x = W / 2 + (hurt ? Math.sin(g.time * 60) * 5 : 0); const y = 70 + Math.sin(g.time * 2) * 4;
    const bw = 168; const bh = bossImg.naturalWidth ? bw * bossImg.naturalHeight / bossImg.naturalWidth : 105;
    if (bossImg.naturalWidth) {
      ctx.save();
      if (hurt && Math.floor(g.time * 20) % 2) ctx.globalAlpha = 0.45;
      ctx.drawImage(bossImg, x - bw / 2, y - bh / 2, bw, bh);
      ctx.restore();
    } else { // 圖片還沒載入時的替代圖形
      ctx.fillStyle = '#b79cf2'; ctx.beginPath(); ctx.ellipse(x, y, 58, 46, 0, 0, 7); ctx.fill();
    }
    // 血條
    const w = 120; const by = 70 + bh / 2 + 10;
    ctx.fillStyle = 'rgba(74,64,99,.2)'; rr(W / 2 - w / 2, by, w, 10, 5); ctx.fill();
    const ratio = Math.max(0, g.bossHp) / BOSS_HP;
    if (ratio > 0) { ctx.fillStyle = '#f76a8c'; rr(W / 2 - w / 2, by, Math.max(10, w * ratio), 10, 5); ctx.fill(); }
  }

  function draw() {
    const scale = canvas.width / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#a9d8ff'); sky.addColorStop(1, '#ffe3ee');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    for (const c of g.clouds) cloud(c.x, c.y, c.s);

    const w = g.wave;
    if (w && w.state === 'in' && 1 - w.t / w.dur < 0.3) { // 時間快到時畫面閃紅
      ctx.fillStyle = `rgba(247,106,140,${0.25 * (0.5 + 0.5 * Math.sin(g.time * 14))})`; ctx.fillRect(0, 0, W, H);
    }
    if (w && w.state === 'in') { // 大大的倒數秒數，淡淡地印在背景裡
      const left = Math.max(0, w.dur - w.t); const urgent = left <= 3;
      const pulse = urgent ? 1 + 0.08 * Math.abs(Math.sin(g.time * 6)) : 1;
      ctx.font = `800 ${Math.round(230 * pulse)}px ${ZH_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = urgent ? 'rgba(240,62,110,.42)' : 'rgba(74,64,99,.17)';
      ctx.fillText(String(Math.ceil(left)), W / 2, H * 0.62);
    }
    if (g.phase === 'boss' && !(g.bossHp <= 0 && g.bossHurt <= 0)) drawBoss();
    for (const h of g.halves) drawHalf(h);
    if (w) for (const f of w.fruits) if (f.state !== 'gone' && f.y < H + FRUIT_R + 20) drawFruit(f);
    for (const p of g.particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); star(p.x, p.y, p.r, p.color); }
    ctx.globalAlpha = 1;
    for (const b of g.blasts) {
      drawBlast(b);
      if (b.t < 0.18) { ctx.fillStyle = `rgba(255,120,60,${0.4 * (1 - b.t / 0.18)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
    }
    drawNinja();
    drawTrail();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of g.floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = `800 24px ${ZH_FONT}`;
      ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    if (g.banner) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; rr(40, H / 2 - 44, W - 80, 76, 22); ctx.fill();
      ctx.fillStyle = '#f76a8c';
      fit(g.banner.text, W - 110, 26, ZH_FONT.replace('sans-serif', JP_FONT));
      ctx.fillText(g.banner.text, W / 2, H / 2 - 6);
    }
  }

  // 倒數計時：剩餘秒數與進度條
  function updateTimer() {
    const w = g.wave; const on = !!w && w.state === 'in';
    const el = $('#timer');
    el.classList.toggle('hidden', !on);
    if (!on) { $('#timerBar').style.width = '0'; return; }
    const left = Math.max(0, w.dur - w.t);
    const secs = String(Math.ceil(left));
    if ($('#timerNum').textContent !== secs) $('#timerNum').textContent = secs;
    el.classList.toggle('urgent', left <= 3);
    $('#timerBar').style.width = `${left / w.dur * 100}%`;
    $('#timerBar').classList.toggle('urgent', left <= 3);
  }

  let raf = 0; let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!g.paused && !g.intro) update(dt);
    if (g.over) return;
    draw();
    updateTimer();
    raf = requestAnimationFrame(loop);
  }

  function setPaused(p) {
    if (!g || g.over || g.intro) return;
    g.paused = p;
    if (p && synth) synth.cancel();
    $('#pauseOverlay').classList.toggle('hidden', !p);
  }

  // ---------- 輸入 ----------
  const toPt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.width * W }; };
  let blade = null; // 手指或滑鼠按著時的上一個位置
  canvas.addEventListener('pointerdown', (e) => {
    if (!g || g.paused || g.over || g.intro) return;
    blade = toPt(e);
    g.trail.push({ ...blade, life: 0.22, start: true });
    trySlice(blade.x, blade.y, blade.x, blade.y);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!blade || !g || g.paused || g.over) return;
    const p = toPt(e);
    g.trail.push({ ...p, life: 0.22 });
    trySlice(blade.x, blade.y, p.x, p.y);
    blade = p;
  });
  const release = () => { blade = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (!g || g.over || !$('#game').classList.contains('active')) return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { setPaused(!g.paused); return; }
    if (g.paused || g.intro) return;
    const w = g.wave;
    if (/^[1-3]$/.test(e.key)) {
      const f = w && w.state === 'in' && w.fruits[+e.key - 1];
      if (f && f.state === 'alive' && f.live) strike(f, -0.5);
    } else if (e.key === 'r' || e.key === 'R') { if (w && w.q.kind === 'listen') say(w.q.item.k); } else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (g && !g.over) resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && g && !g.over && $('#game').classList.contains('active')) setPaused(true); });

  // ---------- 按鈕 ----------
  $('#speedSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]'); if (!b) return;
    save.settings.speed = b.dataset.speed; persist(); refreshSettings();
  });
  $('#listenToggle').addEventListener('click', () => {
    save.settings.listening = !save.settings.listening; persist(); refreshSettings();
    if (save.settings.listening) say('こんにちは');
  });
  $('#skinList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-skin]'); if (!b || b.disabled) return;
    save.settings.skin = b.dataset.skin; persist(); renderSkins();
  });
  $('#kanjiToggle').addEventListener('click', () => { save.settings.noKanji = !save.settings.noKanji; persist(); refreshSettings(); });
  $('#soundSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sound]'); if (!b) return;
    save.settings.sound = b.dataset.sound === 'on'; persist(); refreshSettings();
    if (save.settings.sound) sfx('ok'); else if (synth) synth.cancel();
  });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) renderStages(+b.dataset.level); });
  $('#stageList').addEventListener('click', (e) => { const b = e.target.closest('[data-stage]'); if (b) startGame({ li: curLevel, si: +b.dataset.stage }); });
  $('#stagesBack').addEventListener('click', () => { renderHome(); show('home'); });
  const closeIntro = (never) => {
    if (never) { save.settings.skipIntro = true; persist(); }
    g.intro = false; last = performance.now();
    $('#introOverlay').classList.add('hidden');
    sfx('ok'); // 順便在使用者點擊時啟用音效
  };
  $('#introStart').addEventListener('click', () => closeIntro(false));
  $('#introNever').addEventListener('click', () => closeIntro(true));
  $('#pauseBtn').addEventListener('click', () => setPaused(true));
  $('#resumeBtn').addEventListener('click', () => { setPaused(false); last = performance.now(); });
  $('#restartBtn').addEventListener('click', () => startGame(g.spec));
  const leave = () => (g.spec.notebook ? renderNotebook() : renderStages(g.li));
  $('#quitBtn').addEventListener('click', () => { g.over = true; cancelAnimationFrame(raf); if (synth) synth.cancel(); leave(); });
  $('#promptBox').addEventListener('click', () => { if (g && g.wave && g.wave.state === 'in' && g.wave.q.kind === 'listen') say(g.wave.q.item.k); });
  $('#retryBtn').addEventListener('click', () => startGame(g.spec));
  $('#nextBtn').addEventListener('click', () => { const n = nextStage(); if (n) startGame({ li: n[0], si: n[1] }); });
  $('#menuBtn').addEventListener('click', leave);
  $('#notebookCard').addEventListener('click', renderNotebook);
  $('#notebookBack').addEventListener('click', () => { renderHome(); show('home'); });
  $('#notebookPlay').addEventListener('click', () => { if (save.notebook.length >= NOTEBOOK_MIN) startGame({ notebook: true }); });

  if (synth) {
    findVoice();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', findVoice);
    setTimeout(() => { voicesChecked = true; findVoice(); }, 1500);
  } else voicesChecked = true;
  renderHome();
  window.__jt = { get state() { return g; }, buildQuestion, save };
})();
