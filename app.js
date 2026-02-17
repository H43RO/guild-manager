// ============================================================
//  길드 관리 시스템 — Main Logic (동적 버전)
// ============================================================

// ── Constants (더 이상 Mock 데이터 없음) ─────────────────────
const GUILD_COLORS = ['#f97316','#fbbf24','#ea580c','#f59e0b','#facc15','#fb7185','#10b981','#ef4444','#06b6d4','#6366f1'];
const GUILD_ICONS  = ['fa-crown','fa-heart','fa-star','fa-moon','fa-sun','fa-cube','fa-gem','fa-shield','fa-bolt','fa-fire'];

const MAPLE_WORLDS = ["스카니아","베라","루나","제니스","크로아","유니온","엘리시움","이노시스","레드","오로라","아케인","노바","리부트","리부트2","버닝","버닝2","버닝3"];

// ── API Service ─────────────────────────────────────────────
const API = {
  BASE: 'https://open.api.nexon.com',
  KEY: 'live_d27d5888cd5fdd47e94e8b22bd1da34cd635815a2408f57cd41aaec4bb02513befe8d04e6d233bd35cf2fabdeb93fb0d',

  async _get(path, params = {}, retries = 3) {
    const url = new URL(this.BASE + path);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
    
    try {
      const res = await fetch(url.toString(), { headers: { 'x-nxopen-api-key': this.KEY } });
      
      if (res.status === 429) {
        if (retries > 0) {
          console.warn(`API Rate Limit (429) on ${path}. Retrying in 2.5s... (${retries} left)`);
          await new Promise(r => setTimeout(r, 2500));
          return this._get(path, params, retries - 1);
        } else {
          throw new Error('API Rate Limit Exceeded (429)');
        }
      }
      
      if (!res.ok) { 
        const err = await res.json().catch(() => ({})); 
        throw new Error(err.error?.message || `API 오류 (${res.status})`); 
      }
      return await res.json();
    } catch (e) { 
      console.error(`API ${path}:`, e); 
      throw e; 
    }
  },

  getGuildId(guildName, worldName) { return this._get('/maplestory/v1/guild/id', { guild_name: guildName, world_name: worldName || Store.getWorld() }); },
  getGuildBasic(oguildId, date) { return this._get('/maplestory/v1/guild/basic', { oguild_id: oguildId, date }); },
  getCharacterId(name) { return this._get('/maplestory/v1/id', { character_name: name }); },
  getCharacterBasic(ocid, date) { return this._get('/maplestory/v1/character/basic', { ocid, date }); },
  getGuildRanking(date, worldName, rankingType, guildName) { return this._get('/maplestory/v1/ranking/guild', { date, world_name: worldName || Store.getWorld(), ranking_type: rankingType, guild_name: guildName }); },
  
  // Character Details
  getCharacterStat(ocid, date) { return this._get('/maplestory/v1/character/stat', { ocid, date }); },
  getCharacterItemEquipment(ocid, date) { return this._get('/maplestory/v1/character/item-equipment', { ocid, date }); },
  getCharacterCashItemEquipment(ocid, date) { return this._get('/maplestory/v1/character/cashitem-equipment', { ocid, date }); },
  getCharacterSymbol(ocid, date) { return this._get('/maplestory/v1/character/symbol-equipment', { ocid, date }); },
  getCharacterUnion(ocid, date) { return this._get('/maplestory/v1/user/union', { ocid, date }); },
  getCharacterUnionRaider(ocid, date) { return this._get('/maplestory/v1/user/union-raider', { ocid, date }); },
  getCharacterUnionArtifact(ocid, date) { return this._get('/maplestory/v1/user/union-artifact', { ocid, date }); },
  getCharacterUnionChampion(ocid, date) { return this._get('/maplestory/v1/user/union-champion', { ocid, date }); },
  getCharacterDojang(ocid, date) { return this._get('/maplestory/v1/character/dojang', { ocid, date }); }
};

// ── Store (Hybrid: Server Sync or Static LocalStorage) ───────
const Store = {
  _db: {},
  _isStatic: false,
  async init() {
    try {
      const res = await fetch('/api/data').catch(() => ({ ok: false }));
      if (!res.ok) throw new Error('Backend not found');
      
      const data = await res.json();
      
      // Migration & Porting logic...
      if (Object.keys(data).length === 0) {
        this._migrateFromLocal(data);
        if (Object.keys(data).length > 0) this._sync(data);
      }
      this._db = data;
      this._isStatic = false;
      return true;
    } catch (e) { 
      console.warn('Backend server not detected. Switching to Static Mode (LocalStorage).');
      this._isStatic = true;
      this._loadFromLocal();
      return true;
    }
  },
  _migrateFromLocal(target) {
    const keys = ["setup_done", "world", "guilds", "start_date", "char_cache", "guild_cache", "main_map", "suro_data", "penalties", "history", "member_ranks"];
    keys.forEach(k => {
      const v = localStorage.getItem('void_' + k);
      if (v) target[k] = JSON.parse(v);
    });
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('void_ranks_')) {
        const k = key.replace('void_', '');
        target[k] = JSON.parse(localStorage.getItem(key));
      }
    }
  },
  _loadFromLocal() {
    this._migrateFromLocal(this._db);
  },
  _saveToLocal(key, val) {
    localStorage.setItem('void_' + key, JSON.stringify(val));
  },
  _sync(data) {
    if (this._isStatic) return;
    fetch('/api/data', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data) 
    }).catch(e => console.error('Sync Error:', e));
  },
  _get(key, fb) { return this._db[key] !== undefined ? this._db[key] : fb; },
  _set(key, val) { 
    this._db[key] = val; 
    if (this._isStatic) {
      this._saveToLocal(key, val);
    } else {
      this._sync(this._db);
    }
  },

  // Export/Import
  exportData() {
    const dataStr = JSON.stringify(this._db, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `guild_data_${new Date().toISOString().split('T')[0]}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  },
  importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (confirm('⚠️ 모든 기존 데이터를 덮어쓰시겠습니까?')) {
          this._db = data;
          if (this._isStatic) {
            Object.keys(data).forEach(k => this._saveToLocal(k, data[k]));
          } else {
            this._sync(data);
          }
          location.reload();
        }
      } catch (err) { alert('잘못된 JSON 파일입니다.'); }
    };
    reader.readAsText(file);
  },

  // 온보딩 완료 여부
  isSetupDone() { return this._get('setup_done', false); },
  setSetupDone(v) { this._set('setup_done', v); },

  // 월드
  getWorld() { return this._get('world', ''); },
  setWorld(w) { this._set('world', w); },

  // 길드 목록 (사용자가 추가한 것만)
  getGuilds() { return this._get('guilds', []); },
  setGuilds(g) { this._set('guilds', g); },
  addGuild(guild) { const g = this.getGuilds(); g.push(guild); this.setGuilds(g); return g; },
  removeGuild(name) { const g = this.getGuilds().filter(x => x.name !== name); this.setGuilds(g); return g; },

  // 길드 설립일
  getStartDate() { return this._get('start_date', null); },
  setStartDate(d) { this._set('start_date', d); },
  
  // Cache & Data
  getCharCache() { return this._get('char_cache', {}); },
  cacheChar(name, ocid, data) { const c = this.getCharCache(); c[name] = { ocid, data, ts: Date.now() }; this._set('char_cache', c); },
  getCachedChar(name) { const c = this.getCharCache(); return (c[name] && Date.now() - c[name].ts < 86400000) ? c[name] : null; },
  
  getGuildCache() { return this._get('guild_cache', {}); },
  cacheGuild(name, id, data) { const c = this.getGuildCache(); c[name] = { id, data, ts: Date.now() }; this._set('guild_cache', c); },
  getCachedGuild(name) { const c = this.getGuildCache(); return (c[name] && Date.now() - c[name].ts < 1800000) ? c[name] : null; },

  getMainMap() { return this._get('main_map', {}); },
  setMainChar(sub, main) { const m = this.getMainMap(); m[sub] = main; this._set('main_map', m); },

  getAllSuro() { return this._get('suro_data', {}); },
  getSuro(week) { return (this.getAllSuro())[week] || {}; },
  saveSuro(week, data) { const all = this.getAllSuro(); all[week] = { ...all[week], ...data }; this._set('suro_data', all); },
  getSuroWeeks() { return Object.keys(this.getAllSuro()).sort().reverse(); },

  getPenalties() { return this._get('penalties', []); },
  addPenalty(rec) { const p = this.getPenalties(); p.unshift({ ...rec, ts: Date.now() }); this._set('penalties', p); },

  getHistory() { return this._get('history', []); },
  addHistory(rec) { const h = this.getHistory(); h.unshift({ ...rec, ts: Date.now() }); this._set('history', h); },
  
  getPrevMembers(name) { return this._get('prev_' + name, []); },
  setPrevMembers(name, list) { this._set('prev_' + name, list); },

  // 직위 관리
  getRanks(guildName) { 
    if (!guildName) return [{ name: '부마스터', condition: '기본 부관리자 직위', benefit: '길드 관리 권한' }];
    const r = this._get(`ranks_${guildName}`, [{ name: '부마스터', condition: '기본 부관리자 직위', benefit: '길드 관리 권한' }]);
    if (!r.find(x => x.name === '부마스터')) {
      r.unshift({ name: '부마스터', condition: '기본 부관리자 직위', benefit: '길드 관리 권한' });
    }
    return r;
  },
  setRanks(r, guildName) { 
    if (!guildName) return;
    if (!r.find(x => x.name === '부마스터')) {
      r.unshift({ name: '부마스터', condition: '기본 부관리자 직위', benefit: '길드 관리 권한' });
    }
    this._set(`ranks_${guildName}`, r); 
  },
  getMemberRanks() { return this._get('member_ranks', {}); },
  setMemberRank(name, rank) { const r = this.getMemberRanks(); r[name] = rank; this._set('member_ranks', r); }
};

// ── State ───────────────────────────────────────────────────
const state = {
  activeTab: 'dashboard',
  guildMembers: {}, 
  guildData: {},
  charDetails: {},
  loadingChars: new Set(),
  filters: { guild: 'all', search: '' },
  suroGuild: null,
  analysisSort: { field: 'score', order: 'desc' },
  rankSearch: '',
  rankAssignGuild: null,
  rankConfigGuild: null
};

// ── Utils ───────────────────────────────────────────────────
function showLoading(show) {
  const el = document.getElementById('loadingOverlay');
  if (!el) return;
  el.style.opacity = show ? '1' : '0';
  el.style.pointerEvents = show ? 'all' : 'none';
}

function getSuroWeekKey(d) {
  const date = d || new Date();
  const day = date.getDay();
  let diff = day - 4; if (diff < 0) diff += 7;
  date.setDate(date.getDate() - diff);
  return `${date.getFullYear().toString().slice(-2)}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function closeModal(id) { document.getElementById(id).classList.remove('visible'); }
function openModal(id) { document.getElementById(id).classList.add('visible'); }

// ── Onboarding Flow ─────────────────────────────────────────
let currentOnboardStep = 1;

function nextOnboardStep(step) {
  document.querySelectorAll('.onboarding-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.step-dot').forEach(el => el.classList.remove('active'));
  
  document.getElementById(`onboardStep${step}`).classList.add('active');
  
  // Activate dots up to current step
  document.querySelectorAll('.step-dot').forEach(el => {
    if (Number(el.dataset.step) <= step) el.classList.add('active');
  });
  
  currentOnboardStep = step;
}

async function validateAndNext() {
  const world = document.getElementById('setupWorld').value;
  const guildName = document.getElementById('setupGuildName').value.trim();
  const errorEl = document.getElementById('setupError');
  
  errorEl.style.display = 'none';
  
  if (!world) {
    errorEl.textContent = '월드를 선택해주세요.';
    errorEl.style.display = 'block';
    return;
  }
  
  if (!guildName) {
    errorEl.textContent = '길드 이름을 입력해주세요.';
    errorEl.style.display = 'block';
    return;
  }
  
  // Verify guild exists via API
  const btn = document.getElementById('setupNextBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 확인 중...';
  
  try {
    const result = await API.getGuildId(guildName, world);
    if (!result.oguild_id) throw new Error('길드를 찾을 수 없습니다.');
    
    // Get guild basic for start date
    const basic = await API.getGuildBasic(result.oguild_id);
    
    // Store setup data temporarily
    window._setupData = {
      world,
      guildName,
      guildDate: basic.guild_date_created || null,
      guildLevel: basic.guild_level,
      guildMaster: basic.guild_master_name,
      memberCount: (basic.guild_member || []).length,
      guildId: result.oguild_id
    };
    
    // Populate summary
    document.getElementById('setupSummaryCard').innerHTML = `
      <div class="summary-row"><span class="summary-label">월드</span><span class="summary-value">${world}</span></div>
      <div class="summary-row"><span class="summary-label">길드명</span><span class="summary-value">${guildName}</span></div>
      <div class="summary-row"><span class="summary-label">길드 레벨</span><span class="summary-value">Lv.${basic.guild_level || '?'}</span></div>
      <div class="summary-row"><span class="summary-label">길드 마스터</span><span class="summary-value">${basic.guild_master_name || '?'}</span></div>
      <div class="summary-row"><span class="summary-label">길드원 수</span><span class="summary-value">${(basic.guild_member || []).length}명</span></div>
    `;
    
    nextOnboardStep(3);
  } catch (e) {
    errorEl.textContent = `길드를 찾을 수 없습니다: ${e.message}`;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '다음';
  }
}

function completeSetup() {
  const data = window._setupData;
  if (!data) return;
  
  // Save to Store
  Store.setWorld(data.world);
  Store.setStartDate(data.guildDate || new Date().toISOString().split('T')[0]);
  
  // Create guild entry
  const guild = {
    id: data.guildName.toLowerCase().replace(/\s/g, '_'),
    name: data.guildName,
    type: '메인',
    color: GUILD_COLORS[0],
    icon: GUILD_ICONS[0],
    max: 200
  };
  Store.setGuilds([guild]);
  Store.setSetupDone(true);
  
  // Update page title
  document.title = `${data.guildName} 길드 관리 시스템`;
  
  // Transition to main app
  document.getElementById('onboardingScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  
  loadAllGuilds();
}

// ── Data Loading ────────────────────────────────────────────
async function loadGuildData(name) {
  const cached = Store.getCachedGuild(name);
  if (cached) {
    state.guildData[name] = cached.data;
    state.guildMembers[name] = cached.data.guild_member || [];
    return cached.data;
  }
  try {
    const idRes = await API.getGuildId(name);
    if (!idRes.oguild_id) throw new Error('길드 ID를 찾을 수 없습니다');
    const basic = await API.getGuildBasic(idRes.oguild_id);
    Store.cacheGuild(name, idRes.oguild_id, basic);
    
    // Change Detection
    const current = basic.guild_member || [];
    const prev = Store.getPrevMembers(name);
    if (prev.length > 0) {
      const newM = current.filter(x => !prev.includes(x));
      const leftM = prev.filter(x => !current.includes(x));
      newM.forEach(n => Store.addHistory({ date: new Date().toISOString().split('T')[0], category: '가입', name: n, content: `${name} 길드에 가입함` }));
      leftM.forEach(n => Store.addHistory({ date: new Date().toISOString().split('T')[0], category: '탈퇴', name: n, content: `${name} 길드에서 탈퇴함` }));
    }
    Store.setPrevMembers(name, current);

    state.guildData[name] = basic;
    state.guildMembers[name] = current;
    return basic;
  } catch (e) {
    console.error(e);
    state.guildMembers[name] = [];
    return null;
  }
}

async function loadCharacterDetail(name) {
  const cached = Store.getCachedChar(name);
  if (cached) { state.charDetails[name] = cached.data; return cached.data; }
  if (state.loadingChars.has(name)) return;
  state.loadingChars.add(name);
  try {
    const idRes = await API.getCharacterId(name);
    if (!idRes.ocid) return null;
    const basic = await API.getCharacterBasic(idRes.ocid);
    const detail = {
      name: basic.character_name, class: basic.character_class,
      level: basic.character_level, image: basic.character_image,
      world: basic.world_name, guild: basic.character_guild_name
    };
    state.charDetails[name] = detail;
    Store.cacheChar(name, idRes.ocid, detail);
    return detail;
  } catch(e) { console.error(e); return null; }
  finally { state.loadingChars.delete(name); }
}

async function loadAllGuilds() {
  showLoading(true);
  const guilds = Store.getGuilds();
  
  if (guilds.length === 0) {
    showLoading(false);
    router(state.activeTab);
    return;
  }
  
  // Load guilds sequentially to prevent 429
  for (const g of guilds) {
    try {
      await loadGuildData(g.name);
      // Small delay between guild fetches
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Failed to load guild ${g.name}`, e);
    }
  }
  
  // Update header stats
  // Update header stats
  updateHeaderStats();
  
  // Update ranking data (Suro/Flag) - Background
  // We'll implement this later or separate function

  
  // Update page title
  const mainGuild = guilds[0];
  if (mainGuild) {
    document.title = `${mainGuild.name} 길드 관리 시스템`;
  }
  
  showLoading(false);
  router(state.activeTab);

  // Background fetch character details - FAST LOAD disabled to avoid 429
  // Now loads sequentially with delay
  const allMembers = Object.values(state.guildMembers).flat();
  
  // 1. First, populate state from cache to show existing data immediately
  let hasCachedData = false;
  allMembers.forEach(n => {
    const cached = Store.getCachedChar(n);
    if (cached) {
      state.charDetails[n] = cached.data;
      hasCachedData = true;
    }
  });

  // If we loaded data from cache and are on members tab, update UI immediately
  if (hasCachedData && state.activeTab === 'members') {
    renderMemberList();
  }

  // 2. Filter for missing data
  const toLoad = allMembers.filter(n => !Store.getCachedChar(n));
  
  if (toLoad.length > 0) {
    console.log(`Starting background fetch for ${toLoad.length} new members...`);
    // Process one by one to respect API limits
    processNextChar(toLoad, 0);
  } else {
    console.log('All members loaded from cache.');
  }
}

async function processNextChar(list, index) {
  if (index >= list.length) return;
  
  const name = list[index];
  await loadCharacterDetail(name);
  
  // Update UI if on members tab
  if (state.activeTab === 'members') {
    // Only re-render specific card if possible for performance, but simple re-render is safer for now
    // Debounce re-renders slightly
    if (!window._renderTimeout) {
      window._renderTimeout = setTimeout(() => {
        if (state.activeTab === 'members') renderMemberList();
        window._renderTimeout = null;
      }, 500);
    }
  }
  
  // Wait before next request (Nexon API rate limit is strict)
  // 1500ms delay to be very safe against 429
  setTimeout(() => processNextChar(list, index + 1), 1500);

}

const PAGE_TITLES = {
  dashboard: '대시보드',
  members: '길드원 관리',
  suro: '수로 점수 관리',
  ranking: '길드 랭킹',
  penalty: '벌점 관리',
  history: '운영 이력',
  settings: '환경 설정'
};

// ── Routing ─────────────────────────────────────────────────
function router(tab) {
  state.activeTab = tab;
  const content = document.getElementById('contentArea');
  if (!content) return;
  
  // Transition
  content.style.opacity = '0';
  
  setTimeout(() => {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('onclick').includes(`router('${tab}')`));
    });

    const titles = { 
      dashboard: '대시보드', 
      members: '길드원 관리', 
      suro: '수로 점수 관리', 
      ranking: '길드 랭킹',
      penalty: '벌점 내역',
      history: '활동 히스토리',
      settings: '환경 설정',
      ranks: '직위 관리'
    };
    
    document.getElementById('pageTitle').innerText = titles[tab] || '시스템';

    if (tab === 'dashboard') renderDashboard(content);
    else if (tab === 'members') renderMembers(content);
    else if (tab === 'suro') renderSuro(content);
    else if (tab === 'ranking') renderRanking(content);
    else if (tab === 'penalty') renderPenalty(content);
    else if (tab === 'history') renderHistory(content);
    else if (tab === 'settings') renderSettings(content);
    else if (tab === 'ranks') renderRanks(content);
    
    content.style.opacity = '1';
  }, 150);
}

// ── RENDER: Dashboard ───────────────────────────────────────
function renderDashboard(container) {
  const guilds = Store.getGuilds();
  
  if (guilds.length === 0) {
    container.innerHTML = `
      <div class="fade-in" style="text-align:center;padding:4rem 2rem;">
        <div style="font-size:4rem;margin-bottom:1.5rem;opacity:0.15;"><i class="fas fa-cube"></i></div>
        <h2 style="margin-bottom:1rem;color:var(--text-main);">등록된 길드가 없습니다</h2>
        <p style="color:var(--text-muted);margin-bottom:2rem;">설정 탭에서 길드를 먼저 등록해주세요.</p>
        <button class="btn btn-primary" onclick="router('settings')"><i class="fas fa-cog"></i> 길드 설정하기</button>
      </div>
    `;
    return;
  }

  const mainGuildName = guilds[0].name || '길드';
  const totalMembersCount = Object.values(state.guildMembers).reduce((sum, members) => sum + members.length, 0);
  const totalCapacity = guilds.reduce((sum, g) => sum + (g.max || 200), 0);
  const occupancyRate = Math.round((totalMembersCount / totalCapacity) * 100);
  
  // Aggregate Suro Scores for Hall of Fame
  const week = getSuroWeekKey();
  const suroData = Store.getSuro(week);
  const allMembersSuro = [];
  Object.entries(state.guildMembers).forEach(([gName, members]) => {
    members.forEach(mName => {
      const score = Number(suroData[mName]) || 0;
      if (score > 0) {
        const d = state.charDetails[mName];
        allMembersSuro.push({ name: mName, score: score, guild: gName, job: d ? d.class : null });
      }
    });
  });
  const topSuroMembers = allMembersSuro.sort((a,b) => b.score - a.score).slice(0, 5);

  container.innerHTML = `
    <div class="dashboard-grid fade-in">
      
      <!-- [1] 상단 메인 대시보드 타이틀 -->
      <div class="col-span-12">
        <div class="hero-card">
          <div style="z-index:1;">
            <div class="sub-label" style="opacity:0.8;">${Store.getWorld()} 월드</div>
            <h1 style="font-size:2.5rem;font-weight:900;margin-bottom:0.5rem;background:linear-gradient(to right, #fff, var(--primary)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;">${mainGuildName}</h1>
            <p style="color:var(--text-muted);">연맹 대시보드 시스템에 접속했습니다.</p>
          </div>
          <div class="floating-stat hide-mobile" style="text-align:right;z-index:1;">
            <div class="value-xl">${occupancyRate}%</div>
            <div class="label-sm">전체 점유율</div>
          </div>
        </div>
      </div>

      <!-- [2] 핵심 지표 서머리 (지하수로 합산 & 길드 인원) -->
      <div class="col-span-6 premium-card glow-orange" style="min-height:200px; display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <span class="sub-label">지하수로 점수 총합</span>
          <div style="display:flex; justify-content:flex-end;">
            <h2 class="stat-value" id="totalSuroDisplay" style="font-size:4rem;">---</h2>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:var(--text-muted); font-weight:600;">연합 전체 수로 기록</span>
          <span class="label-pill orange" style="font-size:0.8rem;">${week} 기준</span>
        </div>
      </div>

      <div class="col-span-6 premium-card" style="min-height:200px; display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <span class="sub-label">길드 인원</span>
          <div style="display:flex; justify-content:flex-end;">
            <h2 class="stat-value" style="font-size:4rem;">${totalMembersCount}<span style="font-size:1.5rem; opacity:0.5; margin-left:0.5rem;">/ ${totalCapacity}</span></h2>
          </div>
        </div>
        <div style="display:flex; gap:1rem; overflow-x:auto; padding-bottom:0.5rem;">
          ${guilds.map(g => {
            const count = (state.guildMembers[g.name] || []).length;
            return `
              <div style="flex-shrink:0; display:flex; align-items:center; gap:0.5rem; font-size:0.85rem;">
                <span style="width:8px; height:8px; border-radius:50%; background:${g.color};"></span>
                <span style="color:var(--text-muted); font-weight:700;">${g.name}:</span>
                <span style="font-weight:900;">${count}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- [3] 길드별 지하수로 점수 현황 -->
      <div class="col-span-8 premium-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2.5rem;">
          <h3 style="font-size:1.4rem; font-weight:900;"><i class="fas fa-water" style="color:var(--primary); margin-right:0.75rem;"></i>지하수로 점수</h3>
          <div style="font-size:0.8rem; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:0.4rem 0.8rem; border-radius:10px;">길드별 점수 집계</div>
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:2rem;">
          ${guilds.map(g => {
            const count = (state.guildMembers[g.name] || []).length;
            const progress = Math.round((count / (g.max || 200)) * 100);
            return `
              <div class="insight-item" style="padding:1.5rem; background:rgba(255,255,255,0.015); border:1px solid rgba(255,255,255,0.05); border-radius:24px; position:relative; overflow:hidden; margin-bottom:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                  <div style="display:flex; align-items:center; gap:1rem;">
                    <div style="width:40px; height:40px; border-radius:14px; background:${g.color}22; display:flex; align-items:center; justify-content:center; color:${g.color}; font-size:1.1rem;">
                      <i class="fas ${g.icon}"></i>
                    </div>
                    <div>
                      <div style="font-size:1.1rem; font-weight:850; line-height:1;">${g.name}</div>
                      <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.3rem;">멤버 ${count}명 참여</div>
                    </div>
                  </div>
                  <div id="suro-score-${g.id}" style="font-family:monospace; font-weight:900; color:var(--primary); font-size:1.4rem; text-align:right;">---</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- [4] 명예의 전당 (수로 TOP 5) -->
      <div class="col-span-4 premium-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2rem;">
          <h3 style="font-size:1.4rem; font-weight:900;"><i class="fas fa-crown" style="color:var(--accent); margin-right:0.75rem;"></i>명예의 전당</h3>
          <span style="font-size:0.75rem; color:var(--text-muted);">SURO TOP 5</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:1.2rem;">
          ${topSuroMembers.length === 0 ? '<div style="padding:3rem; text-align:center; color:var(--text-muted);">수로 기록을 먼저 입력해주세요.</div>' : ''}
          ${topSuroMembers.map((m, i) => `
            <div style="display:flex; align-items:center; gap:1rem; padding:1.1rem; border-radius:20px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); transition:all 0.3s; position:relative;" onmouseenter="this.style.borderColor='var(--accent-glow)';this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.03)';this.style.background='rgba(255,255,255,0.02)'">
              <div style="font-size:1.2rem; font-weight:950; color:var(--accent); font-style:italic;">${i+1}</div>
              <div style="flex:1;">
                <div style="font-weight:900; font-size:1rem; margin-bottom:0.2rem;">${m.name}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">${m.guild}${m.job ? ` ・ <span style="color:var(--primary)">${m.job}</span>` : ''}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.1rem; font-weight:900; font-family:monospace; color:var(--text-main);">${m.score.toLocaleString()}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- [5] 메뉴 퀵 링크 -->
      <div class="col-span-12" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:1.5rem; margin-top:1rem;">
        <div class="action-tile" onclick="router('suro')">
          <i class="fas fa-edit" style="background:rgba(249, 115, 22, 0.1); color:var(--primary);"></i>
          <span style="font-weight:900;">수로 점수 관리</span>
        </div>
        <div class="action-tile" onclick="router('members')">
          <i class="fas fa-users" style="background:rgba(59, 130, 246, 0.1); color:#3b82f6;"></i>
          <span style="font-weight:900;">길드원 목록</span>
        </div>
        <div class="action-tile" onclick="router('penalty')">
          <i class="fas fa-gavel" style="background:rgba(239, 68, 68, 0.1); color:var(--danger);"></i>
          <span style="font-weight:900;">벌점 이력 관리</span>
        </div>
        <div class="action-tile" onclick="router('settings')">
          <i class="fas fa-cog" style="background:rgba(255, 255, 255, 0.05); color:var(--text-main);"></i>
          <span style="font-weight:900;">길드 설정</span>
        </div>
      </div>

    </div>
  `;
  
  loadDashboardScores(guilds);
}

async function loadDashboardScores(guilds) {
  // We'll try yesterday's date first, then the day before.
  const datesToTry = [
    new Date(Date.now() - 86400000).toISOString().split('T')[0],
    new Date(Date.now() - 172800000).toISOString().split('T')[0]
  ];
  
  let totalSuroSum = 0;
  let topGuild = { name: '-', score: -1 };

  for (const g of guilds) {
      let scoreFound = 0;
      for (const d of datesToTry) {
          try {
              const res = await API.getGuildRanking(d, g.world || Store.getWorld(), 2, g.name);
              if (res.ranking && res.ranking.length > 0) {
                  const matched = res.ranking.find(r => r.guild_name === g.name);
                  if (matched) {
                      scoreFound = matched.guild_point;
                      break; 
                  }
              }
          } catch (e) {
              console.warn(`Attempt failed for ${g.name} on ${d}`);
          }
      }
      
      const el = document.getElementById(`suro-score-${g.id}`);
      if (el) {
          if (scoreFound > 0) {
              el.innerHTML = `${scoreFound.toLocaleString()} <span style="font-size:0.7rem; color:var(--text-muted); font-weight:400;">점</span>`;
              totalSuroSum += scoreFound;
              if (scoreFound > topGuild.score) topGuild = { name: g.name, score: scoreFound };
          } else {
              el.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted); font-weight:400;">데이터 없음</span>`;
          }
      }
      
      // Update running total after each guild load for reactive feel
      const totalEl = document.getElementById('totalSuroDisplay');
      if (totalEl) totalEl.innerText = totalSuroSum.toLocaleString();
  }

  // Update MVP Guild Display
  const mvpEl = document.getElementById('topSuroGuildDisplay');
  if (mvpEl && topGuild.score > 0) {
      mvpEl.innerHTML = `
          <div class="stat-label">최고 수로 길드 (MVP)</div>
          <div style="font-size:1.8rem; font-weight:900; color:var(--accent); text-shadow:0 0 15px var(--accent-glow);">${topGuild.name}</div>
          <div style="font-size:0.9rem; font-weight:700; color:var(--text-muted); margin-top:0.2rem;">점수: ${topGuild.score.toLocaleString()}</div>
      `;
  } else if (mvpEl) {
      mvpEl.innerHTML = `
          <div class="stat-label">최고 수로 길드 (MVP)</div>
          <div style="font-size:1.2rem; font-weight:700; color:var(--text-muted);">최근 집계 데이터 없음</div>
      `;
  }
}


// ── RENDER: Members ─────────────────────────────────────────

function renderMembers(container) {
  const guilds = Store.getGuilds();
  container.innerHTML = `
    <div class="fade-in" style="height:100%;display:flex;flex-direction:column;gap:1.5rem;">
      <div style="display:flex;flex-direction:column;gap:1.2rem;">
        <!-- Search Bar -->
        <div class="search-wrapper" style="position:relative;">
          <i class="fas fa-search" style="position:absolute;left:1.5rem;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:1rem;"></i>
          <input type="text" class="input-field" placeholder="찾으시는 길드원의 이름을 입력하세요..." 
            value="${state.filters.search}" 
            style="padding-left:3.5rem;height:60px;font-size:1.1rem;border-radius:20px;background:rgba(255,255,255,0.02);border-color:var(--border-subtle);" 
            oninput="state.filters.search=this.value;renderMemberList()">
        </div>
        
        <!-- Filter Chips -->
        <div style="display:flex;gap:0.75rem;overflow-x:auto;padding:0.2rem 0;scrollbar-width:none;mask-image: linear-gradient(to right, black 80%, transparent 100%);">
          <button class="btn ${state.filters.guild === 'all' ? 'btn-primary' : 'btn-glass'}" 
            style="border-radius:99px;padding:0.6rem 1.8rem;white-space:nowrap;font-size:0.95rem;"
            onclick="state.filters.guild='all';renderMembers(document.getElementById('contentArea'))">전체보기</button>
          ${guilds.map(g => `
            <button class="btn ${state.filters.guild === g.name ? 'btn-primary' : 'btn-glass'}" 
              style="border-radius:99px;padding:0.6rem 1.8rem;white-space:nowrap;font-size:0.95rem;${state.filters.guild !== g.name ? `border-color:${g.color}33;` : ''}"
              onclick="state.filters.guild='${g.name}';renderMembers(document.getElementById('contentArea'))">
              <i class="fas ${g.icon}" style="margin-right:0.5rem;color:${state.filters.guild === g.name ? 'white' : g.color};"></i>${g.name}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="member-list" id="memberList"></div>
    </div>
  `;
  renderMemberList();
}

function renderMemberList() {
  const list = document.getElementById('memberList');
  if (!list) return;
  const term = state.filters.search.toLowerCase();
  const targetGuild = state.filters.guild;
  
  let members = [];
  const source = targetGuild === 'all' ? Store.getGuilds() : Store.getGuilds().filter(g => g.name === targetGuild);
  
  source.forEach(g => {
    (state.guildMembers[g.name] || []).forEach(name => {
      if (term && !name.toLowerCase().includes(term)) return;
      members.push({ name, guild: g.name, color: g.color });
    });
  });

  if (members.length === 0) {
    list.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-muted);"><i class="fas fa-search" style="font-size:3rem;margin-bottom:1rem;display:block;opacity:0.2;"></i>검색 결과가 없습니다</div>`;
    return;
  }

  members.sort((a, b) => {
    const masterA = state.guildData[a.guild]?.guild_master_name === a.name;
    const masterB = state.guildData[b.guild]?.guild_master_name === b.name;
    
    const rankA = masterA ? '길드마스터' : (Store.getMemberRanks()[a.name] || '일반 길드원');
    const rankB = masterB ? '길드마스터' : (Store.getMemberRanks()[b.name] || '일반 길드원');
    
    const orderA = ['길드마스터', ...Store.getRanks(a.guild).map(r => r.name), '일반 길드원'];
    const orderB = ['길드마스터', ...Store.getRanks(b.guild).map(r => r.name), '일반 길드원'];

    const idxA = orderA.indexOf(rankA);
    const idxB = orderB.indexOf(rankB);
    
    if (idxA !== idxB) return idxA - idxB;

    const dA = state.charDetails[a.name];
    const dB = state.charDetails[b.name];
    if (dA && dB) return dB.level - dA.level;
    if (dA) return -1;
    if (dB) return 1;
    return a.name.localeCompare(b.name);
  });

  list.innerHTML = members.map(m => {
    const d = state.charDetails[m.name];
    const isLoading = !d;
    const isMaster = state.guildData[m.guild]?.guild_master_name === m.name;
    
    return `
      <div class="member-card ${isLoading ? 'loading' : ''}" onclick="showCharDetail('${escapeHtml(m.name)}')">
        <div class="member-card-bg"></div>
        <div class="member-avatar">
          ${d?.image ? `<img src="${d.image}" loading="lazy">` : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
        </div>
        <div class="member-info">
          <div class="member-name">
            ${escapeHtml(m.name)}
            ${isMaster ? '<i class="fas fa-crown crown-icon"></i>' : ''}
          </div>
          
          <div style="margin-bottom:0.4rem;">
            ${(() => {
              const currentRank = isMaster ? '길드마스터' : (Store.getMemberRanks()[m.name] || '일반 길드원');
              return `
                <span class="label-pill ${(isMaster || currentRank === '부마스터') ? 'orange' : ''}" style="font-size:0.7rem;padding:0.1rem 0.5rem;">
                  ${currentRank}
                </span>
              `;
            })()}
          </div>
          
          ${d ? `
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.9rem;color:var(--text-muted);">
              <span class="member-level">Lv.${d.level}</span>
              <span class="member-guild-tag" style="border-color:${m.color};color:${m.color};">${m.guild}</span>
            </div>
            <div class="member-class">${d.class}</div>
          ` : `
            <div class="member-class" style="opacity:0.5;">정보 로딩 중...</div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function updateHeaderStats() {
  const startDate = Store.getStartDate();
  const diff = startDate ? Math.floor((new Date() - new Date(startDate)) / (1000 * 60 * 60 * 24)) : 0;
  
  const badge = document.getElementById('anniversaryLabel');
  if (badge) {
    badge.innerHTML = `<i class="fas fa-clock" style="margin-right:0.5rem;opacity:0.7;"></i>운영 ${diff}일차`;
    badge.style.cursor = 'pointer';
    badge.onclick = () => {
      const newDate = prompt('운영 시작일을 입력하세요 (YYYY-MM-DD)', startDate || new Date().toISOString().split('T')[0]);
      if (newDate && /\\d{4}-\\d{2}-\\d{2}/.test(newDate)) {
        Store.setStartDate(newDate);
        updateHeaderStats();
      }
    };
  }
}

async function showCharDetail(name) {
  openModal('charDetailModal');
  const d = state.charDetails[name];
  const modal = document.getElementById('charDetailModal');
  const content = modal.querySelector('.modal-content');
  
  content.innerHTML = `
    <div style="height:400px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="loader-spinner" style="margin-bottom:1.5rem;"></div>
      <div style="color:var(--text-muted);font-size:1.1rem;">${name} 대원의 정보를 불러오는 중...</div>
      <div style="color:var(--text-muted);font-size:0.9rem;opacity:0.6;margin-top:0.5rem;">(잠시만 기다려주세요)</div>
    </div>
  `;
  
  try {
    const data = await loadCharacterFullDetail(name);
    // state.charDetails[name] = { ...state.charDetails[name], ...data.basic, fullData: data };
    renderCharacterModal(data, content);
  } catch (e) {
    console.error(e);
    content.innerHTML = `
      <div style="height:400px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
        <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:var(--danger);margin-bottom:1rem;"></i>
        <div style="font-size:1.2rem;font-weight:700;margin-bottom:0.5rem;">정보 조회 실패</div>
        <div style="color:var(--text-muted);margin-bottom:1.5rem;">${e.message || '알 수 없는 오류가 발생했습니다.'}</div>
        <button class="btn btn-secondary" onclick="closeModal('charDetailModal')">닫기</button>
      </div>
    `;
  }
}

async function loadCharacterFullDetail(name) {
  let ocid = null;
  const cached = Store.getCachedChar(name);
  if (cached && cached.ocid) ocid = cached.ocid;
  else {
    const res = await API.getCharacterId(name);
    ocid = res.ocid;
  }
  
  if (!ocid) throw new Error('캐릭터를 찾을 수 없습니다.');
  
  const now = new Date();
  const date = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Yesterday
  const dateStr = date.toISOString().split('T')[0];
  
  // Parallel fetch for main data
  const coreResults = await Promise.allSettled([
    API.getCharacterBasic(ocid, dateStr),
    API.getCharacterStat(ocid, dateStr),
    API.getCharacterItemEquipment(ocid, dateStr),
    API.getCharacterCashItemEquipment(ocid, dateStr),
    API.getCharacterSymbol(ocid, dateStr),
    API.getCharacterUnion(ocid, dateStr),
    API.getCharacterUnionRaider(ocid, dateStr),
    API.getCharacterUnionArtifact(ocid, dateStr),
    API.getCharacterUnionChampion(ocid, dateStr),
    API.getCharacterDojang(ocid, dateStr)
  ]);
  
  const [basic, stat, equip, cash, symbol, union, raider, artifact, champion, dojang] = coreResults.map(r => r.status === 'fulfilled' ? r.value : null);
  
  if (!basic) throw new Error('기본 정보를 불러오지 못했습니다. (점검 중이거나 기록 없음)');
  
  // Fetch History (Last 30 days) - throttled or in small batches to avoid 429
  const historyDates = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    historyDates.push(d.toISOString().split('T')[0]);
  }
  
  // To avoid hitting 429 too hard, we fetch history in batches of 5
  const history = [];
  for (let i = 0; i < historyDates.length; i += 5) {
    const batch = historyDates.slice(i, i + 5);
    const batchResults = await Promise.allSettled(batch.map(d => API.getCharacterBasic(ocid, d)));
    batchResults.forEach(r => { if (r.status === 'fulfilled') history.push(r.value); });
  }

  return { basic, stat, equip, cash, symbol, union, raider, artifact, champion, dojang, history };
}

function renderCharacterModal(data, container) {
  const { basic, stat, equip, cash, symbol, union, raider, artifact, champion, dojang, history } = data;
  const combatPower = stat?.final_stat?.find(s => s.stat_name === '전투력')?.stat_value || 0;
  
  container.innerHTML = `
    <button class="btn btn-glass" onclick="closeModal('charDetailModal')" style="position:absolute;top:1.5rem;right:1.5rem;z-index:50;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--text-muted);">
      <i class="fas fa-times"></i>
    </button>
    <div class="detail-layout">
      <div class="detail-left">
        <div class="char-portrait">
          <img src="${basic.character_image}" alt="${basic.character_name}">
          <div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.6);color:white;padding:2px 8px;border-radius:12px;font-size:0.8rem;">Lv.${basic.character_level}</div>
        </div>
        <div style="text-align:center;width:100%;">
          <h2 style="font-size:1.6rem;font-weight:800;margin-bottom:0.25rem;">${basic.character_name}</h2>
          <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem;">${basic.world_name} / ${basic.character_class}</div>
          
          <div style="background:var(--bg-surface);padding:1rem;border-radius:12px;border:1px solid var(--border-subtle);width:100%;">
             <div class="label-sm" style="margin-bottom:0.25rem;">전투력</div>
             <div class="value-lg" style="color:var(--accent);font-size:1.3rem;">${Number(combatPower).toLocaleString()}</div>
          </div>
          
          <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:center;">
             <button class="btn btn-secondary btn-sm" onclick="promptSetMain('${escapeHtml(basic.character_name)}')">본캐 설정</button>
             <button class="btn btn-secondary btn-sm" onclick="window.open('https://maple.gg/u/${basic.character_name}', '_blank')">MapleGG</button>
          </div>
        </div>
      </div>
      
      <div class="detail-right">
        <div class="modal-tabs">
          <button class="tab-btn active" onclick="switchTab(event, 'tab-stat')">스탯</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-equip')">장비</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-cash')">코디</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-union')">유니온</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-dojang')">무릉</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-account')">본캐/부캐</button>
          <button class="tab-btn" onclick="switchTab(event, 'tab-exp')" id="tab-exp-btn">경험치</button>
        </div>
        
        <div id="tab-stat" class="tab-content active">
           ${renderTabStat(stat, symbol)}
        </div>
        <div id="tab-equip" class="tab-content">
           ${renderTabEquip(equip)}
        </div>
        <div id="tab-cash" class="tab-content">
           ${renderTabCash(cash)}
        </div>
        <div id="tab-union" class="tab-content">
           ${renderTabUnion(union, artifact, raider, champion)}
        </div>
        <div id="tab-dojang" class="tab-content">
           ${renderTabDojang(dojang)}
        </div>
        <div id="tab-account" class="tab-content">
           ${renderTabAccount(raider, basic.world_name)}
        </div>
        <div id="tab-exp" class="tab-content">
           ${renderTabEXP(history)}
        </div>
      </div>
    </div>
  `;
  
  // Initialize Chart if EXP tab is opened
  setTimeout(() => initEXPChart(history), 100);
}

function renderTabStat(stat, symbol) {
  if (!stat || !stat.final_stat) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">스탯 정보 없음</div>';
  const important = ['스탯 공격력', '최종 데미지', '보스 몬스터 공격 시 데미지', '방어율 무시', '크리티컬 데미지', '아이템 드롭률', '메소 획득량', 'STR', 'DEX', 'INT', 'LUK', 'HP', 'MP'];
  
  const statsHtml = `
    <div class="stat-grid">
      ${stat.final_stat.filter(s => important.includes(s.stat_name)).map(s => `
          <div class="stat-item">
              <span class="stat-label">${s.stat_name}</span>
              <span class="stat-val">${Number(s.stat_value).toLocaleString()}${s.stat_name.includes('율') || s.stat_name.includes('데미지') ? '%' : ''}</span> 
          </div>
      `).join('')}
    </div>
  `;

  const symbolsHtml = symbol?.symbol_equipment?.length > 0 ? `
    <h3 style="margin-top:2rem;margin-bottom:1rem;font-size:1.1rem;">✨ 심볼 정보</h3>
    <div class="symbol-grid">
      ${symbol.symbol_equipment.map(s => {
        const progress = s.symbol_require_growth_count > 0 ? (s.symbol_growth_count / s.symbol_require_growth_count * 100) : 100;
        return `
          <div class="symbol-card">
            <div class="symbol-head">
              <img src="${s.symbol_icon}" class="symbol-icon">
              <div>
                <div class="symbol-name" style="font-size:0.75rem;">${s.symbol_name}</div>
                <div class="symbol-lv">Lv.${s.symbol_level}</div>
              </div>
            </div>
            <div class="progress-container">
              <div class="progress-fill" style="width:${progress}%"></div>
            </div>
            <div class="progress-text">${s.symbol_growth_count} / ${s.symbol_require_growth_count || 'MAX'}</div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  return statsHtml + symbolsHtml;
}

function renderTabEquip(equip) {
  if (!equip || !equip.item_equipment) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">장비 정보 비공개 상태입니다.</div>';
  
  return `
    <div class="equip-grid">
      ${equip.item_equipment.map(item => {
        const gradeClass = item.potential_option_grade ? `grade-${item.potential_option_grade.toLowerCase()}` : '';
        const tooltipHtml = getItemTooltip(item);
        
        return `
          <div class="equip-card ${gradeClass} tooltip-trigger" onmousemove="handleTooltip(event)">
            <div class="equip-icon" style="border:1px solid var(--border-subtle);">
              <img src="${item.item_icon}" alt="${item.item_name}">
            </div>
            <div class="equip-info">
              <div class="equip-name">${item.item_name}</div>
              <div class="equip-meta">
                ${item.starforce > 0 ? `<span class="star-force">★ ${item.starforce}</span>` : ''}
                <span>${item.item_equipment_slot}</span>
              </div>
            </div>
            <div class="item-tooltip">${tooltipHtml}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.handleTooltip = function(e) {
  const tooltip = e.currentTarget.querySelector('.item-tooltip');
  if (!tooltip) return;
  
  const padding = 20;
  let x = e.clientX + padding;
  let y = e.clientY + padding;
  
  const twin = tooltip.offsetWidth || 320;
  const th = tooltip.offsetHeight || 400;
  
  if (x + twin > window.innerWidth) x = e.clientX - twin - padding;
  if (y + th > window.innerHeight) y = e.clientY - th - padding;
  
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
};

function getItemTooltip(item) {
  const parts = [];
  parts.push(`<div class="tooltip-name" style="text-align:center;font-weight:800;font-size:1.1rem;margin-bottom:0.5rem;border-bottom:1px solid #444;padding-bottom:0.5rem;">${item.item_name}${item.scroll_upgrade > 0 ? ` (+${item.scroll_upgrade})` : ''}</div>`);
  
  if (item.starforce > 0) {
    parts.push(`<div style="color:#facc15;text-align:center;margin-bottom:0.5rem;font-size:0.9rem;">★ ${item.starforce}</div>`);
  }

  const statLabels = {
    'str': 'STR', 'dex': 'DEX', 'int': 'INT', 'luk': 'LUK',
    'max_hp': '최대 HP', 'max_mp': '최대 MP',
    'attack_power': '공격력', 'magic_power': '마력',
    'defense': '방어력', 'speed': '이동속도', 'jump': '점프력'
  };

  Object.entries(statLabels).forEach(([key, label]) => {
    const total = Number(item.item_total_option[key]) || 0;
    if (total === 0) return;
    
    const base = Number(item.item_base_option[key]) || 0;
    const bonus = Number(item.item_add_option[key]) || 0;
    const scroll = (Number(item.item_etc_option[key]) || 0) + (Number(item.item_starforce_option[key]) || 0);

    let detail = `<span style="color:#aaa">(${base}`;
    if (bonus > 0) detail += ` <span style="color:#facc15">+${bonus}</span>`;
    if (scroll > 0) detail += ` <span style="color:#8b5cf6">+${scroll}</span>`;
    detail += `)</span>`;

    parts.push(`
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:2px;">
        <span>${label}</span>
        <span>+${total} ${detail}</span>
      </div>
    `);
  });

  if (item.potential_option_1) {
    parts.push(`<div style="margin-top:0.8rem;color:#A0C94F;font-weight:700;font-size:0.85rem;">잠재능력 (${item.potential_option_grade})</div>`);
    parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.potential_option_1}</div>`);
    if (item.potential_option_2) parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.potential_option_2}</div>`);
    if (item.potential_option_3) parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.potential_option_3}</div>`);
  }

  if (item.additional_potential_option_1) {
    parts.push(`<div style="margin-top:0.5rem;color:#4CB8E8;font-weight:700;font-size:0.85rem;">에디셔널 잠재능력 (${item.additional_potential_option_grade})</div>`);
    parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.additional_potential_option_1}</div>`);
    if (item.additional_potential_option_2) parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.additional_potential_option_2}</div>`);
    if (item.additional_potential_option_3) parts.push(`<div style="font-size:0.75rem;color:#ddd;">- ${item.additional_potential_option_3}</div>`);
  }

  return parts.join('');
}

function renderTabCash(cash) {
  if (!cash || (!cash.cash_item_equipment_base && !cash.cash_item_equipment_preset_1)) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">코디 정보 없음</div>';
  const items = (cash.cash_item_equipment_preset_1 && cash.cash_item_equipment_preset_1.length > 0) 
    ? cash.cash_item_equipment_preset_1 
    : cash.cash_item_equipment_base;

  return `
    <div class="equip-grid">
      ${items.map(item => `
          <div class="equip-card">
            <div class="equip-icon">
              <img src="${item.cash_item_icon}" alt="${item.cash_item_name}">
            </div>
            <div class="equip-info">
              <div class="equip-name">${item.cash_item_name}</div>
              <div class="equip-meta">${item.cash_item_equipment_slot}</div>
            </div>
          </div>
      `).join('')}
    </div>
  `;
}

function renderTabUnion(union, artifact, raider, champion) {
  if (!union) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">유니온 정보 없음</div>';

  const occupiedCells = new Set();
  raider?.union_block?.forEach(b => {
    b.block_position?.forEach(p => {
      occupiedCells.add(`${p.x},${p.y}`);
    });
  });

  const innerStatsHtml = raider?.union_inner_stat?.map(s => `
    <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:0.25rem;">
      <span style="color:var(--text-muted);">영역 ${s.stat_field_id}</span>
      <span style="color:var(--primary);font-weight:600;">${s.stat_field_effect}</span>
    </div>
  `).join('') || '';

  return `
    <div style="display:flex;gap:2rem;align-items:flex-start;">
      <div style="flex:0 0 320px;">
        <h3 style="margin-bottom:1rem;font-size:1.1rem;">🗺️ 유니온 배치</h3>
        <div class="union-map-container">
          ${Array.from({length: 440}).map((_, i) => {
             const x = (i % 22) - 11;
             const y = 10 - Math.floor(i / 22);
             const isActive = occupiedCells.has(`${x},${y}`);
             return `<div class="union-block ${isActive ? 'active' : ''}"></div>`;
          }).join('')}
        </div>
        <div style="margin-top:1rem;background:var(--bg-surface);padding:1rem;border-radius:12px;border:1px solid var(--border-subtle);">
           <div class="label-sm">배치 효과</div>
           <div style="margin-top:0.5rem;">${innerStatsHtml}</div>
           <hr style="border:none;border-top:1px solid var(--border-subtle);margin:0.75rem 0;">
           <div class="label-sm">유니온 등급</div>
           <div style="font-size:1.1rem;font-weight:800;color:var(--accent);">${union.union_grade}</div>
           <div class="label-sm" style="margin-top:0.5rem;">총 레벨</div>
           <div style="font-size:1.1rem;font-weight:800;">Lv.${union.union_level}</div>
        </div>
      </div>
      
      <div style="flex:1;">
        <h3 style="margin-bottom:1rem;font-size:1.1rem;">🏆 유니온 챔피언</h3>
        <div class="account-grid" style="grid-template-columns: 1fr 1fr;margin-bottom:2rem;">
          ${champion?.union_champion?.map(c => `
            <div class="account-card" style="padding:0.75rem;">
               <div style="flex:1;">
                 <div class="account-name" style="font-size:0.85rem;">${c.champion_name}</div>
                 <div class="account-sub" style="font-size:0.7rem;">슬롯 ${c.champion_slot}</div>
               </div>
               <div style="color:var(--accent);font-weight:800;font-size:0.8rem;">${c.champion_grade}</div>
            </div>
          `).join('') || '<div style="color:var(--text-muted);">미배치 또는 정보 없음</div>'}
        </div>
        
        <h3 style="margin-bottom:1rem;font-size:1.1rem;">💎 유니온 아티팩트 (Lv.${artifact?.union_artifact_level || 0})</h3>
        <div class="artifact-grid">
           ${artifact?.union_artifact_crystal?.map(c => `
             <div class="artifact-card">
               <div class="account-name" style="font-size:0.8rem;">${c.name}</div>
               <div class="account-sub">Lv.${c.level}</div>
             </div>
           `).join('') || '<div style="color:var(--text-muted);">정보 없음</div>'}
        </div>
      </div>
    </div>
  `;
}

function renderTabDojang(dojang) {
  if (!dojang) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">무릉 정보 없음</div>';
  return `
    <div class="bento-item" style="max-width:400px;margin:2rem auto;text-align:center;">
      <div class="label-sm">무릉도장 최고 기록</div>
      <div style="display:flex;justify-content:space-around;align-items:center;margin-top:1.5rem;">
        <div>
           <div style="font-size:3.5rem;font-weight:900;color:var(--accent);">${dojang.dojang_best_floor}층</div>
           <div style="color:var(--text-muted);font-size:0.9rem;">최고 층수</div>
        </div>
        <div style="width:1px;height:60px;background:var(--border-subtle);"></div>
        <div>
          <div style="font-size:1.5rem;font-weight:800;">${Math.floor(dojang.dojang_best_time / 60)}분 ${dojang.dojang_best_time % 60}초</div>
          <div style="color:var(--text-muted);font-size:0.85rem;">소요 시간</div>
          <div style="color:var(--text-muted);font-size:0.75rem;margin-top:0.5rem;">기록일: ${dojang.date_dojang_record ? dojang.date_dojang_record.split('T')[0] : '-'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderTabAccount(raider, worldName) {
  if (!raider || !raider.union_block) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">계정 정보 없음</div>';
  
  // Characters from union_block
  const chars = [...raider.union_block].sort((a,b) => Number(b.block_level) - Number(a.block_level));

  return `
    <h3 style="margin-bottom:1.5rem;font-size:1.1rem;">👥 계정 내 캐릭터 (${chars.length}개)</h3>
    <div class="account-grid">
      ${chars.map(c => `
        <div class="account-card">
          <div class="account-info">
            <div class="account-name">${c.block_class}</div>
            <div class="account-sub">${worldName}</div>
            <div style="font-size:0.75rem;color:var(--primary);margin-top:0.25rem;">Lv.${c.block_level}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTabEXP(history) {
  if (!history || history.length === 0) return '<div style="padding:2rem;text-align:center;color:var(--text-muted);">경험치 히스토리 데이터가 부족합니다.</div>';
  return `
    <h3 style="margin-bottom:1.5rem;font-size:1.1rem;">📈 경험치 히스토리 (최근 30일)</h3>
    <div style="background:var(--bg-surface);padding:1.5rem;border-radius:16px;border:1px solid var(--border-subtle);">
      <div class="chart-container" style="height:350px;position:relative;">
        <canvas id="expChartCanvas"></canvas>
      </div>
    </div>
  `;
}

function initEXPChart(history) {
  const ctx = document.getElementById('expChartCanvas');
  if (!ctx) return;

  const data = [...history].reverse();
  const labels = data.map(h => h.date ? h.date.split('-').slice(1).join('/') : '');
  const levels = data.map(h => h.character_level);
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '레벨',
        data: levels,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: levels.length > 15 ? 2 : 4,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 15, 21, 0.9)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: '#f97316',
          borderWidth: 1,
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: { 
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#94a3b8' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45 }
        }
      }
    }
  });
}

window.switchTab = function(event, tabId) {
  const container = event.target.closest('.detail-right');
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  event.target.classList.add('active');
  const target = container.querySelector('#' + tabId);
  if (target) target.classList.add('active');
};

function promptSetMain(name) {
  const main = prompt("본캐 닉네임을 입력하세요:", name);
  if (main) { Store.setMainChar(name, main); alert('연동 완료!'); }
}

// ── RENDER: Suro (점수 관리) ──────────────────────────────────
function renderSuro(container) {
  const guilds = Store.getGuilds();
  if (guilds.length === 0) {
    container.innerHTML = `<div class="fade-in" style="text-align:center;padding:4rem;color:var(--text-muted);">등록된 길드가 없습니다. 설정에서 길드를 추가해주세요.</div>`;
    return;
  }
  
  if (!state.suroGuild) state.suroGuild = guilds[0].name;
  if (state.suroSearch === undefined) state.suroSearch = '';

  const week = getSuroWeekKey();
  const data = Store.getSuro(week);
  const members = state.guildMembers[state.suroGuild] || [];
  
  // Section 1 Data: Leaderboard
  const scored = members.map(n => ({ name: n, score: Number(data[n]) || 0 })).sort((a,b) => b.score - a.score);
  
  // Section 2 Data: Search/Input
  const searchResults = state.suroSearch 
    ? members.filter(n => n.toLowerCase().includes(state.suroSearch.toLowerCase()))
    : members; // Show ALL members by default

  // Section 3 Data: Non-participants
  const nonParticipants = members.filter(n => (Number(data[n]) || 0) === 0);

  container.innerHTML = `
    <div class="fade-in" style="height:100%;display:flex;flex-direction:column;gap:1.5rem;">
      <!-- Guild Selector -->
      <div class="flex-responsive" style="justify-content:space-between;align-items:center;shrink-0;">
        <div style="display:flex;gap:0.5rem; overflow-x:auto; scrollbar-width:none; padding-bottom:5px;">
          ${guilds.map(g => `
            <button class="btn ${state.suroGuild === g.name ? 'btn-primary' : 'btn-glass'}" 
              style="white-space:nowrap; border-radius:99px;"
              onclick="state.suroGuild='${g.name}';renderSuro(document.getElementById('contentArea'))">
              ${g.name}
            </button>
          `).join('')}
        </div>
        <div class="hide-mobile" style="font-size:0.9rem;color:var(--text-muted);font-weight:700;">
          기준일: <span style="color:var(--primary)">${week} (목)</span>
        </div>
      </div>

      <!-- Main 3-Section Layout -->
      <div class="suro-grid-responsive" style="gap:1.5rem;flex:1;min-height:0;">
        
        <!-- 1. Leaderboard Section -->
        <div class="bento-item" style="padding:0;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:1.5rem;border-bottom:1px solid var(--border-subtle);">
            <h3 style="font-size:1.1rem;"><i class="fas fa-medal" style="color:#facc15;margin-right:0.5rem;"></i>수로 순위</h3>
          </div>
          <div style="flex:1;overflow-y:auto;padding:0.5rem;">
            <table style="width:100%;border-collapse:collapse;">
              <tbody style="font-size:0.9rem;">
                ${scored.map((m, i) => {
                  let medal = '';
                  if (i === 0) medal = '🥇';
                  else if (i === 1) medal = '🥈';
                  else if (i === 2) medal = '🥉';
                  
                  return `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.02);transition:background 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background='transparent'">
                      <td style="padding:0.8rem;color:var(--text-muted);width:45px;font-weight:800;">
                        ${medal ? `<span style="font-size:1.2rem;">${medal}</span>` : `<span style="margin-left:4px;">${i + 1}</span>`}
                      </td>
                      <td style="padding:0.8rem;font-weight:700;">${m.name}</td>
                      <td style="padding:0.8rem;text-align:right;font-family:monospace;font-weight:900;font-size:1.4rem;color:${m.score > 0 ? 'var(--primary)' : 'var(--text-muted)'}">
                        ${m.score.toLocaleString()}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 2. Input/Search Section -->
        <div class="bento-item" style="padding:0;display:flex;flex-direction:column;overflow:hidden;border-color:var(--primary);box-shadow: 0 0 20px rgba(249, 115, 22, 0.1);">
          <div style="padding:1.5rem;border-bottom:1px solid var(--border-subtle);background:linear-gradient(to bottom, rgba(249, 115, 22, 0.05), transparent);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h3 style="font-size:1.1rem;"><i class="fas fa-edit" style="color:var(--primary);margin-right:0.5rem;"></i>점수 입력</h3>
              <label class="btn btn-glass" style="padding:0.4rem 0.8rem;font-size:0.75rem;cursor:pointer;">
                <i class="fas fa-camera"></i> 스크린샷 인식
                <input type="file" multiple accept="image/*" style="display:none;" onchange="startOCR(this)">
              </label>
            </div>
            
            <div id="ocrProgress" style="display:none;margin-bottom:1rem;">
              <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:0.3rem;color:var(--primary);">
                <span id="ocrStatus">이미지 분석 중...</span>
                <span id="ocrPercent">0%</span>
              </div>
              <div class="progress-container" style="height:4px;"><div id="ocrBar" class="progress-fill" style="width:0%"></div></div>
            </div>

            <div style="position:relative;">
              <i class="fas fa-search" style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.8rem;"></i>
              <input type="text" class="input-field" placeholder="길드원 검색..." 
                value="${state.suroSearch}" 
                style="padding:0.6rem 1rem 0.6rem 2.2rem;font-size:0.85rem;"
                oninput="state.suroSearch=this.value;updateSuroSearchView()">
            </div>
          </div>
          <div id="suroSearchArea" style="flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.75rem;">
            ${renderSuroSearchList(searchResults, data)}
          </div>
          <div style="padding:1.5rem;border-top:1px solid var(--border-subtle);text-align:center;background:linear-gradient(to top, rgba(249, 115, 22, 0.05), transparent);">
            <button class="btn btn-primary" style="width:100%;padding:1.2rem;font-size:1rem;border-radius:16px;box-shadow: 0 10px 20px rgba(249, 115, 22, 0.2);justify-content:center;" onclick="saveSuroInputsInPage()">저장하기</button>
          </div>
        </div>


        <!-- 3. Non-participants Section -->
        <div class="bento-item" style="padding:0;display:flex;flex-direction:column;overflow:hidden;background:rgba(239, 68, 68, 0.02);">
          <div style="padding:1.5rem;border-bottom:1px solid var(--border-subtle);">
            <h3 style="font-size:1.1rem;margin-bottom:1rem;"><i class="fas fa-user-slash" style="color:var(--danger);margin-right:0.5rem;"></i>미참여자</h3>
            <div style="background:var(--danger);color:white;padding:1rem;border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:800;">총 미참여자</span>
              <span style="font-size:1.5rem;font-weight:900;">${nonParticipants.length}명</span>
            </div>
          </div>
          <div style="flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.5rem;">
            ${nonParticipants.map(n => `
              <div style="padding:0.8rem 1rem;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:700;">${n}</span>
                <span style="font-size:0.75rem;color:var(--text-muted);">미참여</span>
              </div>
            `).join('')}
            ${nonParticipants.length === 0 ? '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.9rem;">모두 참여했습니다! 🔥</div>' : ''}
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderSuroSearchList(list, currentData) {
  if (list.length === 0) return '<div style="text-align:center;padding:2rem;color:var(--text-muted);">검색 결과가 없습니다.</div>';
  return list.map(n => `
    <div class="suro-input-row" 
      style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);padding:0.75rem 1.25rem;border-radius:16px;border:1px solid var(--border-subtle);transition:all 0.2s ease;"
      onmouseenter="this.style.background='rgba(255,255,255,0.08)';this.style.borderColor='rgba(249, 115, 22, 0.3)';"
      onmouseleave="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='var(--border-subtle)';"
    >
      <span style="font-weight:700;font-size:1rem;color:var(--text-main);">${n}</span>
      <input type="text" 
        inputmode="numeric"
        class="suro-input-direct" 
        data-name="${n}" 
        value="${currentData[n] ? Number(currentData[n]).toLocaleString() : ''}" 
        placeholder="0"
        style="width:160px;background:transparent;border:none;border-bottom:2px solid var(--border-subtle);color:var(--primary);text-align:right;outline:none;font-weight:900;font-family:'Pretendard Variable', monospace;font-size:1.4rem;transition:all 0.2s ease;padding:0.25rem 0;"
        onfocus="this.style.borderBottomColor='var(--primary)';this.style.transform='scale(1.05)';this.parentElement.style.borderColor='var(--primary)';"
        onblur="this.style.borderBottomColor='var(--border-subtle)';this.style.transform='scale(1)';this.parentElement.style.borderColor='rgba(255,255,255,0.08)';"
        oninput="this.value = this.value.replace(/[^0-9]/g, '').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')"
        onwheel="this.blur();"
      >
    </div>
  `).join('');
}

function updateSuroSearchView() {
  const week = getSuroWeekKey();
  const data = Store.getSuro(week);
  const members = state.guildMembers[state.suroGuild] || [];
  const searchResults = state.suroSearch 
    ? members.filter(n => n.toLowerCase().includes(state.suroSearch.toLowerCase()))
    : members;
  
  const container = document.getElementById('suroSearchArea');
  if (container) container.innerHTML = renderSuroSearchList(searchResults, data);
}

function saveSuroInputsInPage() {
  const data = {};
  document.querySelectorAll('.suro-input-direct').forEach(i => { 
    const rawValue = i.value.replace(/,/g, '');
    if(rawValue) data[i.dataset.name] = Number(rawValue); 
  });
  
  if (Object.keys(data).length === 0) {
    alert("입력된 점수가 없습니다.");
    return;
  }
  
  const week = getSuroWeekKey();
  Store.saveSuro(week, data);
  renderSuro(document.getElementById('contentArea'));
}

async function startOCR(input) {
  if (!input.files || input.files.length === 0) return;
  
  const progressArea = document.getElementById('ocrProgress');
  const statusCtx = document.getElementById('ocrStatus');
  const percentCtx = document.getElementById('ocrPercent');
  const barCtx = document.getElementById('ocrBar');
  
  progressArea.style.display = 'block';
  
  const files = Array.from(input.files);
  const totalFiles = files.length;
  let processedNames = 0;

  const currentMembers = state.guildMembers[state.suroGuild] || [];
  const SIMILARITY_THRESHOLD = 0.5;
  
  try {
    const worker = await Tesseract.createWorker('kor+eng');
    const allDetected = [];

    for (let i = 0; i < totalFiles; i++) {
      statusCtx.textContent = `이미지 분석 중 (${i+1}/${totalFiles})`;
      const { data } = await worker.recognize(files[i]);
      const words = data.words;

      // 1. 헤더 찾기 (기준점 확보 - 핵심 키워드 포함여부로 판단)
      const nameHeader = words.find(w => w.text.includes('닉네') || w.text.includes('네임'));
      const suroHeader = words.find(w => w.text.includes('수로') || w.text.includes('지하') || w.text.includes('지하수'));

      if (!nameHeader || !suroHeader) {
        console.warn("헤더를 찾을 수 없어 기본 모드로 분석합니다.");
        // 기본 모드 생략 (헤더가 없으면 정확도가 현저히 낮으므로 패스하거나 기존 로직 사용)
        continue;
      }

      // 2. 컬럼 영역 정의 (닉네임 열 vs 수로 열)
      const nameColLeft = nameHeader.bbox.x0 - 20;
      const nameColRight = nameHeader.bbox.x1 + 30;
      
      const suroColLeft = suroHeader.bbox.x0 - 50; // 주간 미션과 겹치지 않도록 범위 축소
      const suroColRight = suroHeader.bbox.x1 + 60;
      
      const tableTop = nameHeader.bbox.y1;

      // 3. 해당 영역의 단어들 추출
      const nicknamesInCol = words.filter(w => 
        w.bbox.x0 >= nameColLeft && w.bbox.x1 <= nameColRight && w.bbox.y0 > tableTop
      );

      const scoresInCol = words.filter(w => 
        w.bbox.x0 >= suroColLeft && w.bbox.x1 <= suroColRight && w.bbox.y0 > tableTop
      );

      // 4. 수직 위치(Y)를 기준으로 닉네임과 점수 매칭
      nicknamesInCol.forEach(nameWord => {
        const nameY = (nameWord.bbox.y0 + nameWord.bbox.y1) / 2;
        const nameRaw = nameWord.text.trim();
        if (nameRaw.length < 2) return;

        // 같은 줄(Y)에 있는 점수 후보들을 모두 찾음
        const candidates = scoresInCol.filter(sw => {
          const scoreY = (sw.bbox.y0 + sw.bbox.y1) / 2;
          return Math.abs(nameY - scoreY) < 15;
        });

        if (candidates.length > 0) {
          // 주간 미션(왼쪽)이 섞이는 것을 방지하기 위해 '가장 오른쪽에 있는 것'을 선택
          const matchedScoreWord = candidates.sort((a, b) => b.bbox.x1 - a.bbox.x1)[0];
          
          let scoreStr = matchedScoreWord.text.replace(/[^0-9]/g, '');
          if (!scoreStr || scoreStr.length === 0) return;

          // 길드원 매칭
          let bestMatch = null;
          let highestScore = 0;
          currentMembers.forEach(m => {
            const score = getSimilarity(nameRaw, m);
            if (score > highestScore) {
              highestScore = score;
              bestMatch = m;
            }
          });

          if (highestScore > SIMILARITY_THRESHOLD && bestMatch) {
            const inputEl = document.querySelector(`.suro-input-direct[data-name="${bestMatch}"]`);
            if (inputEl) {
              inputEl.value = Number(scoreStr).toLocaleString();
              processedNames++;
              allDetected.push(`${nameRaw} -> ${bestMatch}: ${Number(scoreStr).toLocaleString()}`);
            }
          }
        }
      });

      const progress = ((i + 1) / totalFiles) * 100;
      percentCtx.textContent = `${Math.round(progress)}%`;
      barCtx.style.width = `${progress}%`;
    }

    await worker.terminate();
    
    if (allDetected.length > 0) {
      alert("--- OCR 인식 결과 ---\n" + allDetected.join('\n'));
    } else {
      alert("인식된 길드원 데이터가 없습니다. 스크린샷이 길드 참여 현황 화면인지 확인해주세요.");
    }
    
    statusCtx.textContent = `분석 완료! (${processedNames}명 인식됨)`;
    setTimeout(() => { progressArea.style.display = 'none'; }, 3000);

  } catch (err) {
    console.error(err);
    statusCtx.textContent = '분석 중 오류 발생';
  } finally {
    input.value = '';
  }
}

// Helper for Fuzzy Matching
function getSimilarity(s1, s2) {
  let longer = s1;
  let shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  let longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  let costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j;
      else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) != s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue),
              costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

// ── RENDER: Ranking ─────────────────────────────────────────
async function renderRanking(container) {
  container.innerHTML = `<div class="loader-spinner"></div>`;
  try {
    // Try yesterday first, then the day before (Nexon API ranking update time varies)
    const datesToTry = [
      new Date(Date.now() - 86400000).toISOString().split('T')[0],
      new Date(Date.now() - 172800000).toISOString().split('T')[0]
    ];
    
    let list = [];
    for (const d of datesToTry) {
      const raw = await API.getGuildRanking(d, null, 0); // ranking_type 0 is reputation
      if (raw.ranking && raw.ranking.length > 0) {
        list = raw.ranking;
        break;
      }
    }
    
    if (list.length === 0) {
      container.innerHTML = `<div style="padding:4rem;text-align:center;color:var(--text-muted);">현재 월드의 랭킹 데이터를 가져올 수 없습니다.</div>`;
      return;
    }
    
    const myGuildNames = Store.getGuilds().map(g => g.name);
    
    container.innerHTML = `
      <div class="fade-in bento-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">
        ${list.slice(0, 50).map(r => {
          const isMyGuild = myGuildNames.includes(r.guild_name);
          return `
            <div class="bento-item" style="${isMyGuild ? 'border: 2px solid var(--accent); background: rgba(255, 165, 0, 0.05); transform: translateY(-5px); box-shadow: 0 10px 20px rgba(255, 165, 0, 0.1);' : ''}">
              <div style="display:flex;justify-content:space-between;">
                <div style="font-size:2rem;font-weight:900;color:${isMyGuild ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}; opacity: ${isMyGuild ? '0.8' : '0.1'};">#${r.ranking}</div>
                <div class="status-badge" style="margin-left:auto; ${isMyGuild ? 'background: var(--accent); color: black;' : ''}">Lv.${r.guild_level}</div>
              </div>
              <div style="font-size:1.2rem;font-weight:800;margin-top:0.5rem; color: ${isMyGuild ? 'var(--accent)' : 'inherit'};">
                ${r.guild_name}
                ${isMyGuild ? ' <i class="fas fa-check-circle" style="font-size: 0.9rem;"></i>' : ''}
              </div>
              <div style="color:var(--text-muted);font-size:0.9rem;">${r.guild_master_name}</div>
              <div style="margin-top:1rem;font-family:monospace;color:${isMyGuild ? 'var(--accent)' : 'var(--primary)'};text-align:right; font-weight: 700;">${r.guild_point.toLocaleString()} 점</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch(e) { container.innerHTML = `<div style="padding:2rem;color:var(--danger);">${e.message}</div>`; }
}

// ── RENDER: Penalty ─────────────────────────────────────────
function renderPenalty(container) {
  const list = Store.getPenalties().sort((a,b) => new Date(b.date) - new Date(a.date));
  
  // Calculate Stats
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}`;
  const monthPenalties = list.filter(p => p.date.startsWith(monthKey));
  const totalPoints = monthPenalties.reduce((sum, p) => sum + p.points, 0);
  
  const userCounts = {};
  list.forEach(p => userCounts[p.name] = (userCounts[p.name] || 0) + p.points);
  const topUser = Object.entries(userCounts).sort((a,b) => b[1] - a[1])[0];

  container.innerHTML = `
    <div class="fade-in" style="height:100%;display:flex;flex-direction:column;gap:1.5rem;">
      
      <!-- Stats Row -->
      <div class="penalty-stats-grid" style="gap:1.5rem;">
        <div class="bento-item" style="padding:1.25rem;">
          <span class="label-sm">이번 달 총 벌점</span>
          <div style="display:flex;align-items:baseline;gap:0.5rem;">
            <span class="value-lg" style="color:var(--danger);">${totalPoints}</span>
            <span style="color:var(--text-muted);font-size:0.9rem;">점</span>
          </div>
        </div>
        <div class="bento-item" style="padding:1.25rem;">
          <span class="label-sm">이번 달 위반 건수</span>
          <div style="display:flex;align-items:baseline;gap:0.5rem;">
            <span class="value-lg">${monthPenalties.length}</span>
            <span style="color:var(--text-muted);font-size:0.9rem;">건</span>
          </div>
        </div>
        <div class="bento-item" style="padding:1.25rem;">
          <span class="label-sm">최다 벌점자</span>
          <div style="display:flex;align-items:baseline;gap:0.5rem;">
            <span class="value-lg" style="font-size:1.2rem;">${topUser ? topUser[0] : '-'}</span>
            <span style="color:var(--text-muted);font-size:0.8rem;">(${topUser ? topUser[1] : 0}점)</span>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:1.1rem;font-weight:800;">벌점 기록</h3>
        <button class="btn btn-primary" onclick="openPenaltyModal()">
          <i class="fas fa-gavel"></i> 벌점 부여하기
        </button>
      </div>

      <!-- Chronological List -->
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:1rem;padding-right:0.5rem;">
        ${list.length === 0 ? `
          <div style="text-align:center;padding:4rem;color:var(--text-muted);">
            <i class="fas fa-shield-alt" style="font-size:3rem;margin-bottom:1rem;opacity:0.2;"></i>
            <p>기록된 벌점이 없습니다. 깨끗한 길드원이군요!</p>
          </div>
        ` : ''}
        
        ${list.map(p => `
          <div class="bento-item fade-in" style="padding:1rem 1.5rem;flex-direction:row;align-items:center;justify-content:space-between;border-left:4px solid ${p.points >= 5 ? 'var(--danger)' : 'var(--primary)'};">
            <div style="display:flex;align-items:center;gap:1.5rem;flex:1;">
              <div style="min-width:90px;">
                <div style="font-size:0.75rem;color:var(--text-muted);">${p.date}</div>
                <div style="font-weight:800;font-size:1.1rem;margin-top:0.2rem;">${p.name}</div>
              </div>
              <div style="flex:1;">
                <div class="label-sm" style="margin-bottom:0.2rem;">사유</div>
                <div style="color:var(--text-main);font-size:0.95rem;">${p.reason}</div>
              </div>
            </div>
            <div style="text-align:right;min-width:80px;">
              <div class="label-sm" style="margin-bottom:0;">벌점</div>
              <div style="font-size:1.5rem;font-weight:900;color:var(--danger);font-family:monospace;">${p.points} <span style="font-size:0.8rem;font-weight:700;">pt</span></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function openPenaltyModal() {
  document.getElementById('penaltyDate').value = new Date().toISOString().split('T')[0];
  openModal('penaltyModal');
}

function setPenaltyReason(reason, points) {
  document.getElementById('penaltyReason').value = reason;
  if (points) document.getElementById('penaltyPoints').value = points;
}

function submitPenalty() {
  const rec = {
    date: document.getElementById('penaltyDate').value,
    name: document.getElementById('penaltyTarget').value,
    points: Number(document.getElementById('penaltyPoints').value),
    reason: document.getElementById('penaltyReason').value
  };
  if (!rec.date || !rec.name || !rec.reason) {
    alert('모든 항목을 입력해주세요.');
    return;
  }
  Store.addPenalty(rec);
  Store.addHistory({ date: rec.date, category: '벌점', name: rec.name, content: `${rec.name}에게 ${rec.points}점 벌점 부여 - ${rec.reason}` });
  closeModal('penaltyModal');
  renderPenalty(document.getElementById('contentArea'));
}

// ── RENDER: History ─────────────────────────────────────────
function renderHistory(container) {
  const list = Store.getHistory();
  container.innerHTML = `
    <div class="fade-in bento-item" style="min-height:80vh;">
      ${list.length === 0 ? '<div style="text-align:center;padding:3rem;color:var(--text-muted);">아직 기록된 이력이 없습니다</div>' : ''}
      <ul style="list-style:none;padding:1rem;">
      ${list.map(h => `
        <li style="padding:1rem;border-left:2px solid var(--border-subtle);margin-left:1rem;position:relative;">
          <div style="position:absolute;left:-6px;top:1.2rem;width:10px;height:10px;border-radius:50%;background:var(--primary);"></div>
          <div style="font-size:0.8rem;color:var(--text-muted);">${h.date} · ${h.category}</div>
          <div style="font-size:1rem;margin-top:0.2rem;">${h.content}</div>
        </li>
      `).join('')}
      </ul>
    </div>
  `;
}

// ── RENDER: Settings ────────────────────────────────────────
function renderSettings(container) {
  const guilds = Store.getGuilds();
  const world = Store.getWorld();
  
  container.innerHTML = `
    <div class="fade-in" style="max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:1.5rem;">
      
      <!-- 월드 설정 -->
      <div class="bento-item">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-globe-asia" style="color:var(--primary);margin-right:0.5rem;"></i>월드 설정</h3>
        <div class="label-sm">현재 월드</div>
        <select class="input-field" onchange="Store.setWorld(this.value);location.reload();" style="margin-bottom:1rem;">
          ${MAPLE_WORLDS.map(w => `<option value="${w}" ${w===world?'selected':''}>${w}</option>`).join('')}
        </select>
      </div>

      <!-- 길드 관리 -->
      <div class="bento-item">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <h3><i class="fas fa-users" style="color:var(--primary);margin-right:0.5rem;"></i>길드 관리</h3>
          <button class="btn btn-primary" style="padding:0.4rem 1rem;font-size:0.85rem;" onclick="openModal('addGuildModal')"><i class="fas fa-plus"></i> 길드 추가</button>
        </div>
        
        ${guilds.length === 0 ? '<div style="text-align:center;padding:2rem;color:var(--text-muted);">등록된 길드가 없습니다</div>' : ''}
        
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${guilds.map((g, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-surface);padding:1rem;border-radius:12px;border-left:3px solid ${g.color};">
              <div style="display:flex;align-items:center;gap:1rem;">
                <i class="fas ${g.icon}" style="color:${g.color};font-size:1.2rem;width:24px;text-align:center;"></i>
                <div>
                  <div style="font-weight:700;">${g.name}</div>
                  <div style="font-size:0.8rem;color:var(--text-muted);">${g.type} · ${(state.guildMembers[g.name]||[]).length}명</div>
                </div>
              </div>
              <button class="btn btn-glass" style="padding:0.3rem 0.8rem;font-size:0.8rem;color:var(--danger);" onclick="confirmRemoveGuild('${escapeHtml(g.name)}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 데이터 관리 -->
      <div class="bento-item">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-database" style="color:var(--primary);margin-right:0.5rem;"></i>데이터 관리</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1.5rem;">
          ${Store._isStatic ? 'GitHub IO와 같은 정식 서버가 없는 환경에서는 브라우저에 데이터가 저장됩니다. 데이터를 다른 기기로 옮기려면 백업/복원 기능을 이용하세요.' : '내부 데이터 파일(data.json)과 연동되어 안전하게 관리되고 있습니다.'}
        </p>

        <div class="data-mgmt-grid" style="gap:1rem; margin-bottom:1.5rem;">
          <button class="btn btn-glass" onclick="Store.exportData()" style="justify-content:center;">
            <i class="fas fa-download" style="margin-right:0.5rem;"></i> JSON 백업 (Export)
          </button>
          <button class="btn btn-glass" onclick="document.getElementById('importFile').click()" style="justify-content:center;">
            <i class="fas fa-upload" style="margin-right:0.5rem;"></i> 데이터 복원 (Import)
          </button>
          <input type="file" id="importFile" style="display:none;" accept=".json" onchange="Store.importData(this.files[0])">
        </div>

        <div style="display:flex;gap:1rem; padding-top:1rem; border-top:1px solid rgba(255,255,255,0.05);">
          <button class="btn btn-glass" onclick="clearCache()" style="color:var(--text-muted); font-size:0.8rem;">캐시 초기화</button>
          <button class="btn btn-glass" onclick="resetAll()" style="color:var(--danger); font-size:0.8rem;">전체 초기화</button>
        </div>
      </div>
    </div>
  `;
}

// ── Guild Management Actions ────────────────────────────────
async function submitAddGuild() {
  const nameInput = document.getElementById('addGuildName');
  const typeInput = document.getElementById('addGuildType');
  const errorEl = document.getElementById('addGuildError');
  
  const name = nameInput.value.trim();
  const type = typeInput.value.trim() || '부캐';
  
  errorEl.style.display = 'none';
  
  if (!name) {
    errorEl.textContent = '길드 이름을 입력해주세요.';
    errorEl.style.display = 'block';
    return;
  }
  
  // Check duplicate
  if (Store.getGuilds().some(g => g.name === name)) {
    errorEl.textContent = '이미 등록된 길드입니다.';
    errorEl.style.display = 'block';
    return;
  }
  
  // Verify via API
  try {
    const result = await API.getGuildId(name);
    if (!result.oguild_id) throw new Error();
  } catch {
    errorEl.textContent = '존재하지 않는 길드입니다. 이름과 월드를 확인해주세요.';
    errorEl.style.display = 'block';
    return;
  }
  
  const existing = Store.getGuilds();
  const colorIdx = existing.length % GUILD_COLORS.length;
  const iconIdx = existing.length % GUILD_ICONS.length;
  
  const guild = {
    id: name.toLowerCase().replace(/\s/g, '_'),
    name,
    type,
    color: GUILD_COLORS[colorIdx],
    icon: GUILD_ICONS[iconIdx],
    max: 200
  };
  
  Store.addGuild(guild);
  closeModal('addGuildModal');
  nameInput.value = '';
  typeInput.value = '';
  
  // Reload data and refresh settings
  await loadGuildData(name);
  renderSettings(document.getElementById('contentArea'));
}

function confirmRemoveGuild(name) {
  if (confirm(`정말 "${name}" 길드를 목록에서 제거하시겠습니까?\n(길드 데이터도 함께 삭제됩니다)`)) {
    Store.removeGuild(name);
    delete state.guildMembers[name];
    delete state.guildData[name];
    Store.addHistory({ date: new Date().toISOString().split('T')[0], category: '설정', name: name, content: `${name} 길드를 관리 목록에서 제거` });
    renderSettings(document.getElementById('contentArea'));
  }
}

function clearCache() {
  if (confirm('캐시를 초기화하면 다음 로딩 시 API에서 데이터를 다시 받아옵니다. 계속하시겠습니까?')) {
    Store._set('char_cache', {});
    Store._set('guild_cache', {});
    alert('캐시가 초기화되었습니다. 새로고침됩니다.');
    location.reload();
  }
}

function resetAll() {
  if (confirm('⚠️ 정말 전체 초기화하시겠습니까?\n모든 길드, 수로 점수, 벌점, 이력 데이터가 삭제됩니다.')) {
    localStorage.clear();
    location.reload();
  }
}

// ── RENDER: Ranks (직위 관리) ─────────────────────────────
function renderRanks(container) {
  const guilds = Store.getGuilds();
  if (!state.rankConfigGuild) state.rankConfigGuild = guilds[0]?.name || '';
  if (!state.rankAssignGuild) state.rankAssignGuild = guilds[0]?.name || '';

  container.innerHTML = `
    <div class="fade-in rank-management-grid" style="height:100%; gap:2rem;">
      <!-- Left: Rank Configuration -->
      <div id="rankConfigArea" style="display:flex; flex-direction:column; gap:1.5rem; min-height:0;">
        ${renderRankManagement()}
      </div>

      <!-- Right: Rank Assignment -->
      <div id="rankAssignArea" style="display:flex; flex-direction:column; gap:1.5rem; min-height:0;">
        ${renderRankAssignment()}
      </div>
    </div>
  `;
}

function renderRankManagement() {
  const guilds = Store.getGuilds();
  const ranks = Store.getRanks(state.rankConfigGuild);
  const currentGuild = guilds.find(g => g.name === state.rankConfigGuild);

  return `
    <div class="bento-item" style="flex:1; display:flex; flex-direction:column;">
      <div style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:0.5rem;"><i class="fas fa-cog" style="color:var(--primary);margin-right:0.5rem;"></i>직위 구성 및 서열</h3>
        <p style="font-size:0.8rem; color:var(--text-muted);">길드별 직위 체계와 서열을 드래그하여 설정하세요.</p>
      </div>

      <!-- Guild Selection -->
      <div style="display:flex;gap:0.4rem;overflow-x:auto;padding-bottom:1rem;margin-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.05);scrollbar-width:none;">
        ${guilds.map(g => `
          <button class="btn ${state.rankConfigGuild === g.name ? 'btn-primary' : 'btn-glass'}" 
            style="white-space:nowrap; border-radius:99px; padding:0.4rem 1rem; font-size:0.8rem;"
            onclick="state.rankConfigGuild='${g.name}'; renderRanks(document.getElementById('contentArea'))">
            ${g.name}
          </button>
        `).join('')}
      </div>
      <div style="display:flex;flex-direction:column;gap:1rem; flex:1; overflow-y:auto; padding-right:0.5rem;" id="rankSortContainer">
        <!-- Rank 0: Guild Master (Fixed) -->
        <div class="rank-item-fixed" style="display:flex;align-items:center;justify-content:space-between;padding:1rem;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.2);border-radius:12px;">
          <div style="display:flex;align-items:center;gap:1rem;">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:white;font-size:0.8rem;">0</div>
            <div>
              <div style="font-weight:700;">길드마스터</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">시스템 자동 지정</div>
              <div style="font-size:0.7rem;color:var(--accent);margin-top:0.2rem;"><i class="fas fa-gift" style="margin-right:0.3rem;"></i>길드 전권</div>
            </div>
          </div>
          <i class="fas fa-lock" style="opacity:0.3; font-size:0.8rem;"></i>
        </div>

        <!-- Rank 1: Vice Master (Fixed) -->
        <div class="rank-item-fixed" style="display:flex;align-items:center;justify-content:space-between;padding:1rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px; border-left:4px solid var(--primary);">
          <div style="display:flex;align-items:center;gap:1rem;">
            <div style="width:32px;height:32px;border-radius:50%;background:rgba(249,115,22,0.2);display:flex;align-items:center;justify-content:center;color:var(--primary);font-size:0.8rem;">1</div>
            <div>
              <div style="font-weight:700;">부마스터</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">기본 부관리자 직위</div>
              <div style="font-size:0.7rem;color:var(--primary);margin-top:0.2rem;"><i class="fas fa-gift" style="margin-right:0.3rem;"></i>길드 관리 권한</div>
            </div>
          </div>
          <i class="fas fa-lock" style="opacity:0.3; font-size:0.8rem;"></i>
        </div>

        <!-- Dynamic Ranks (Draggable) -->
        ${ranks.filter(r => r.name !== '부마스터').map((r, i) => `
          <div class="draggable-rank" draggable="true" data-index="${i}" ondragstart="handleRankDragStart(event)" ondragover="handleRankDragOver(event)" ondrop="handleRankDrop(event)" ondragend="this.style.opacity='1'"
               style="display:flex;align-items:center;justify-content:space-between;padding:1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:12px; cursor:grab; transition:all 0.2s;">
            <div style="display:flex;align-items:center;gap:1rem; pointer-events:none;">
              <div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;">${i + 2}</div>
              <div>
                <div style="font-weight:700; color:var(--text-main);">${r.name}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);">${r.condition || '조건 없음'}</div>
                ${r.benefit ? `<div style="font-size:0.7rem;color:var(--success);margin-top:0.2rem;"><i class="fas fa-gift" style="margin-right:0.3rem;"></i>${r.benefit}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:0.5rem; align-items:center;">
              <button class="btn btn-glass" style="color:var(--danger);padding:0.4rem;font-size:0.8rem;" onclick="removeRank('${escapeHtml(r.name)}')"><i class="fas fa-trash"></i></button>
              <i class="fas fa-bars" style="opacity:0.2; cursor:grab;"></i>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top:2rem;padding:1.5rem;background:rgba(255,255,255,0.02);border:1px dashed var(--border-subtle);border-radius:12px;">
        <h4 style="margin-bottom:1rem;font-size:0.9rem;">직위 추가</h4>
        <div style="display:flex; flex-direction:column; gap:0.75rem;">
          <input type="text" id="newRankName" class="input-field" placeholder="직위명">
          <input type="text" id="newRankCond" class="input-field" placeholder="부여 조건">
          <input type="text" id="newRankBenefit" class="input-field" placeholder="직위 혜택 (예: 길드 노블레스 스킬 우선 사용)">
          <button class="btn btn-primary" style="width:100%;" onclick="addRank()">직위 추가하기</button>
        </div>
      </div>
    </div>
  `;
}

// Drag & Drop Handlers
window.handleRankDragStart = (e) => {
  e.dataTransfer.setData('text/plain', e.target.dataset.index);
  e.target.style.opacity = '0.4';
};
window.handleRankDragOver = (e) => {
  e.preventDefault();
  const dragging = document.querySelector('.draggable-rank[style*="opacity: 0.4"]');
  if (e.target.classList.contains('draggable-rank') && e.target !== dragging) {
    e.target.style.transform = 'translateY(5px)';
  }
};
window.handleRankDrop = (e) => {
  e.preventDefault();
  const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
  const target = e.target.closest('.draggable-rank');
  if (!target) return;
  const toIdx = parseInt(target.dataset.index);
  
  if (fromIdx === toIdx) return;
  
  const ranks = Store.getRanks(state.rankConfigGuild).filter(r => r.name !== '부마스터');
  const [moved] = ranks.splice(fromIdx, 1);
  ranks.splice(toIdx, 0, moved);
  
  // Re-save with 부마스터 at start
  Store.setRanks([{ name: '부마스터', condition: '기본 부관리자 직위', benefit: '길드 관리 권한' }, ...ranks], state.rankConfigGuild);
  renderRanks(document.getElementById('contentArea'));
};

function renderRankAssignment() {
  const guilds = Store.getGuilds();
  if (!state.rankAssignGuild) state.rankAssignGuild = guilds[0]?.name || '';

  return `
    <div style="display:flex;flex-direction:column;gap:1.5rem;height:100%;">
      <div class="flex-responsive" style="justify-content:space-between;align-items:center;shrink-0; gap:1rem;">
        <div style="display:flex;gap:0.5rem; overflow-x:auto; scrollbar-width:none;">
          ${guilds.map(g => `
            <button class="btn ${state.rankAssignGuild === g.name ? 'btn-primary' : 'btn-glass'}" 
              style="white-space:nowrap; border-radius:99px;"
              onclick="state.rankAssignGuild='${g.name}'; state.rankSearch=''; renderRanks(document.getElementById('contentArea'))">
              ${g.name}
            </button>
          `).join('')}
        </div>
        <div style="position:relative;width:200px; flex-shrink:0;">
          <i class="fas fa-search" style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);opacity:0.5; font-size:0.8rem;"></i>
          <input type="text" class="input-field" id="rankSearchInput" placeholder="길드원 검색" value="${state.rankSearch}" 
            style="padding-left:2.5rem; height:40px; font-size:0.85rem;" oninput="updateRankSearch(this.value)">
        </div>
      </div>

      <div class="bento-item" style="flex:1;overflow-y:auto;padding:0; border-radius:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead style="background:rgba(255,255,255,0.02);position:sticky;top:0;z-index:5;">
            <tr style="text-align:left; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em;">
              <th style="padding:1.2rem 1.5rem;">길드원</th>
              <th style="padding:1.2rem 1.5rem;">현재 직위</th>
              <th style="padding:1.2rem 1.5rem;text-align:right;">직위 변경</th>
            </tr>
          </thead>
          <tbody id="rankAssignmentTableBody">
            ${renderRankAssignmentRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function updateRankSearch(val) {
  state.rankSearch = val;
  const tbody = document.getElementById('rankAssignmentTableBody');
  if (tbody) {
    tbody.innerHTML = renderRankAssignmentRows();
  }
}

function renderRankAssignmentRows() {
  const ranks = Store.getRanks(state.rankAssignGuild);
  const memberRanks = Store.getMemberRanks();
  const rankOrder = ['길드마스터', ...ranks.map(r => r.name), '일반 길드원'];
  
  const members = (state.guildMembers[state.rankAssignGuild] || [])
    .filter(n => n.toLowerCase().includes(state.rankSearch.toLowerCase()))
    .sort((a, b) => {
      const isMasterA = state.guildData[state.rankAssignGuild]?.guild_master_name === a;
      const isMasterB = state.guildData[state.rankAssignGuild]?.guild_master_name === b;
      const rA = isMasterA ? '길드마스터' : (memberRanks[a] || '일반 길드원');
      const rB = isMasterB ? '길드마스터' : (memberRanks[b] || '일반 길드원');
      return rankOrder.indexOf(rA) - rankOrder.indexOf(rB);
    });

  if (members.length === 0) {
    return `<tr><td colspan="3" style="padding:3rem; text-align:center; color:var(--text-muted);">검색 결과가 없습니다</td></tr>`;
  }

  return members.map(name => {
    const isMaster = state.guildData[state.rankAssignGuild]?.guild_master_name === name;
    const currentRank = isMaster ? '길드마스터' : (memberRanks[name] || '일반 길드원');
    
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.03); transition:background 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.01)'" onmouseleave="this.style.background='transparent'">
        <td style="padding:1rem 1.5rem;">
          <div style="font-weight:700; color:var(--text-main);">${name}</div>
        </td>
        <td style="padding:1rem 1.5rem;">
          <span class="label-pill ${(isMaster || currentRank === '부마스터') ? 'orange' : (currentRank === '일반 길드원' ? '' : 'primary')}" style="font-size:0.75rem; padding:0.2rem 0.6rem;">
            ${currentRank}
          </span>
        </td>
        <td style="padding:1rem 1.5rem;text-align:right;">
          ${isMaster ? '<span style="font-size:0.8rem; opacity:0.3;">자동 고정</span>' : `
            <select class="input-field" style="width:140px;padding:0.4rem 0.8rem;font-size:0.8rem; background:rgba(255,255,255,0.02);" 
              onchange="Store.setMemberRank('${name}', this.value); renderRanks(document.getElementById('contentArea'))">
              <option value="일반 길드원" ${currentRank === '일반 길드원' ? 'selected' : ''}>일반 길드원</option>
              ${ranks.map(r => `<option value="${r.name}" ${currentRank === r.name ? 'selected' : ''}>${r.name}</option>`).join('')}
            </select>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function addRank() {
  const name = document.getElementById('newRankName').value.trim();
  const cond = document.getElementById('newRankCond').value.trim();
  const benefit = document.getElementById('newRankBenefit').value.trim();
  if (!name || !state.rankConfigGuild) return;
  const ranks = Store.getRanks(state.rankConfigGuild);
  ranks.push({ name, condition: cond, benefit });
  Store.setRanks(ranks, state.rankConfigGuild);
  renderRanks(document.getElementById('contentArea'));
}

function removeRank(name) {
  if (!state.rankConfigGuild) return;
  let ranks = Store.getRanks(state.rankConfigGuild).filter(r => r.name !== name);
  Store.setRanks(ranks, state.rankConfigGuild);
  renderRanks(document.getElementById('contentArea'));
}

// ── Init ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await Store.init();
  
  if (Store.isSetupDone() && Store.getGuilds().length > 0) {
    // 이미 설정 완료 → 메인 앱 표시
    document.getElementById('onboardingScreen').style.display = 'none';
    document.getElementById('app').style.display = '';
    showLoading(true);
    
    document.getElementById('refreshBtn').addEventListener('click', () => {
      Store._set('guild_cache', {});
      loadAllGuilds();
    });
    
    // Penalty modal observer
    const penaltyModal = document.getElementById('penaltyModal');
    if (penaltyModal) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          if (m.target.id === 'penaltyModal' && m.target.classList.contains('visible')) {
            const sel = document.getElementById('penaltyTarget');
            const all = Object.values(state.guildMembers).flat().sort();
            sel.innerHTML = all.map(n => `<option value="${n}">${n}</option>`).join('');
          }
        });
      });
      observer.observe(penaltyModal, { attributes: true, attributeFilter:['class'] });
    }
    
    loadAllGuilds();
  } else {
    // 최초 방문 → 온보딩 표시
    showLoading(false);
    document.getElementById('onboardingScreen').style.display = '';
    document.getElementById('app').style.display = 'none';
  }
});
