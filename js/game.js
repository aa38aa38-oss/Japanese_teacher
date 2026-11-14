'use strict';
(() => {
  const LEVELS = window.JT_LEVELS;
  const $ = (s) => document.querySelector(s);
  const W = 360; // 遊戲邏輯寬度，高度依螢幕比例計算
  const SPEEDS = {
    easy: { time: 10, hp: 5, lanes: 3 },
    normal: { time: 7, hp: 4, lanes: 3 },
    hard: { time: 4.5, hp: 3, lanes: 4 },
  };
  const MAX_QUESTIONS = 20;
  const BOSS_HP = 5;
  const JP_FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP","Noto Sans CJK JP","Meiryo",sans-serif';
  const ZH_FONT = '"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif';
  const SPEAKER_SVG = '<svg class="speaker" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

  // ---------- 存檔 ----------
  const SAVE_KEY = 'jt-save-v1';
  const save = { settings: { speed: 'normal', listening: false, sound: true }, progress: {} };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) { Object.assign(save.settings, s.settings); Object.assign(save.progress, s.progress); }
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
      if (name === 'shoot') tone(880, 0, 0.08, 'square', 0.04);
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
    const lt = $('#listenToggle');
    const avail = listeningAvailable();
    lt.disabled = !avail;
    lt.setAttribute('aria-pressed', String(avail && st.listening));
    $('#listenNote').textContent = avail || !voicesChecked && synth
      ? '混入「聽發音選答案」的題目'
      : '這個裝置沒有日語語音，無法使用';
    $('#soundToggle').setAttribute('aria-pressed', String(st.sound));
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

  function buildQuestion(item, pool, n, listening) {
    const isKana = !!item.r;
    let kind;
    if (listening && Math.random() < 0.3) kind = 'listen';
    else if (isKana) kind = 'k2r';
    else kind = pick(item.j ? ['j2z', 'z2j', 'k2y'] : ['j2z', 'z2j']);

    const opt = (it) => {
      if (isKana) return kind === 'listen' ? { main: it.k, ja: true } : { main: it.r };
      if (kind === 'j2z' || kind === 'listen') return { main: it.z };
      if (kind === 'z2j') return { main: it.j || it.k, ruby: it.j ? it.k : '', ja: true };
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
  const keys = { left: false, right: false };

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    H = W * r.height / r.width;
  }
  const planeY = () => H - 62;
  const laneW = () => W / g.lanes;
  const laneOf = (x) => Math.max(0, Math.min(g.lanes - 1, Math.floor(x / laneW())));
  const laneX = (i) => (i + 0.5) * laneW();

  function startStage(li, si) {
    const level = LEVELS[li]; const stage = level.stages[si];
    const sp = SPEEDS[save.settings.speed];
    const queue = shuffle(stage.items).slice(0, MAX_QUESTIONS);
    show('game');
    resize();
    g = {
      li, si, level, stage, sp,
      lanes: sp.lanes,
      listening: save.settings.listening && listeningAvailable(),
      dur: sp.time * (level.vocab ? 1.3 : 1),
      queue, total: queue.length, done: 0,
      phase: 'normal', bossHp: BOSS_HP, bossHurt: 0, bossPool: [],
      hp: sp.hp, score: 0, combo: 0, mistakes: 0, missed: new Map(),
      px: W / 2, tx: W / 2, pendingFire: false, cool: 0, hurt: 0, shake: 0,
      bullets: [], particles: [], wave: null, waves: 0,
      banner: { text: stage.name, t: 1.3 },
      clouds: Array.from({ length: 6 }, (_, i) => ({ x: Math.random() * W, y: i * 120 - 60, s: 0.6 + Math.random() * 0.7, v: 18 + Math.random() * 16 })),
      time: 0, paused: false, over: false,
    };
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
    const pool = g.stage.items;
    const q = buildQuestion(item, pool, g.lanes, g.listening);
    const boss = g.phase === 'boss';
    const startY = boss ? 176 : 44;
    g.wave = {
      q, state: 'in', t: 0, rt: 0,
      dur: g.dur * (boss ? 0.85 : 1),
      startY, endY: planeY() - 118,
      enemies: q.options.map((o, i) => ({ opt: o, lane: i, x: laneX(i), y: startY, h: o.ruby ? 52 : 44, look: (g.waves * 3 + i) % 4, state: 'alive', vy: 0, pop: 0 })),
    };
    g.waves++;
    g.bullets.length = 0;
    setPrompt(q);
    if (q.kind === 'listen') say(item.k);
  }

  function nextWave() {
    if (g.hp <= 0) return finish(false);
    if (g.phase === 'normal') {
      if (!g.queue.length) {
        g.phase = 'boss'; g.wave = null;
        const missed = [...g.missed.keys()];
        g.bossPool = [...shuffle(g.stage.items.filter((it) => !g.missed.has(it))), ...shuffle(missed)];
        g.banner = { text: '魔王出現了！', t: 1.6 };
        setPrompt(null); sfx('boss'); updateHud();
        return;
      }
      spawnWave(g.queue.shift());
    } else {
      if (g.bossHp <= 0) return finish(true);
      if (!g.bossPool.length) g.bossPool = shuffle(g.stage.items);
      spawnWave(g.bossPool.pop());
    }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = 60 + Math.random() * 200;
      g.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, color, r: 3 + Math.random() * 4 });
    }
  }

  // enemy 為被打中的敵人；時間到時為 null
  function resolve(enemy) {
    const w = g.wave;
    if (!w || w.state !== 'in') return;
    const ok = !!enemy && enemy.opt.correct;
    const item = w.q.item;
    w.state = 'reveal';
    if (ok) {
      g.score += 100 + Math.round(50 * (1 - w.t / w.dur)) + Math.min(g.combo, 10) * 10;
      g.combo++;
      enemy.state = 'dead';
      burst(enemy.x, enemy.y, '#ffd24d', 16);
      w.enemies.forEach((e) => { if (e !== enemy) { e.state = 'flee'; e.vy = -260; } });
      if (g.phase === 'boss') {
        g.bossHp--; g.bossHurt = 0.5;
        burst(W / 2, 70, '#c9a4ff', g.bossHp <= 0 ? 60 : 14);
      } else g.done++;
      w.rt = g.phase === 'boss' && g.bossHp <= 0 ? 1.6 : 1.0;
      sfx('ok');
      setPrompt(w.q, 'ok');
    } else {
      g.hp--; g.combo = 0; g.mistakes++;
      g.hurt = 0.6; g.shake = 0.35;
      g.missed.set(item, (g.missed.get(item) || 0) + 1);
      // 答錯的題目稍後再出現一次，直到答對為止
      if (g.phase === 'normal') g.queue.splice(Math.min(g.queue.length, 2 + Math.floor(Math.random() * 2)), 0, item);
      w.enemies.forEach((e) => { e.state = e.opt.correct ? 'answer' : e === enemy ? 'wrong' : 'faded'; });
      w.rt = 2.4;
      sfx('bad');
      setPrompt(w.q, enemy ? 'bad' : 'timeout');
    }
    if (save.settings.sound) say(item.k);
    updateHud();
  }

  function fire() {
    if (g.cool > 0 || !g.wave || g.wave.state !== 'in') return;
    g.cool = 0.28;
    g.bullets.push({ x: g.px, y: planeY() - 26, lane: laneOf(g.px) });
    sfx('shoot');
  }

  function finish(win) {
    g.over = true;
    cancelAnimationFrame(raf);
    if (synth) { /* 讓最後一個字唸完，不取消 */ }
    const stars = !win ? 0 : g.mistakes === 0 ? 3 : g.mistakes <= 2 ? 2 : 1;
    const p = save.progress[g.stage.id] || { stars: 0, best: 0 };
    const newBest = win && g.score > (p.best || 0);
    if (win) { p.stars = Math.max(p.stars || 0, stars); p.best = Math.max(p.best || 0, g.score); save.progress[g.stage.id] = p; persist(); }
    sfx(win ? 'clear' : 'over');

    $('#resultTitle').textContent = win ? '過關！' : '再挑戰一次吧';
    $('#resultStars').innerHTML = starsHtml(stars);
    $('#resultStars').classList.toggle('hidden', !win);
    $('#resultScore').textContent = g.score;
    $('#resultBest').textContent = newBest ? '新紀錄！' : p.best ? `（最高 ${p.best}）` : '';
    const missed = [...g.missed.keys()];
    $('#missWrap').classList.toggle('hidden', !missed.length);
    $('#missList').innerHTML = missed.map((it, i) => {
      const body = it.r
        ? `<span class="mj" lang="ja">${esc(it.k)}</span><span class="mz">${esc(it.r)}</span>`
        : `<span class="mj" lang="ja">${esc(it.j || it.k)}</span>${it.j ? `<span class="mk" lang="ja">${esc(it.k)}</span>` : ''}<span class="mz">${esc(it.z)}</span>`;
      return `<li>${body}${synth ? `<button data-say="${i}" aria-label="聽發音">${SPEAKER_SVG}</button>` : ''}</li>`;
    }).join('');
    $('#missList').onclick = (e) => { const b = e.target.closest('[data-say]'); if (b) say(missed[+b.dataset.say].k); };
    const hasNext = !!nextStage();
    $('#nextBtn').classList.toggle('hidden', !win || !hasNext);
    $('#retryBtn').classList.toggle('primary', !win || !hasNext);
    show('result');
  }

  function nextStage() {
    if (g.si + 1 < g.level.stages.length) return [g.li, g.si + 1];
    if (g.li + 1 < LEVELS.length) return [g.li + 1, 0];
    return null;
  }

  // ---------- 更新 ----------
  function update(dt) {
    g.time += dt;
    for (const c of g.clouds) { c.y += c.v * dt; if (c.y > H + 60) { c.y = -60; c.x = Math.random() * W; } }
    if (keys.left !== keys.right) { g.px += (keys.left ? -1 : 1) * 380 * dt; g.tx = g.px; }
    else if (g.px !== g.tx) {
      const step = 1500 * dt; const d = g.tx - g.px;
      g.px = Math.abs(d) <= step ? g.tx : g.px + Math.sign(d) * step;
    }
    g.px = Math.max(22, Math.min(W - 22, g.px));
    g.tx = Math.max(22, Math.min(W - 22, g.tx));
    g.cool -= dt; g.hurt = Math.max(0, g.hurt - dt); g.shake = Math.max(0, g.shake - dt); g.bossHurt = Math.max(0, g.bossHurt - dt);
    if (g.pendingFire && Math.abs(g.px - g.tx) < 1) { g.pendingFire = false; fire(); }

    if (g.banner) {
      g.banner.t -= dt;
      if (g.banner.t <= 0) { g.banner = null; nextWave(); }
    }
    const w = g.wave;
    if (w) {
      for (const e of w.enemies) e.pop = Math.min(1, e.pop + dt * 5);
      if (w.state === 'in') {
        w.t += dt;
        const y = w.startY + (w.endY - w.startY) * Math.min(1, w.t / w.dur);
        for (const e of w.enemies) e.y = y;
        for (const b of g.bullets) {
          b.y -= 1100 * dt;
          const e = w.enemies[b.lane];
          if (!b.dead && b.y <= e.y + e.h) { b.dead = true; resolve(e); break; }
        }
        if (w.state === 'in' && w.t >= w.dur) resolve(null);
      } else {
        for (const e of w.enemies) if (e.state === 'flee') { e.vy -= 900 * dt; e.y += e.vy * dt; }
        for (const b of g.bullets) b.y -= 1100 * dt;
        w.rt -= dt;
        if (w.rt <= 0) { g.wave = null; nextWave(); }
      }
    }
    if (g.over) return;
    g.bullets = g.bullets.filter((b) => !b.dead && b.y > -20);
    for (const p of g.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    g.particles = g.particles.filter((p) => p.life > 0);
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
  const BLOBS = ['#ff9fb6', '#8fd9a8', '#8ec5ff', '#ffc866'];
  function face(x, y, s, mood) {
    ctx.fillStyle = '#4a4063';
    if (mood === 'dizzy') {
      ctx.strokeStyle = '#4a4063'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
      for (const dx of [-7, 7]) {
        ctx.beginPath(); ctx.moveTo(x + (dx - 3) * s, y - 3 * s); ctx.lineTo(x + (dx + 3) * s, y + 3 * s);
        ctx.moveTo(x + (dx + 3) * s, y - 3 * s); ctx.lineTo(x + (dx - 3) * s, y + 3 * s); ctx.stroke();
      }
    } else {
      ctx.beginPath(); ctx.arc(x - 7 * s, y, 2.8 * s, 0, 7); ctx.arc(x + 7 * s, y, 2.8 * s, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - 6 * s, y - 1 * s, 1 * s, 0, 7); ctx.arc(x + 8 * s, y - 1 * s, 1 * s, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,110,140,.45)';
    ctx.beginPath(); ctx.arc(x - 13 * s, y + 5 * s, 3.5 * s, 0, 7); ctx.arc(x + 13 * s, y + 5 * s, 3.5 * s, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4a4063'; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
    ctx.beginPath();
    if (mood === 'happy') ctx.arc(x, y + 3 * s, 4 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.arc(x, y + 8 * s, 3 * s, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
  }

  function drawEnemy(e, targeted) {
    const cw = laneW() - 10;
    const s = 0.4 + 0.6 * e.pop;
    const wob = Math.sin(g.time * 3 + e.lane * 1.7) * 3;
    const shake = e.state === 'wrong' ? Math.sin(g.time * 50) * 3 : 0;
    ctx.save();
    ctx.translate(e.x + shake, e.y);
    ctx.scale(s, s);
    ctx.globalAlpha = e.state === 'faded' ? 0.3 : 1;
    // 小怪物
    const by = -16 + wob * 0.4;
    ctx.fillStyle = BLOBS[e.look];
    ctx.beginPath(); ctx.arc(-14, by - 18, 7, 0, 7); ctx.arc(14, by - 18, 7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(0, by, 23, 0, 7); ctx.fill();
    face(0, by - 4, 1, e.state === 'wrong' ? 'dizzy' : e.state === 'answer' ? 'happy' : 'normal');
    // 答案牌
    const answer = e.state === 'answer';
    ctx.fillStyle = 'rgba(74,64,99,.15)'; rr(-cw / 2, 4, cw, e.h, 12); ctx.fill();
    ctx.fillStyle = answer ? '#e4fbea' : e.state === 'wrong' ? '#ffe3e9' : '#fff'; rr(-cw / 2, 0, cw, e.h, 12); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = answer ? '#4fc37a' : e.state === 'wrong' ? '#f76a8c' : targeted ? '#ffb347' : 'rgba(74,64,99,.12)';
    rr(-cw / 2, 0, cw, e.h, 12); ctx.stroke();
    ctx.fillStyle = '#4a4063'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fam = e.opt.ja ? JP_FONT : ZH_FONT;
    if (e.opt.ruby) {
      fit(e.opt.ruby, cw - 8, 12, fam); ctx.fillStyle = '#8a80a3'; ctx.fillText(e.opt.ruby, 0, 12);
      fit(e.opt.main, cw - 10, 22, fam); ctx.fillStyle = '#4a4063'; ctx.fillText(e.opt.main, 0, 34);
    } else {
      fit(e.opt.main, cw - 10, e.opt.ja ? 22 : 20, fam); ctx.fillText(e.opt.main, 0, e.h / 2 + 1);
    }
    ctx.restore();
  }

  function drawBoss() {
    const hurt = g.bossHurt > 0;
    const x = W / 2 + (hurt ? Math.sin(g.time * 60) * 4 : 0); const y = 66 + Math.sin(g.time * 2) * 4;
    ctx.fillStyle = hurt ? '#e6d4ff' : '#b79cf2';
    ctx.beginPath(); ctx.arc(x - 34, y - 30, 14, 0, 7); ctx.arc(x + 34, y - 30, 14, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y, 58, 46, 0, 0, 7); ctx.fill();
    // 皇冠
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.moveTo(x - 20, y - 40); ctx.lineTo(x - 22, y - 60); ctx.lineTo(x - 10, y - 50); ctx.lineTo(x, y - 64);
    ctx.lineTo(x + 10, y - 50); ctx.lineTo(x + 22, y - 60); ctx.lineTo(x + 20, y - 40); ctx.closePath(); ctx.fill();
    face(x, y - 4, 2, hurt ? 'dizzy' : 'normal');
    // 血條
    const bw = 120;
    ctx.fillStyle = 'rgba(74,64,99,.2)'; rr(x - bw / 2, y + 52, bw, 10, 5); ctx.fill();
    const ratio = Math.max(0, g.bossHp) / BOSS_HP;
    if (ratio > 0) { ctx.fillStyle = '#f76a8c'; rr(x - bw / 2, y + 52, Math.max(10, bw * ratio), 10, 5); ctx.fill(); }
  }

  function drawPlane() {
    const x = g.px; const y = planeY();
    if (g.hurt > 0 && Math.floor(g.time * 16) % 2) return;
    ctx.save(); ctx.translate(x, y);
    // 火焰
    const f = 10 + Math.sin(g.time * 30) * 4;
    ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-6, 22); ctx.lineTo(0, 22 + f + 6); ctx.lineTo(6, 22); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.moveTo(-3, 22); ctx.lineTo(0, 22 + f); ctx.lineTo(3, 22); ctx.fill();
    // 機翼與尾翼
    ctx.fillStyle = '#ff8fab'; rr(-30, -2, 60, 16, 8); ctx.fill();
    rr(-14, 16, 28, 9, 4.5); ctx.fill();
    ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(-22, 6, 4, 0, 7); ctx.arc(22, 6, 4, 0, 7); ctx.fill();
    // 機身
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#f76a8c'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 27, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8ec5ff'; ctx.beginPath(); ctx.ellipse(0, -8, 7, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(-2, -11, 2.2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function draw() {
    const scale = canvas.width / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#a9d8ff'); sky.addColorStop(1, '#ffe3ee');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    for (const c of g.clouds) cloud(c.x, c.y, c.s);

    const w = g.wave;
    const aiming = w && w.state === 'in';
    const lane = laneOf(g.px);
    if (aiming) {
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(lane * laneW(), 0, laneW(), H);
      ctx.strokeStyle = 'rgba(247,106,140,.45)'; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(g.px, planeY() - 34); ctx.lineTo(g.px, w.enemies[lane].y + w.enemies[lane].h + 6); ctx.stroke();
      ctx.setLineDash([]);
      // 危險線
      const left = 1 - w.t / w.dur;
      if (left < 0.3) { ctx.fillStyle = `rgba(247,106,140,${0.25 * (0.5 + 0.5 * Math.sin(g.time * 14))})`; ctx.fillRect(0, 0, W, H); }
    }
    if (g.phase === 'boss' && !(g.bossHp <= 0 && g.bossHurt <= 0)) drawBoss();
    if (w) for (const e of w.enemies) if (e.state !== 'dead') drawEnemy(e, aiming && e.lane === lane);
    for (const b of g.bullets) star(b.x, b.y, 8, '#ffd24d');
    for (const p of g.particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); star(p.x, p.y, p.r, p.color); }
    ctx.globalAlpha = 1;
    drawPlane();

    if (g.banner) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; rr(40, H / 2 - 44, W - 80, 76, 22); ctx.fill();
      ctx.fillStyle = '#f76a8c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fit(g.banner.text, W - 110, 26, ZH_FONT.replace('sans-serif', JP_FONT));
      ctx.fillText(g.banner.text, W / 2, H / 2 - 6);
    }
    if (g.waves <= 1 && g.phase === 'normal') {
      ctx.fillStyle = 'rgba(74,64,99,.75)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 13px ${ZH_FONT}`;
      const tip = matchMedia('(pointer: coarse)').matches ? '拖曳移動飛機，放開手指發射' : '方向鍵移動、空白鍵發射（或直接點答案）';
      ctx.fillText(tip, W / 2, H - 14);
    }
  }

  let raf = 0; let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!g.paused) update(dt);
    if (g.over) return;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function setPaused(p) {
    if (!g || g.over) return;
    g.paused = p;
    keys.left = keys.right = false;
    if (p && synth) synth.cancel();
    $('#pauseOverlay').classList.toggle('hidden', !p);
  }

  // ---------- 輸入 ----------
  const toX = (e) => { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; };
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!g || g.paused) return;
    dragging = true; g.tx = toX(e); g.pendingFire = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging && g && !g.paused) g.tx = toX(e); });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    if (g && !g.paused && e.type === 'pointerup') { g.tx = toX(e); g.pendingFire = true; }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (!g || g.over || !$('#game').classList.contains('active')) return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { setPaused(!g.paused); return; }
    if (g.paused) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; g.pendingFire = false; }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; g.pendingFire = false; }
    else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') { if (!e.repeat) fire(); }
    else if (/^[1-4]$/.test(e.key) && +e.key <= g.lanes) { g.tx = laneX(+e.key - 1); g.pendingFire = true; }
    else if (e.key === 'r' || e.key === 'R') { if (g.wave && g.wave.q.kind === 'listen') say(g.wave.q.item.k); return; }
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });
  window.addEventListener('resize', () => { if (g && !g.over) { resize(); if (g.wave) g.wave.endY = planeY() - 118; } });
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
  $('#soundToggle').addEventListener('click', () => { save.settings.sound = !save.settings.sound; persist(); refreshSettings(); sfx('ok'); });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) renderStages(+b.dataset.level); });
  $('#stageList').addEventListener('click', (e) => { const b = e.target.closest('[data-stage]'); if (b) startStage(curLevel, +b.dataset.stage); });
  $('#stagesBack').addEventListener('click', () => { renderHome(); show('home'); });
  $('#pauseBtn').addEventListener('click', () => setPaused(true));
  $('#resumeBtn').addEventListener('click', () => { setPaused(false); last = performance.now(); });
  $('#restartBtn').addEventListener('click', () => startStage(g.li, g.si));
  $('#quitBtn').addEventListener('click', () => { g.over = true; cancelAnimationFrame(raf); renderStages(g.li); });
  $('#promptBox').addEventListener('click', () => { if (g && g.wave && g.wave.state === 'in' && g.wave.q.kind === 'listen') say(g.wave.q.item.k); });
  $('#retryBtn').addEventListener('click', () => startStage(g.li, g.si));
  $('#nextBtn').addEventListener('click', () => { const n = nextStage(); if (n) startStage(n[0], n[1]); });
  $('#menuBtn').addEventListener('click', () => renderStages(g.li));

  if (synth) {
    findVoice();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', findVoice);
    setTimeout(() => { voicesChecked = true; findVoice(); }, 1500);
  } else voicesChecked = true;
  renderHome();
  window.__jt = { get state() { return g; }, buildQuestion };
})();
