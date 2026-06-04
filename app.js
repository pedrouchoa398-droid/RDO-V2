/* ============================================================
   RDO Obra — app.js v3
   IndexedDB | Autosave | Drafts | Fotos múltiplas | PDF
   ============================================================ */

'use strict';

// ============================================================
// 1. BANCO DE DADOS — IndexedDB
// ============================================================
const DB_NAME    = 'rdoObra';
const DB_VERSION = 3;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('projects'))  { const s = d.createObjectStore('projects',  { keyPath:'id' }); s.createIndex('nome','nome',{unique:false}); }
      if (!d.objectStoreNames.contains('teams'))     { const s = d.createObjectStore('teams',     { keyPath:'id' }); s.createIndex('nome','nome',{unique:false}); }
      if (!d.objectStoreNames.contains('reports'))   { const s = d.createObjectStore('reports',   { keyPath:'id' }); s.createIndex('data','data',{unique:false}); }
      if (!d.objectStoreNames.contains('drafts'))    { d.createObjectStore('drafts',    { keyPath:'id' }); }
      if (!d.objectStoreNames.contains('settings'))  { d.createObjectStore('settings',  { keyPath:'id' }); }
      if (!d.objectStoreNames.contains('photos'))    { const s = d.createObjectStore('photos',    { keyPath:'id' }); s.createIndex('reportId','reportId',{unique:false}); }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(store, obj)    { return new Promise((res,rej)=>{ const t=db.transaction(store,'readwrite'); t.objectStore(store).put(obj).onsuccess=e=>res(e.target.result); t.onerror=e=>rej(e.target.error); }); }
function dbGet(store, key)    { return new Promise((res,rej)=>{ const t=db.transaction(store,'readonly');  t.objectStore(store).get(key).onsuccess=e=>res(e.target.result); t.onerror=e=>rej(e.target.error); }); }
function dbDel(store, key)    { return new Promise((res,rej)=>{ const t=db.transaction(store,'readwrite'); t.objectStore(store).delete(key).onsuccess=()=>res(); t.onerror=e=>rej(e.target.error); }); }
function dbAll(store)         { return new Promise((res,rej)=>{ const t=db.transaction(store,'readonly');  const req=t.objectStore(store).getAll(); req.onsuccess=e=>res(e.target.result); req.onerror=e=>rej(e.target.error); }); }
function dbByIndex(store, idx, val) {
  return new Promise((res,rej)=>{
    const t=db.transaction(store,'readonly');
    const req=t.objectStore(store).index(idx).getAll(val);
    req.onsuccess=e=>res(e.target.result);
    req.onerror=e=>rej(e.target.error);
  });
}

// ============================================================
// 2. ESTADO EM MEMÓRIA
// ============================================================
const form = {
  obraNome: '', data: '', clima: '',
  equipesDesc: '',
  membros: [],        // [{nome, obs}]
  equipamentos: [],
  progRows: [],       // [string]
  pendRows: [],       // [string]
  obs: '',
  fotos: []           // [{id, blob, dataUrl, desc}]
};

let config = { empresa:'', resp:'', cargo:'', tel:'', email:'', end:'', logoDataUrl:'' };

// ============================================================
// 3. UTILITÁRIOS
// ============================================================
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function today() { return new Date().toISOString().slice(0,10); }

let toastTimer;
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 2800);
}

// ============================================================
// 4. TABS
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const screen = document.getElementById('screen-'+name);
  if (screen) screen.classList.add('active');
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (tab) tab.classList.add('active');
  if (name==='relatorios') renderRelatorios();
  if (name==='obras')      renderObras();
  if (name==='equipes')    renderEquipes();
  if (name==='config')     loadConfigForm();
}

// ============================================================
// 5. HEADER
// ============================================================
function updateHeader() {
  const d = new Date();
  document.getElementById('headerSub').textContent =
    d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  if (config.logoDataUrl) {
    document.getElementById('headerIcon').innerHTML = `<img src="${config.logoDataUrl}" alt="logo">`;
  } else {
    document.getElementById('headerIcon').textContent = config.empresa ? config.empresa.slice(0,2).toUpperCase() : 'RD';
  }
}

// ============================================================
// 6. CLIMA
// ============================================================
function selClima(el, val) {
  document.querySelectorAll('.clima-chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('inpClima').value = val;
  form.clima = val;
  scheduleDraft();
}

// ============================================================
// 7. FOTOS
// ============================================================
async function handleFiles(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const compressed = await compressImage(file, 1200, 0.82);
    const dataUrl = await blobToDataUrl(compressed);
    form.fotos.push({ id: uid(), blob: compressed, dataUrl, desc: '' });
  }
  e.target.value = '';
  renderFotos();
  scheduleDraft();
}

function compressImage(file, maxPx, quality) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => resolve(b || file), 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsDataURL(blob);
  });
}

function renderFotos() {
  const grid = document.getElementById('photosGrid');
  if (!form.fotos.length) { grid.innerHTML=''; return; }
  grid.innerHTML = form.fotos.map((f,i) => `
    <div class="photo-card">
      <img src="${f.dataUrl}" alt="foto ${i+1}" loading="lazy">
      <button class="photo-remove" onclick="removeFoto(${i})">✕</button>
      <input class="photo-desc-input" type="text" placeholder="Descrição da foto..."
        value="${esc(f.desc)}" oninput="form.fotos[${i}].desc=this.value;scheduleDraft()">
    </div>
  `).join('');
}

function removeFoto(i) { form.fotos.splice(i,1); renderFotos(); scheduleDraft(); }

// ============================================================
// 8. MEMBROS
// ============================================================
function addMembro(nome='', obs='') {
  form.membros.push({nome, obs});
  renderMembros();
}

function renderMembros() {
  document.getElementById('rdoMembers').innerHTML = form.membros.map((m,i)=>`
    <div class="member-item">
      <div class="member-fields">
        <input type="text" placeholder="Nome do membro" value="${esc(m.nome)}"
          oninput="form.membros[${i}].nome=this.value;scheduleDraft()">
        <input type="text" placeholder="Observação (ausência, atribuição...)" value="${esc(m.obs)}"
          oninput="form.membros[${i}].obs=this.value;scheduleDraft()">
      </div>
      <button class="member-del" onclick="form.membros.splice(${i},1);renderMembros()">🗑</button>
    </div>
  `).join('');
}

// ============================================================
// 9. EQUIPAMENTOS
// ============================================================
function addEquip() {
  const v = document.getElementById('inpEquip').value.trim();
  if (!v) return;
  form.equipamentos.push(v);
  document.getElementById('inpEquip').value='';
  renderEquipTags();
  scheduleDraft();
}

function renderEquipTags() {
  document.getElementById('equipTags').innerHTML = form.equipamentos.map((e,i)=>`
    <span class="tag">${esc(e)}
      <button class="tag-del" onclick="form.equipamentos.splice(${i},1);renderEquipTags();scheduleDraft()">✕</button>
    </span>
  `).join('');
}

// ============================================================
// 10. ATIVIDADES
// ============================================================
function addProg(txt='') {
  form.progRows.push(txt);
  renderProgRows();
}

function renderProgRows() {
  document.getElementById('progRows').innerHTML = form.progRows.map((r,i)=>`
    <div class="prog-row">
      <div class="prog-num">${i+1}</div>
      <textarea placeholder="Descreva a atividade executada..." oninput="form.progRows[${i}]=this.value;scheduleDraft()">${esc(r)}</textarea>
      <button class="prog-del" onclick="form.progRows.splice(${i},1);renderProgRows()">✕</button>
    </div>
  `).join('');
}

// ============================================================
// 11. PENDÊNCIAS
// ============================================================
function addPend(txt='') {
  form.pendRows.push(txt);
  renderPendRows();
}

function renderPendRows() {
  document.getElementById('pendRows').innerHTML = form.pendRows.map((r,i)=>`
    <div class="pend-row">
      <input type="text" placeholder="Descreva a pendência..." value="${esc(r)}"
        oninput="form.pendRows[${i}]=this.value;scheduleDraft()">
      <button class="pend-del" onclick="form.pendRows.splice(${i},1);renderPendRows()">✕</button>
    </div>
  `).join('');
}

// ============================================================
// 12. OBRAS
// ============================================================
async function salvarObra() {
  const nome = document.getElementById('obraNome').value.trim();
  if (!nome) { toast('Preencha o nome da obra!','err'); return; }
  const editId = document.getElementById('editObraId').value;
  const obra = {
    id: editId || uid(),
    nome,
    cliente: document.getElementById('obraCliente').value.trim(),
    end:     document.getElementById('obraEnd').value.trim(),
    obs:     document.getElementById('obraObs').value.trim()
  };
  await dbPut('projects', obra);
  cancelEditObra();
  await renderObras();
  await refreshSelects();
  toast('Obra salva!');
}

function cancelEditObra() {
  document.getElementById('editObraId').value='';
  document.getElementById('obraNome').value='';
  document.getElementById('obraCliente').value='';
  document.getElementById('obraEnd').value='';
  document.getElementById('obraObs').value='';
  document.getElementById('obraFormTitle').textContent='Nova Obra';
}

async function renderObras() {
  const obras = await dbAll('projects');
  document.getElementById('obraCount').textContent = `${obras.length} obra(s) salva(s)`;
  const el = document.getElementById('obrasList');
  if (!obras.length) { el.innerHTML='<div class="empty"><div class="empty-icon">🏗️</div>Nenhuma obra cadastrada</div>'; return; }
  el.innerHTML = obras.map(o=>`
    <div class="saved-item">
      <div class="si-icon">🏗️</div>
      <div class="si-info">
        <div class="si-name">${esc(o.nome)}</div>
        <div class="si-sub">${esc(o.cliente||'')}${o.end?' · '+o.end:''}</div>
      </div>
      <div class="si-actions">
        <button class="si-btn" onclick="editObra('${o.id}')">✏️</button>
        <button class="si-btn" onclick="deleteObra('${o.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

async function editObra(id) {
  const o = await dbGet('projects', id);
  if (!o) return;
  document.getElementById('editObraId').value = id;
  document.getElementById('obraNome').value   = o.nome;
  document.getElementById('obraCliente').value= o.cliente||'';
  document.getElementById('obraEnd').value    = o.end||'';
  document.getElementById('obraObs').value    = o.obs||'';
  document.getElementById('obraFormTitle').textContent='Editar Obra';
  switchTab('obras');
  window.scrollTo(0,0);
}

async function deleteObra(id) {
  if (!confirm('Excluir esta obra?')) return;
  await dbDel('projects', id);
  await renderObras();
  await refreshSelects();
  toast('Obra excluída.');
}

// ============================================================
// 13. EQUIPES
// ============================================================
let tmpEquipeMembers = [];

function addEquipeMember() {
  const v = document.getElementById('equipeMemberInput').value.trim();
  if (!v) return;
  tmpEquipeMembers.push({nome:v});
  document.getElementById('equipeMemberInput').value='';
  renderEquipeMembersList();
}

function renderEquipeMembersList() {
  document.getElementById('equipeMembersList').innerHTML = tmpEquipeMembers.map((m,i)=>`
    <div class="member-item">
      <div class="member-fields">
        <input type="text" value="${esc(m.nome)}" oninput="tmpEquipeMembers[${i}].nome=this.value">
      </div>
      <button class="member-del" onclick="tmpEquipeMembers.splice(${i},1);renderEquipeMembersList()">🗑</button>
    </div>
  `).join('');
}

async function salvarEquipe() {
  const nome = document.getElementById('equipeNome').value.trim();
  if (!nome) { toast('Preencha o nome da equipe!','err'); return; }
  const editId = document.getElementById('editEquipeId').value;
  const equipe = { id: editId || uid(), nome, membros: [...tmpEquipeMembers] };
  await dbPut('teams', equipe);
  cancelEditEquipe();
  await renderEquipes();
  await refreshSelects();
  toast('Equipe salva!');
}

function cancelEditEquipe() {
  document.getElementById('editEquipeId').value='';
  document.getElementById('equipeNome').value='';
  tmpEquipeMembers=[];
  renderEquipeMembersList();
  document.getElementById('equipeFormTitle').textContent='Nova Equipe';
}

async function renderEquipes() {
  const equipes = await dbAll('teams');
  document.getElementById('equipeCount').textContent = `${equipes.length} equipe(s) salva(s)`;
  const el = document.getElementById('equipesList');
  if (!equipes.length) { el.innerHTML='<div class="empty"><div class="empty-icon">👥</div>Nenhuma equipe cadastrada</div>'; return; }
  el.innerHTML = equipes.map(e=>`
    <div class="saved-item">
      <div class="si-icon">👥</div>
      <div class="si-info">
        <div class="si-name">${esc(e.nome)}</div>
        <div class="si-sub">${e.membros.length} membro(s): ${e.membros.slice(0,3).map(m=>esc(m.nome)).join(', ')}${e.membros.length>3?'…':''}</div>
      </div>
      <div class="si-actions">
        <button class="si-btn" onclick="editEquipe('${e.id}')">✏️</button>
        <button class="si-btn" onclick="deleteEquipe('${e.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

async function editEquipe(id) {
  const e = await dbGet('teams', id);
  if (!e) return;
  document.getElementById('editEquipeId').value = id;
  document.getElementById('equipeNome').value   = e.nome;
  tmpEquipeMembers = e.membros.map(m=>({...m}));
  renderEquipeMembersList();
  document.getElementById('equipeFormTitle').textContent='Editar Equipe';
  switchTab('equipes');
  window.scrollTo(0,0);
}

async function deleteEquipe(id) {
  if (!confirm('Excluir esta equipe?')) return;
  await dbDel('teams', id);
  await renderEquipes();
  await refreshSelects();
  toast('Equipe excluída.');
}

async function loadEquipeIntoForm() {
  const id = document.getElementById('selEquipe').value;
  if (!id) return;
  const eq = await dbGet('teams', id);
  if (!eq) return;
  form.membros = eq.membros.map(m=>({nome:m.nome, obs:''}));
  renderMembros();
  toast(`Equipe "${eq.nome}" carregada!`);
  scheduleDraft();
}

// ============================================================
// 14. CONFIG
// ============================================================
async function loadConfigDB() {
  const c = await dbGet('settings','main');
  if (c) config = c;
}

async function loadConfigForm() {
  document.getElementById('cfgEmpresa').value = config.empresa||'';
  document.getElementById('cfgResp').value    = config.resp||'';
  document.getElementById('cfgCargo').value   = config.cargo||'';
  document.getElementById('cfgTel').value     = config.tel||'';
  document.getElementById('cfgEmail').value   = config.email||'';
  document.getElementById('cfgEnd').value     = config.end||'';
  if (config.logoDataUrl) {
    const prev = document.getElementById('logoPreview');
    prev.src = config.logoDataUrl; prev.classList.add('show');
    document.getElementById('removeLogo').style.display='inline-flex';
  }
}

async function salvarConfig() {
  config.empresa = document.getElementById('cfgEmpresa').value.trim();
  config.resp    = document.getElementById('cfgResp').value.trim();
  config.cargo   = document.getElementById('cfgCargo').value.trim();
  config.tel     = document.getElementById('cfgTel').value.trim();
  config.email   = document.getElementById('cfgEmail').value.trim();
  config.end     = document.getElementById('cfgEnd').value.trim();
  config.id      = 'main';
  await dbPut('settings', config);
  updateHeader();
  toast('Configurações salvas!');
}

async function handleLogo(e) {
  const file = e.target.files[0]; if (!file) return;
  const blob = await compressImage(file, 400, 0.9);
  const dataUrl = await blobToDataUrl(blob);
  config.logoDataUrl = dataUrl;
  const prev = document.getElementById('logoPreview');
  prev.src = dataUrl; prev.classList.add('show');
  document.getElementById('removeLogo').style.display='inline-flex';
  e.target.value='';
}

function removeLogo() {
  config.logoDataUrl='';
  const prev = document.getElementById('logoPreview');
  prev.src=''; prev.classList.remove('show');
  document.getElementById('removeLogo').style.display='none';
}

// ============================================================
// 15. SELECTS (obras e equipes no form de RDO)
// ============================================================
async function refreshSelects() {
  const obras   = await dbAll('projects');
  const equipes = await dbAll('teams');

  const selO = document.getElementById('selObra');
  selO.innerHTML = '<option value="">— Selecione uma obra —</option>' +
    obras.map(o=>`<option value="${o.id}">${esc(o.nome)}</option>`).join('');

  const selE = document.getElementById('selEquipe');
  selE.innerHTML = '<option value="">— Selecione uma equipe —</option>' +
    equipes.map(e=>`<option value="${e.id}">${esc(e.nome)}</option>`).join('');
}

async function onObraSelect() {
  const id = document.getElementById('selObra').value;
  if (!id) return;
  const o = await dbGet('projects', id);
  if (o) document.getElementById('inpObraNome').value = o.nome;
  scheduleDraft();
}

// ============================================================
// 16. AUTOSAVE / DRAFT
// ============================================================
let draftTimer;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 600);
}

async function saveDraft() {
  syncFormFromDOM();
  const draft = {
    id: 'current',
    ts: Date.now(),
    obraNome:    form.obraNome,
    data:        form.data,
    clima:       form.clima,
    equipesDesc: form.equipesDesc,
    membros:     form.membros,
    equipamentos:form.equipamentos,
    progRows:    form.progRows,
    pendRows:    form.pendRows,
    obs:         form.obs,
    fotos: form.fotos.map(f=>({id:f.id, dataUrl:f.dataUrl, desc:f.desc}))
  };
  try {
    await dbPut('drafts', draft);
    const ind = document.getElementById('autosaveIndicator');
    ind.classList.add('show');
    setTimeout(()=>ind.classList.remove('show'), 2000);
  } catch(e) { console.warn('draft save failed', e); }
}

function syncFormFromDOM() {
  form.obraNome    = document.getElementById('inpObraNome').value.trim();
  form.data        = document.getElementById('inpData').value;
  form.clima       = document.getElementById('inpClima').value;
  form.equipesDesc = document.getElementById('inpEquipesDesc').value.trim();
  form.obs         = document.getElementById('inpObs').value.trim();
  // membros, progRows, pendRows, fotos já são sincronizados pelo oninput
  // forçar leitura do DOM para garantir
  document.querySelectorAll('#rdoMembers .member-fields input:first-child').forEach((el,i)=>{
    if (form.membros[i]) form.membros[i].nome = el.value;
  });
  document.querySelectorAll('#rdoMembers .member-fields input:last-child').forEach((el,i)=>{
    if (form.membros[i]) form.membros[i].obs = el.value;
  });
  document.querySelectorAll('#progRows textarea').forEach((el,i)=>{ form.progRows[i] = el.value; });
  document.querySelectorAll('#pendRows input').forEach((el,i)=>{ form.pendRows[i] = el.value; });
  document.querySelectorAll('#photosGrid .photo-desc-input').forEach((el,i)=>{ if(form.fotos[i]) form.fotos[i].desc = el.value; });
}

async function checkDraft() {
  const draft = await dbGet('drafts','current');
  if (!draft) return;
  const hasContent = draft.obraNome || draft.progRows?.some(Boolean) || draft.fotos?.length;
  if (!hasContent) return;
  const banner = document.getElementById('draftBanner');
  const ts = new Date(draft.ts).toLocaleString('pt-BR');
  document.getElementById('draftInfo').textContent = `Obra: ${draft.obraNome||'—'} · Salvo em: ${ts}`;
  banner.classList.add('show');
}

async function loadDraft() {
  const draft = await dbGet('drafts','current');
  if (!draft) return;
  document.getElementById('inpObraNome').value  = draft.obraNome||'';
  document.getElementById('inpData').value      = draft.data||today();
  document.getElementById('inpEquipesDesc').value = draft.equipesDesc||'';
  document.getElementById('inpObs').value       = draft.obs||'';
  if (draft.clima) {
    document.getElementById('inpClima').value = draft.clima;
    document.querySelectorAll('.clima-chip').forEach(c=>{
      c.classList.toggle('on', c.dataset.clima===draft.clima || c.textContent===draft.clima.split(' ')[0]);
    });
  }
  form.membros      = draft.membros||[];
  form.equipamentos = draft.equipamentos||[];
  form.progRows     = draft.progRows||[];
  form.pendRows     = draft.pendRows||[];
  form.fotos        = (draft.fotos||[]).map(f=>({...f, blob:null}));
  renderMembros(); renderEquipTags(); renderProgRows(); renderPendRows(); renderFotos();
  document.getElementById('draftBanner').classList.remove('show');
  toast('Rascunho recuperado!');
}

async function discardDraft() {
  await dbDel('drafts','current');
  document.getElementById('draftBanner').classList.remove('show');
  toast('Rascunho descartado.');
}

// ============================================================
// 17. SALVAR RDO
// ============================================================
async function salvarRDO() {
  syncFormFromDOM();
  if (!form.obraNome) { toast('Preencha o nome da obra!','err'); return; }
  if (!form.data)     { toast('Preencha a data!','err'); return; }

  const id = uid();
  const rdo = {
    id,
    ts:          Date.now(),
    obraNome:    form.obraNome,
    data:        form.data,
    clima:       form.clima,
    equipesDesc: form.equipesDesc,
    membros:     form.membros.filter(m=>m.nome.trim()),
    equipamentos:form.equipamentos,
    progRows:    form.progRows.filter(Boolean),
    pendRows:    form.pendRows.filter(Boolean),
    obs:         form.obs,
    fotoIds:     form.fotos.map(f=>f.id),
    fotoCount:   form.fotos.length
  };

  // salvar fotos separadamente
  for (const f of form.fotos) {
    await dbPut('photos', { id: f.id, reportId: id, dataUrl: f.dataUrl, desc: f.desc });
  }

  await dbPut('reports', rdo);
  await dbDel('drafts','current');

  toast('Relatório salvo com sucesso!');
  clearForm();
}

function clearForm() {
  document.getElementById('inpObraNome').value='';
  document.getElementById('inpData').value=today();
  document.getElementById('inpClima').value='';
  document.getElementById('inpEquipesDesc').value='';
  document.getElementById('inpObs').value='';
  document.getElementById('selObra').value='';
  document.getElementById('selEquipe').value='';
  document.querySelectorAll('.clima-chip').forEach(c=>c.classList.remove('on'));
  form.membros=[]; form.equipamentos=[]; form.progRows=[]; form.pendRows=[]; form.fotos=[];
  renderMembros(); renderEquipTags(); renderProgRows(); renderPendRows(); renderFotos();
  addProg(); // começa com uma linha vazia
}

// ============================================================
// 18. RELATÓRIOS — listagem
// ============================================================
async function renderRelatorios() {
  const all = await dbAll('reports');
  all.sort((a,b)=>b.ts-a.ts);
  document.getElementById('relCount').textContent = `${all.length} relatório(s)`;
  const el = document.getElementById('relList');
  if (!all.length) {
    el.innerHTML='<div class="empty"><div class="empty-icon">📁</div>Nenhum relatório salvo ainda</div>';
    return;
  }
  el.innerHTML = all.map(r=>`
    <div class="report-item">
      <div class="ri-top">
        <div class="ri-obra">${esc(r.obraNome)}</div>
        <div class="ri-date">${fmtDate(r.data)}</div>
      </div>
      <div class="ri-meta">${r.clima||''} · ${r.fotoCount||0} foto(s) · ${r.progRows?.length||0} atividade(s)</div>
      <div class="ri-preview">${esc((r.progRows||[]).filter(Boolean).join(' · ').slice(0,90)||'Sem atividades descritas')}</div>
      <div class="ri-actions">
        <button class="btn btn-secondary btn-sm" onclick="verRelatorio('${r.id}')">👁 Ver</button>
        <button class="btn btn-success btn-sm"   onclick="exportPDF('${r.id}')">📄 PDF</button>
        <button class="btn btn-danger btn-sm"    onclick="deleteRelatorio('${r.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

async function deleteRelatorio(id) {
  if (!confirm('Excluir este relatório?')) return;
  const fotos = await dbByIndex('photos','reportId',id);
  for (const f of fotos) await dbDel('photos',f.id);
  await dbDel('reports',id);
  await renderRelatorios();
  toast('Relatório excluído.');
}

// ============================================================
// 19. VER RELATÓRIO (modal)
// ============================================================
async function verRelatorio(id) {
  const r = await dbGet('reports', id);
  if (!r) return;
  const fotos = await dbByIndex('photos','reportId',id);

  const membrosHtml = r.membros?.length
    ? r.membros.map(m=>`<div>• ${esc(m.nome)}${m.obs?' — <em>'+esc(m.obs)+'</em>':''}</div>`).join('')
    : '—';
  const progHtml = r.progRows?.filter(Boolean).length
    ? r.progRows.filter(Boolean).map((p,i)=>`<div>${i+1}. ${esc(p)}</div>`).join('')
    : '—';
  const pendHtml = r.pendRows?.filter(Boolean).length
    ? r.pendRows.filter(Boolean).map(p=>`<div>⚠️ ${esc(p)}</div>`).join('')
    : '—';
  const fotosHtml = fotos.length
    ? `<div class="rm-photos">${fotos.map(f=>`
        <div class="rm-photo">
          <img src="${f.dataUrl}" loading="lazy">
          ${f.desc?`<div class="rm-photo-desc">${esc(f.desc)}</div>`:''}
        </div>`).join('')}</div>`
    : '<span style="color:var(--muted)">Nenhuma foto</span>';

  document.getElementById('modalReportContent').innerHTML = `
    <div class="rm-section"><div class="rm-label">Obra</div><div class="rm-value">${esc(r.obraNome)}</div></div>
    <div class="rm-section"><div class="rm-label">Data</div><div class="rm-value">${fmtDate(r.data)} · ${r.clima||'—'}</div></div>
    <div class="rm-section"><div class="rm-label">Equipes</div><div class="rm-value">${esc(r.equipesDesc||'—')}</div></div>
    <hr class="div">
    <div class="rm-section"><div class="rm-label">Membros</div><div class="rm-value">${membrosHtml}</div></div>
    <div class="rm-section"><div class="rm-label">Equipamentos</div><div class="rm-value">${esc(r.equipamentos?.join(', ')||'—')}</div></div>
    <hr class="div">
    <div class="rm-section"><div class="rm-label">Atividades</div><div class="rm-value">${progHtml}</div></div>
    <div class="rm-section"><div class="rm-label">Pendências</div><div class="rm-value">${pendHtml}</div></div>
    <div class="rm-section"><div class="rm-label">Observações</div><div class="rm-value">${esc(r.obs||'—')}</div></div>
    <hr class="div">
    <div class="rm-section"><div class="rm-label">Fotos (${fotos.length})</div>${fotosHtml}</div>
  `;
  document.getElementById('modalPdfBtn').onclick = ()=>exportPDF(id);
  document.getElementById('modalDelBtn').onclick  = ()=>{ deleteRelatorio(id); closeModal('modalReport'); };
  openModal('modalReport');
}

// ============================================================
// 20. PDF PROFISSIONAL
// ============================================================
async function exportPDF(id) {
  const r = await dbGet('reports', id);
  if (!r) return;
  const fotos = await dbByIndex('photos','reportId',id);

  const logo = config.logoDataUrl
    ? `<img src="${config.logoDataUrl}" style="height:60px;object-fit:contain;margin-bottom:6px">`
    : '';
  const empresa = config.empresa
    ? `<div style="font-size:16px;font-weight:700">${esc(config.empresa)}</div>` : '';
  const resp = config.resp
    ? `<div style="font-size:12px;color:#555">${esc(config.resp)}${config.cargo?' — '+config.cargo:''}</div>` : '';

  const membrosHtml = r.membros?.length
    ? r.membros.map(m=>`<tr><td>${esc(m.nome)}</td><td>${esc(m.obs||'')}</td></tr>`).join('')
    : '<tr><td colspan="2">—</td></tr>';

  const progHtml = r.progRows?.filter(Boolean).length
    ? r.progRows.filter(Boolean).map((p,i)=>`<tr><td style="width:28px;color:#f5a623;font-weight:700">${i+1}</td><td>${esc(p)}</td></tr>`).join('')
    : '<tr><td colspan="2">—</td></tr>';

  const pendHtml = r.pendRows?.filter(Boolean).length
    ? r.pendRows.filter(Boolean).map(p=>`<tr><td>⚠️</td><td>${esc(p)}</td></tr>`).join('')
    : '<tr><td colspan="2">Sem pendências</td></tr>';

  const fotosHtml = fotos.map(f=>`
    <div style="page-break-inside:avoid;margin-bottom:18px">
      <img src="${f.dataUrl}" style="max-width:100%;max-height:320px;border-radius:6px;display:block">
      ${f.desc?`<p style="margin:5px 0 0;font-size:12px;color:#444;font-style:italic">${esc(f.desc)}</p>`:''}
    </div>
  `).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <style>
    @page { margin: 18mm 15mm; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #222; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
         color: #c47b00; margin: 16px 0 6px; border-bottom: 1px solid #e0e0e0; padding-bottom: 3px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:2px solid #f5a623; padding-bottom:12px; }
    .header-left { display:flex; flex-direction:column; }
    .header-right { text-align:right; }
    table { width:100%; border-collapse:collapse; margin-bottom:6px; }
    td, th { padding: 5px 8px; border:1px solid #e0e0e0; vertical-align:top; font-size:12px; }
    th { background:#f5f5f5; font-weight:700; text-transform:uppercase; font-size:11px; color:#555; }
    .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:6px; }
    .meta-box { background:#f9f9f9; border:1px solid #e0e0e0; border-radius:6px; padding:8px 10px; }
    .meta-label { font-size:10px; text-transform:uppercase; color:#888; font-weight:700; margin-bottom:2px; }
    .meta-value { font-size:13px; font-weight:600; }
    .footer { margin-top:24px; padding-top:8px; border-top:1px solid #e0e0e0; display:flex; justify-content:space-between; font-size:10px; color:#888; }
    @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  </style>
  </head><body>
  <div class="header">
    <div class="header-left">
      ${logo}
      ${empresa}
      ${resp}
    </div>
    <div class="header-right">
      <h1 style="color:#1a1d27">RELATÓRIO DIÁRIO</h1>
      <div style="font-size:13px;font-weight:700;color:#f5a623">DE OBRA — RDO</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box"><div class="meta-label">Obra</div><div class="meta-value">${esc(r.obraNome)}</div></div>
    <div class="meta-box"><div class="meta-label">Data</div><div class="meta-value">${fmtDate(r.data)}</div></div>
    <div class="meta-box"><div class="meta-label">Clima</div><div class="meta-value">${r.clima||'—'}</div></div>
    <div class="meta-box"><div class="meta-label">Equipes</div><div class="meta-value">${esc(r.equipesDesc||'—')}</div></div>
  </div>

  <h2>Membros da Equipe</h2>
  <table>
    <tr><th>Nome</th><th>Observação</th></tr>
    ${membrosHtml}
  </table>

  ${r.equipamentos?.length ? `<h2>Equipamentos</h2><p>${esc(r.equipamentos.join(', '))}</p>` : ''}

  <h2>Atividades Executadas</h2>
  <table><tr><th>#</th><th>Descrição</th></tr>${progHtml}</table>

  <h2>Pendências</h2>
  <table><tr><th></th><th>Descrição</th></tr>${pendHtml}</table>

  ${r.obs ? `<h2>Observações</h2><p style="white-space:pre-wrap">${esc(r.obs)}</p>` : ''}

  ${fotos.length ? `<h2>Fotos (${fotos.length})</h2>${fotosHtml}` : ''}

  <div class="footer">
    <div>Gerado em: ${new Date().toLocaleString('pt-BR')}</div>
    <div>${config.empresa||''} ${config.resp?'· '+config.resp:''}</div>
  </div>
  </body></html>`;

  const win = window.open('','_blank');
  if (!win) { toast('Permita popups para gerar o PDF','err'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(()=>win.print(), 700);
}

// ============================================================
// 21. MODAL
// ============================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click', e=>{ if(e.target===el) el.classList.remove('open'); });
});

// ============================================================
// 22. SERVICE WORKER
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW error',e));
  }
}

// ============================================================
// 23. MIGRAÇÃO localStorage → IndexedDB
// ============================================================
async function migrateFromLocalStorage() {
  try {
    const old = localStorage.getItem('rdoRelatorios') || localStorage.getItem('rdo_relatorios');
    if (!old) return;
    const arr = JSON.parse(old);
    if (!Array.isArray(arr) || !arr.length) return;
    for (const r of arr) {
      const exists = await dbGet('reports', r.id||String(r.ts||Date.now()));
      if (exists) continue;
      const id = r.id || uid();
      const fotos = r.fotos || [];
      const fotoIds = [];
      for (const f of fotos) {
        const fid = uid();
        fotoIds.push(fid);
        await dbPut('photos',{ id:fid, reportId:id, dataUrl:f.dataUrl||f, desc:f.desc||'' });
      }
      await dbPut('reports',{
        id, ts: r.ts||Date.now(),
        obraNome: r.obra||r.obraNome||'',
        data: r.data||'',
        clima: r.clima||'',
        equipesDesc: r.equipesDesc||r.equipes||'',
        membros: r.membros||[],
        equipamentos: r.equipamentos||[],
        progRows: r.progresso ? [r.progresso] : (r.progressRows||r.progRows||[]),
        pendRows: r.pendencias||r.pendRows||[],
        obs: r.obs||'',
        fotoIds, fotoCount: fotoIds.length
      });
    }
    localStorage.removeItem('rdoRelatorios');
    localStorage.removeItem('rdo_relatorios');
    console.info('[RDO] Migração do localStorage concluída.');
  } catch(e) { console.warn('[RDO] Migração falhou:', e); }
}

// ============================================================
// 24. INIT
// ============================================================
async function init() {
  await openDB();
  await migrateFromLocalStorage();
  await loadConfigDB();
  updateHeader();
  await refreshSelects();
  document.getElementById('inpData').value = today();
  addProg();
  await checkDraft();
  registerSW();
}

init().catch(e=>console.error('[RDO] Init error',e));
