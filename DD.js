// ─── STATE ──────────────────────────────────────────────────
let selectedFW = 'pros-cons';
let useAI = false;
let currentResultHTML = '';
let currentResultText = '';
let currentDecision = '';
let currentContext = '';
let currentOpenHistId = null;

const FW_NAMES = {
  'pros-cons':'Pros & Cons',
  'weighted':'Weighted Scoring',
  '10-10-10':'10-10-10 Rule',
  'devils-advocate':"Devil's Advocate"
};

// ═══════════════════════════════════════════════════════════════
// AUTH MODULE — sign up / sign in / sign out (client-side only)
// Storage layout:
//   dd_users           → { username: { passwordHash, createdAt } }
//   dd_current_user    → currently signed-in username (or empty)
//   dd_history_<user>  → that user's saved decisions
//   dd_history         → legacy / guest history (kept for back-compat)
// ═══════════════════════════════════════════════════════════════
let currentUser = null;          // username string or null
let authMode = 'signin';         // 'signin' | 'signup'

async function hashPassword(pw) {
  // SHA-256 with a tiny app-specific salt. Not bulletproof — but this is a
  // local-only profile system, so it's only meant to stop casual snooping
  // of the localStorage contents. There is no server round-trip.
  const salted = 'dd::v1::' + pw;
  const buf = new TextEncoder().encode(salted);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem('dd_users') || '{}'); }
  catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem('dd_users', JSON.stringify(users));
}

function getCurrentUser() {
  return localStorage.getItem('dd_current_user') || null;
}
function setCurrentUser(username) {
  if (username) localStorage.setItem('dd_current_user', username);
  else localStorage.removeItem('dd_current_user');
  currentUser = username || null;
}

function avatarLetter(name) {
  return (name||'?').trim().charAt(0).toUpperCase() || '?';
}

// ─── Modal control ──────────────────────────────────────────────
function openAuthModal(mode) {
  authMode = mode || 'signin';
  switchAuthTab(authMode);
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authConfirm').value = '';
  document.getElementById('authOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(()=>document.getElementById('authUsername').focus(), 80);
}
function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function switchAuthTab(mode) {
  authMode = mode;
  const isSignUp = mode === 'signup';
  document.getElementById('tabSignIn').classList.toggle('active', !isSignUp);
  document.getElementById('tabSignUp').classList.toggle('active', isSignUp);
  document.getElementById('confirmField').style.display = isSignUp ? 'flex' : 'none';
  document.getElementById('authTitle').textContent = isSignUp ? 'Create your account' : 'Welcome back';
  document.getElementById('authSub').textContent = isSignUp
    ? 'Your decisions stay private to your account, stored only in this browser.'
    : 'Sign in to keep your decisions private and synced across this browser.';
  document.getElementById('authSubmitBtn').textContent = isSignUp ? 'Create Account' : 'Sign In';
  document.getElementById('authPassword').setAttribute('autocomplete', isSignUp ? 'new-password' : 'current-password');
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

// ─── Sign up / Sign in / Sign out ──────────────────────────────
async function handleAuthSubmit() {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const confirm  = document.getElementById('authConfirm').value;
  const btn = document.getElementById('authSubmitBtn');

  if (!username) return showAuthError('Please enter a username.');
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(username))
    return showAuthError('Username: 2–30 characters, letters/numbers/_.- only.');
  if (!password || password.length < 6)
    return showAuthError('Password must be at least 6 characters.');

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Working…';

  try {
    const users = getUsers();
    const key = username.toLowerCase();
    const hash = await hashPassword(password);

    if (authMode === 'signup') {
      if (password !== confirm) {
        showAuthError('Passwords don\'t match.');
        return;
      }
      if (users[key]) {
        showAuthError('That username is already taken on this browser.');
        return;
      }
      users[key] = {
        displayName: username,
        passwordHash: hash,
        createdAt: new Date().toISOString()
      };
      saveUsers(users);
      setCurrentUser(key);
      closeAuthModal();
      applyAuthState();
      toast(`Welcome, ${username}! Account created.`, 'success');
    } else {
      // sign in
      const u = users[key];
      if (!u) {
        showAuthError('No account with that username. Try "Create Account".');
        return;
      }
      if (u.passwordHash !== hash) {
        showAuthError('Incorrect password. Try again.');
        return;
      }
      setCurrentUser(key);
      closeAuthModal();
      applyAuthState();
      toast(`Welcome back, ${u.displayName||username}!`, 'success');
    }
  } catch (err) {
    console.error(err);
    showAuthError('Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function signOut() {
  const name = currentDisplayName();
  closeUserDropdown();
  setCurrentUser(null);
  applyAuthState();
  // If we were on the history page, the locked state will render automatically
  if (document.getElementById('page-history').classList.contains('active')) {
    renderHistoryGrid();
  }
  toast(`Signed out${name?', '+name:''}. See you soon.`, 'info');
}

function currentDisplayName() {
  if (!currentUser) return null;
  const u = getUsers()[currentUser];
  return u ? (u.displayName || currentUser) : currentUser;
}

// ─── User dropdown ─────────────────────────────────────────────
function toggleUserDropdown(e) {
  e?.stopPropagation();
  document.getElementById('userDropdown').classList.toggle('open');
}
function closeUserDropdown() {
  document.getElementById('userDropdown')?.classList.remove('open');
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('userMenuWrap');
  if (wrap && !wrap.contains(e.target)) closeUserDropdown();
});

// ─── Apply auth state to the UI ────────────────────────────────
function applyAuthState() {
  currentUser = getCurrentUser();
  const signedIn = !!currentUser;
  const signInBtn = document.getElementById('navSignInBtn');
  const userWrap  = document.getElementById('userMenuWrap');

  if (signedIn) {
    const display = currentDisplayName();
    signInBtn.style.display = 'none';
    userWrap.style.display = 'block';
    document.getElementById('umAvatar').textContent = avatarLetter(display);
    document.getElementById('umName').textContent  = display;
    document.getElementById('udUsername').textContent = display;
    const u = getUsers()[currentUser];
    if (u && u.createdAt) {
      const d = new Date(u.createdAt);
      document.getElementById('udMeta').textContent =
        'Member since ' + d.toLocaleDateString('en-GB',{month:'short',year:'numeric'});
    } else {
      document.getElementById('udMeta').textContent = '';
    }
  } else {
    signInBtn.style.display = 'flex';
    userWrap.style.display = 'none';
  }
  updateHistCount();
  if (document.getElementById('page-history')?.classList.contains('active')) {
    renderHistoryGrid();
  }
}

// ═══════════════════════════════════════════════════════════════

// ─── PAGE ROUTING ────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  window.scrollTo(0,0);
  if (name === 'history') renderHistoryGrid();
}

// ─── FRAMEWORK SELECTION ────────────────────────────────────
function selectFW(el) {
  document.querySelectorAll('.fp-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedFW = el.dataset.fw;
  document.getElementById('rFwBadge').textContent = FW_NAMES[selectedFW];
  renderManualInputs();
}
function selectFWByName(name) {
  const el = document.querySelector(`.fp-opt[data-fw="${name}"]`);
  if (el) selectFW(el);
}

// ─── AI TOGGLE ───────────────────────────────────────────────
// ─── PROVIDER CONFIG ─────────────────────────────────────────
const PROVIDERS = {
  claude: {
    name:'Claude (Anthropic)',
    keyPlaceholder:'sk-ant-api03-...',
    keyLink:'https://console.anthropic.com/settings/keys',
    keyLinkText:'console.anthropic.com',
    models:['claude-sonnet-4-20250514','claude-3-5-haiku-20241022','claude-opus-4-20250514'],
    modelDefault:'claude-sonnet-4-20250514'
  },
  openai: {
    name:'ChatGPT (OpenAI)',
    keyPlaceholder:'sk-...',
    keyLink:'https://platform.openai.com/api-keys',
    keyLinkText:'platform.openai.com',
    models:['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'],
    modelDefault:'gpt-4o'
  },
  gemini: {
    name:'Gemini (Google)',
    keyPlaceholder:'AIza...',
    keyLink:'https://aistudio.google.com/app/apikey',
    keyLinkText:'aistudio.google.com',
    models:['gemini-1.5-pro','gemini-1.5-flash','gemini-2.0-flash'],
    modelDefault:'gemini-1.5-pro'
  },
  custom: {
    name:'Custom (OpenAI-compatible)',
    keyPlaceholder:'your-api-key',
    keyLink:null,
    models:['custom-model'],
    modelDefault:'custom-model',
    showEndpoint:true
  }
};

let selectedProvider = 'claude';

function onToggleAI() {
  useAI = document.getElementById('aiToggle').checked;
  document.getElementById('aiProviderPanel').style.display = useAI ? 'block' : 'none';
  document.getElementById('aiToggleCard').classList.toggle('ai-on', useAI);
  const modeBadge = document.getElementById('rModeBadge');
  if (useAI) {
    modeBadge.textContent = 'AI';
    modeBadge.className = 'r-badge r-mode-badge-ai';
    renderProviderFields();
  } else {
    modeBadge.textContent = 'Manual';
    modeBadge.className = 'r-badge r-mode-badge-manual';
  }
  renderManualInputs();
}

function selectProvider(el) {
  document.querySelectorAll('.ai-provider-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  selectedProvider = el.dataset.provider;
  renderProviderFields();
}

function renderProviderFields() {
  const p = PROVIDERS[selectedProvider];
  const fields = document.getElementById('aiConfigFields');
  const modelsHTML = p.models.map(m=>`<option value="${m}"${m===p.modelDefault?' selected':''}>${m}</option>`).join('');
  const keyNote = p.keyLink
    ? `Get your free key at <a href="${p.keyLink}" target="_blank">${p.keyLinkText}</a>`
    : 'Paste your API key from your provider dashboard';

  fields.innerHTML = `
    ${p.showEndpoint ? `<div class="ai-field-group">
      <div class="ai-field-label">API Endpoint URL</div>
      <input class="ai-key-inp" id="aiEndpoint" type="text" placeholder="https://your-endpoint/v1/chat/completions"/>
    </div>` : ''}
    <div class="ai-field-group">
      <div class="ai-field-label">API Key</div>
      <input class="ai-key-inp" id="aiApiKey" type="password" placeholder="${p.keyPlaceholder}" autocomplete="off"/>
      <div class="ai-field-note">${keyNote}</div>
    </div>
    <div class="ai-field-group">
      <div class="ai-field-label">Model</div>
      <select class="ai-model-select" id="aiModel">${modelsHTML}</select>
    </div>`;
}

// ─── MANUAL INPUTS RENDERER ──────────────────────────────────
function renderManualInputs() {
  const wrap = document.getElementById('manualInputsWrap');
  if (useAI) { wrap.innerHTML = ''; return; }

  if (selectedFW === 'pros-cons') {
    wrap.innerHTML = `<div class="manual-box">
      <div class="manual-box-title">Your Pros & Cons</div>
      <div>
        <div class="mini-label">✅ Pros — reasons to do it</div>
        <div id="prosList"></div>
        <button class="add-btn" onclick="addListItem('prosList','pro')">+ Add a Pro</button>
      </div>
      <div>
        <div class="mini-label">❌ Cons — reasons against</div>
        <div id="consList"></div>
        <button class="add-btn" onclick="addListItem('consList','con')">+ Add a Con</button>
      </div>
      <div>
        <div class="mini-label">Your Verdict <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div>
        <textarea class="mini-ta" id="manualVerdict" placeholder="What do you think you should do and why?"></textarea>
      </div>
    </div>`;
    addListItem('prosList','pro'); addListItem('prosList','pro');
    addListItem('consList','con'); addListItem('consList','con');

  } else if (selectedFW === 'weighted') {
    wrap.innerHTML = `<div class="manual-box">
      <div class="manual-box-title">Weighted Scoring</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div class="mini-label">Option A</div><input class="mini-inp" id="optA" placeholder="e.g. Take new job" oninput="updateCritLabels()"/></div>
        <div><div class="mini-label">Option B</div><input class="mini-inp" id="optB" placeholder="e.g. Stay at current" oninput="updateCritLabels()"/></div>
      </div>
      <div>
        <div class="mini-label">Criteria — score each option 1–10</div>
        <div id="criteriaList"></div>
        <button class="add-btn" onclick="addCriteria()">+ Add Criteria</button>
      </div>
    </div>`;
    addCriteria('Salary / Financial',8,6);
    addCriteria('Career Growth',9,5);
    addCriteria('Work-Life Balance',5,8);

  } else if (selectedFW === '10-10-10') {
    wrap.innerHTML = `<div class="manual-box">
      <div class="manual-box-title">10-10-10 Rule</div>
      <div><div class="mini-label">⚡ In 10 Minutes — immediate reaction</div><textarea class="mini-ta" id="t10m" placeholder="How will I feel right after choosing this?"></textarea></div>
      <div><div class="mini-label">📅 In 10 Months — short-term consequences</div><textarea class="mini-ta" id="t10mo" placeholder="What will life look like in about a year?"></textarea></div>
      <div><div class="mini-label">🔭 In 10 Years — long-term view</div><textarea class="mini-ta" id="t10y" placeholder="From a decade away, how significant is this?"></textarea></div>
      <div><div class="mini-label">Your Verdict <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div><textarea class="mini-ta" id="manualVerdict" placeholder="Which choice holds up across all three horizons?"></textarea></div>
    </div>`;

  } else if (selectedFW === 'devils-advocate') {
    wrap.innerHTML = `<div class="manual-box">
      <div class="manual-box-title">Devil's Advocate</div>
      <div><div class="mini-label">Your Likely Instinct</div><input class="mini-inp" id="daInstinct" placeholder="What do you think you want to do?"/></div>
      <div><div class="mini-label">Challenges Against It</div><div id="daChallenges"></div><button class="add-btn" onclick="addDAItem('daChallenges','Challenge — e.g. What if the team is toxic?')">+ Add Challenge</button></div>
      <div><div class="mini-label">Hidden Assumptions</div><div id="daAssumptions"></div><button class="add-btn" onclick="addDAItem('daAssumptions','Assumption — e.g. The offer won\\'t expire...')">+ Add Assumption</button></div>
      <div><div class="mini-label">The Stronger Alternative</div><textarea class="mini-ta" id="daAlt" placeholder="Make the case for the opposite choice..."></textarea></div>
      <div><div class="mini-label">Your Verdict <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div><textarea class="mini-ta" id="manualVerdict" placeholder="After stress-testing both sides, what's soundest?"></textarea></div>
    </div>`;
    addDAItem('daChallenges','e.g. What if the new role has a toxic manager?');
    addDAItem('daChallenges','e.g. What if the salary bump doesn\'t offset the stress?');
    addDAItem('daAssumptions','e.g. Assuming the grass is always greener...');
    addDAItem('daAssumptions','e.g. Assuming my current company won\'t improve...');
  }
}

function addListItem(listId, type) {
  const list = document.getElementById(listId);
  const row = document.createElement('div'); row.className = 'item-row';
  const inp = document.createElement('input'); inp.className = 'mini-inp';
  inp.placeholder = type==='pro' ? 'e.g. Higher salary, more growth opportunities…' : 'e.g. Longer commute, uncertain team culture…';
  const rm = document.createElement('button'); rm.className = 'rm-btn'; rm.textContent = '×'; rm.onclick = ()=>row.remove();
  row.append(inp,rm); list.appendChild(row);
}

function addCriteria(name='',a='',b='') {
  const list = document.getElementById('criteriaList');
  const div = document.createElement('div'); div.className = 'crit-card';
  const oA = document.getElementById('optA')?.value||'Option A';
  const oB = document.getElementById('optB')?.value||'Option B';
  div.innerHTML = `<div class="crit-header">
    <input class="mini-inp" placeholder="Criteria e.g. Salary" value="${esc(name)}"/>
    <button class="rm-btn" onclick="this.closest('.crit-card').remove()">×</button>
  </div>
  <div class="crit-scores">
    <div><div class="mini-label crit-lbl-a">${esc(oA)} Score</div><input class="mini-inp score-inp" type="number" min="1" max="10" placeholder="1–10" value="${a}"/></div>
    <div><div class="mini-label crit-lbl-b">${esc(oB)} Score</div><input class="mini-inp score-inp" type="number" min="1" max="10" placeholder="1–10" value="${b}"/></div>
  </div>`;
  list.appendChild(div);
}

function updateCritLabels() {
  const oA = document.getElementById('optA')?.value||'Option A';
  const oB = document.getElementById('optB')?.value||'Option B';
  document.querySelectorAll('.crit-lbl-a').forEach(l=>l.textContent=oA+' Score');
  document.querySelectorAll('.crit-lbl-b').forEach(l=>l.textContent=oB+' Score');
}

function addDAItem(listId, placeholder) {
  const list = document.getElementById(listId);
  const row = document.createElement('div'); row.className = 'item-row';
  const inp = document.createElement('input'); inp.className = 'mini-inp'; inp.placeholder = placeholder;
  const rm = document.createElement('button'); rm.className = 'rm-btn'; rm.textContent = '×'; rm.onclick = ()=>row.remove();
  row.append(inp,rm); list.appendChild(row);
}

// ─── COLLECT MANUAL DATA ─────────────────────────────────────
function collectManual() {
  if (selectedFW === 'pros-cons') {
    return {
      pros: [...document.querySelectorAll('#prosList .mini-inp')].map(i=>i.value.trim()).filter(Boolean),
      cons: [...document.querySelectorAll('#consList .mini-inp')].map(i=>i.value.trim()).filter(Boolean),
      verdict: document.getElementById('manualVerdict')?.value.trim()||''
    };
  } else if (selectedFW === 'weighted') {
    return {
      optA: document.getElementById('optA')?.value.trim()||'Option A',
      optB: document.getElementById('optB')?.value.trim()||'Option B',
      criteria: [...document.querySelectorAll('#criteriaList .crit-card')].map(c=>{
        const inps=c.querySelectorAll('input');
        return {name:inps[0]?.value.trim()||'',scoreA:parseInt(inps[1]?.value)||0,scoreB:parseInt(inps[2]?.value)||0};
      }).filter(c=>c.name)
    };
  } else if (selectedFW === '10-10-10') {
    return {
      t10m: document.getElementById('t10m')?.value.trim()||'',
      t10mo: document.getElementById('t10mo')?.value.trim()||'',
      t10y: document.getElementById('t10y')?.value.trim()||'',
      verdict: document.getElementById('manualVerdict')?.value.trim()||''
    };
  } else {
    return {
      instinct: document.getElementById('daInstinct')?.value.trim()||'',
      challenges: [...document.querySelectorAll('#daChallenges .mini-inp')].map(i=>i.value.trim()).filter(Boolean),
      assumptions: [...document.querySelectorAll('#daAssumptions .mini-inp')].map(i=>i.value.trim()).filter(Boolean),
      alt: document.getElementById('daAlt')?.value.trim()||'',
      verdict: document.getElementById('manualVerdict')?.value.trim()||''
    };
  }
}

// ─── BUILD MANUAL HTML ───────────────────────────────────────
function buildManualHTML(decision, context, data) {
  const fw = selectedFW;
  let html = `<div class="res-section"><div class="res-section-title">Decision</div><p style="font-size:14px;font-weight:600;line-height:1.5">${esc(decision)}${context?`<span style="font-weight:400;color:var(--ink-muted);font-size:13px;display:block;margin-top:4px">${esc(context)}</span>`:''}</p></div>`;

  if (fw === 'pros-cons') {
    const pros = data.pros.length ? data.pros.map(p=>`<li><span class="pc-bullet">●</span>${esc(p)}</li>`).join('') : `<li><span class="pc-bullet">●</span><span class="empty-state">No pros added</span></li>`;
    const cons = data.cons.length ? data.cons.map(c=>`<li><span class="pc-bullet">●</span>${esc(c)}</li>`).join('') : `<li><span class="pc-bullet">●</span><span class="empty-state">No cons added</span></li>`;
    html += `<div class="res-section"><div class="res-section-title">Pros & Cons Analysis</div>
      <div class="pc-cols">
        <div class="pc-col pros"><div class="pc-col-title">✅ Pros (${data.pros.length})</div><ul class="pc-list">${pros}</ul></div>
        <div class="pc-col cons"><div class="pc-col-title">❌ Cons (${data.cons.length})</div><ul class="pc-list">${cons}</ul></div>
      </div></div>`;
    const total = data.pros.length + data.cons.length;
    const pct = total>0 ? Math.round(data.pros.length/total*100) : 50;
    const lean = pct>58 ? '👍 Leans toward doing it' : pct<42 ? '👎 Leans against doing it' : '⚖️ Roughly balanced';
    html += `<div class="balance-bar-wrap"><div class="bal-label">Balance Score</div><div class="bal-track"><div class="bal-fill" id="balFill" style="width:0%"></div></div><div class="bal-info"><div class="bal-lean">${lean}</div><div class="bal-score">${data.pros.length} Pros · ${data.cons.length} Cons</div></div></div>`;
    if (data.verdict) html += `<div class="verdict-box" style="margin-top:16px"><div class="verdict-label">🎯 Your Verdict</div><div class="verdict-text">${esc(data.verdict)}</div></div>`;
    setTimeout(()=>{const el=document.getElementById('balFill');if(el)el.style.width=pct+'%'},100);

  } else if (fw === 'weighted') {
    const totA = data.criteria.reduce((s,c)=>s+c.scoreA,0);
    const totB = data.criteria.reduce((s,c)=>s+c.scoreB,0);
    const max = data.criteria.length * 10;
    const winner = totA>=totB ? data.optA : data.optB;
    const rows = data.criteria.map(c=>`<tr>
      <td style="font-weight:600;font-size:13px">${esc(c.name)}</td>
      <td><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" style="width:0%" data-w="${c.scoreA*10}"></div></div><span class="bar-num">${c.scoreA}</span></div></td>
      <td><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" style="width:0%" data-w="${c.scoreB*10}"></div></div><span class="bar-num">${c.scoreB}</span></div></td>
    </tr>`).join('');
    html += `<div class="res-section"><div class="res-section-title">Scoring Table</div>
      ${data.criteria.length?`<table class="score-tbl">
        <thead><tr><th>Criteria</th><th>${esc(data.optA)}</th><th>${esc(data.optB)}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:var(--bg)"><td style="font-weight:700">Total Score</td>
          <td><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" style="width:0%" data-w="${max>0?Math.round(totA/max*100):0}"></div></div><span class="bar-num" style="font-size:15px">${totA}</span></div></td>
          <td><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" style="width:0%" data-w="${max>0?Math.round(totB/max*100):0}"></div></div><span class="bar-num" style="font-size:15px">${totB}</span></div></td>
        </tr></tfoot>
      </table>` : '<p class="empty-state">No criteria added.</p>'}
    </div>`;
    if (data.criteria.length) html += `<div class="verdict-box"><div class="verdict-label">🎯 Result</div><div class="verdict-text"><strong>${esc(winner)}</strong> scores higher (${totA>=totB?totA:totB}/${max} vs ${totA>=totB?totB:totA}/${max}). Based on your weighted criteria, this option better aligns with your priorities.</div></div>`;
    setTimeout(()=>{ document.querySelectorAll('.bar-fill[data-w]').forEach(el=>{el.style.width=el.dataset.w+'%'}); },100);

  } else if (fw === '10-10-10') {
    html += `<div class="res-section"><div class="res-section-title">The Three Time Horizons</div>
      <div class="tl-grid">
        <div class="tl-card"><div class="tl-period">⚡ In 10 Minutes</div><div class="tl-content">${data.t10m||'<span class="empty-state">Not filled in</span>'}</div></div>
        <div class="tl-card"><div class="tl-period">📅 In 10 Months</div><div class="tl-content">${data.t10mo||'<span class="empty-state">Not filled in</span>'}</div></div>
        <div class="tl-card"><div class="tl-period">🔭 In 10 Years</div><div class="tl-content">${data.t10y||'<span class="empty-state">Not filled in</span>'}</div></div>
      </div></div>`;
    if (data.verdict) html += `<div class="verdict-box"><div class="verdict-label">🎯 Your Verdict</div><div class="verdict-text">${esc(data.verdict)}</div></div>`;

  } else {
    const challenges = data.challenges.length ? data.challenges.map(c=>`<div class="da-challenge">${esc(c)}</div>`).join('') : '<div class="da-challenge empty-state">No challenges added</div>';
    const assumptions = data.assumptions.length ? data.assumptions.map(a=>`<div class="da-assumption">${esc(a)}</div>`).join('') : '<div class="da-assumption empty-state">No assumptions listed</div>';
    if (data.instinct) html += `<div class="res-section"><div class="res-section-title">Your Likely Instinct</div><p style="font-size:14px;font-weight:600">${esc(data.instinct)}</p></div>`;
    html += `<div class="res-section"><div class="res-section-title">Challenges Against It</div>${challenges}</div>`;
    html += `<div class="res-section"><div class="res-section-title">Hidden Assumptions</div>${assumptions}</div>`;
    if (data.alt) html += `<div class="res-section"><div class="res-section-title">The Stronger Alternative</div><p style="font-size:14px;line-height:1.65">${esc(data.alt)}</p></div>`;
    if (data.verdict) html += `<div class="verdict-box"><div class="verdict-label">🎯 Your Verdict</div><div class="verdict-text">${esc(data.verdict)}</div></div>`;
  }
  return html;
}

// ─── UNIVERSAL AI CALLER ─────────────────────────────────────
async function callAIProvider(provider, apiKey, model, prompt) {
  let url, headers, body, extractFn;

  if (provider === 'claude') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    body = JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
    extractFn = d => { if(d.error) throw new Error(d.error.message); return d.content?.map(b=>b.text||'').join('')||''; };

  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    body = JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
    extractFn = d => { if(d.error) throw new Error(d.error.message); return d.choices?.[0]?.message?.content||''; };

  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1400 } });
    extractFn = d => { if(d.error) throw new Error(d.error.message); return d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||''; };

  } else if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    body = JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
    extractFn = d => { if(d.error) throw new Error(d.error.message||JSON.stringify(d.error)); return d.choices?.[0]?.message?.content||''; };

  } else if (provider === 'mistral') {
    url = 'https://api.mistral.ai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    body = JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
    extractFn = d => { if(d.error) throw new Error(d.error.message||JSON.stringify(d.error)); return d.choices?.[0]?.message?.content||''; };

  } else if (provider === 'custom') {
    const endpoint = document.getElementById('aiEndpoint')?.value.trim();
    if (!endpoint) throw new Error('Please enter a custom endpoint URL.');
    url = endpoint;
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
    body = JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
    extractFn = d => { if(d.error) throw new Error(d.error.message||JSON.stringify(d.error)); return d.choices?.[0]?.message?.content||''; };

  } else {
    throw new Error('Unknown provider: ' + provider);
  }

  const response = await fetch(url, { method: 'POST', headers, body });
  let data;
  try { data = await response.json(); } catch(e) { throw new Error('Invalid response from API. Check your key and try again.'); }
  if (!response.ok && !data.error) throw new Error(`API error ${response.status}: ${response.statusText}`);
  return extractFn(data);
}

// ─── AI PROMPT & RENDER ──────────────────────────────────────
function getAIPrompt(decision, context) {
  const ctx = context ? `\n\nAdditional context: ${context}` : '';
  const p = {
    'pros-cons': `You are a sharp, thoughtful decision coach using the Pros & Cons framework.\n\nDecision: ${decision}${ctx}\n\nRespond with these exact sections:\n### Understanding the Decision\n### Pros\n### Cons\n### Hidden Factors\n### Verdict\n\nBe concrete and specific to their situation. Use bullet points under each section.`,
    'weighted': `You are a sharp decision coach using Weighted Scoring.\n\nDecision: ${decision}${ctx}\n\nRespond with these exact sections:\n### Key Decision Criteria\n### Scoring Analysis\n### What the Numbers Say\n### Verdict\n\nScore each option 1-10 on each criterion. Be specific.`,
    '10-10-10': `You are a decision coach applying the 10-10-10 Rule.\n\nDecision: ${decision}${ctx}\n\nRespond with these exact sections:\n### In 10 Minutes\n### In 10 Months\n### In 10 Years\n### The Time Lens Insight\n### Verdict\n\nBe vivid and specific to their situation.`,
    'devils-advocate': `You are a critical thinking coach using Devil's Advocate.\n\nDecision: ${decision}${ctx}\n\nRespond with these exact sections:\n### Your Likely Instinct\n### The Case Against It\n### Assumptions Being Made\n### The Stronger Alternative\n### What This Reveals\n### Verdict\n\nBe bold and direct.`
  };
  return p[selectedFW];
}

function renderAIHTML(text) {
  let html = text
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g,m=>`<ul>${m}</ul>`)
    .replace(/\n\n/g,'</p><p>');
  const vm = html.match(/<h3>.*?Verdict.*?<\/h3>([\s\S]*?)(?=<h3>|$)/i);
  if (vm) {
    html = html.replace(vm[0], `<div class="ai-verdict"><div class="ai-verdict-label">🎯 Verdict</div>${vm[0].replace(/<h3>.*?<\/h3>/i,'')}</div>`);
  }
  return `<div class="ai-result"><p>${html}</p></div>`;
}

// ─── MAIN ANALYSE ────────────────────────────────────────────
async function analyse() {
  const decision = document.getElementById('decision').value.trim();
  if (!decision) {
    const ta = document.getElementById('decision');
    ta.focus(); ta.style.borderColor='#e74c3c';
    setTimeout(()=>ta.style.borderColor='',2500);
    toast('Please describe your decision first.','error'); return;
  }
  const context = document.getElementById('context').value.trim();
  currentDecision = decision; currentContext = context;
  const btn = document.getElementById('analyseBtn');
  const body = document.getElementById('resultBody');
  const footer = document.getElementById('resultFooter');

  btn.disabled = true;
  btn.innerHTML = '⏳ Analysing…';
  footer.style.display = 'none';
  body.innerHTML = `<div class="loader"><div class="spin-ring"></div><div class="loader-msg">Applying ${FW_NAMES[selectedFW]} framework…</div></div>`;

  try {
    if (useAI) {
      const apiKey = document.getElementById('aiApiKey')?.value.trim();
      if (!apiKey) throw new Error('Please enter your API key in the AI settings above.');
      const model = document.getElementById('aiModel')?.value || '';
      const prompt = getAIPrompt(decision, context);
      const text = await callAIProvider(selectedProvider, apiKey, model, prompt);
      currentResultHTML = renderAIHTML(text);
      currentResultText = text;
    } else {
      const data = collectManual();
      await new Promise(r=>setTimeout(r,420)); // brief delay for feel
      currentResultHTML = buildManualHTML(decision, context, data);
      currentResultText = buildResultText(decision, context, data);
    }
    body.innerHTML = currentResultHTML;
    footer.style.display = 'flex';
  } catch(err) {
    body.innerHTML = `<div class="result-placeholder"><div class="ph-dice" style="animation:none">⚠️</div><p class="ph-text" style="color:var(--red)">${esc(err.message||'Something went wrong. Please try again.')}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎲 Roll the Dice';
  }
}

function buildResultText(decision, context, data) {
  let t = `DECISION: ${decision}\n`;
  if (context) t += `CONTEXT: ${context}\n`;
  t += `FRAMEWORK: ${FW_NAMES[selectedFW]}\n\n`;
  if (selectedFW==='pros-cons') {
    t+=`PROS:\n${data.pros.map(p=>`• ${p}`).join('\n')||'(none)'}\n\nCONS:\n${data.cons.map(c=>`• ${c}`).join('\n')||'(none)'}`;
    if(data.verdict) t+=`\n\nVERDICT:\n${data.verdict}`;
  } else if (selectedFW==='weighted') {
    t+=`OPTIONS: ${data.optA} vs ${data.optB}\n\nCRITERIA:\n`;
    data.criteria.forEach(c=>t+=`${c.name}: ${data.optA}=${c.scoreA}, ${data.optB}=${c.scoreB}\n`);
    const tA=data.criteria.reduce((s,c)=>s+c.scoreA,0), tB=data.criteria.reduce((s,c)=>s+c.scoreB,0);
    t+=`\nTOTALS: ${data.optA}=${tA}, ${data.optB}=${tB}`;
  } else if (selectedFW==='10-10-10') {
    t+=`IN 10 MINUTES:\n${data.t10m||'—'}\n\nIN 10 MONTHS:\n${data.t10mo||'—'}\n\nIN 10 YEARS:\n${data.t10y||'—'}`;
    if(data.verdict) t+=`\n\nVERDICT:\n${data.verdict}`;
  } else {
    t+=`INSTINCT: ${data.instinct||'—'}\n\nCHALLENGES:\n${data.challenges.map(c=>`• ${c}`).join('\n')||'(none)'}\n\nASSUMPTIONS:\n${data.assumptions.map(a=>`• ${a}`).join('\n')||'(none)'}`;
    if(data.alt) t+=`\n\nSTRONGER ALTERNATIVE:\n${data.alt}`;
    if(data.verdict) t+=`\n\nVERDICT:\n${data.verdict}`;
  }
  return t;
}

function clearResult() {
  document.getElementById('resultBody').innerHTML = `<div class="result-placeholder"><div class="ph-dice">🎲</div><p class="ph-text">Your structured decision analysis will appear here.</p><div class="ph-steps"><div class="ph-step" data-n="1">Describe your decision</div><div class="ph-step" data-n="2">Pick a framework</div><div class="ph-step" data-n="3">Hit Roll the Dice</div></div></div>`;
  document.getElementById('resultFooter').style.display='none';
  currentResultHTML=''; currentResultText='';
}

// ─── COPY ─────────────────────────────────────────────────────
function copyResult() {
  const t = currentResultText || document.getElementById('resultBody').innerText;
  navigator.clipboard.writeText(t).then(()=>toast('Analysis copied!','success')).catch(()=>toast('Copy failed — try selecting manually.','error'));
}

// ─── PDF EXPORT ──────────────────────────────────────────────
// ─── PURE JS PDF BUILDER (zero external deps) ────────────────
// Builds a real PDF file from scratch using raw PDF syntax.
// Supports multiline text, page breaks, bold/normal weight, colors.

function downloadPDF(htmlContent, decision, context, fw) {
  // ── 1. Extract clean text lines from the result ──
  const container = document.createElement('div');
  container.innerHTML = htmlContent || currentResultHTML || '';

  // Build structured line list from DOM
  const lines = [];
  const fwLabel = fw || FW_NAMES[selectedFW];
  const dateStr = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

  lines.push({ type:'header', text:'DecisionDice', sub: dateStr });
  lines.push({ type:'decision', text: decision||'', ctx: context||'' });
  lines.push({ type:'fwbadge', text: fwLabel });
  lines.push({ type:'gap' });

  // Walk visible DOM nodes intelligently
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    const cls = node.className || '';
    const tag = (node.tagName||'').toLowerCase();

    if (cls.includes('res-section-title') || tag==='h3') {
      lines.push({ type:'section', text: node.textContent.trim() });
    } else if (cls.includes('verdict-box') || cls.includes('ai-verdict')) {
      lines.push({ type:'verdict', text: node.textContent.replace(/🎯\s*Verdict/i,'').trim() });
    } else if (cls.includes('pc-col')) {
      const colTitle = node.querySelector('.pc-col-title')?.textContent.trim()||'';
      lines.push({ type:'colheader', text: colTitle });
      node.querySelectorAll('li').forEach(li => {
        const t = li.textContent.replace(/[●•]/g,'').trim();
        if(t) lines.push({ type:'bullet', text: t });
      });
    } else if (cls.includes('tl-card')) {
      const period = node.querySelector('.tl-period')?.textContent.trim()||'';
      const content = node.querySelector('.tl-content')?.textContent.trim()||'';
      if(period) lines.push({ type:'sublabel', text: period });
      if(content) lines.push({ type:'body', text: content });
      lines.push({ type:'smallgap' });
    } else if (cls.includes('da-challenge') || cls.includes('da-assumption')) {
      const t = node.textContent.trim();
      if(t && !t.includes('Not filled')) lines.push({ type:'bullet', text: t });
    } else if (cls.includes('balance-bar-wrap')) {
      const lean = node.querySelector('.bal-lean')?.textContent.trim()||'';
      const score = node.querySelector('.bal-score')?.textContent.trim()||'';
      if(lean) lines.push({ type:'sublabel', text: lean + (score ? '  ·  ' + score : '') });
    } else if (cls.includes('score-tbl')) {
      // table — walk rows
      node.querySelectorAll('tr').forEach((row,ri) => {
        const cells = [...row.querySelectorAll('th,td')].map(c => c.textContent.replace(/[0-9]+\s*$/,'').trim()).filter(Boolean);
        if(cells.length) lines.push({ type: ri===0?'sublabel':'body', text: cells.join('  |  ') });
      });
    } else if (tag==='p' || tag==='li') {
      const t = node.textContent.replace(/[●•]/g,'•').trim();
      if(t) lines.push({ type: tag==='li'?'bullet':'body', text: t });
    } else if (tag==='h3') {
      lines.push({ type:'section', text: node.textContent.trim() });
    } else {
      node.childNodes.forEach(walk);
    }
  }
  container.childNodes.forEach(walk);

  // ── 2. PDF building primitives ──
  // A4: 595 x 842 pt (72pt = 1 inch). 1mm ≈ 2.835pt
  const PW=595, PH=842, ML=50, MR=50, MT=50, MB=50;
  const CW = PW - ML - MR;

  // Font metrics (Helvetica proportional widths, approximate)
  const WIDTHS_NORMAL = {
    ' ':0.278,'!':0.278,'"':0.355,'#':0.556,'$':0.556,'%':0.889,'&':0.667,"'":0.191,
    '(':0.333,')':0.333,'*':0.389,'+':0.584,',':0.278,'-':0.333,'.':0.278,'/':0.278,
    '0':0.556,'1':0.556,'2':0.556,'3':0.556,'4':0.556,'5':0.556,'6':0.556,'7':0.556,
    '8':0.556,'9':0.556,':':0.278,';':0.278,'<':0.584,'=':0.584,'>':0.584,'?':0.556,
    '@':1.015,'A':0.667,'B':0.667,'C':0.722,'D':0.722,'E':0.667,'F':0.611,'G':0.778,
    'H':0.722,'I':0.278,'J':0.500,'K':0.667,'L':0.611,'M':0.833,'N':0.722,'O':0.778,
    'P':0.667,'Q':0.778,'R':0.722,'S':0.667,'T':0.611,'U':0.722,'V':0.667,'W':0.944,
    'X':0.667,'Y':0.667,'Z':0.611,'[':0.278,'\\':0.278,']':0.278,'^':0.469,'_':0.556,
    'a':0.556,'b':0.556,'c':0.500,'d':0.556,'e':0.556,'f':0.278,'g':0.556,'h':0.556,
    'i':0.222,'j':0.222,'k':0.500,'l':0.222,'m':0.833,'n':0.556,'o':0.556,'p':0.556,
    'q':0.556,'r':0.333,'s':0.500,'t':0.278,'u':0.556,'v':0.500,'w':0.722,'x':0.500,
    'y':0.500,'z':0.500,'{':0.334,'|':0.260,'}':0.334,'~':0.584
  };

  function charW(ch, bold, size) {
    const base = WIDTHS_NORMAL[ch] || 0.556;
    return base * (bold ? 1.05 : 1.0) * size;
  }

  function measureStr(str, bold, size) {
    return [...str].reduce((s,c)=>s+charW(c,bold,size), 0);
  }

  function wrapText(text, bold, size, maxW) {
    const words = text.split(' ');
    const result = [];
    let line = '';
    for (const word of words) {
      const test = line ? line+' '+word : word;
      if (measureStr(test, bold, size) > maxW && line) {
        result.push(line);
        line = word;
      } else { line = test; }
    }
    if (line) result.push(line);
    return result.length ? result : [''];
  }

  // ── 3. Encode text as PDF literal string ──
  function pdfStr(s) {
    // Strip non-latin chars (emojis etc become spaces), escape PDF specials
    let out = '';
    for (const ch of s) {
      const code = ch.codePointAt(0);
      if (code > 255) { out += ' '; continue; }
      if (ch==='(' || ch===')' || ch==='\\') out += '\\'+ch;
      else out += ch;
    }
    return '(' + out + ')';
  }

  // ── 4. Page stream builder ──
  const pages = []; // each page: array of stream ops
  let page = [];
  let y = PH - MT; // top of content
  let inTextBlock = false;

  function endText() { if(inTextBlock){page.push('ET'); inTextBlock=false;} }
  function beginText() { if(!inTextBlock){page.push('BT'); inTextBlock=true;} }

  function newPage() {
    endText();
    // Footer for current page
    page.push('BT');
    page.push(`/F1 8 Tf`);
    page.push(`0.608 0.584 0.561 rg`);
    page.push(`${ML} ${MB-18} Td`);
    page.push(`${pdfStr('DecisionDice  -  Make smarter choices')} Tj`);
    page.push(`${CW - 60} 0 Td`);
    page.push(`${pdfStr('decisondice.app')} Tj`);
    page.push('ET');
    pages.push([...page]);
    page = [];
    y = PH - MT;
  }

  function checkY(needed) { if (y - needed < MB + 20) newPage(); }

  function drawRect(x, ry, w, h, r, g, b, fill=true) {
    endText();
    page.push(`${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)} ${fill?'rg':'RG'}`);
    page.push(`${x} ${ry} ${w} ${h} re ${fill?'f':'S'}`);
  }

  function drawLine(x1,y1,x2,y2,r,g,b,lw=0.5) {
    endText();
    page.push(`${lw} w`);
    page.push(`${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)} RG`);
    page.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  }

  function textLine(text, x, ty, font, size, r, g, b) {
    beginText();
    page.push(`/${font} ${size} Tf`);
    page.push(`${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)} rg`);
    page.push(`${x} ${ty} Td`);
    page.push(`${pdfStr(text)} Tj`);
    endText();
  }

  function addWrappedText(text, x, startY, font, size, r, g, b, lineH, maxW) {
    const bold = font==='F2';
    const wrapped = wrapText(text, bold, size, maxW);
    let cy = startY;
    wrapped.forEach(line => {
      textLine(line, x, cy, font, size, r, g, b);
      cy -= lineH;
    });
    return cy; // returns y after last line
  }

  // ── 5. Render page 1 header ──
  // Dark header bar
  drawRect(0, PH-55, PW, 55, 26, 24, 20, true);
  textLine('DecisionDice', ML, PH-33, 'F2', 18, 200, 135, 58);
  textLine(dateStr, PW-MR-measureStr(dateStr,false,9)-2, PH-33, 'F1', 9, 160, 155, 148);
  textLine('Smart Decision Making Tool', ML, PH-47, 'F1', 8, 130, 125, 118);
  y = PH - 75;

  // Decision box
  const decLines = wrapText(decision||'', true, 12, CW-16);
  const ctxLines = context ? wrapText(context, false, 9, CW-16) : [];
  const boxH = 16 + (decLines.length * 16) + (ctxLines.length * 12) + 8;
  checkY(boxH + 20);
  drawRect(ML, y - boxH, CW, boxH, 247, 244, 239, true);
  textLine('YOUR DECISION', ML+8, y-12, 'F2', 7, 107, 101, 96);
  let ty2 = y - 26;
  decLines.forEach(l => { textLine(l, ML+8, ty2, 'F2', 12, 26, 24, 20); ty2 -= 16; });
  if (context) { ty2 -= 2; ctxLines.forEach(l => { textLine(l, ML+8, ty2, 'F1', 9, 107, 101, 96); ty2 -= 12; }); }
  y -= boxH + 10;

  // Framework badge
  checkY(18);
  const badgeTxt = 'FRAMEWORK: ' + fwLabel.toUpperCase();
  const badgeW2 = measureStr(badgeTxt, true, 8) + 16;
  drawRect(ML, y-12, badgeW2, 16, 240, 220, 195, true);
  textLine(badgeTxt, ML+8, y-7, 'F2', 8, 166, 88, 24);
  y -= 26;

  // ── 6. Render content lines ──
  for (const line of lines) {
    if (line.type==='header'||line.type==='decision'||line.type==='fwbadge'||line.type==='gap') continue;

    if (line.type==='section') {
      checkY(28);
      y -= 8;
      drawLine(ML, y+2, PW-MR, y+2, 221, 217, 210, 0.5);
      y -= 4;
      textLine(line.text.replace(/[^\x20-\x7E]/g,' ').trim(), ML, y, 'F2', 12, 26, 24, 20);
      y -= 18;

    } else if (line.type==='verdict') {
      const vLines = wrapText(line.text.replace(/[^\x20-\x7E]/g,' '), false, 11, CW-20);
      const vH = 20 + vLines.length * 15 + 8;
      checkY(vH);
      y -= 6;
      drawRect(ML, y-vH, CW, vH, 26, 24, 20, true);
      textLine('VERDICT', ML+10, y-12, 'F2', 7, 200, 135, 58);
      let vy = y-24;
      vLines.forEach(l => { textLine(l, ML+10, vy, 'F1', 11, 230, 225, 218); vy -= 15; });
      y -= vH + 10;

    } else if (line.type==='colheader') {
      checkY(18);
      textLine(line.text.replace(/[^\x20-\x7E]/g,' '), ML, y, 'F2', 10, 26, 24, 20);
      y -= 16;

    } else if (line.type==='sublabel') {
      checkY(16);
      textLine(line.text.replace(/[^\x20-\x7E]/g,' '), ML, y, 'F2', 9, 107, 101, 96);
      y -= 14;

    } else if (line.type==='bullet') {
      const bLines = wrapText('• ' + line.text.replace(/[^\x20-\x7E]/g,' '), false, 10, CW-10);
      checkY(bLines.length * 14 + 2);
      bLines.forEach((l,i) => {
        textLine(i===0?l:'  '+l.replace(/^•\s*/,''), ML+4, y, 'F1', 10, 55, 52, 48);
        y -= 14;
      });

    } else if (line.type==='body') {
      const bLines = wrapText(line.text.replace(/[^\x20-\x7E]/g,' '), false, 10, CW);
      checkY(bLines.length * 14 + 2);
      bLines.forEach(l => { textLine(l, ML, y, 'F1', 10, 55, 52, 48); y -= 14; });

    } else if (line.type==='smallgap') {
      y -= 6;
    }
  }

  newPage(); // push final page

  // ── 7. Assemble raw PDF ──
  const streamBuffers = pages.map(ops => ops.join('\n'));
  const offsets = [];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';

  // Object helpers
  const objs = {};
  let nextObj = 1;
  function addObj(content) {
    const id = nextObj++;
    objs[id] = content;
    return id;
  }

  // Fonts
  const f1id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  // Pages dict placeholder
  const pagesId = nextObj++;

  // Page objects + content streams
  const pageIds = streamBuffers.map((stream, idx) => {
    const encoded = stream;
    const streamLen = encoded.length;
    const streamId = addObj(`<< /Length ${streamLen} >>\nstream\n${encoded}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
      `/Resources << /Font << /F1 ${f1id} 0 R /F2 ${f2id} 0 R >> >> ` +
      `/Contents ${streamId} 0 R >>`
    );
    return pageId;
  });

  // Pages dict
  objs[pagesId] = `<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Catalog
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  // Info
  const infoId = addObj(`<< /Title (DecisionDice Analysis) /Creator (DecisionDice) >>`);

  // Write objects
  const xrefOffsets = {};
  for (let id = 1; id < nextObj; id++) {
    xrefOffsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }

  // xref
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${nextObj}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextObj; id++) {
    pdf += xrefOffsets[id].toString().padStart(10,'0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${nextObj} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF`;

  // ── 8. Download ──
  const bytes = new Uint8Array(pdf.length);
  for (let i=0; i<pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  const blob = new Blob([bytes], {type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (decision||'analysis').substring(0,40).replace(/[^a-z0-9]/gi,'_').toLowerCase();
  a.download = `DecisionDice_${safeName}.pdf`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
  toast('PDF downloaded!','success');
}

// ─── SAVE TO HISTORY ─────────────────────────────────────────
function saveToHistory() {
  if (!currentResultHTML) return;
  if (!currentUser) {
    toast('Sign in to save decisions privately to your account.','info');
    openAuthModal('signin');
    return;
  }
  const history = getHistory();
  const entry = {
    id: Date.now().toString(),
    decision: currentDecision,
    context: currentContext,
    framework: selectedFW,
    mode: useAI ? 'ai' : 'manual',
    resultHTML: currentResultHTML,
    resultText: currentResultText || document.getElementById('resultBody').innerText,
    date: new Date().toISOString()
  };
  history.unshift(entry);
  if (history.length > 50) history.pop();
  saveHistory(history);
  updateHistCount();
  toast('Saved to your private history!','success');
}

function historyKey() {
  // Per-user key when signed in; legacy `dd_history` for guests
  return currentUser ? ('dd_history_' + currentUser) : 'dd_history';
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(historyKey())||'[]'); } catch { return []; }
}
function saveHistory(history) {
  localStorage.setItem(historyKey(), JSON.stringify(history));
}

function updateHistCount() {
  const n = getHistory().length;
  document.getElementById('navHistCount').textContent = n;
}

// ─── RENDER HISTORY ───────────────────────────────────────────
let histFilter = 'all';
function filterHistory(btn) {
  document.querySelectorAll('.hist-filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  histFilter = btn.dataset.filter;
  renderHistoryGrid();
}

function renderHistoryGrid() {
  const grid = document.getElementById('historyGrid');

  // Locked state for signed-out users
  if (!currentUser) {
    grid.innerHTML = `<div class="hist-locked">
      <div class="hist-locked-icon">🔐</div>
      <h3>Your history is private.</h3>
      <p>Sign in or create a free account to save decisions privately to your profile. Each user's history stays separate from everyone else's on this browser.</p>
      <button class="btn-primary" onclick="openAuthModal('signin')">🔐 Sign In</button>
      <button class="btn-ghost" style="margin-left:10px" onclick="openAuthModal('signup')">Create Account</button>
    </div>`;
    return;
  }

  let history = getHistory();
  if (histFilter !== 'all') history = history.filter(h=>h.framework===histFilter);

  if (!history.length) {
    grid.innerHTML = `<div class="hist-empty">
      <div class="hist-empty-icon">📋</div>
      <h3>${histFilter==='all' ? 'No decisions saved yet.' : 'No decisions with this framework.'}</h3>
      <p>${histFilter==='all' ? 'Make a decision and click "Save to History" — it\'ll appear here.' : 'Try a different filter or make a new decision.'}</p>
      <button class="btn-primary" style="margin-top:16px" onclick="showPage('home');setTimeout(()=>document.getElementById('tool').scrollIntoView({behavior:'smooth'}),100)">Make a Decision →</button>
    </div>`;
    return;
  }

  grid.innerHTML = `<div class="hist-grid">${history.map(entry=>{
    const date = new Date(entry.date);
    const dateStr = date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    const timeStr = date.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const preview = entry.resultText ? entry.resultText.substring(0,200).replace(/\n/g,' ') : 'No preview available';
    return `<div class="hist-card" onclick="openHistModal('${entry.id}')">
      <div class="hist-card-top">
        <div class="hist-card-badges">
          <span class="hist-fw-badge">${FW_NAMES[entry.framework]||entry.framework}</span>
          <span class="hist-mode-badge ${entry.mode}">${entry.mode==='ai'?'✨ AI':'📝 Manual'}</span>
        </div>
        <div class="hist-card-menu" onclick="event.stopPropagation()">
          <button class="hist-card-dots" onclick="toggleHistDD('${entry.id}',event)">⋯</button>
          <div class="hist-dropdown" id="hdd-${entry.id}">
            <button class="hist-dd-item" onclick="downloadHistPDF('${entry.id}')">⬇ Download PDF</button>
            <button class="hist-dd-item" onclick="copyHistEntry('${entry.id}')">📋 Copy Analysis</button>
            <button class="hist-dd-item danger" onclick="deleteEntry('${entry.id}',event)">🗑 Delete</button>
          </div>
        </div>
      </div>
      <div class="hist-card-decision">${esc(entry.decision)}</div>
      ${entry.context?`<div class="hist-card-context">${esc(entry.context)}</div>`:''}
      <div class="hist-card-verdict">${esc(preview)}…</div>
      <div class="hist-card-footer">
        <span class="hist-card-date">${dateStr} · ${timeStr}</span>
        <button class="hist-card-view" onclick="event.stopPropagation();openHistModal('${entry.id}')">View →</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function toggleHistDD(id, event) {
  event.stopPropagation();
  document.querySelectorAll('.hist-dropdown').forEach(d=>{ if(d.id!=='hdd-'+id) d.classList.remove('open'); });
  document.getElementById('hdd-'+id)?.classList.toggle('open');
}
document.addEventListener('click', ()=>document.querySelectorAll('.hist-dropdown').forEach(d=>d.classList.remove('open')));

function openHistModal(id) {
  const entry = getHistory().find(h=>h.id===id);
  if (!entry) return;
  currentOpenHistId = id;
  document.getElementById('modalDecision').textContent = entry.decision;
  document.getElementById('modalContext').textContent = entry.context || '';
  document.getElementById('modalBadges').innerHTML = `<span class="hist-fw-badge">${FW_NAMES[entry.framework]||entry.framework}</span><span class="hist-mode-badge ${entry.mode}">${entry.mode==='ai'?'✨ AI':'📝 Manual'}</span>`;
  document.getElementById('modalBody').innerHTML = entry.resultHTML || `<pre style="white-space:pre-wrap;font-size:13px;line-height:1.65;font-family:'Karla',sans-serif">${esc(entry.resultText||'')}</pre>`;
  document.getElementById('histModal').classList.add('open');
  document.body.style.overflow='hidden';
  // Animate bars
  setTimeout(()=>document.querySelectorAll('#modalBody .bar-fill[data-w]').forEach(el=>{el.style.width=el.dataset.w+'%'}),150);
}

function closeHistModal(event) {
  if (event && event.target !== document.getElementById('histModal')) return;
  document.getElementById('histModal').classList.remove('open');
  document.body.style.overflow='';
  currentOpenHistId = null;
}

function copyModalResult() {
  const entry = getHistory().find(h=>h.id===currentOpenHistId);
  if (!entry) return;
  const text = entry.resultText || document.getElementById('modalBody').innerText;
  navigator.clipboard.writeText(text).then(()=>toast('Copied!','success'));
}

function downloadModalPDF() {
  const entry = getHistory().find(h=>h.id===currentOpenHistId);
  if (!entry) return;
  const prevFW = selectedFW;
  selectedFW = entry.framework;
  downloadPDF(entry.resultHTML, entry.decision, entry.context, FW_NAMES[entry.framework]);
  selectedFW = prevFW;
}

function downloadHistPDF(id) {
  const entry = getHistory().find(h=>h.id===id);
  if (!entry) return;
  const prevFW = selectedFW; selectedFW = entry.framework;
  downloadPDF(entry.resultHTML, entry.decision, entry.context, FW_NAMES[entry.framework]);
  selectedFW = prevFW;
}

function copyHistEntry(id) {
  const entry = getHistory().find(h=>h.id===id);
  if (!entry) return;
  navigator.clipboard.writeText(entry.resultText||entry.decision).then(()=>toast('Copied!','success'));
}

function deleteEntry(id, event) {
  event?.stopPropagation();
  if (!confirm('Delete this decision from history?')) return;
  const history = getHistory().filter(h=>h.id!==id);
  saveHistory(history);
  updateHistCount(); renderHistoryGrid();
  toast('Deleted.','info');
}

function deleteHistoryItem() {
  if (!currentOpenHistId) return;
  closeHistModal(null);
  deleteEntry(currentOpenHistId);
}

function clearAllHistory() {
  if (!confirm('Clear all saved decisions? This cannot be undone.')) return;
  localStorage.removeItem(historyKey());
  updateHistCount(); renderHistoryGrid();
  toast('History cleared.','info');
}

// ─── TOAST ───────────────────────────────────────────────────
const ICONS = {success:'✓',error:'✕',info:'ℹ'};
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  const ic = document.getElementById('toastIcon');
  const ms = document.getElementById('toastMsg');
  ic.textContent = ICONS[type]||'';
  ms.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'), 2800);
}

// ─── UTILITY ─────────────────────────────────────────────────
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── INIT ─────────────────────────────────────────────────────
applyAuthState();      // restore session from localStorage and update nav
renderManualInputs();
updateHistCount();
// Pre-render provider fields so they're ready when AI is toggled on
renderProviderFields();

// Close auth modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('authOverlay').classList.contains('open')) {
    closeAuthModal();
  }
});

// Hero card hover animation
document.querySelectorAll('.fw-preview-card').forEach((card,i)=>{
  card.addEventListener('mouseenter',()=>{
    document.querySelectorAll('.fw-preview-card').forEach(c=>c.classList.remove('active'));
    card.classList.add('active');
  });
});
