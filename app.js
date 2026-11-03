const STORAGE_KEY = 'meu-plantao:v1';
const FILE_DB_NAME = 'meu-plantao-files-v1';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
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
let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = todayKey();
let toastTimer;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
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
      const file = await readAttachment(button.dataset.openFile);
      if (!file) { showToast('Anexo não encontrado neste navegador.'); return; }
      const fileUrl = URL.createObjectURL(file.blob);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
    } catch { showToast('Não foi possível abrir o anexo.'); }
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
  const validFiles = files.every(file => (file.type === 'application/pdf' || file.type.startsWith('image/')) && file.size <= MAX_ATTACHMENT_BYTES);
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
function showAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle('error', isError);
}
function applyAuthSession(session) {
  const signedIn = Boolean(session?.user);
  authGate.hidden = signedIn;
  appShell.hidden = !signedIn;
  document.getElementById('authSignOut').hidden = !signedIn;
  if (signedIn) showAuthMessage('');
}
document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authClient) {
    showAuthMessage('Não foi possível iniciar a autenticação. Confira a conexão e a configuração do Supabase.', true);
    return;
  }
  const button = document.getElementById('authSubmit');
  button.disabled = true;
  showAuthMessage('Enviando link…');
  try {
    const email = document.getElementById('authEmail').value.trim();
    const emailRedirectTo = `${location.origin}${location.pathname}`;
    const { error } = await authClient.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
    if (error) throw error;
    showAuthMessage('Se este e-mail tiver uma conta autorizada, você receberá um link de acesso. Confira também o spam.');
  } catch (error) {
    showAuthMessage(error.message || 'Não foi possível enviar o link. Confira as configurações de autenticação.', true);
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
  authClient.auth.onAuthStateChange((_event, session) => applyAuthSession(session));
  authClient.auth.getSession().then(({ data, error }) => {
    if (error) showAuthMessage('Não foi possível verificar a sessão. Atualize a página e tente novamente.', true);
    applyAuthSession(data?.session || null);
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

