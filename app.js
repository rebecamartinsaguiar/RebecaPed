const STORAGE_KEY = 'meu-plantao:v1';
const FILE_DB_NAME = 'meu-plantao-files-v1';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SYNC_META_KEY = 'meu-plantao:sync:v1';
const LOCAL_BACKUP_KEY = 'meu-plantao:pre-sync-backup:v1';
const STORAGE_BUCKET = 'protocol-attachments';
const SUPPORTED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function todayKey() { return dateKey(new Date()); }
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function hoursFor(shift) {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function cleanUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [], medications: Array.isArray(parsed.medications) ? parsed.medications : [], protocols: Array.isArray(parsed.protocols) ? parsed.protocols : [] };
  } catch { return { shifts: [], medications: [], protocols: [] }; }
}
function emptyPendingDeletes() { return { shifts: [], medications: [], protocols: [], attachments: [] }; }
function emptySyncMeta() { return { ownerId: null, baseline: { shifts: [], medications: [], protocols: [], attachments: [] }, pendingDeletes: emptyPendingDeletes() }; }
function loadSyncMeta() {
  try {
    const stored = JSON.parse(localStorage.getItem(SYNC_META_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return emptySyncMeta();
    return { ...emptySyncMeta(), ...stored, baseline: { ...emptySyncMeta().baseline, ...(stored.baseline || {}) }, pendingDeletes: { ...emptyPendingDeletes(), ...(stored.pendingDeletes || {}) } };
  } catch { return emptySyncMeta(); }
}
function cloneState(value = state) { return JSON.parse(JSON.stringify(value)); }
function hasRecords(value) { return Boolean(value && ['shifts', 'medications', 'protocols'].some(key => Array.isArray(value[key]) && value[key].length)); }
function currentAttachmentIds(value = state) { return new Set(value.protocols.flatMap(protocol => (protocol.attachments || []).map(file => file.id))); }
function countRecords(value) {
  const attachments = value.protocols.reduce((sum, protocol) => sum + (protocol.attachments || []).length, 0);
  return { shifts: value.shifts.length, medications: value.medications.length, protocols: value.protocols.length, attachments };
}
function openFileDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Este navegador não oferece armazenamento de anexos.')); return; }
    const request = indexedDB.open(FILE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('attachments', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de anexos.'));
  });
}
async function saveAttachment(file) {
  const id = crypto.randomUUID();
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').put({ id, name: file.name, type: file.type, size: file.size, blob: file });
    tx.oncomplete = () => { db.close(); resolve({ id, name: file.name, type: file.type, size: file.size }); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Falha ao salvar anexo.')); };
  });
}
async function readAttachment(id) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readonly');
    const request = tx.objectStore('attachments').get(id);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Falha ao abrir anexo.')); };
  });
}
async function removeAttachment(id) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Falha ao remover anexo.')); };
  });
}
let state = loadState();
let syncMeta = loadSyncMeta();
let cloudBaseline = {
  shifts: new Set(syncMeta.baseline.shifts),
  medications: new Set(syncMeta.baseline.medications),
  protocols: new Set(syncMeta.baseline.protocols),
  attachments: new Map(syncMeta.baseline.attachments.map(item => [item.id, item])),
};
let activeCloudUser = null;
let cloudPhase = 'signed-out';
let cloudBootPromise = null;
let cloudBootUserId = null;
let cloudWriteQueue = Promise.resolve();
let pendingLocalImport = null;
let pendingRemoteState = null;
let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = todayKey();
let toastTimer;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  recordPendingDeletes();
  renderAll();
  if (activeCloudUser && cloudPhase === 'ready') queueCloudSync();
}
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function byDateAndTime(a, b) { return a.date.localeCompare(b.date) || a.start.localeCompare(b.start); }
function monthShifts(date = viewMonth) {
  const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return state.shifts.filter(shift => shift.date.startsWith(prefix)).sort(byDateAndTime);
}
function hoursTotal(shifts) { return shifts.reduce((sum, shift) => sum + hoursFor(shift), 0); }
function amountTotal(shifts) { return shifts.reduce((sum, shift) => sum + Number(shift.value || 0), 0); }

function setSyncStatus(message, status = 'ready') {
  const element = document.getElementById('syncStatus');
  element.textContent = message;
  element.dataset.state = status;
}
function persistStateOnly() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function saveCloudMetadata() {
  syncMeta = {
    ownerId: activeCloudUser?.id || syncMeta.ownerId,
    baseline: {
      shifts: [...cloudBaseline.shifts],
      medications: [...cloudBaseline.medications],
      protocols: [...cloudBaseline.protocols],
      attachments: [...cloudBaseline.attachments.values()],
    },
    pendingDeletes: syncMeta.pendingDeletes,
  };
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
}
function recordPendingDeletes() {
  if (!activeCloudUser || syncMeta.ownerId !== activeCloudUser.id) return;
  const current = {
    shifts: new Set(state.shifts.map(item => item.id)),
    medications: new Set(state.medications.map(item => item.id)),
    protocols: new Set(state.protocols.map(item => item.id)),
    attachments: currentAttachmentIds(),
  };
  for (const type of ['shifts', 'medications', 'protocols']) {
    const pending = new Set(syncMeta.pendingDeletes[type]);
    for (const id of cloudBaseline[type]) if (!current[type].has(id)) pending.add(id);
    syncMeta.pendingDeletes[type] = [...pending];
  }
  const pendingAttachments = new Set(syncMeta.pendingDeletes.attachments);
  for (const id of cloudBaseline.attachments.keys()) if (!current.attachments.has(id)) pendingAttachments.add(id);
  syncMeta.pendingDeletes.attachments = [...pendingAttachments];
  saveCloudMetadata();
}
function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data || [];
}
function setCloudBaseline(remote) {
  cloudBaseline = {
    shifts: new Set(remote.state.shifts.map(item => item.id)),
    medications: new Set(remote.state.medications.map(item => item.id)),
    protocols: new Set(remote.state.protocols.map(item => item.id)),
    attachments: new Map(remote.attachments.map(item => [item.id, item])),
  };
}
async function fetchUserCloudState(userId) {
  const [shiftResult, medicationResult, protocolResult, attachmentResult] = await Promise.all([
    authClient.from('shifts').select('*').eq('owner_id', userId).order('work_date'),
    authClient.from('user_medication_references').select('*').eq('owner_id', userId).order('medication_name'),
    authClient.from('protocols').select('*').eq('owner_id', userId).order('title'),
    authClient.from('protocol_attachments').select('*').eq('owner_id', userId),
  ]);
  const shiftRows = dataOrThrow(shiftResult);
  const medicationRows = dataOrThrow(medicationResult);
  const protocolRows = dataOrThrow(protocolResult);
  const attachmentRows = dataOrThrow(attachmentResult);
  const attachmentsByProtocol = new Map();
  const attachments = attachmentRows.map(row => ({ id: row.id, protocolId: row.protocol_id, storagePath: row.storage_path }));
  attachmentRows.forEach(row => {
    const list = attachmentsByProtocol.get(row.protocol_id) || [];
    list.push({ id: row.id, name: row.original_name, type: row.mime_type, size: Number(row.size_bytes), storagePath: row.storage_path });
    attachmentsByProtocol.set(row.protocol_id, list);
  });
  return {
    state: {
      shifts: shiftRows.map(row => ({ id: row.id, date: row.work_date, start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5), value: Number(row.amount_brl) })),
      medications: medicationRows.map(row => ({ id: row.id, name: row.medication_name, presentation: row.presentation || '', dosePerKg: row.dose_per_kg_per_dose == null ? '' : Number(row.dose_per_kg_per_dose), concentration: row.concentration_mg_ml == null ? '' : Number(row.concentration_mg_ml), maxDose: row.max_dose_mg == null ? '' : Number(row.max_dose_mg), interval: row.interval_text || '', contraindications: row.contraindications || '', interactions: row.interactions || '', url: row.source_url || '', reviewed: row.reviewed_on || '' })),
      protocols: protocolRows.map(row => ({ id: row.id, title: row.title, source: row.source_name || '', url: row.external_url || '', reviewed: row.reviewed_on || '', attachments: attachmentsByProtocol.get(row.id) || [] })),
    },
    attachments,
  };
}
function removePendingDeletes(remoteState, pending) {
  const deleted = {
    shifts: new Set(pending.shifts), medications: new Set(pending.medications),
    protocols: new Set(pending.protocols), attachments: new Set(pending.attachments),
  };
  return {
    ...remoteState,
    shifts: remoteState.shifts.filter(item => !deleted.shifts.has(item.id)),
    medications: remoteState.medications.filter(item => !deleted.medications.has(item.id)),
    protocols: remoteState.protocols.filter(item => !deleted.protocols.has(item.id)).map(protocol => ({ ...protocol, attachments: protocol.attachments.filter(file => !deleted.attachments.has(file.id)) })),
  };
}
function localOnlyCounts(local, remote) {
  const shiftIds = new Set(remote.shifts.map(item => item.id));
  const medicationIds = new Set(remote.medications.map(item => item.id));
  const protocolIds = new Set(remote.protocols.map(item => item.id));
  const attachmentIds = currentAttachmentIds(remote);
  return {
    shifts: local.shifts.filter(item => !shiftIds.has(item.id)).length,
    medications: local.medications.filter(item => !medicationIds.has(item.id)).length,
    protocols: local.protocols.filter(item => !protocolIds.has(item.id)).length,
    attachments: local.protocols.reduce((sum, protocol) => sum + (protocol.attachments || []).filter(file => !attachmentIds.has(file.id)).length, 0),
  };
}
function mergeRemoteAndLocal(remote, local) {
  const mergeById = (remoteItems, localItems) => {
    const result = [...remoteItems];
    const ids = new Set(remoteItems.map(item => item.id));
    localItems.forEach(item => { if (!ids.has(item.id)) result.push(item); });
    return result;
  };
  const remoteProtocols = new Map(remote.protocols.map(item => [item.id, item]));
  const protocols = [...remote.protocols];
  local.protocols.forEach(localProtocol => {
    const remoteProtocol = remoteProtocols.get(localProtocol.id);
    if (!remoteProtocol) { protocols.push(localProtocol); return; }
    const ids = new Set(remoteProtocol.attachments.map(file => file.id));
    remoteProtocol.attachments.push(...(localProtocol.attachments || []).filter(file => !ids.has(file.id)));
  });
  return {
    shifts: mergeById(remote.shifts, local.shifts),
    medications: mergeById(remote.medications, local.medications),
    protocols,
  };
}
function localBackupAvailable() {
  try { return Boolean(JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || 'null')?.state); }
  catch { return false; }
}
function updateCloudButtons() {
  document.getElementById('syncNow').hidden = !activeCloudUser;
  document.getElementById('importLocalBackup').hidden = !activeCloudUser || !localBackupAvailable();
}
async function upsertSnapshot(snapshot, user) {
  const now = new Date().toISOString();
  const shifts = snapshot.shifts.map(item => ({ id: item.id, owner_id: user.id, work_date: item.date, start_time: item.start, end_time: item.end, amount_brl: Number(item.value || 0), updated_at: now }));
  const medications = snapshot.medications.map(item => ({
    id: item.id, owner_id: user.id, medication_name: item.name, presentation: item.presentation || null,
    dose_per_kg_per_dose: item.dosePerKg === '' || item.dosePerKg == null ? null : Number(item.dosePerKg),
    concentration_mg_ml: item.concentration === '' || item.concentration == null ? null : Number(item.concentration),
    max_dose_mg: item.maxDose === '' || item.maxDose == null ? null : Number(item.maxDose),
    interval_text: item.interval || null, contraindications: item.contraindications || null,
    interactions: item.interactions || null, source_url: cleanUrl(item.url) || null, reviewed_on: item.reviewed || null, updated_at: now,
  }));
  const protocols = snapshot.protocols.map(item => ({ id: item.id, owner_id: user.id, title: item.title, source_name: item.source || null, external_url: cleanUrl(item.url) || null, reviewed_on: item.reviewed || null, updated_at: now }));
  if (shifts.length) dataOrThrow(await authClient.from('shifts').upsert(shifts, { onConflict: 'id' }));
  if (medications.length) dataOrThrow(await authClient.from('user_medication_references').upsert(medications, { onConflict: 'id' }));
  if (protocols.length) dataOrThrow(await authClient.from('protocols').upsert(protocols, { onConflict: 'id' }));

  const attachmentRows = [];
  for (const protocol of snapshot.protocols) {
    for (const file of protocol.attachments || []) {
      let storagePath = file.storagePath || '';
      let mimeType = file.type || '';
      let fileSize = Number(file.size || 0);
      if (!storagePath) {
        const localFile = await readAttachment(file.id);
        if (!localFile?.blob) throw new Error(`O anexo “${file.name}” não foi encontrado neste navegador. Ele continua listado nos dados locais.`);
        mimeType = localFile.type || mimeType;
        fileSize = Number(localFile.size || fileSize);
        if (!SUPPORTED_ATTACHMENT_TYPES.has(mimeType)) throw new Error(`O formato do anexo “${file.name}” não é aceito pelo armazenamento privado.`);
        if (fileSize < 1 || fileSize > MAX_ATTACHMENT_BYTES) throw new Error(`O anexo “${file.name}” excede o limite de 20 MB.`);
        storagePath = `${user.id}/${protocol.id}/${file.id}`;
        const upload = await authClient.storage.from(STORAGE_BUCKET).upload(storagePath, localFile.blob, { contentType: mimeType, upsert: true });
        if (upload.error) throw upload.error;
        file.storagePath = storagePath;
        file.type = mimeType;
        file.size = fileSize;
      }
      attachmentRows.push({ id: file.id, protocol_id: protocol.id, owner_id: user.id, storage_path: storagePath, original_name: file.name, mime_type: mimeType, size_bytes: fileSize });
    }
  }
  if (attachmentRows.length) dataOrThrow(await authClient.from('protocol_attachments').upsert(attachmentRows, { onConflict: 'id' }));
  persistStateOnly();
}
async function deleteCloudRows(table, ids, userId) {
  for (const id of ids) {
    const result = await authClient.from(table).delete().eq('owner_id', userId).eq('id', id);
    if (result.error) throw result.error;
  }
}
async function syncLocalStateToCloud(user) {
  if (!user || cloudPhase !== 'ready') return;
  const snapshot = cloneState();
  recordPendingDeletes();
  setSyncStatus('Sincronizando…', 'loading');
  await upsertSnapshot(snapshot, user);
  const uploadedPaths = new Map(snapshot.protocols.flatMap(protocol => (protocol.attachments || []).filter(file => file.storagePath).map(file => [file.id, file])));
  state.protocols.forEach(protocol => (protocol.attachments || []).forEach(file => {
    const uploaded = uploadedPaths.get(file.id);
    if (uploaded) { file.storagePath = uploaded.storagePath; file.type = uploaded.type; file.size = uploaded.size; }
  }));

  const deletedProtocols = new Set(syncMeta.pendingDeletes.protocols);
  const deletedAttachments = new Set(syncMeta.pendingDeletes.attachments);
  for (const [id, file] of cloudBaseline.attachments) if (deletedProtocols.has(file.protocolId)) deletedAttachments.add(id);
  const storagePaths = [...deletedAttachments].map(id => cloudBaseline.attachments.get(id)?.storagePath).filter(Boolean);
  if (storagePaths.length) {
    const result = await authClient.storage.from(STORAGE_BUCKET).remove(storagePaths);
    if (result.error) throw result.error;
  }
  await deleteCloudRows('protocol_attachments', [...deletedAttachments], user.id);
  await deleteCloudRows('shifts', syncMeta.pendingDeletes.shifts, user.id);
  await deleteCloudRows('user_medication_references', syncMeta.pendingDeletes.medications, user.id);
  await deleteCloudRows('protocols', [...deletedProtocols], user.id);

  cloudBaseline = {
    shifts: new Set(snapshot.shifts.map(item => item.id)),
    medications: new Set(snapshot.medications.map(item => item.id)),
    protocols: new Set(snapshot.protocols.map(item => item.id)),
    attachments: new Map(snapshot.protocols.flatMap(protocol => (protocol.attachments || []).filter(file => file.storagePath).map(file => [file.id, { id: file.id, protocolId: protocol.id, storagePath: file.storagePath }]))),
  };
  syncMeta.pendingDeletes = emptyPendingDeletes();
  syncMeta.ownerId = user.id;
  saveCloudMetadata();
  persistStateOnly();
  setSyncStatus('Sincronizado', 'ready');
}
function queueCloudSync() {
  const user = activeCloudUser;
  const task = cloudWriteQueue.catch(() => {}).then(() => syncLocalStateToCloud(user));
  cloudWriteQueue = task;
  return task;
}
function scheduleCloudSync() {
  queueCloudSync().catch(error => {
    setSyncStatus('Salvo neste aparelho; nuvem indisponível', 'error');
    showToast(error.message || 'Não foi possível sincronizar. Os dados locais foram preservados.');
  });
}
function saveLocalBackup(value) {
  if (!hasRecords(value)) return;
  localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state: value }));
  updateCloudButtons();
}
function persistLoadedState(value) {
  state = value;
  persistStateOnly();
  renderAll();
}
function openLocalImportDialog(local, remote) {
  pendingLocalImport = cloneState(local);
  pendingRemoteState = cloneState(remote);
  const counts = localOnlyCounts(pendingLocalImport, pendingRemoteState);
  document.getElementById('localImportSummary').textContent = `Há ${counts.shifts} plantão(ões), ${counts.medications} referência(s), ${counts.protocols} protocolo(s) e ${counts.attachments} anexo(s) que ainda não estão na nuvem.`;
  document.getElementById('appShell').hidden = false;
  document.getElementById('authGate').hidden = true;
  document.getElementById('localImportDialog').showModal();
  setSyncStatus('Escolha como continuar', 'loading');
}
async function initializeCloudForUser(user) {
  const local = cloneState();
  const savedMetadata = loadSyncMeta();
  syncMeta = savedMetadata.ownerId === user.id ? savedMetadata : { ...emptySyncMeta(), ownerId: user.id };
  try {
    setSyncStatus('Carregando nuvem…', 'loading');
    const remote = await fetchUserCloudState(user.id);
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    const unmatched = localOnlyCounts(local, visibleRemote);
    const unmatchedTotal = Object.values(unmatched).reduce((sum, value) => sum + value, 0);
    if (unmatchedTotal > 0) {
      cloudPhase = 'choosing';
      openLocalImportDialog(local, visibleRemote);
      updateCloudButtons();
      return;
    }
    persistLoadedState(visibleRemote);
    syncMeta.ownerId = user.id;
    cloudPhase = 'ready';
    saveCloudMetadata();
    setSyncStatus('Sincronizado', 'ready');
    updateCloudButtons();
    if (Object.values(syncMeta.pendingDeletes).some(ids => ids.length)) scheduleCloudSync();
  } catch (error) {
    cloudPhase = 'offline';
    document.getElementById('authGate').hidden = true;
    document.getElementById('appShell').hidden = false;
    renderAll();
    updateCloudButtons();
    setSyncStatus('Offline: dados mantidos neste aparelho', 'error');
    showToast(error.message || 'Não foi possível carregar a nuvem. Os dados deste aparelho foram preservados.');
  }
}
function beginCloudBootstrap(user, force = false) {
  if (!user) return;
  if (activeCloudUser?.id === user.id && ['ready', 'choosing', 'loading'].includes(cloudPhase)) return cloudBootPromise;
  if (activeCloudUser?.id === user.id && cloudPhase === 'offline' && !force) return;
  activeCloudUser = user;
  cloudPhase = 'loading';
  cloudBootUserId = user.id;
  cloudBootPromise = initializeCloudForUser(user).finally(() => {
    if (cloudBootUserId === user.id) { cloudBootPromise = null; cloudBootUserId = null; }
  });
  return cloudBootPromise;
}
async function chooseLocalImport(importLocal) {
  const dialog = document.getElementById('localImportDialog');
  const importButton = document.getElementById('importLocalData');
  const cloudButton = document.getElementById('useCloudData');
  importButton.disabled = true;
  cloudButton.disabled = true;
  try {
    if (!activeCloudUser || !pendingRemoteState || !pendingLocalImport) throw new Error('A sessão mudou. Entre novamente para continuar a sincronização.');
    if (importLocal) {
      const merged = mergeRemoteAndLocal(pendingRemoteState, pendingLocalImport);
      state = merged;
      setSyncStatus('Importando registros…', 'loading');
      await upsertSnapshot(state, activeCloudUser);
      const remote = await fetchUserCloudState(activeCloudUser.id);
      setCloudBaseline(remote);
      persistLoadedState(removePendingDeletes(remote.state, syncMeta.pendingDeletes));
      localStorage.removeItem(LOCAL_BACKUP_KEY);
    } else {
      saveLocalBackup(pendingLocalImport);
      persistLoadedState(pendingRemoteState);
    }
    syncMeta.ownerId = activeCloudUser.id;
    cloudPhase = 'ready';
    saveCloudMetadata();
    dialog.close();
    pendingLocalImport = null;
    pendingRemoteState = null;
    setSyncStatus('Sincronizado', 'ready');
    updateCloudButtons();
    if (Object.values(syncMeta.pendingDeletes).some(ids => ids.length)) scheduleCloudSync();
  } catch (error) {
    setSyncStatus('Importação pendente', 'error');
    showToast(error.message || 'Não foi possível concluir a importação. Os dados locais continuam preservados.');
  } finally {
    importButton.disabled = false;
    cloudButton.disabled = false;
  }
}
async function importLocalBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || 'null');
    if (!backup?.state || !activeCloudUser) return;
    const remote = await fetchUserCloudState(activeCloudUser.id);
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    const counts = localOnlyCounts(backup.state, visibleRemote);
    if (!Object.values(counts).some(value => value > 0)) {
      localStorage.removeItem(LOCAL_BACKUP_KEY);
      updateCloudButtons();
      showToast('Esse backup já está na nuvem.');
      return;
    }
    cloudPhase = 'choosing';
    openLocalImportDialog(backup.state, visibleRemote);
  } catch (error) {
    showToast(error.message || 'Não foi possível abrir o backup local.');
  }
}
async function syncNow() {
  if (!activeCloudUser) return;
  const button = document.getElementById('syncNow');
  button.disabled = true;
  try {
    if (cloudPhase === 'offline') {
      await beginCloudBootstrap(activeCloudUser, true);
      if (cloudPhase !== 'ready') return;
    }
    if (cloudPhase !== 'ready') return;
    await queueCloudSync();
    const remote = await fetchUserCloudState(activeCloudUser.id);
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    persistLoadedState(mergeRemoteAndLocal(visibleRemote, state));
    syncMeta.ownerId = activeCloudUser.id;
    saveCloudMetadata();
    setSyncStatus('Sincronizado', 'ready');
  } catch (error) {
    setSyncStatus('Falha na sincronização', 'error');
    showToast(error.message || 'Não foi possível sincronizar agora.');
  } finally {
    button.disabled = false;
  }
}
document.getElementById('syncNow').addEventListener('click', syncNow);
document.getElementById('importLocalBackup').addEventListener('click', importLocalBackup);
document.getElementById('useCloudData').addEventListener('click', () => chooseLocalImport(false));
document.getElementById('importLocalData').addEventListener('click', () => chooseLocalImport(true));
window.addEventListener('online', () => {
  if (!activeCloudUser) return;
  if (cloudPhase === 'offline') beginCloudBootstrap(activeCloudUser, true);
  else if (cloudPhase === 'ready') scheduleCloudSync();
});

function renderHome() {
  const shifts = monthShifts(new Date());
  document.getElementById('homeEarnings').textContent = money.format(amountTotal(shifts));
  document.getElementById('homeShiftCount').textContent = `${shifts.length} ${shifts.length === 1 ? 'plantão registrado' : 'plantões registrados'}`;
  document.getElementById('homeHours').textContent = `${number.format(hoursTotal(shifts))} h`;
  document.getElementById('homeMedCount').textContent = state.medications.length;
  document.getElementById('homeProtocolCount').textContent = state.protocols.length;
}
function renderCalendar() {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const date = new Date(year, month, 1);
  const title = monthFormat.format(date);
  document.getElementById('monthTitle').textContent = title.charAt(0).toLocaleUpperCase('pt-BR') + title.slice(1);
  document.getElementById('reportPeriod').textContent = title;
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const offset = date.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevious = new Date(year, month, 0).getDate();
  const shiftsInMonth = monthShifts(viewMonth);
  const shiftDates = new Set(shiftsInMonth.map(shift => shift.date));
  let html = weekdays.map(day => `<div class="weekday">${day}</div>`).join('');
  for (let index = 0; index < 42; index++) {
    let day, dayDate, outside = false;
    if (index < offset) { day = daysInPrevious - offset + index + 1; dayDate = new Date(year, month - 1, day); outside = true; }
    else if (index >= offset + daysInMonth) { day = index - offset - daysInMonth + 1; dayDate = new Date(year, month + 1, day); outside = true; }
    else { day = index - offset + 1; dayDate = new Date(year, month, day); }
    const key = dateKey(dayDate);
    const classes = ['calendar-day', outside ? 'outside' : '', selectedDate === key ? 'selected' : '', shiftDates.has(key) ? 'has-shift' : ''].filter(Boolean).join(' ');
    html += `<button class="${classes}" data-date="${key}" aria-label="${escapeHtml(longDateFormat.format(dayDate))}${shiftDates.has(key) ? ', tem plantão' : ''}" aria-pressed="${selectedDate === key}">${day}</button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.date;
    if (parseDateKey(selectedDate).getMonth() !== viewMonth.getMonth() || parseDateKey(selectedDate).getFullYear() !== viewMonth.getFullYear()) {
      const picked = parseDateKey(selectedDate);
      viewMonth = new Date(picked.getFullYear(), picked.getMonth(), 1);
    }
    renderShifts();
  }));
}
function renderShifts() {
  renderCalendar();
  const selected = parseDateKey(selectedDate);
  const formatted = longDateFormat.format(selected);
  document.getElementById('selectedDateTitle').textContent = formatted.charAt(0).toLocaleUpperCase('pt-BR') + formatted.slice(1);
  const dayShifts = state.shifts.filter(shift => shift.date === selectedDate).sort(byDateAndTime);
  const list = document.getElementById('dayShiftList');
  if (!dayShifts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum plantão neste dia.<br>Use “＋ Plantão” para registrar um turno.</div>';
  } else {
    list.innerHTML = dayShifts.map(shift => `<div class="shift-row"><div class="shift-time">${escapeHtml(shift.start)}<br>${escapeHtml(shift.end)}</div><div class="shift-info"><b>${number.format(hoursFor(shift))} horas</b><small>${escapeHtml(shortDateFormat.format(parseDateKey(shift.date)))}</small></div><strong class="shift-value">${money.format(Number(shift.value))}</strong><button class="delete-shift" data-delete-shift="${escapeHtml(shift.id)}" aria-label="Excluir plantão de ${escapeHtml(shift.start)}" title="Excluir">×</button></div>`).join('');
    list.querySelectorAll('[data-delete-shift]').forEach(button => button.addEventListener('click', () => deleteShift(button.dataset.deleteShift)));
  }
  const shifts = monthShifts(viewMonth);
  document.getElementById('monthEarnings').textContent = money.format(amountTotal(shifts));
  document.getElementById('monthShiftCount').textContent = shifts.length;
  document.getElementById('monthHours').textContent = `${number.format(hoursTotal(shifts))} h`;
  renderReport(shifts);
}
function renderReport(shifts) {
  const report = document.getElementById('monthlyReport');
  if (!shifts.length) {
    report.innerHTML = '<div class="empty-state">Nenhum plantão registrado neste mês.<br>Quando você adicionar turnos, o total e os valores por dia aparecerão aqui.</div>';
    return;
  }
  const daily = new Map();
  shifts.forEach(shift => {
    const current = daily.get(shift.date) || { count: 0, amount: 0, hours: 0 };
    current.count += 1;
    current.amount += Number(shift.value || 0);
    current.hours += hoursFor(shift);
    daily.set(shift.date, current);
  });
  const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  report.innerHTML = `<table class="report-table"><thead><tr><th>Data</th><th>Plantões</th><th>Horas</th><th>Ganhos</th></tr></thead><tbody>${rows.map(([date, item]) => `<tr><td>${escapeHtml(shortDateFormat.format(parseDateKey(date)))}</td><td>${item.count}</td><td>${number.format(item.hours)} h</td><td>${money.format(item.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total do mês</td><td>${shifts.length}</td><td>${number.format(hoursTotal(shifts))} h</td><td>${money.format(amountTotal(shifts))}</td></tr></tfoot></table>`;
}
function renderMedicationList() {
  const element = document.getElementById('medicationList');
  if (!state.medications.length) { element.innerHTML = '<div class="empty-state">Nenhuma referência salva.<br>Cadastre o nome, a apresentação e o link da bula profissional que você consulta.</div>'; return; }
  element.innerHTML = state.medications.map(item => {
    const url = cleanUrl(item.url);
    const dose = item.dosePerKg ? `<p><b>Dose registrada:</b> ${escapeHtml(item.dosePerKg)} mg/kg/dose${item.maxDose ? ` · limite ${escapeHtml(item.maxDose)} mg/dose` : ''}${item.interval ? ` · ${escapeHtml(item.interval)}` : ''}</p>` : '<p><b>Dose:</b> não registrada</p>';
    const contraindications = item.contraindications ? `<p><b>Contraindicações:</b> ${escapeHtml(item.contraindications)}</p>` : '<p><b>Contraindicações:</b> não registradas; consulte a bula.</p>';
    const interactions = item.interactions ? `<p><b>Interações:</b> ${escapeHtml(item.interactions)}</p>` : '<p><b>Interações:</b> não registradas; isso não confirma ausência.</p>';
    const review = item.reviewed ? `<p>Revisado em ${escapeHtml(shortDateFormat.format(parseDateKey(item.reviewed)))}</p>` : '<p>Data de revisão não informada</p>';
    return `<article class="saved-card"><h3>${escapeHtml(item.name)}</h3>${item.presentation ? `<p>${escapeHtml(item.presentation)}</p>` : ''}${dose}${contraindications}${interactions}${review}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir bula profissional ↗</a>` : '<p>Sem link de bula</p>'}<div class="saved-actions"><button class="text-button" data-delete-med="${escapeHtml(item.id)}">Remover</button></div></article>`;
  }).join('');
  element.querySelectorAll('[data-delete-med]').forEach(button => button.addEventListener('click', () => {
    state.medications = state.medications.filter(item => item.id !== button.dataset.deleteMed);
    saveState(); showToast('Referência removida.');
  }));
}
function renderProtocolList() {
  const element = document.getElementById('protocolList');
  if (!state.protocols.length) { element.innerHTML = '<div class="empty-state">Nenhum protocolo salvo.<br>Adicione um título e o link da fonte oficial que você usa.</div>'; return; }
  element.innerHTML = state.protocols.map(item => {
    const url = cleanUrl(item.url);
    const reviewed = item.reviewed ? `Revisado em ${shortDateFormat.format(parseDateKey(item.reviewed))}` : 'Data de revisão não informada';
    const files = Array.isArray(item.attachments) ? item.attachments : [];
    const attachmentLinks = files.map(file => `<button class="attachment-link" data-open-file="${escapeHtml(file.id)}">${escapeHtml(file.name)} <span>${number.format(file.size / (1024 * 1024))} MB ↗</span></button>`).join('');
    return `<article class="saved-card"><h3>${escapeHtml(item.title)}</h3>${item.source ? `<p>${escapeHtml(item.source)}</p>` : ''}<p>${escapeHtml(reviewed)}</p>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir documento ↗</a>` : '<p>Sem link externo</p>'}${files.length ? `<div class="attachment-list"><b>Anexos</b>${attachmentLinks}</div>` : ''}<div class="saved-actions"><button class="text-button" data-delete-protocol="${escapeHtml(item.id)}">Remover</button></div></article>`;
  }).join('');
  element.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', async () => {
    try {
      const fileInfo = files.find(file => file.id === button.dataset.openFile);
      let blob = (await readAttachment(button.dataset.openFile))?.blob;
      if (!blob && fileInfo?.storagePath && activeCloudUser) {
        const { data, error } = await authClient.storage.from(STORAGE_BUCKET).download(fileInfo.storagePath);
        if (error) throw error;
        blob = data;
      }
      if (!blob) { showToast('Anexo não encontrado neste aparelho nem na nuvem.'); return; }
      const fileUrl = URL.createObjectURL(blob);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
    } catch (error) { showToast(error.message || 'Não foi possível abrir o anexo.'); }
  }));
  element.querySelectorAll('[data-delete-protocol]').forEach(button => button.addEventListener('click', () => {
    const item = state.protocols.find(protocol => protocol.id === button.dataset.deleteProtocol);
    if (!item || !confirm('Remover este protocolo e seus anexos?')) return;
    Promise.all((item.attachments || []).map(file => removeAttachment(file.id).catch(() => {}))).then(() => {
      state.protocols = state.protocols.filter(protocol => protocol.id !== item.id);
      saveState(); showToast('Protocolo removido.');
    });
  }));
}
function renderAll() { renderHome(); renderShifts(); renderMedicationList(); renderProtocolList(); renderDoseMedicationOptions(); }
function renderDoseMedicationOptions() {
  const select = document.getElementById('doseMedication');
  const current = select.value;
  select.innerHTML = '<option value="">Informar valores manualmente</option>' + state.medications.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.medications.some(item => item.id === current)) select.value = current;
}
function openShift(date = selectedDate) {
  document.getElementById('shiftForm').reset();
  document.getElementById('shiftId').value = '';
  document.getElementById('shiftDate').value = date;
  document.getElementById('shiftStart').value = '07:00';
  document.getElementById('shiftEnd').value = '19:00';
  document.getElementById('shiftValue').value = '';
  document.getElementById('shiftDialogTitle').textContent = 'Novo plantão';
  document.getElementById('shiftDialog').showModal();
}
function deleteShift(id) {
  if (!confirm('Excluir este plantão?')) return;
  state.shifts = state.shifts.filter(shift => shift.id !== id);
  saveState(); showToast('Plantão excluído.');
}
function showPage(page) {
  document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  if (page === 'plantoes') renderShifts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showCalculation(elementId, markup) {
  const result = document.getElementById(elementId);
  result.innerHTML = markup;
  result.classList.remove('hidden');
}
function positive(...values) { return values.every(value => Number.isFinite(value) && value > 0); }

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
document.getElementById('addShift').addEventListener('click', () => openShift());
document.getElementById('addShiftDay').addEventListener('click', () => openShift());
document.getElementById('prevMonth').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); selectedDate = dateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)); renderShifts(); });
document.getElementById('nextMonth').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); selectedDate = dateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)); renderShifts(); });
document.getElementById('shiftForm').addEventListener('submit', event => {
  event.preventDefault();
  const date = document.getElementById('shiftDate').value;
  const start = document.getElementById('shiftStart').value;
  const end = document.getElementById('shiftEnd').value;
  const value = Number(document.getElementById('shiftValue').value);
  if (!date || !start || !end || !Number.isFinite(value) || value < 0) { showToast('Confira os campos do plantão.'); return; }
  if (start === end) { showToast('Início e fim não podem ser iguais.'); return; }
  state.shifts.push({ id: crypto.randomUUID(), date, start, end, value });
  selectedDate = date;
  const parsed = parseDateKey(date);
  viewMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  saveState();
  document.getElementById('shiftDialog').close();
  showToast('Plantão registrado.');
});

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.getElementById('addMedication').addEventListener('click', () => { document.getElementById('medicationForm').reset(); document.getElementById('medicationDialog').showModal(); });
document.getElementById('medicationForm').addEventListener('submit', event => {
  event.preventDefault();
  const optionalNumber = id => document.getElementById(id).value === '' ? '' : Number(document.getElementById(id).value);
  state.medications.push({ id: crypto.randomUUID(), name: document.getElementById('medName').value.trim(), presentation: document.getElementById('medPresentation').value.trim(), dosePerKg: optionalNumber('medDosePerKg'), concentration: optionalNumber('medConcentration'), maxDose: optionalNumber('medMaxDose'), interval: document.getElementById('medInterval').value.trim(), contraindications: document.getElementById('medContraindications').value.trim(), interactions: document.getElementById('medInteractions').value.trim(), url: cleanUrl(document.getElementById('medUrl').value.trim()), reviewed: document.getElementById('medReviewed').value });
  saveState(); document.getElementById('medicationDialog').close(); showToast('Referência salva neste dispositivo.');
});
document.getElementById('addProtocol').addEventListener('click', () => { document.getElementById('protocolForm').reset(); document.getElementById('protocolDialog').showModal(); });
document.getElementById('protocolForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('protocolFiles');
  const files = [...(input.files || [])];
  const validFiles = files.every(file => SUPPORTED_ATTACHMENT_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES);
  if (!validFiles) { showToast('Anexe PDF ou imagem de até 20 MB cada.'); return; }
  try {
    const attachments = await Promise.all(files.map(saveAttachment));
    state.protocols.push({ id: crypto.randomUUID(), title: document.getElementById('protocolTitle').value.trim(), source: document.getElementById('protocolSource').value.trim(), url: cleanUrl(document.getElementById('protocolUrl').value.trim()), reviewed: document.getElementById('protocolReviewed').value, attachments });
    saveState(); document.getElementById('protocolDialog').close(); showToast('Protocolo e anexos salvos neste dispositivo.');
  } catch (error) { showToast(error.message || 'Não foi possível salvar os anexos.'); }
});

document.querySelectorAll('.calc-tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.calc-tab').forEach(tab => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('.calc-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `calc-${button.dataset.calc}`));
}));
document.getElementById('calculateDose').addEventListener('click', () => {
  const weight = Number(document.getElementById('doseWeight').value);
  const dosePerKg = Number(document.getElementById('dosePerKg').value);
  const concentration = Number(document.getElementById('doseConcentration').value);
  const maxRaw = document.getElementById('doseMaximum').value;
  const maximum = maxRaw === '' ? null : Number(maxRaw);
  if (!positive(weight, dosePerKg, concentration) || (maximum !== null && (!Number.isFinite(maximum) || maximum <= 0))) { showCalculation('doseResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  const dose = weight * dosePerKg;
  const volume = dose / concentration;
  const exceeded = maximum !== null && dose > maximum;
  showCalculation('doseResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(dose)} mg por dose</strong><small>Volume calculado: <b>${number.format(volume)} mL</b> · ${number.format(weight)} kg × ${number.format(dosePerKg)} mg/kg ÷ ${number.format(concentration)} mg/mL</small>${exceeded ? '<small class="result-warning"><b>Atenção:</b> o resultado ultrapassa o limite máximo que você informou. Verifique a prescrição e a fonte profissional.</small>' : '<small>Confirme dose, limite e apresentação na bula profissional ou protocolo vigente.</small>'}`);
});
document.getElementById('doseMedication').addEventListener('change', event => {
  const item = state.medications.find(medication => medication.id === event.target.value);
  document.getElementById('dosePerKg').value = item?.dosePerKg || '';
  document.getElementById('doseConcentration').value = item?.concentration || '';
  document.getElementById('doseMaximum').value = item?.maxDose || '';
});
document.getElementById('calculateVolume').addEventListener('click', () => {
  const mg = Number(document.getElementById('amountMg').value);
  const concentration = Number(document.getElementById('amountConcentration').value);
  if (!positive(mg, concentration)) { showCalculation('volumeResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  showCalculation('volumeResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(mg / concentration)} mL</strong><small>${number.format(mg)} mg ÷ ${number.format(concentration)} mg/mL. Confira a concentração da apresentação.</small>`);
});
document.getElementById('calculateInfusion').addEventListener('click', () => {
  const volume = Number(document.getElementById('infusionVolume').value);
  const duration = Number(document.getElementById('infusionHours').value);
  if (!positive(volume, duration)) { showCalculation('infusionResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  showCalculation('infusionResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(volume / duration)} mL/h</strong><small>${number.format(volume)} mL ÷ ${number.format(duration)} horas. Confirme parâmetros e equipamento conforme protocolo local.</small>`);
});

const authClient = window.MEU_PLANTAO_SUPABASE_CLIENT;
const authGate = document.getElementById('authGate');
const appShell = document.getElementById('appShell');
const authMessage = document.getElementById('authMessage');
let passwordRecoveryMode = false;
function showAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle('error', isError);
}
function applyAuthSession(session) {
  const signedIn = Boolean(session?.user);
  const changingPassword = signedIn && passwordRecoveryMode;
  if (!signedIn) {
    activeCloudUser = null;
    cloudPhase = 'signed-out';
    setSyncStatus('Entre para sincronizar', 'ready');
  } else {
    beginCloudBootstrap(session.user);
  }
  const loadingCloud = signedIn && cloudPhase === 'loading' && !changingPassword;
  authGate.hidden = signedIn && !changingPassword && !loadingCloud;
  appShell.hidden = !signedIn || changingPassword || loadingCloud;
  document.getElementById('authForm').hidden = changingPassword || loadingCloud;
  document.getElementById('authPasswordRecoveryForm').hidden = !changingPassword;
  document.getElementById('authLoading').hidden = !loadingCloud;
  document.getElementById('authSignOut').hidden = !signedIn;
  if (signedIn && !changingPassword && !loadingCloud) showAuthMessage('');
  updateCloudButtons();
}
document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authClient) {
    showAuthMessage('Não foi possível iniciar a autenticação. Confira a conexão e a configuração do Supabase.', true);
    return;
  }
  const button = document.getElementById('authSubmit');
  button.disabled = true;
  showAuthMessage('Verificando acesso…');
  try {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const { error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (error) {
    const message = error.message || '';
    if (message.toLowerCase().includes('invalid login credentials')) showAuthMessage('E-mail ou senha não conferem. Se ainda não definiu uma senha, use “Esqueci ou preciso definir minha senha”.', true);
    else showAuthMessage(message || 'Não foi possível entrar. Confira a conexão e tente novamente.', true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authRecovery').addEventListener('click', async () => {
  if (!authClient) {
    showAuthMessage('Não foi possível iniciar a recuperação. Confira a conexão e a configuração do Supabase.', true);
    return;
  }
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    document.getElementById('authEmail').focus();
    showAuthMessage('Informe seu e-mail para receber o link de redefinição.', true);
    return;
  }
  const button = document.getElementById('authRecovery');
  button.disabled = true;
  showAuthMessage('Solicitando link de redefinição…');
  try {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showAuthMessage('Se este e-mail estiver cadastrado, você receberá um link para definir uma senha. Confira também o spam.');
  } catch (error) {
    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();
    if (code === 'over_email_send_rate_limit' || message.includes('email rate limit exceeded')) {
      showAuthMessage('O limite de envio de e-mails do Supabase foi atingido. Aguarde cerca de uma hora desde o último envio antes de pedir outro link. Convites e redefinições compartilham esse limite.', true);
    } else if (code === 'email_address_not_authorized') {
      showAuthMessage('O envio padrão do Supabase só atende endereços autorizados da equipe. É necessário configurar um provedor SMTP próprio.', true);
    } else {
      showAuthMessage(error.message || 'Não foi possível solicitar a redefinição de senha.', true);
    }
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authPasswordRecoveryForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('newPassword').value;
  const confirmation = document.getElementById('confirmPassword').value;
  if (password.length < 8) { showAuthMessage('A senha precisa ter pelo menos 8 caracteres.', true); return; }
  if (password !== confirmation) { showAuthMessage('As senhas não conferem.', true); return; }
  const button = document.getElementById('savePassword');
  button.disabled = true;
  try {
    const { error } = await authClient.auth.updateUser({ password });
    if (error) throw error;
    passwordRecoveryMode = false;
    const { data } = await authClient.auth.getSession();
    applyAuthSession(data?.session || null);
    showToast('Senha atualizada.');
  } catch (error) {
    showAuthMessage(error.message || 'Não foi possível atualizar a senha. Solicite um novo link de redefinição.', true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authSignOut').addEventListener('click', async () => {
  if (!authClient) return;
  const { error } = await authClient.auth.signOut();
  if (error) showToast('Não foi possível sair da conta.');
});
if (authClient) {
  authClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') passwordRecoveryMode = true;
    applyAuthSession(session);
  });
  authClient.auth.getSession().then(({ data, error }) => {
    if (error) showAuthMessage('Não foi possível verificar a sessão. Atualize a página e tente novamente.', true);
    applyAuthSession(data?.session || null);
    if (!data?.session) {
      const callbackParams = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (callbackParams.get('error_code') === 'otp_expired' && !callbackParams.has('access_token')) {
        history.replaceState(null, document.title, `${location.pathname}${location.search}`);
        showAuthMessage('Este link expirou ou já foi usado. Solicite um novo link; se o limite de envio aparecer, aguarde antes de tentar novamente.', true);
      }
    }
  }).catch(() => {
    showAuthMessage('Não foi possível verificar a sessão. Atualize a página e tente novamente.', true);
    applyAuthSession(null);
  });
} else {
  applyAuthSession(null);
  showAuthMessage('A configuração do Supabase não carregou. Atualize a página ou verifique a conexão.', true);
}

renderAll();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

