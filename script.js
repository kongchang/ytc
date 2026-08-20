// ============================================================
// ระบบติดตามแฟ้มเอกสาร — app logic (Firebase Firestore backend)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- Elements ----------
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

const form = document.getElementById('addFileForm');
const titleInput = document.getElementById('titleInput');
const descInput = document.getElementById('descInput');
const photoInput = document.getElementById('photoInput');
const photoUploadBox = document.getElementById('photoUploadBox');
const photoPreview = document.getElementById('photoPreview');
const previewImg = document.getElementById('previewImg');
const previewName = document.getElementById('previewName');
const removePhotoBtn = document.getElementById('removePhotoBtn');
const submitBtn = document.getElementById('submitBtn');

const fileList = document.getElementById('fileList');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyText = document.getElementById('emptyText');

const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statDone = document.getElementById('statDone');
const countAll = document.getElementById('countAll');
const countPending = document.getElementById('countPending');
const countDone = document.getElementById('countDone');

const filterTabs = document.querySelectorAll('.filter-tab');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const pagination = document.getElementById('pagination');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = document.getElementById('lightboxClose');
const connStatus = document.getElementById('connStatus');

// ---------- State ----------
let state = { entries: [] };
let seqMap = new Map(); // id -> running number, computed each render from createdAt order
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
const PAGE_SIZE = 6;
let pendingPhoto = null;
let pendingPhotoFile = null;
let editingDateFor = null; // { id, type } เช่น { id: 'e123', type: 'sent' }

// ============ Connection status banner ============
function showConnMessage(msg, isError) {
  connStatus.textContent = msg;
  connStatus.hidden = false;
  connStatus.classList.toggle('error', !!isError);
}
function hideConnMessage() {
  connStatus.hidden = true;
}

// ============ Firebase setup ============
let db = null;
let entriesCol = null;

if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
  showConnMessage('⚠️ ยังไม่ได้ตั้งค่า Firebase — แก้ไขไฟล์ firebase-config.js ด้วยค่าโปรเจกต์ของคุณ แล้วรีเฟรชหน้านี้', true);
} else {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    entriesCol = collection(db, 'entries');
    const entriesQuery = query(entriesCol, orderBy('createdAt', 'desc'));

    onSnapshot(entriesQuery, (snapshot) => {
      state.entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      hideConnMessage();
      render();
    }, (err) => {
      console.error('Firestore sync error:', err);
      showConnMessage('⚠️ เชื่อมต่อ Firestore ไม่สำเร็จ — ตรวจสอบ Firestore Rules และการตั้งค่าโปรเจกต์', true);
    });
  } catch (err) {
    console.error('Firebase init error:', err);
    showConnMessage('⚠️ ตั้งค่า Firebase ไม่ถูกต้อง — ตรวจสอบไฟล์ firebase-config.js', true);
  }
}

// ============ Firestore write helpers ============
async function addEntry(entryData) {
  if (!entriesCol) {
    showConnMessage('⚠️ ยังเชื่อมต่อ Firebase ไม่ได้ ตรวจสอบ firebase-config.js', true);
    return false;
  }
  try {
    await addDoc(entriesCol, entryData);
    return true;
  } catch (err) {
    console.error('Add failed:', err);
    showConnMessage('⚠️ บันทึกแฟ้มไม่สำเร็จ ลองใหม่อีกครั้ง', true);
    return false;
  }
}

async function updateEntry(id, patch) {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'entries', id), patch);
  } catch (err) {
    console.error('Update failed:', err);
    showConnMessage('⚠️ อัปเดตสถานะไม่สำเร็จ ลองใหม่อีกครั้ง', true);
  }
}

async function removeEntry(id) {
  if (!db) return;
  try {
    await deleteDoc(doc(db, 'entries', id));
  } catch (err) {
    console.error('Delete failed:', err);
    showConnMessage('⚠️ ลบแฟ้มไม่สำเร็จ ลองใหม่อีกครั้ง', true);
  }
}

// ============ Navigation ============
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const pageId = btn.dataset.page + '-page';
    switchPage(pageId);
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function switchPage(pageId) {
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

// ============ Photo Upload ============
photoUploadBox.addEventListener('click', () => photoInput.click());

photoUploadBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  photoUploadBox.style.background = '#f0f2f7';
});

photoUploadBox.addEventListener('dragleave', () => {
  photoUploadBox.style.background = '';
});

photoUploadBox.addEventListener('drop', (e) => {
  e.preventDefault();
  photoUploadBox.style.background = '';
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    photoInput.files = files;
    handlePhotoSelect();
  }
});

photoInput.addEventListener('change', handlePhotoSelect);

function handlePhotoSelect() {
  const file = photoInput.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    alert('ไฟล์ใหญ่เกินไป (สูงสุด 5MB)');
    photoInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 600;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      pendingPhoto = canvas.toDataURL('image/jpeg', 0.75);
      pendingPhotoFile = file;
      displayPhotoPreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function displayPhotoPreview() {
  previewImg.src = pendingPhoto;
  previewName.textContent = pendingPhotoFile.name;
  photoPreview.classList.add('show');
}

removePhotoBtn.addEventListener('click', (e) => {
  e.preventDefault();
  pendingPhoto = null;
  pendingPhotoFile = null;
  photoInput.value = '';
  photoPreview.classList.remove('show');
});

// ============ Form Submit ============
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  const entryData = {
    title: title,
    desc: descInput.value.trim(),
    photo: pendingPhoto,
    sent: false,
    sentDate: null,
    returned: false,
    returnedDate: null,
    createdAt: Date.now()
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const ok = await addEntry(entryData);

  submitBtn.disabled = false;
  submitBtn.textContent = 'บันทึกแฟ้มใหม่';

  if (!ok) return;

  // Reset form
  titleInput.value = '';
  descInput.value = '';
  pendingPhoto = null;
  pendingPhotoFile = null;
  photoInput.value = '';
  photoPreview.classList.remove('show');
  currentPage = 1;

  // Switch to dashboard
  switchPage('dashboard-page');
  navBtns.forEach(b => b.classList.remove('active'));
  navBtns[0].classList.add('active');
});

// ============ Status Toggle ============
function toggleStatusWithDatePicker(id, type) {
  const entry = state.entries.find(x => x.id === id);
  if (!entry) return;

  const isPending = editingDateFor && editingDateFor.id === id && editingDateFor.type === type;

  // ถ้า already checked แล้ว (บันทึกแล้วจริง) ให้ uncheck
  if (type === 'sent' && entry.sent) {
    updateEntry(id, { sent: false, sentDate: null, returned: false, returnedDate: null });
    editingDateFor = null;
    render();
    return;
  } else if (type === 'returned' && entry.returned) {
    updateEntry(id, { returned: false, returnedDate: null });
    editingDateFor = null;
    render();
    return;
  }

  // ถ้าติ๊กค้างรอกรอกวันที่อยู่ (ยังไม่กดบันทึก) แล้วกดซ้ำ ให้ยกเลิกการติ๊ก
  if (isPending) {
    editingDateFor = null;
    render();
    return;
  }

  // ยังไม่ติ๊ก -> เปิดช่องกรอกวันที่ ยังไม่ถือว่าสำเร็จจนกว่าจะเลือกวันที่แล้วกด "บันทึก"
  if (type === 'returned' && !entry.sent) return; // ต้องส่งขึ้นไปก่อนถึงจะรับลงมาได้

  editingDateFor = { id, type };
  render();

  setTimeout(() => {
    const datePicker = fileList.querySelector(`[data-entry-id="${id}"][data-type="${type}"] .date-input`);
    if (datePicker) {
      datePicker.focus();
      if (datePicker.showPicker) {
        try { datePicker.showPicker(); } catch (e) {}
      }
    }
  }, 0);
}

function saveDateForEntry(id, type) {
  const entry = state.entries.find(x => x.id === id);
  if (!entry) return;

  const picker = fileList.querySelector(`[data-entry-id="${id}"][data-type="${type}"]`);
  const input = picker ? picker.querySelector('.date-input') : null;
  if (!input || !input.value) return;

  const patch = type === 'sent'
    ? { sent: true, sentDate: input.value }
    : { returned: true, returnedDate: input.value };

  updateEntry(id, patch);
  editingDateFor = null;
  render();
}

function cancelDateEdit() {
  editingDateFor = null;
  render();
}

function deleteEntry(id) {
  if (confirm('ลบแฟ้มนี้?')) {
    removeEntry(id);
  }
}

// ============ Rendering ============
function rebuildSeqMap() {
  seqMap = new Map();
  const asc = [...state.entries].sort((a, b) => a.createdAt - b.createdAt);
  asc.forEach((e, idx) => seqMap.set(e.id, idx + 1));
}

function render() {
  rebuildSeqMap();

  const total = state.entries.length;
  const pending = state.entries.filter(e => e.sent && !e.returned).length;
  const done = state.entries.filter(e => e.sent && e.returned).length;

  statTotal.textContent = total;
  statPending.textContent = pending;
  statDone.textContent = done;
  countAll.textContent = total;
  countPending.textContent = pending;
  countDone.textContent = done;

  filterTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === currentFilter);
  });

  const filtered = applyFilter(state.entries);

  if (filtered.length === 0) {
    fileList.innerHTML = '';
    pagination.innerHTML = '';
    emptyState.classList.remove('hidden');
    if (total === 0) {
      emptyTitle.textContent = 'ยังไม่มีแฟ้มในระบบ';
      emptyText.textContent = 'กดปุ่ม "เพิ่มแฟ้มใหม่" เพื่อเริ่มติดตามแฟ้มเอกสารของคุณ';
    } else if (searchQuery) {
      emptyTitle.textContent = 'ไม่พบแฟ้มที่ค้นหา';
      emptyText.textContent = 'ลองค้นหาด้วยคำอื่น หรือล้างคำค้นหา';
    } else {
      emptyTitle.textContent = 'ไม่มีแฟ้มในหมวดนี้';
      emptyText.textContent = 'ลองเลือกแท็บอื่นเพื่อดูแฟ้มทั้งหมด';
    }
    return;
  }

  emptyState.classList.add('hidden');

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  fileList.innerHTML = pageItems.map(entry => createFileCard(entry)).join('');

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''} aria-label="ก่อนหน้า">‹</button>`;

  getPageNumbers(currentPage, totalPages).forEach(p => {
    if (p === '...') {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
  });

  html += `<button class="page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''} aria-label="ถัดไป">›</button>`;

  pagination.innerHTML = html;
}

function getPageNumbers(current, total) {
  const delta = 1;
  const range = [];
  const withDots = [];
  let last;

  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }

  range.forEach(i => {
    if (last !== undefined) {
      if (i - last === 2) withDots.push(last + 1);
      else if (i - last !== 1) withDots.push('...');
    }
    withDots.push(i);
    last = i;
  });

  return withDots;
}

function applyFilter(entries) {
  let result = entries;
  if (currentFilter === 'pending') result = result.filter(e => e.sent && !e.returned);
  else if (currentFilter === 'done') result = result.filter(e => e.sent && e.returned);

  if (searchQuery) {
    result = result.filter(e => entrySearchText(e).includes(searchQuery));
  }

  return result;
}

// รวมข้อความสำหรับค้นหา: ชื่อเรื่อง, รายละเอียด, และวันที่ (สร้าง/ส่งขึ้น/รับลงมา)
// ในหลายรูปแบบ (ไทยเต็ม, ไทยย่อ, ตัวเลข วัน/เดือน/ปี) เพื่อให้ค้นด้วยวัน เดือน หรือปีได้
function entrySearchText(entry) {
  const parts = [entry.title, entry.desc || ''];

  parts.push(dateSearchTokens(new Date(entry.createdAt)));
  if (entry.sentDate) parts.push(dateSearchTokens(isoToDateObj(entry.sentDate)));
  if (entry.returnedDate) parts.push(dateSearchTokens(isoToDateObj(entry.returnedDate)));

  return parts.join(' ').toLowerCase();
}

function isoToDateObj(isoStr) {
  const [year, month, day] = isoStr.split('-');
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

function dateSearchTokens(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const buddhistYear = year + 543;
  const thaiLong = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const thaiShort = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });

  return [
    thaiLong, thaiShort,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${year}-${month}-${day}`,
    String(year), String(buddhistYear)
  ].join(' ');
}

function createFileCard(entry) {
  const photoHtml = entry.photo
    ? `<img class="file-photo" src="${entry.photo}" alt="รูป: ${escapeHtml(entry.title)}" data-full="${entry.photo}" />`
    : `<div class="file-photo placeholder">📄</div>`;

  const todayStr = new Date().toISOString().split('T')[0];

  const showSentDatePicker = editingDateFor && editingDateFor.id === entry.id && editingDateFor.type === 'sent';
  const showReturnedDatePicker = editingDateFor && editingDateFor.id === entry.id && editingDateFor.type === 'returned';

  // ติ๊กถูกให้ขึ้นทันทีตอนเปิดช่องกรอกวันที่ (ก่อนกดบันทึกจริง) เพื่อให้เห็นว่าเลือกแล้ว
  const sentCheckSvg = (entry.sent || showSentDatePicker) ? CHECK_SVG : '';
  const returnedCheckSvg = (entry.returned || showReturnedDatePicker) ? CHECK_SVG : '';

  const sentDateValue = entry.sent && entry.sentDate ? entry.sentDate : todayStr;
  const returnedDateValue = entry.returned && entry.returnedDate ? entry.returnedDate : todayStr;

  const sentDateDisplay = entry.sent && entry.sentDate ? isoToThaiDate(entry.sentDate) : '';
  const returnedDateDisplay = entry.returned && entry.returnedDate ? isoToThaiDate(entry.returnedDate) : '';

  return `
    <div class="file-card">
      <div style="display: flex; gap: 14px;">
        ${photoHtml}
        <div class="file-header" style="margin: 0; gap: 0;">
          <div class="file-title-section">
            <p class="file-title">${escapeHtml(entry.title)}</p>
            <p class="file-meta">${formatDateTime(entry.createdAt)}</p>
            ${entry.desc ? `<p class="file-meta">${escapeHtml(entry.desc)}</p>` : ''}
          </div>
          <div class="file-code">#${docCode(entry)}</div>
        </div>
      </div>

      <div class="file-status">
        <div style="flex: 1;">
          <button class="status-item" data-action="toggle-sent" data-id="${entry.id}" style="background: none; border: none; padding: 0; cursor: pointer; text-align: left; width: 100%;">
            <div class="status-checkbox ${(entry.sent || showSentDatePicker) ? 'checked' : ''}">${sentCheckSvg}</div>
            <div>
              <div class="status-label">ส่งขึ้นไปแล้ว</div>
              ${sentDateDisplay ? `<div class="status-date">${sentDateDisplay}</div>` : ''}
              ${showSentDatePicker && !entry.sent ? `<div class="status-date">เลือกวันที่แล้วกดบันทึก</div>` : ''}
            </div>
          </button>
          ${(entry.sent || showSentDatePicker) ? `
            <div class="date-picker-inline ${showSentDatePicker ? 'show' : ''}" data-entry-id="${entry.id}" data-type="sent" style="margin-top: 8px;">
              <input type="date" class="date-input" value="${sentDateValue}" max="${todayStr}" />
              <button class="date-save-btn" data-action="save-date" data-id="${entry.id}" data-type="sent">บันทึก</button>
              <button class="date-cancel-btn" data-action="cancel-date" data-id="${entry.id}" data-type="sent">ยกเลิก</button>
            </div>
          ` : ''}
        </div>

        <div class="status-divider"></div>

        <div style="flex: 1;">
          <button class="status-item" data-action="toggle-returned" data-id="${entry.id}" ${!entry.sent ? 'style="opacity: 0.5; pointer-events: none; background: none; border: none; padding: 0; cursor: not-allowed; text-align: left; width: 100%;"' : 'style="background: none; border: none; padding: 0; cursor: pointer; text-align: left; width: 100%;"'}>
            <div class="status-checkbox ${(entry.returned || showReturnedDatePicker) ? 'checked' : ''}">${returnedCheckSvg}</div>
            <div>
              <div class="status-label">รับลงมาแล้ว</div>
              ${returnedDateDisplay ? `<div class="status-date">${returnedDateDisplay}</div>` : ''}
              ${showReturnedDatePicker && !entry.returned ? `<div class="status-date">เลือกวันที่แล้วกดบันทึก</div>` : ''}
            </div>
          </button>
          ${(entry.returned || showReturnedDatePicker) ? `
            <div class="date-picker-inline ${showReturnedDatePicker ? 'show' : ''}" data-entry-id="${entry.id}" data-type="returned" style="margin-top: 8px;">
              <input type="date" class="date-input" value="${returnedDateValue}" max="${todayStr}" />
              <button class="date-save-btn" data-action="save-date" data-id="${entry.id}" data-type="returned">บันทึก</button>
              <button class="date-cancel-btn" data-action="cancel-date" data-id="${entry.id}" data-type="returned">ยกเลิก</button>
            </div>
          ` : ''}
        </div>

        <div class="file-actions">
          <button class="delete-btn" data-action="delete" data-id="${entry.id}">ลบ</button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function docCode(entry) {
  const seq = seqMap.get(entry.id) || 0;
  return String(seq).padStart(4, '0');
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) +
         ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function isoToThaiDate(isoStr) {
  if (!isoStr) return '';
  const [year, month, day] = isoStr.split('-');
  const d = new Date(year, parseInt(month) - 1, day);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ============ Event Delegation ============
fileList.addEventListener('click', (e) => {
  const img = e.target.closest('.file-photo[data-full]');
  if (img) {
    lightboxImg.src = img.dataset.full;
    lightbox.classList.add('open');
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const type = btn.dataset.type;

  if (action === 'toggle-sent') {
    toggleStatusWithDatePicker(id, 'sent');
  } else if (action === 'toggle-returned') {
    toggleStatusWithDatePicker(id, 'returned');
  } else if (action === 'save-date') {
    saveDateForEntry(id, type);
  } else if (action === 'cancel-date') {
    cancelDateEdit();
  } else if (action === 'delete') {
    deleteEntry(id);
  }
});

lightboxClose.addEventListener('click', () => lightbox.classList.remove('open'));
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) lightbox.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightbox.classList.remove('open');
});

// Filter tabs
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    currentPage = 1;
    render();
  });
});

// Search bar
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  searchClearBtn.classList.toggle('show', searchQuery.length > 0);
  currentPage = 1;
  render();
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClearBtn.classList.remove('show');
  currentPage = 1;
  render();
  searchInput.focus();
});

// Pagination
pagination.addEventListener('click', (e) => {
  const btn = e.target.closest('.page-btn');
  if (!btn || btn.disabled) return;
  const p = btn.dataset.page;
  if (p === 'prev') currentPage -= 1;
  else if (p === 'next') currentPage += 1;
  else currentPage = parseInt(p, 10);
  render();
});

// Initial render (data populates once Firestore's onSnapshot fires)
render();
