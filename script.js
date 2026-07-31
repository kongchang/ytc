// Data & State Management
const STATUS_CONFIG = {
    'ยังไม่เริ่ม': { color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-200' },
    'กำลังดำเนินการ': { color: 'text-yellow-600', bg: 'bg-yellow-100', border: 'border-yellow-200' },
    'เสร็จสมบูรณ์แล้ว': { color: 'text-emerald-600', bg: 'bg-emerald-100', border: 'border-emerald-200' }
};

let complaints = [];
let currentFilter = 'ทั้งหมด';
let timeFilterVal = 'ทั้งหมด';
let actionCallback = null; // For confirm modal
let currentPage = 1; // สำหรับแบ่งหน้ารายการคำร้อง
const ITEMS_PER_PAGE = 9; // จำนวนการ์ดต่อหน้า

// Firestore จำกัดขนาดเอกสารไว้ที่ 1MB ต่อรายการ — ตั้งงบไว้ที่ 900KB เผื่อระยะปลอดภัย (ใช้ทั้งตอนแสดงมิเตอร์และตอนบันทึกจริง)
const FIRESTORE_DOC_SIZE_BUDGET = 900 * 1024;

// เก็บรูปภาพที่แนบในฟอร์ม (รองรับหลายรูปต่อหัวข้อ) ระหว่างกรอกฟอร์ม
let currentImages = { form: [], before: [], after: [] };

// แปลงข้อมูลเก่า (เก็บเป็นรูปเดียว เช่น beforeImg เป็น string) ให้เป็น array เสมอ
// เพื่อให้ข้อมูลเก่าที่เคยบันทึกไว้ยังแสดงผลได้ปกติ ควบคู่กับข้อมูลใหม่ที่เก็บได้หลายรูป
function normalizeImgArray(arrField, legacyField) {
    if (Array.isArray(arrField)) return arrField.slice();
    if (Array.isArray(legacyField)) return legacyField.slice();
    if (legacyField) return [legacyField];
    return [];
}

// Sample Mock Data (Loaded if localStorage is empty)
const MOCK_DATA = [
    {
        id: 1, title: "ไฟฟ้าส่องว่างสาธารณะดับตลอดเส้นทาง", receiveNo: "125/2569", requester: "นางมาลี รักดี",
        supervisor: "นายวิทยา สุขใจ", department: "งานโยธา", subDepartment: "ชุดไฟฟ้า", zone: "เขต 2",
        projectWorkTopic: "เทศปัญญัติ", workflowStage: "สำรวจ",
        startDate: "2026-07-10", contactType: "เบอร์โทรศัพท์", contactInfo: "0811112222",
        status: "กำลังดำเนินการ", note: "รอประสานงานการไฟฟ้า", completedDate: "",
        beforeImg: "https://images.unsplash.com/photo-1517420879524-86d64ac2f339?auto=format&fit=crop&w=600&q=80", afterImg: ""
    },
    {
        id: 2, title: "ถนนชำรุดเป็นหลุมบ่อขนาดใหญ่เป็นระยะทางยาว", receiveNo: "126/2569", requester: "นายสมศักดิ์ ใจดี",
        supervisor: "นายวิทยา สุขใจ", department: "งานโยธา", subDepartment: "ชุดซ่อมปะถนน", zone: "เขต 2",
        projectWorkTopic: "งบอุดหนุน", workflowStage: "ทำสัญญา",
        startDate: "2026-06-28", contactType: "เบอร์โทรศัพท์", contactInfo: "0822223333",
        status: "เสร็จสมบูรณ์แล้ว", note: "", completedDate: "2026-07-01",
        beforeImg: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=600&q=80",
        afterImg: "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=600&q=80"
    }
];

const SESSION_KEY = 'sateangnok_session';

// ป้องกัน XSS: แปลงอักขระที่มีความหมายพิเศษใน HTML ให้เป็นข้อความธรรมดา
// ใช้ทุกจุดที่เอาข้อมูลจากฐานข้อมูล (ซึ่งอาจถูกแก้ไขโดยไม่ผ่านฟอร์มของเราก็ได้) ไปแปะผ่าน innerHTML
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ตรวจสอบว่า src ของรูปภาพเป็น data URL รูปภาพ หรือลิงก์ http(s) เท่านั้น
// ป้องกันไม่ให้ค่าที่แปลกปลอมกลายเป็นช่องทางโจมตี (เช่น javascript: URIs หรือ attribute injection)
function safeImageSrc(src) {
    if (typeof src !== 'string') return 'https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ';
    if (/^data:image\//i.test(src) || /^https?:\/\//i.test(src)) return src;
    return 'https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ';
}

// Initialize icons on load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    setupEventListeners();

    // ตัวเดียวที่ตัดสินว่า "ล็อกอินแล้วจริงหรือไม่" คือ Firebase Authentication
    // (localStorage ด้านบนใช้แค่กันหน้าจอกระพริบตอนกด F5 เท่านั้น ไม่ใช่ตัวป้องกันความปลอดภัยจริง)
    auth.onAuthStateChanged((user) => {
        if (user) {
            localStorage.setItem(SESSION_KEY, 'active'); // ใช้เพื่อ anti-flash เท่านั้น
            document.documentElement.classList.add('has-session');
            document.getElementById('login-view').classList.add('hidden');
            const appLayout = document.getElementById('app-layout');
            appLayout.classList.remove('hidden');
            navigate('dashboard');
            lucide.createIcons();
            initFirestoreSync(); // เริ่มซิงก์ข้อมูลก็ต่อเมื่อยืนยันตัวตนสำเร็จแล้วเท่านั้น
        } else {
            stopFirestoreSync();
            localStorage.removeItem(SESSION_KEY);
            document.documentElement.classList.remove('has-session');
            document.getElementById('app-layout').classList.add('hidden');
            const login = document.getElementById('login-view');
            login.classList.remove('hidden', 'opacity-0');
        }
    });
});

// เชื่อมต่อและซิงก์ข้อมูล "คำร้อง" กับ Firestore แบบเรียลไทม์
// ทุกคนที่เปิดเว็บนี้จะอ่าน/เขียนข้อมูลชุดเดียวกันจากฐานข้อมูลกลาง แทนที่จะแยกกันอยู่ใน localStorage ของแต่ละเครื่อง
let firestoreUnsubscribe = null;
function initFirestoreSync() {
    if (firestoreUnsubscribe) return; // กันไม่ให้ผูก listener ซ้ำซ้อนหากล็อกอิน-ออกหลายรอบ

    // เช็กให้แน่ใจว่า "เคยเซตข้อมูลตัวอย่างไปแล้วหรือยัง" ก่อนเริ่มฟังข้อมูลจริง
    // เพื่อไม่ให้ข้อมูลตัวอย่างถูกใส่กลับเข้ามาซ้ำทุกครั้งที่ตารางว่าง (เช่น ตอนผู้ใช้ลบคำร้องทั้งหมดออกโดยตั้งใจ)
    ensureMockDataSeededOnce().finally(() => {
        firestoreUnsubscribe = db.collection('complaints').onSnapshot((snapshot) => {
            // snapshot.empty ที่นี่แปลว่า "ไม่มีคำร้องตอนนี้จริง ๆ" (เช่น ผู้ใช้ลบออกหมด)
            // ไม่ใช่สัญญาณให้ใส่ข้อมูลตัวอย่างกลับเข้ามาอีกต่อไป
            complaints = snapshot.docs.map(doc => doc.data());
            renderDashboard();
            renderTeamBreakdown(); // อัปเดตสรุปภาระงานทีมงานเสมอ ไม่ว่าจะเปิดหน้านั้นอยู่หรือไม่
        }, (err) => {
            console.error('Firestore sync error:', err);
            showToast('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า Firebase ใน firebase-config.js', 'error');
        });
    });
}

function stopFirestoreSync() {
    if (firestoreUnsubscribe) {
        firestoreUnsubscribe();
        firestoreUnsubscribe = null;
    }
    complaints = [];
}

// ใส่ข้อมูลตัวอย่างเริ่มต้นให้ "ครั้งเดียวตลอดอายุฐานข้อมูล" เท่านั้น
// อ่านสถานะจากเอกสาร meta/seedStatus แทนการดูว่า collection ว่างหรือไม่ (ซึ่งเปลี่ยนได้ตลอดจากการลบข้อมูลจริง)
function ensureMockDataSeededOnce() {
    const seedFlagRef = db.collection('meta').doc('seedStatus');
    return seedFlagRef.get().then((flagDoc) => {
        if (flagDoc.exists) return; // เคยเซตไปแล้ว (ไม่ว่าจะเคยลบข้อมูลจริงทิ้งไปแล้วหรือไม่ก็ตาม) ไม่ต้องทำซ้ำ

        const batch = db.batch();
        MOCK_DATA.forEach(item => {
            batch.set(db.collection('complaints').doc(String(item.id)), item);
        });
        batch.set(seedFlagRef, { seededAt: new Date().toISOString() });
        return batch.commit().catch(err => console.error('Seed data error:', err));
    }).catch(err => {
        console.error('Seed flag check error:', err);
    });
}

// Custom Toast Notification (Replaces alert)
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    const isSuccess = type === 'success';
    const bgColor = isSuccess ? 'bg-white' : 'bg-red-50';
    const borderColor = isSuccess ? 'border-emerald-200' : 'border-red-200';
    const iconColor = isSuccess ? 'text-emerald-500' : 'text-red-500';
    const iconName = isSuccess ? 'check-circle-2' : 'alert-circle';
    const textColor = isSuccess ? 'text-gray-800' : 'text-red-800';

    toast.className = `flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl border ${borderColor} ${bgColor} toast-enter mb-2 pointer-events-auto`;
    toast.innerHTML = `
        <i data-lucide="${iconName}" class="w-6 h-6 ${iconColor} flex-shrink-0"></i>
        <p class="text-sm font-bold ${textColor}">${message}</p>
    `;
    
    container.appendChild(toast);
    lucide.createIcons({ root: toast });

    setTimeout(() => {
        toast.classList.replace('toast-enter', 'toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Toggle Password Visibility (Login field)
function togglePasswordVisibility() {
    const input = document.getElementById('login-password');
    const btn = document.getElementById('toggle-password-btn');
    const isHidden = input.type === 'password';

    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = `<i id="toggle-password-icon" data-lucide="${isHidden ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
    lucide.createIcons({ root: btn });
}

// Authentication ผ่าน Firebase Auth จริง (ตรวจสอบฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ใน JS ฝั่งเครื่อง)
// ผู้ใช้ยังคงกรอก "ชื่อผู้ใช้งาน" แบบเดิมได้ตามปกติ โค้ดจะแปลงเป็นอีเมลภายในให้เอง
// เพราะ Firebase Authentication (Email/Password) ต้องใช้รูปแบบอีเมลเป็นตัวระบุบัญชี
const STAFF_EMAIL_DOMAIN = 'stnkongchang.local'; // ต้องตรงกับตอนสร้างผู้ใช้ในหน้า Firebase Console

function usernameToEmail(username) {
    return `${username.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

let loginInFlight = false;
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (loginInFlight) return;

    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    loginInFlight = true;
    if (submitBtn) submitBtn.disabled = true;

    auth.signInWithEmailAndPassword(usernameToEmail(user), pass)
        .then(() => {
            // onAuthStateChanged (ด้านบน) จะเป็นตัวจัดการเปลี่ยนหน้าจอเข้าสู่ dashboard ให้เอง
            showToast('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ');
        })
        .catch((err) => {
            console.error('Login error:', err.code);
            // ข้อความเดียวกันทุกกรณี ไม่บอกว่า "ไม่มีบัญชีนี้" หรือ "รหัสผ่านผิด"
            // เพื่อไม่ให้ผู้ไม่หวังดีใช้เดา (enumerate) ชื่อผู้ใช้งานที่มีอยู่จริงได้
            showToast('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง!', 'error');
        })
        .finally(() => {
            loginInFlight = false;
            if (submitBtn) submitBtn.disabled = false;
        });
});

function logout() {
    auth.signOut(); // onAuthStateChanged จะเป็นตัวจัดการล้างหน้าจอกลับไปหน้า Login ให้เอง
}

// Navigation
function navigate(viewName) {
    document.getElementById('view-dashboard').classList.add('hidden');
    document.getElementById('view-form').classList.add('hidden');
    document.getElementById('view-team').classList.add('hidden');
    
    // reset nav styles
    const inactiveNav = "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-white/5 text-emerald-100 hover:text-white";
    const activeNav = "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all bg-emerald-900/60 shadow-inner";
    document.getElementById('nav-dashboard').className = inactiveNav;
    document.getElementById('nav-form').className = inactiveNav;
    document.getElementById('nav-team').className = inactiveNav;

    if (viewName === 'dashboard') {
        document.getElementById('view-dashboard').classList.remove('hidden');
        document.getElementById('nav-dashboard').className = activeNav;
        renderDashboard();
    } else if (viewName === 'form') {
        document.getElementById('view-form').classList.remove('hidden');
        document.getElementById('nav-form').className = activeNav;
        window.scrollTo(0,0);
    } else if (viewName === 'team') {
        document.getElementById('view-team').classList.remove('hidden');
        document.getElementById('nav-team').className = activeNav;
        renderTeamBreakdown();
        window.scrollTo(0,0);
    }
}

function openForm(id = null) {
    resetForm();
    if (id) {
        const item = complaints.find(c => c.id === id);
        if (item) populateForm(item);
        document.getElementById('form-title').innerHTML = `<i data-lucide="edit" class="w-6 h-6 text-brand"></i> แก้ไขข้อมูลคำร้อง (ID: ${id})`;
    } else {
        document.getElementById('form-title').innerHTML = `<i data-lucide="file-edit" class="w-6 h-6 text-brand"></i> บันทึกข้อมูลคำร้องใหม่`;
    }
    lucide.createIcons();
    navigate('form');
}

// Confirm Modal
function openConfirmModal(message, callback) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.remove('hidden');
    actionCallback = callback;
}
function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    actionCallback = null;
}
document.getElementById('btn-confirm-action').addEventListener('click', () => {
    if (actionCallback) actionCallback();
    closeConfirmModal();
});

// Image Viewer Lightbox
function openImageViewer(src) {
    if (!src || src.includes('placehold.co')) return;
    document.getElementById('image-viewer-img').src = src;
    document.getElementById('image-viewer-modal').classList.remove('hidden');
}
function closeImageViewer() {
    document.getElementById('image-viewer-modal').classList.add('hidden');
}

// Detail Modal
function viewDetail(id) {
    const item = complaints.find(c => c.id === id);
    if(!item) return;

    const st = STATUS_CONFIG[item.status];
    document.getElementById('dt-status').className = `inline-block px-3 py-1 rounded-full text-xs font-bold mb-3 ${st.bg} ${st.color}`;
    document.getElementById('dt-status').textContent = item.status;
    
    document.getElementById('dt-title').textContent = item.title;
    document.getElementById('dt-no').textContent = item.receiveNo ? `เลขรับ: ${item.receiveNo}` : 'ไม่มีเลขรับ';
    
    document.getElementById('dt-requester').textContent = item.requester;
    document.getElementById('dt-contact').textContent = `${item.contactType}: ${item.contactInfo}`;
    document.getElementById('dt-zone').textContent = item.zone;
    document.getElementById('dt-dept').textContent = item.department + (item.subDepartment ? ` (${item.subDepartment})` : '');
    document.getElementById('dt-supervisor').textContent = item.supervisor;
    
    // Format Thai Date
    const dObj = new Date(item.startDate);
    document.getElementById('dt-date').textContent = !isNaN(dObj) ? dObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric'}) : item.startDate;

    // Project Work Section (only show for งานโครงการ with project work topic)
    const projectWorkSection = document.getElementById('dt-project-work-section');
    if (item.projectWorkTopic && item.department === 'งานโครงการ') {
        document.getElementById('dt-projectWorkTopic').textContent = item.projectWorkTopic || '-';
        document.getElementById('dt-workflowStage').textContent = item.workflowStage || '-';
        projectWorkSection.classList.remove('hidden');
    } else {
        projectWorkSection.classList.add('hidden');
    }

    // Planning Division Complaint Topic Section (only show for ฝ่ายแผน with planning topic)
    const planningTopicSection = document.getElementById('dt-planning-topic-section');
    if (item.planningTopic && item.department === 'ฝ่ายแผน') {
        document.getElementById('dt-planningTopic').textContent = item.planningTopic || '-';
        planningTopicSection.classList.remove('hidden');
    } else {
        planningTopicSection.classList.add('hidden');
    }

    // Note Section
    const noteEl = document.getElementById('dt-note-section');
    if(item.status !== 'เสร็จสมบูรณ์แล้ว' && item.note) {
        document.getElementById('dt-note').textContent = item.note;
        noteEl.classList.remove('hidden');
    } else {
        noteEl.classList.add('hidden');
    }

    // Images Section
    const formContainer = document.getElementById('dt-form-container');
    const afterContainer = document.getElementById('dt-after-container');
    const completeDate = document.getElementById('dt-completed-date');

    const formArr = normalizeImgArray(item.formImgs);
    const beforeArr = normalizeImgArray(item.beforeImgs, item.beforeImg);
    const afterArr = normalizeImgArray(item.afterImgs, item.afterImg);

    if (formArr.length > 0) {
        renderDetailGallery('dt-form-grid', formArr);
        formContainer.classList.remove('hidden');
    } else {
        formContainer.classList.add('hidden');
    }

    renderDetailGallery('dt-before-grid', beforeArr);

    if (item.status === 'เสร็จสมบูรณ์แล้ว') {
        afterContainer.classList.remove('hidden');
        renderDetailGallery('dt-after-grid', afterArr);
        if(item.completedDate) {
            const cObj = new Date(item.completedDate);
            completeDate.textContent = "ดำเนินการเสร็จเมื่อ: " + (!isNaN(cObj) ? cObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric'}) : item.completedDate);
            completeDate.classList.remove('hidden');
        } else {
            completeDate.classList.add('hidden');
        }
    } else {
        afterContainer.classList.add('hidden');
        completeDate.classList.add('hidden');
    }

    // Actions
    document.getElementById('dt-btn-edit').onclick = () => { closeDetailModal(); openForm(item.id); };
    document.getElementById('dt-btn-delete').onclick = () => { deleteItem(item.id); };

    document.getElementById('detail-modal').classList.remove('hidden');
}

// วาดรูปภาพหลายรูปในหน้ารายละเอียด (แนบแบบฟอร์ม / ก่อน / หลังดำเนินการ)
function renderDetailGallery(containerId, imgs) {
    const container = document.getElementById(containerId);
    if (!imgs || imgs.length === 0) {
        container.innerHTML = `<img src="https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ" alt="ไม่มีรูปภาพ" class="w-full h-28 md:h-32 object-cover rounded-xl border-2 border-gray-200 col-span-2">`;
        return;
    }
    container.innerHTML = imgs.map(src => `
        <img src="${escapeHtml(safeImageSrc(src))}" alt="รูปภาพประกอบ" class="w-full h-28 md:h-32 object-cover rounded-xl border-2 border-gray-200 cursor-pointer shadow-sm hover:opacity-90 transition-opacity" onclick="openImageViewer(this.src)" onerror="this.src='https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ'">
    `).join('');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
}

// Dashboard Render
function setFilter(status) {
    currentFilter = status;
    currentPage = 1;
    
    // Update UI styles for filter cards
    document.querySelectorAll('.stat-card').forEach(card => {
        if(card.dataset.filter === status) {
            card.classList.remove('opacity-60');
            card.classList.add('ring-2');
        } else {
            card.classList.add('opacity-60');
            card.classList.remove('ring-2');
        }
    });

    // Sync with dropdown filter
    const statusDropdown = document.getElementById('filter-status');
    if (statusDropdown && statusDropdown.value !== status) {
        statusDropdown.value = status;
    }

    renderDashboard();
}

function renderDashboard() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Filter logic
    let filtered = complaints.filter(c => {
        // 1. Status Filter
        const matchStatus = currentFilter === 'ทั้งหมด' || c.status === currentFilter;
        
        // 2. Department Filter
        const deptVal = document.getElementById('filter-dept').value;
        const matchDept = deptVal === 'ทั้งหมด' || c.department === deptVal;

        // 3. Zone Filter
        const zoneVal = document.getElementById('filter-zone').value;
        const matchZone = zoneVal === 'ทั้งหมด' || c.zone === zoneVal;

        // 4. Search Filter
        const matchSearch = c.title.toLowerCase().includes(searchTerm) || 
                            (c.receiveNo && c.receiveNo.toLowerCase().includes(searchTerm)) ||
                            c.requester.toLowerCase().includes(searchTerm) ||
                            (c.supervisor && c.supervisor.toLowerCase().includes(searchTerm));
                            
        // 5. Time Filter
        let matchTime = true;
        if (c.startDate && timeFilterVal !== 'ทั้งหมด') {
            // ป้องกันปัญหา Timezone โดยอ่านค่าแยกส่วน
            const [cYear, cMonth, cDay] = c.startDate.split('-').map(Number);
            const cDateOnly = new Date(cYear, cMonth - 1, cDay);

            if (timeFilterVal === 'วันนี้') {
                matchTime = cDateOnly.getTime() === today.getTime();
            } else if (timeFilterVal === 'สัปดาห์นี้') {
                const startOfWeek = new Date(today);
                startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
                const endOfWeek = new Date(today);
                endOfWeek.setDate(today.getDate() - today.getDay() + 6); // Saturday
                matchTime = cDateOnly >= startOfWeek && cDateOnly <= endOfWeek;
            } else if (timeFilterVal === 'เดือนนี้') {
                matchTime = cDateOnly.getMonth() === today.getMonth() && cDateOnly.getFullYear() === today.getFullYear();
            } else if (timeFilterVal === 'ปีนี้') {
                matchTime = cDateOnly.getFullYear() === today.getFullYear();
            } else if (timeFilterVal === 'กำหนดเอง') {
                const customDateVal = document.getElementById('filter-custom-date').value;
                if(customDateVal) {
                    const [sYear, sMonth, sDay] = customDateVal.split('-').map(Number);
                    const cDate = new Date(sYear, sMonth - 1, sDay);
                    matchTime = cDateOnly.getTime() === cDate.getTime();
                }
            }
        }

        return matchStatus && matchSearch && matchTime && matchDept && matchZone;
    });

    // Update Stats
    document.getElementById('stat-total').textContent = complaints.length;
    document.getElementById('stat-pending').textContent = complaints.filter(c=>c.status==='ยังไม่เริ่ม').length;
    document.getElementById('stat-progress').textContent = complaints.filter(c=>c.status==='กำลังดำเนินการ').length;
    document.getElementById('stat-done').textContent = complaints.filter(c=>c.status==='เสร็จสมบูรณ์แล้ว').length;

    // Render Chart
    renderChart();

    const container = document.getElementById('complaints-container');
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center p-10 bg-white rounded-2xl border border-dashed border-gray-300 text-gray-400">
                <i data-lucide="folder-search" class="w-12 h-12 mb-3"></i>
                <p class="font-semibold">ไม่พบข้อมูลคำร้อง</p>
            </div>`;
        lucide.createIcons();
        renderPagination(0, 1);
        return;
    }

    // Sort newest first
    filtered.sort((a,b) => new Date(b.startDate) - new Date(a.startDate));

    // แบ่งหน้า (Pagination)
    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    pageItems.forEach(c => {
        const st = STATUS_CONFIG[c.status];
        
        // Format date roughly
        const dObj = new Date(c.startDate);
        const dStr = !isNaN(dObj) ? dObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit'}) : c.startDate;

        // Determine which image to show (After img has priority if finished, else Before img, else Placeholder)
        const cAfterArr = normalizeImgArray(c.afterImgs, c.afterImg);
        const cBeforeArr = normalizeImgArray(c.beforeImgs, c.beforeImg);
        const displayImg = cAfterArr[0] ? cAfterArr[0] : (cBeforeArr[0] ? cBeforeArr[0] : 'https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ');

        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col group relative overflow-hidden";
        card.onclick = () => viewDetail(c.id);

        // Add a small color strip on top based on status
        let stripColor = c.status === 'เสร็จสมบูรณ์แล้ว' ? 'bg-emerald-500' : (c.status === 'กำลังดำเนินการ' ? 'bg-yellow-500' : 'bg-red-500');

        card.innerHTML = `
            <div class="absolute top-0 left-0 right-0 h-1 ${stripColor} z-10"></div>
            
            <!-- Cover Image -->
            <div class="w-full h-36 bg-gray-100 overflow-hidden relative">
                <img src="${escapeHtml(safeImageSrc(displayImg))}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="รูปภาพประกอบ" onerror="this.src='https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ'">
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                <div class="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                    <span class="px-2.5 py-1 rounded-md text-[10px] font-bold ${st.bg} ${st.color} border ${st.border} shadow-sm backdrop-blur-md bg-opacity-90">${escapeHtml(c.status)}</span>
                    <span class="text-[10px] text-white font-medium drop-shadow-md bg-black/30 px-2 py-0.5 rounded-md backdrop-blur-sm">${escapeHtml(dStr)}</span>
                </div>
            </div>

            <!-- Card Body -->
            <div class="p-4 flex flex-col flex-1">
                <h3 class="font-bold text-gray-800 mb-2 leading-snug line-clamp-2 group-hover:text-brand transition-colors">${escapeHtml(c.title)}</h3>
                <div class="space-y-1 mb-4 flex-1">
                    <p class="text-xs text-gray-500 flex items-center gap-1.5"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-gray-400"></i> ${escapeHtml(c.zone)}</p>
                    <p class="text-xs text-gray-500 flex items-center gap-1.5"><i data-lucide="user" class="w-3.5 h-3.5 text-gray-400"></i> ผู้ร้อง: ${escapeHtml(c.requester)}</p>
                    <p class="text-[10px] text-gray-400 flex items-center gap-1.5 mt-1"><i data-lucide="hard-hat" class="w-3.5 h-3.5 text-gray-400"></i> รับผิดชอบ: ${escapeHtml(c.department)}</p>
                </div>
                <div class="pt-3 border-t border-gray-50 flex items-center justify-between mt-auto">
                    <p class="text-[10px] font-semibold text-gray-400">ID: ${escapeHtml(c.receiveNo || c.id)}</p>
                    <button class="text-brand text-xs font-bold hover:underline flex items-center gap-1">ดูรายละเอียด <i data-lucide="chevron-right" class="w-3 h-3"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    lucide.createIcons({ root: container });
    renderPagination(filtered.length, totalPages);
}

// สร้างแถบเลขหน้า (Pagination Controls) — ฟังก์ชันกลางใช้ซ้ำได้ทั้งหน้า Dashboard และรายการงานของทีมงาน
function renderPaginationControls(containerId, totalItems, currentPageNum, totalPages, onPageChange) {
    const pagContainer = document.getElementById(containerId);
    if (!pagContainer) return;
    pagContainer.innerHTML = '';

    if (totalItems === 0 || totalPages <= 1) return;

    const baseBtn = "min-w-[38px] h-[38px] px-2 flex items-center justify-center rounded-xl text-sm font-bold transition-all";
    const inactiveBtn = `${baseBtn} bg-white border border-gray-200 text-gray-600 hover:bg-gray-50`;
    const activeBtn = `${baseBtn} bg-brand text-white shadow-md`;
    const disabledBtn = `${baseBtn} bg-gray-50 border border-gray-100 text-gray-300 cursor-not-allowed`;

    const wrapper = document.createElement('div');
    wrapper.className = "flex items-center justify-center flex-wrap gap-2";

    // ปุ่มก่อนหน้า
    const prevBtn = document.createElement('button');
    prevBtn.className = currentPageNum === 1 ? disabledBtn : inactiveBtn;
    prevBtn.innerHTML = `<i data-lucide="chevron-left" class="w-4 h-4"></i>`;
    if (currentPageNum !== 1) prevBtn.onclick = () => onPageChange(currentPageNum - 1);
    wrapper.appendChild(prevBtn);

    // คำนวณช่วงเลขหน้าที่จะแสดง (แสดงหน้าแรก, หน้าสุดท้าย, และหน้าใกล้เคียงหน้าปัจจุบัน)
    const pagesToShow = new Set();
    pagesToShow.add(1);
    pagesToShow.add(totalPages);
    for (let p = currentPageNum - 1; p <= currentPageNum + 1; p++) {
        if (p >= 1 && p <= totalPages) pagesToShow.add(p);
    }
    const sortedPages = Array.from(pagesToShow).sort((a, b) => a - b);

    let lastPage = 0;
    sortedPages.forEach(p => {
        if (lastPage && p - lastPage > 1) {
            const dots = document.createElement('span');
            dots.className = "min-w-[38px] h-[38px] flex items-center justify-center text-gray-400 text-sm font-bold";
            dots.textContent = '...';
            wrapper.appendChild(dots);
        }
        const pageBtn = document.createElement('button');
        pageBtn.className = p === currentPageNum ? activeBtn : inactiveBtn;
        pageBtn.textContent = p;
        pageBtn.onclick = () => onPageChange(p);
        wrapper.appendChild(pageBtn);
        lastPage = p;
    });

    // ปุ่มถัดไป
    const nextBtn = document.createElement('button');
    nextBtn.className = currentPageNum === totalPages ? disabledBtn : inactiveBtn;
    nextBtn.innerHTML = `<i data-lucide="chevron-right" class="w-4 h-4"></i>`;
    if (currentPageNum !== totalPages) nextBtn.onclick = () => onPageChange(currentPageNum + 1);
    wrapper.appendChild(nextBtn);

    pagContainer.appendChild(wrapper);
    lucide.createIcons({ root: pagContainer });
}

// Pagination ของหน้า Dashboard (ห่อฟังก์ชันกลางด้านบน)
function renderPagination(totalItems, totalPages) {
    renderPaginationControls('pagination-container', totalItems, currentPage, totalPages, changePage);
}

// เปลี่ยนหน้าที่กำลังแสดง
function changePage(page) {
    currentPage = page;
    renderDashboard();
    const container = document.getElementById('complaints-container');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Render D3 Chart function
function renderChart() {
    const container = document.getElementById('status-chart');
    if (!container) return;
    container.innerHTML = ''; // Clear old chart
    
    const counts = [
        { label: 'ยังไม่เริ่ม', value: complaints.filter(c=>c.status==='ยังไม่เริ่ม').length, color: '#ef4444' },
        { label: 'กำลังดำเนินการ', value: complaints.filter(c=>c.status==='กำลังดำเนินการ').length, color: '#eab308' },
        { label: 'เสร็จสมบูรณ์', value: complaints.filter(c=>c.status==='เสร็จสมบูรณ์แล้ว').length, color: '#10b981' }
    ];

    const total = counts.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
        container.innerHTML = '<p class="text-gray-400 text-sm font-medium">ไม่มีข้อมูลสำหรับแสดงกราฟ</p>';
        return;
    }

    // Create Flex Container for Chart + Legend
    const wrapper = document.createElement('div');
    wrapper.className = "flex flex-col md:flex-row items-center justify-center w-full h-full gap-8";
    container.appendChild(wrapper);

    const chartDiv = document.createElement('div');
    chartDiv.className = "relative w-48 h-48 flex-shrink-0";
    wrapper.appendChild(chartDiv);

    const legendDiv = document.createElement('div');
    legendDiv.className = "flex flex-col gap-4 min-w-[150px]";
    wrapper.appendChild(legendDiv);

    // Build HTML Legend
    counts.forEach(c => {
        legendDiv.innerHTML += `
            <div class="flex items-center gap-3">
                <span class="w-4 h-4 rounded-full shadow-sm" style="background-color: ${c.color};"></span>
                <span class="text-sm font-medium text-gray-600">${c.label}</span>
                <span class="text-sm font-black text-gray-800 ml-auto pl-4">${c.value}</span>
            </div>
        `;
    });

    // Set dimensions for D3 Donut Chart
    const width = 192; 
    const height = 192;
    const margin = 5;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(chartDiv)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    const pie = d3.pie()
        .value(d => d.value)
        .sort(null); // Keep original order
    
    const activeData = counts.filter(d => d.value > 0);
    const data_ready = pie(activeData);

    const arcGenerator = d3.arc()
        .innerRadius(radius * 0.55) // Donut thickness
        .outerRadius(radius);

    // Draw Slices with hover animation
    svg.selectAll('path')
        .data(data_ready)
        .join('path')
        .attr('d', arcGenerator)
        .attr('fill', d => d.data.color)
        .attr("stroke", "#ffffff")
        .style("stroke-width", "3px")
        .style("transition", "transform 0.2s ease-in-out")
        .on("mouseover", function() { d3.select(this).attr("transform", "scale(1.05)"); })
        .on("mouseout", function() { d3.select(this).attr("transform", "scale(1)"); });

    // Add Values inside Slices
    svg.selectAll('text.val')
        .data(data_ready)
        .join('text')
        .text(d => d.data.value)
        .attr("transform", d => `translate(${arcGenerator.centroid(d)})`)
        .style("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-family", "'Prompt', sans-serif")
        .style("fill", "#ffffff")
        .style("font-weight", "bold")
        .style("pointer-events", "none")
        .attr("dy", "0.35em"); // vertically center

    // Add Total in the center of Donut
    svg.append("text")
        .attr("text-anchor", "middle")
        .text("ทั้งหมด")
        .style("font-size", "12px")
        .style("fill", "#9ca3af")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "-0.6em");
        
    svg.append("text")
        .attr("text-anchor", "middle")
        .text(total)
        .style("font-size", "24px")
        .style("fill", "#1f2937")
        .style("font-weight", "900")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "0.7em");
}

// เก็บกลุ่มทีมงานล่าสุดไว้ใช้ตอนคลิกดูรายการงาน (คำนวณใหม่ทุกครั้งที่ renderTeamBreakdown ทำงาน)
let teamGroupsCache = {};
let selectedTeamKey = null; // key ของทีมงานที่กำลังเปิดดูรายการงานอยู่ (ถ้ามี)
let selectedTeamLabel = ''; // ป้ายชื่อทีมงานที่กำลังเปิดดูอยู่ (ไว้แสดงหัวข้อ/สร้างใหม่ตอนรีเฟรช)
let currentTeamPage = 1; // หน้าปัจจุบันของรายการงานในทีมที่เลือก
let selectedSubDeptFilter = 'ทั้งหมด'; // ตัวกรองชุดปฏิบัติงานย่อย (ใช้เฉพาะตอนเปิดดูทีมงานโยธา)
let selectedPlanningTopicFilter = 'ทั้งหมด'; // ตัวกรองงานร้องเรียน (ใช้เฉพาะตอนเปิดดูทีมฝ่ายแผน)
let selectedProjectTopicFilter = 'ทั้งหมด'; // ตัวกรองหัวข้องานโครงการ (ใช้เฉพาะตอนเปิดดูทีมงานโครงการ)

// ชุดปฏิบัติงานย่อยของงานโยธา (ต้องตรงกับตัวเลือกในฟอร์มบันทึกคำร้อง f-subDepartment ทุกประการ)
const SUB_DEPARTMENTS = [
    { value: 'ชุดซ่อมปะถนน', label: 'ชุดซ่อมปะถนน', color: '#f97316' },
    { value: 'ชุด JCB', label: 'ชุดซ่อม JCB', color: '#eab308' },
    { value: 'ชุดตัดหญ้า', label: 'ชุดตัดหญ้า', color: '#22c55e' },
    { value: 'ชุดไฟฟ้า', label: 'ชุดไฟฟ้า', color: '#3b82f6' }
];

// งานร้องเรียนของฝ่ายแผน (ต้องตรงกับตัวเลือกในฟอร์มบันทึกคำร้อง f-planningTopic ทุกประการ)
const PLANNING_TOPICS = [
    { value: 'พรบ.ควบคุมอาคาร', label: 'พรบ.ควบคุมอาคาร', color: '#3b82f6' },
    { value: 'ขุดดินถมดิน', label: 'ขุดดินถมดิน', color: '#f97316' }
];

// หัวข้องานโครงการ (ต้องตรงกับตัวเลือกในฟอร์มบันทึกคำร้อง f-projectWorkTopic ทุกประการ)
const PROJECT_WORK_TOPICS = [
    { value: 'เทศปัญญัติ', label: 'เทศปัญญัติ', color: '#8b5cf6' },
    { value: 'งบอุดหนุน', label: 'งบอุดหนุน', color: '#06b6d4' }
];

// รายชื่อ "ทีมงาน" คงที่ 7 ทีม (หน่วยงาน x เขต) ที่ต้องการแสดงเสมอ เรียงตามลำดับนี้ตายตัว
// งานโยธา จะรวมทุกชุดปฏิบัติงานย่อย (ชุดซ่อมปะถนน/ชุด JCB/ชุดตัดหญ้า/ชุดไฟฟ้า) เข้าเป็นกราฟเดียวต่อเขต
// งานโครงการ ไม่แยกตามเขต (ฟอร์มไม่ระบุเขตพื้นที่สำหรับหน่วยงานนี้) จึงมีกราฟเดียวรวมทั้งหน่วยงาน
const FIXED_TEAMS = [
    { department: 'งานโยธา', zone: 'เขต 1' },
    { department: 'งานโยธา', zone: 'เขต 2' },
    { department: 'งานโยธา', zone: 'เขต 3' },
    { department: 'ฝ่ายแผน', zone: 'เขต 1' },
    { department: 'ฝ่ายแผน', zone: 'เขต 2' },
    { department: 'ฝ่ายแผน', zone: 'เขต 3' },
    { department: 'งานโครงการ', zone: '' }
];

// สรุปภาระงานคงค้าง แยกเป็น 6 กราฟตายตัวตาม FIXED_TEAMS (งานโยธา เขต 1-3, ฝ่ายแผน เขต 1-3)
// แสดงเป็นกราฟวงกลม (โดนัท) ของแต่ละทีม คลิกวงไหนจะเปิดรายการงานของทีมนั้นด้านล่างทันที
// ใช้ข้อมูลทั้งหมดเสมอ (ไม่ผูกกับตัวกรองค้นหา/สถานะด้านบน) เพื่อให้เห็นภาพรวมทุกทีมพร้อมกันในจุดเดียว
// แสดงครบทั้ง 6 กราฟเสมอ แม้ทีมนั้นจะยังไม่มีคำร้องเลยก็ตาม (จะขึ้นเป็นวงกลม 0)
function renderTeamBreakdown() {
    const container = document.getElementById('team-breakdown');
    if (!container) return;
    container.innerHTML = '';

    // ตั้งต้นกลุ่มคงที่ 6 กลุ่มไว้ก่อนเป็น 0 ทั้งหมด
    const groups = {};
    FIXED_TEAMS.forEach(({ department, zone }) => {
        const key = `${department}|${zone}`;
        groups[key] = { department, zone, total: 0, pending: 0, progress: 0, done: 0 };
    });

    // นับจำนวนคำร้องของแต่ละหน่วยงาน + เขต (รวมทุกชุดปฏิบัติงานย่อยของงานโยธาเข้าด้วยกัน)
    complaints.forEach(c => {
        const key = `${c.department}|${c.zone}`;
        const g = groups[key];
        if (!g) return; // ข้ามคำร้องที่หน่วยงาน/เขตไม่ตรงกับ 6 ทีมงานหลัก (เช่น ข้อมูลเก่าที่ผิดรูปแบบ)
        g.total++;
        if (c.status === 'ยังไม่เริ่ม') g.pending++;
        else if (c.status === 'กำลังดำเนินการ') g.progress++;
        else if (c.status === 'เสร็จสมบูรณ์แล้ว') g.done++;
    });
    teamGroupsCache = groups;

    container.className = "grid grid-cols-2 sm:grid-cols-3 gap-4";

    FIXED_TEAMS.forEach(({ department, zone }) => {
        const key = `${department}|${zone}`;
        const g = groups[key];
        const label = zone ? `${department} - ${zone}` : department;

        const card = document.createElement('div');
        card.className = "flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white " +
            (key === selectedTeamKey ? "border-brand shadow-md ring-2 ring-brand/20" : "border-gray-100 hover:border-brand/40 hover:shadow-sm");
        card.onclick = () => showTeamDetail(key, label);

        const donutWrap = document.createElement('div');
        donutWrap.className = "relative w-24 h-24 flex-shrink-0";
        card.appendChild(donutWrap);

        drawMiniDonut(donutWrap, g);

        const textWrap = document.createElement('div');
        textWrap.className = "text-center";
        textWrap.innerHTML = `
            <p class="text-xs font-bold text-gray-700 leading-snug">${escapeHtml(label)}</p>
            <p class="text-[11px] font-semibold text-gray-400 mt-0.5">รวม ${g.total} งาน</p>
        `;
        card.appendChild(textWrap);

        container.appendChild(card);
    });

    // ถ้ากำลังเปิดดูรายการงานของทีมใดอยู่ ให้รีเฟรชรายการนั้นตามข้อมูลล่าสุดด้วย (เผื่อมีการเพิ่ม/แก้ไข/ลบระหว่างเปิดดูอยู่)
    if (selectedTeamKey) {
        if (teamGroupsCache[selectedTeamKey]) {
            renderTeamDetailList();
        } else {
            closeTeamDetail(); // ทีมเดิมไม่อยู่ในกลุ่มคงที่แล้ว ให้ปิดพาเนลไป
        }
    }
}

// วาดกราฟวงกลม (โดนัท) ขนาดเล็กสำหรับการ์ดสรุปทีมงานแต่ละทีม ด้วย D3 (โทนสีเดียวกับกราฟหลักของ Dashboard)
function drawMiniDonut(wrapEl, g) {
    const counts = [
        { value: g.pending, color: '#ef4444' },
        { value: g.progress, color: '#eab308' },
        { value: g.done, color: '#10b981' }
    ];
    const activeData = counts.filter(d => d.value > 0);

    const width = 96, height = 96, margin = 3;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(wrapEl)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    const pie = d3.pie().value(d => d.value).sort(null);
    const data_ready = pie(activeData);

    const arcGenerator = d3.arc()
        .innerRadius(radius * 0.55)
        .outerRadius(radius);

    svg.selectAll('path')
        .data(data_ready)
        .join('path')
        .attr('d', arcGenerator)
        .attr('fill', d => d.data.color)
        .attr("stroke", "#ffffff")
        .style("stroke-width", "2px");

    svg.append("text")
        .attr("text-anchor", "middle")
        .text(g.total)
        .style("font-size", "20px")
        .style("fill", "#1f2937")
        .style("font-weight", "900")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "0.35em");
}

// วาดกราฟวงกลม (โดนัท) แสดงสัดส่วนงานร้องเรียนของฝ่ายแผน (พรบ.ควบคุมอาคาร / ขุดดินถมดิน)
// พร้อมคำอธิบายสัญลักษณ์ (legend) บอกจำนวนแต่ละประเภทกำกับไว้ข้าง ๆ
function drawPlanningTopicChart(counts, total) {
    const chartEl = document.getElementById('team-planningtopic-chart');
    const legendEl = document.getElementById('team-planningtopic-legend');
    if (!chartEl || !legendEl) return;

    chartEl.innerHTML = '';
    const data = PLANNING_TOPICS.map(pt => ({ label: pt.label, value: counts[pt.value] || 0, color: pt.color }));
    const activeData = data.filter(d => d.value > 0);

    const width = 64, height = 64, margin = 2;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(chartEl)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    if (activeData.length === 0) {
        // ไม่มีข้อมูล ให้แสดงวงแหวนสีเทาจาง ๆ แทนวงเปล่า
        svg.append("circle")
            .attr("r", radius)
            .attr("fill", "none")
            .attr("stroke", "#e5e7eb")
            .attr("stroke-width", radius * 0.45);
    } else {
        const pie = d3.pie().value(d => d.value).sort(null);
        const data_ready = pie(activeData);
        const arcGenerator = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

        svg.selectAll('path')
            .data(data_ready)
            .join('path')
            .attr('d', arcGenerator)
            .attr('fill', d => d.data.color)
            .attr("stroke", "#ffffff")
            .style("stroke-width", "2px");
    }

    svg.append("text")
        .attr("text-anchor", "middle")
        .text(total)
        .style("font-size", "15px")
        .style("fill", "#1f2937")
        .style("font-weight", "900")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "0.35em");

    legendEl.innerHTML = data.map(d => `
        <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${d.color}"></span>
            <span>${escapeHtml(d.label)} (${d.value})</span>
        </div>
    `).join('');
}

// วาดกราฟวงกลม (โดนัท) แสดงสัดส่วนชุดปฏิบัติงานย่อยของงานโยธา (ชุดซ่อมปะถนน/ชุด JCB/ชุดตัดหญ้า/ชุดไฟฟ้า)
// พร้อมคำอธิบายสัญลักษณ์ (legend) บอกจำนวนแต่ละชุดกำกับไว้ข้าง ๆ (โครงสร้างเดียวกับ drawPlanningTopicChart/drawProjectTopicChart)
function drawSubDeptChart(counts, total) {
    const chartEl = document.getElementById('team-subdept-chart');
    const legendEl = document.getElementById('team-subdept-legend');
    if (!chartEl || !legendEl) return;

    chartEl.innerHTML = '';
    const data = SUB_DEPARTMENTS.map(sd => ({ label: sd.label, value: counts[sd.value] || 0, color: sd.color }));
    const activeData = data.filter(d => d.value > 0);

    const width = 64, height = 64, margin = 2;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(chartEl)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    if (activeData.length === 0) {
        // ไม่มีข้อมูล ให้แสดงวงแหวนสีเทาจาง ๆ แทนวงเปล่า
        svg.append("circle")
            .attr("r", radius)
            .attr("fill", "none")
            .attr("stroke", "#e5e7eb")
            .attr("stroke-width", radius * 0.45);
    } else {
        const pie = d3.pie().value(d => d.value).sort(null);
        const data_ready = pie(activeData);
        const arcGenerator = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

        svg.selectAll('path')
            .data(data_ready)
            .join('path')
            .attr('d', arcGenerator)
            .attr('fill', d => d.data.color)
            .attr("stroke", "#ffffff")
            .style("stroke-width", "2px");
    }

    svg.append("text")
        .attr("text-anchor", "middle")
        .text(total)
        .style("font-size", "15px")
        .style("fill", "#1f2937")
        .style("font-weight", "900")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "0.35em");

    legendEl.innerHTML = data.map(d => `
        <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${d.color}"></span>
            <span>${escapeHtml(d.label)} (${d.value})</span>
        </div>
    `).join('');
}

// วาดกราฟวงกลม (โดนัท) แสดงสัดส่วนหัวข้องานโครงการ (เทศปัญญัติ / งบอุดหนุน)
// พร้อมคำอธิบายสัญลักษณ์ (legend) บอกจำนวนแต่ละประเภทกำกับไว้ข้าง ๆ (โครงสร้างเดียวกับ drawPlanningTopicChart)
function drawProjectTopicChart(counts, total) {
    const chartEl = document.getElementById('team-projecttopic-chart');
    const legendEl = document.getElementById('team-projecttopic-legend');
    if (!chartEl || !legendEl) return;

    chartEl.innerHTML = '';
    const data = PROJECT_WORK_TOPICS.map(pt => ({ label: pt.label, value: counts[pt.value] || 0, color: pt.color }));
    const activeData = data.filter(d => d.value > 0);

    const width = 64, height = 64, margin = 2;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(chartEl)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    if (activeData.length === 0) {
        // ไม่มีข้อมูล ให้แสดงวงแหวนสีเทาจาง ๆ แทนวงเปล่า
        svg.append("circle")
            .attr("r", radius)
            .attr("fill", "none")
            .attr("stroke", "#e5e7eb")
            .attr("stroke-width", radius * 0.45);
    } else {
        const pie = d3.pie().value(d => d.value).sort(null);
        const data_ready = pie(activeData);
        const arcGenerator = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

        svg.selectAll('path')
            .data(data_ready)
            .join('path')
            .attr('d', arcGenerator)
            .attr('fill', d => d.data.color)
            .attr("stroke", "#ffffff")
            .style("stroke-width", "2px");
    }

    svg.append("text")
        .attr("text-anchor", "middle")
        .text(total)
        .style("font-size", "15px")
        .style("fill", "#1f2937")
        .style("font-weight", "900")
        .style("font-family", "'Prompt', sans-serif")
        .attr("dy", "0.35em");

    legendEl.innerHTML = data.map(d => `
        <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${d.color}"></span>
            <span>${escapeHtml(d.label)} (${d.value})</span>
        </div>
    `).join('');
}

// เปิดพาเนลแสดงรายการงานทั้งหมดของทีมงานที่คลิก (department + zone ตรงกัน รวมทุกชุดปฏิบัติงานย่อย)
function showTeamDetail(key, label) {
    const isNewTeam = key !== selectedTeamKey;
    selectedTeamKey = key;
    selectedTeamLabel = label;
    if (isNewTeam) {
        currentTeamPage = 1; // เปิดทีมใหม่ ให้เริ่มจากหน้าแรกเสมอ
        selectedSubDeptFilter = 'ทั้งหมด'; // เปิดทีมใหม่ ล้างตัวกรองชุดปฏิบัติงานเดิมเสมอ
        selectedPlanningTopicFilter = 'ทั้งหมด'; // เปิดทีมใหม่ ล้างตัวกรองงานร้องเรียนเดิมเสมอ
        selectedProjectTopicFilter = 'ทั้งหมด'; // เปิดทีมใหม่ ล้างตัวกรองหัวข้องานโครงการเดิมเสมอ
    }

    renderTeamDetailList();
    renderTeamBreakdown(); // รีเฟรชกริดเพื่ออัปเดตกรอบไฮไลต์การ์ดที่เลือก

    const panel = document.getElementById('team-detail-panel');
    if (panel) {
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// เปลี่ยนหน้าของรายการงานในทีมที่กำลังเปิดดูอยู่
function changeTeamPage(page) {
    currentTeamPage = page;
    renderTeamDetailList();
    const listContainer = document.getElementById('team-detail-list');
    if (listContainer) listContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// วาดรายการคำร้องของทีมงานที่เลือก ลงในพาเนลรายละเอียด — ใช้การ์ดสไตล์เดียวกับหน้า Dashboard พร้อมแบ่งหน้า
function renderTeamDetailList() {
    const panel = document.getElementById('team-detail-panel');
    const titleEl = document.getElementById('team-detail-title-text');
    const listEl = document.getElementById('team-detail-list');
    const subDeptContainer = document.getElementById('team-subdept-filter-container');
    const subDeptSelect = document.getElementById('team-subdept-filter');
    const planningTopicContainer = document.getElementById('team-planningtopic-filter-container');
    const planningTopicSelect = document.getElementById('team-planningtopic-filter');
    const projectTopicContainer = document.getElementById('team-projecttopic-filter-container');
    const projectTopicSelect = document.getElementById('team-projecttopic-filter');
    if (!panel || !titleEl || !listEl || !selectedTeamKey) return;

    const [department, zone] = selectedTeamKey.split('|');
    const teamJobs = complaints.filter(c => c.department === department && c.zone === zone);
    const isGovyotha = department === 'งานโยธา';
    const isPlanning = department === 'ฝ่ายแผน';
    const isProject = department === 'งานโครงการ';

    // งานโยธา เท่านั้นที่มีชุดปฏิบัติงานย่อยให้เลือกกรองเพิ่ม (แสดงจำนวนงานกำกับแต่ละชุดไว้ในตัวเลือกด้วย)
    if (isGovyotha && subDeptContainer && subDeptSelect) {
        subDeptContainer.classList.remove('hidden');
        const subCounts = {};
        SUB_DEPARTMENTS.forEach(sd => { subCounts[sd.value] = 0; });
        teamJobs.forEach(c => { if (subCounts[c.subDepartment] !== undefined) subCounts[c.subDepartment]++; });

        subDeptSelect.innerHTML = `
            <option value="ทั้งหมด">ทุกชุดปฏิบัติงาน (${teamJobs.length})</option>
            ${SUB_DEPARTMENTS.map(sd => `<option value="${escapeHtml(sd.value)}">${escapeHtml(sd.label)} (${subCounts[sd.value]})</option>`).join('')}
        `;
        subDeptSelect.value = selectedSubDeptFilter;
        drawSubDeptChart(subCounts, teamJobs.length);
    } else if (subDeptContainer) {
        subDeptContainer.classList.add('hidden'); // ฝ่ายแผนไม่มีชุดปฏิบัติงานย่อย ไม่ต้องแสดงตัวกรอง
    }

    // ฝ่ายแผน เท่านั้นที่มีงานร้องเรียนให้เลือกกรองเพิ่ม พร้อมกราฟวงกลมสรุปสัดส่วน
    if (isPlanning && planningTopicContainer && planningTopicSelect) {
        planningTopicContainer.classList.remove('hidden');
        const topicCounts = {};
        PLANNING_TOPICS.forEach(pt => { topicCounts[pt.value] = 0; });
        teamJobs.forEach(c => { if (topicCounts[c.planningTopic] !== undefined) topicCounts[c.planningTopic]++; });

        planningTopicSelect.innerHTML = `
            <option value="ทั้งหมด">ทุกงานร้องเรียน (${teamJobs.length})</option>
            ${PLANNING_TOPICS.map(pt => `<option value="${escapeHtml(pt.value)}">${escapeHtml(pt.label)} (${topicCounts[pt.value]})</option>`).join('')}
        `;
        planningTopicSelect.value = selectedPlanningTopicFilter;
        drawPlanningTopicChart(topicCounts, teamJobs.length);
    } else if (planningTopicContainer) {
        planningTopicContainer.classList.add('hidden'); // หน่วยงานอื่นไม่มีงานร้องเรียนแบบนี้ ไม่ต้องแสดงตัวกรอง/กราฟ
    }

    // งานโครงการ เท่านั้นที่มีหัวข้องานโครงการให้เลือกกรองเพิ่ม พร้อมกราฟวงกลมสรุปสัดส่วน
    if (isProject && projectTopicContainer && projectTopicSelect) {
        projectTopicContainer.classList.remove('hidden');
        const topicCounts = {};
        PROJECT_WORK_TOPICS.forEach(pt => { topicCounts[pt.value] = 0; });
        teamJobs.forEach(c => { if (topicCounts[c.projectWorkTopic] !== undefined) topicCounts[c.projectWorkTopic]++; });

        projectTopicSelect.innerHTML = `
            <option value="ทั้งหมด">ทุกหัวข้องานโครงการ (${teamJobs.length})</option>
            ${PROJECT_WORK_TOPICS.map(pt => `<option value="${escapeHtml(pt.value)}">${escapeHtml(pt.label)} (${topicCounts[pt.value]})</option>`).join('')}
        `;
        projectTopicSelect.value = selectedProjectTopicFilter;
        drawProjectTopicChart(topicCounts, teamJobs.length);
    } else if (projectTopicContainer) {
        projectTopicContainer.classList.add('hidden'); // หน่วยงานอื่นไม่มีหัวข้องานโครงการแบบนี้ ไม่ต้องแสดงตัวกรอง/กราฟ
    }

    const jobs = (isGovyotha && selectedSubDeptFilter !== 'ทั้งหมด')
        ? teamJobs.filter(c => c.subDepartment === selectedSubDeptFilter)
        : (isPlanning && selectedPlanningTopicFilter !== 'ทั้งหมด')
            ? teamJobs.filter(c => c.planningTopic === selectedPlanningTopicFilter)
            : (isProject && selectedProjectTopicFilter !== 'ทั้งหมด')
                ? teamJobs.filter(c => c.projectWorkTopic === selectedProjectTopicFilter)
                : teamJobs;

    const subDeptLabel = SUB_DEPARTMENTS.find(sd => sd.value === selectedSubDeptFilter)?.label;
    const planningTopicLabel = PLANNING_TOPICS.find(pt => pt.value === selectedPlanningTopicFilter)?.label;
    const projectTopicLabel = PROJECT_WORK_TOPICS.find(pt => pt.value === selectedProjectTopicFilter)?.label;
    const titleSuffix = (isGovyotha && selectedSubDeptFilter !== 'ทั้งหมด' && subDeptLabel) ? ` - ${subDeptLabel}`
        : (isPlanning && selectedPlanningTopicFilter !== 'ทั้งหมด' && planningTopicLabel) ? ` - ${planningTopicLabel}`
        : (isProject && selectedProjectTopicFilter !== 'ทั้งหมด' && projectTopicLabel) ? ` - ${projectTopicLabel}` : '';
    titleEl.textContent = `${selectedTeamLabel}${titleSuffix} (${jobs.length} งาน)`;

    if (jobs.length === 0) {
        listEl.className = "";
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center p-10 bg-white rounded-2xl border border-dashed border-gray-300 text-gray-400">
                <i data-lucide="folder-search" class="w-12 h-12 mb-3"></i>
                <p class="font-semibold">ไม่มีงานคงเหลือของทีมนี้แล้ว</p>
            </div>`;
        lucide.createIcons({ root: listEl });
        renderPaginationControls('team-pagination-container', 0, 1, 1, changeTeamPage);
        return;
    }

    // เรียงงานที่ยังไม่เสร็จไว้ก่อน (ยังไม่เริ่ม > กำลังดำเนินการ > เสร็จสมบูรณ์) แล้วเรียงวันที่ใหม่สุดก่อนในกลุ่มเดียวกัน
    const statusOrder = { 'ยังไม่เริ่ม': 0, 'กำลังดำเนินการ': 1, 'เสร็จสมบูรณ์แล้ว': 2 };
    jobs.sort((a, b) => {
        const orderDiff = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
        if (orderDiff !== 0) return orderDiff;
        return new Date(b.startDate) - new Date(a.startDate);
    });

    // แบ่งหน้า (Pagination) เหมือนหน้า Dashboard
    const totalPages = Math.max(1, Math.ceil(jobs.length / ITEMS_PER_PAGE));
    if (currentTeamPage > totalPages) currentTeamPage = totalPages;
    if (currentTeamPage < 1) currentTeamPage = 1;
    const startIdx = (currentTeamPage - 1) * ITEMS_PER_PAGE;
    const pageJobs = jobs.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    listEl.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6";
    listEl.innerHTML = '';

    pageJobs.forEach(c => {
        const st = STATUS_CONFIG[c.status];
        const dObj = new Date(c.startDate);
        const dStr = !isNaN(dObj) ? dObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : c.startDate;

        const cAfterArr = normalizeImgArray(c.afterImgs, c.afterImg);
        const cBeforeArr = normalizeImgArray(c.beforeImgs, c.beforeImg);
        const displayImg = cAfterArr[0] ? cAfterArr[0] : (cBeforeArr[0] ? cBeforeArr[0] : 'https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ');

        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col group relative overflow-hidden";
        card.onclick = () => viewDetail(c.id);

        let stripColor = c.status === 'เสร็จสมบูรณ์แล้ว' ? 'bg-emerald-500' : (c.status === 'กำลังดำเนินการ' ? 'bg-yellow-500' : 'bg-red-500');

        card.innerHTML = `
            <div class="absolute top-0 left-0 right-0 h-1 ${stripColor} z-10"></div>

            <!-- Cover Image -->
            <div class="w-full h-36 bg-gray-100 overflow-hidden relative">
                <img src="${escapeHtml(safeImageSrc(displayImg))}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="รูปภาพประกอบ" onerror="this.src='https://placehold.co/600x400/eeeeee/999999?text=ไม่มีรูปภาพ'">
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                <div class="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                    <span class="px-2.5 py-1 rounded-md text-[10px] font-bold ${st.bg} ${st.color} border ${st.border} shadow-sm backdrop-blur-md bg-opacity-90">${escapeHtml(c.status)}</span>
                    <span class="text-[10px] text-white font-medium drop-shadow-md bg-black/30 px-2 py-0.5 rounded-md backdrop-blur-sm">${escapeHtml(dStr)}</span>
                </div>
            </div>

            <!-- Card Body -->
            <div class="p-4 flex flex-col flex-1">
                <h3 class="font-bold text-gray-800 mb-2 leading-snug line-clamp-2 group-hover:text-brand transition-colors">${escapeHtml(c.title)}</h3>
                <div class="space-y-1 mb-4 flex-1">
                    <p class="text-xs text-gray-500 flex items-center gap-1.5"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-gray-400"></i> ${escapeHtml(c.zone)}</p>
                    <p class="text-xs text-gray-500 flex items-center gap-1.5"><i data-lucide="user" class="w-3.5 h-3.5 text-gray-400"></i> ผู้ร้อง: ${escapeHtml(c.requester)}</p>
                    <p class="text-[10px] text-gray-400 flex items-center gap-1.5 mt-1"><i data-lucide="hard-hat" class="w-3.5 h-3.5 text-gray-400"></i> รับผิดชอบ: ${escapeHtml(c.department)}</p>
                </div>
                <div class="pt-3 border-t border-gray-50 flex items-center justify-between mt-auto">
                    <p class="text-[10px] font-semibold text-gray-400">ID: ${escapeHtml(c.receiveNo || c.id)}</p>
                    <button class="text-brand text-xs font-bold hover:underline flex items-center gap-1">ดูรายละเอียด <i data-lucide="chevron-right" class="w-3 h-3"></i></button>
                </div>
            </div>
        `;
        listEl.appendChild(card);
    });

    lucide.createIcons({ root: listEl });
    renderPaginationControls('team-pagination-container', jobs.length, currentTeamPage, totalPages, changeTeamPage);
}

// ปิดพาเนลรายละเอียดงานของทีมงาน กลับไปแสดงแค่กริดสรุปทั้งหมด
function closeTeamDetail() {
    selectedTeamKey = null;
    selectedTeamLabel = '';
    currentTeamPage = 1;
    selectedSubDeptFilter = 'ทั้งหมด';
    selectedPlanningTopicFilter = 'ทั้งหมด';
    selectedProjectTopicFilter = 'ทั้งหมด';
    const panel = document.getElementById('team-detail-panel');
    if (panel) panel.classList.add('hidden');
    // เอากรอบไฮไลต์การ์ดที่เคยเลือกออก (ถ้ายังอยู่ในหน้านี้)
    const container = document.getElementById('team-breakdown');
    if (container) {
        container.querySelectorAll('.border-brand').forEach(el => {
            el.className = el.className.replace('border-brand shadow-md ring-2 ring-brand/20', 'border-gray-100 hover:border-brand/40 hover:shadow-sm');
        });
    }
}

// Setup Form Event Listeners
function setupEventListeners() {
    document.getElementById('search-input').addEventListener('input', () => { currentPage = 1; renderDashboard(); });

    // ตัวกรองชุดปฏิบัติงานย่อย ในพาเนลรายละเอียดทีมงาน (ใช้เฉพาะตอนเปิดดูทีมงานโยธา)
    const teamSubDeptFilterEl = document.getElementById('team-subdept-filter');
    if (teamSubDeptFilterEl) {
        teamSubDeptFilterEl.addEventListener('change', (e) => {
            selectedSubDeptFilter = e.target.value;
            currentTeamPage = 1;
            renderTeamDetailList();
        });
    }

    // ตัวกรองงานร้องเรียน ในพาเนลรายละเอียดทีมงาน (ใช้เฉพาะตอนเปิดดูทีมฝ่ายแผน)
    const teamPlanningTopicFilterEl = document.getElementById('team-planningtopic-filter');
    if (teamPlanningTopicFilterEl) {
        teamPlanningTopicFilterEl.addEventListener('change', (e) => {
            selectedPlanningTopicFilter = e.target.value;
            currentTeamPage = 1;
            renderTeamDetailList();
        });
    }

    // ตัวกรองหัวข้องานโครงการ ในพาเนลรายละเอียดทีมงาน (ใช้เฉพาะตอนเปิดดูทีมงานโครงการ)
    const teamProjectTopicFilterEl = document.getElementById('team-projecttopic-filter');
    if (teamProjectTopicFilterEl) {
        teamProjectTopicFilterEl.addEventListener('change', (e) => {
            selectedProjectTopicFilter = e.target.value;
            currentTeamPage = 1;
            renderTeamDetailList();
        });
    }
    
    // Time filter handling (PILLS)
    const timeBtns = document.querySelectorAll('.time-btn');
    const customDateContainer = document.getElementById('custom-date-container');

    timeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Reset all buttons styling
            timeBtns.forEach(b => {
                b.className = "time-btn px-4 py-2 rounded-full border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 bg-white transition-colors whitespace-nowrap";
            });
            
            // Set active styling to clicked button
            e.target.className = "time-btn px-4 py-2 rounded-full bg-slate-800 text-white text-sm font-medium shadow-sm transition-colors whitespace-nowrap";
            
            timeFilterVal = e.target.getAttribute('data-val');
            currentPage = 1;
            
            if (timeFilterVal === 'กำหนดเอง') {
                customDateContainer.classList.remove('hidden');
                customDateContainer.classList.add('flex');
            } else {
                customDateContainer.classList.add('hidden');
                customDateContainer.classList.remove('flex');
                renderDashboard();
            }
        });
    });

    // Dropdowns
    document.getElementById('filter-status').addEventListener('change', (e) => setFilter(e.target.value));
    document.getElementById('filter-dept').addEventListener('change', () => { currentPage = 1; renderDashboard(); });
    document.getElementById('filter-zone').addEventListener('change', () => { currentPage = 1; renderDashboard(); });

    // Custom Dates
    document.getElementById('filter-custom-date').addEventListener('change', () => { if (timeFilterVal === 'กำหนดเอง') { currentPage = 1; renderDashboard(); } });

    // Re-render chart on window resize to keep it responsive
    window.addEventListener('resize', () => {
        if (!document.getElementById('view-dashboard').classList.contains('hidden')) {
            renderChart();
        }
    });

    const deptSelect = document.getElementById('f-department');
    const subDeptContainer = document.getElementById('sub-department-container');
    const subDeptSelect = document.getElementById('f-subDepartment');
    const planningTopicContainer = document.getElementById('planning-topic-container');
    const planningTopicSelect = document.getElementById('f-planningTopic');
    const projectWorkContainer = document.getElementById('project-work-container');
    const projectWorkTopicSelect = document.getElementById('f-projectWorkTopic');
    const workflowStageContainer = document.getElementById('workflow-stage-container');
    const workflowStageSelect = document.getElementById('f-workflowStage');
    const requesterFieldWrap = document.getElementById('requester-field-wrap');
    const supervisorFieldWrap = document.getElementById('supervisor-field-wrap');
    const supervisorSlotTop = document.getElementById('supervisor-slot-top');
    const supervisorSlotProject = document.getElementById('supervisor-slot-project');
    const zoneFieldWrap = document.getElementById('zone-field-wrap');
    const zoneSelect = document.getElementById('f-zone');
    const startDateFieldWrap = document.getElementById('startdate-field-wrap');

    // Show/hide sub-department when department is selected
    deptSelect.addEventListener('change', (e) => {
        if (e.target.value === 'งานโยธา') {
            subDeptContainer.classList.remove('hidden');
            subDeptSelect.setAttribute('required', 'true');
        } else {
            subDeptContainer.classList.add('hidden');
            subDeptSelect.removeAttribute('required');
            subDeptSelect.value = '';
        }

        // Show/hide planning division complaint topic (only for ฝ่ายแผน)
        if (e.target.value === 'ฝ่ายแผน') {
            planningTopicContainer.classList.remove('hidden');
            planningTopicSelect.setAttribute('required', 'true');
        } else {
            planningTopicContainer.classList.add('hidden');
            planningTopicSelect.removeAttribute('required');
            planningTopicSelect.value = '';
        }

        // Show/hide project work topic section (only for งานโครงการ)
        if (e.target.value === 'งานโครงการ') {
            projectWorkContainer.classList.remove('hidden');
            projectWorkTopicSelect.setAttribute('required', 'true');
        } else {
            projectWorkContainer.classList.add('hidden');
            projectWorkTopicSelect.removeAttribute('required');
            projectWorkTopicSelect.value = '';
            // Also reset the workflow stage that depends on the project work topic
            workflowStageContainer.classList.add('hidden');
            workflowStageSelect.removeAttribute('required');
            workflowStageSelect.value = '';
        }

        // งานโครงการ: ไม่ต้องระบุเขตพื้นที่ และย้ายช่อง "ผู้ดูแลงาน" ไปแสดงด้านล่างหลังหัวข้องานโครงการแทน
        if (e.target.value === 'งานโครงการ') {
            supervisorSlotProject.appendChild(supervisorFieldWrap);
            supervisorSlotProject.classList.remove('hidden');
            requesterFieldWrap.classList.add('md:col-span-2');

            zoneFieldWrap.classList.add('hidden');
            zoneSelect.removeAttribute('required');
            zoneSelect.value = '';
            startDateFieldWrap.classList.add('md:col-span-2');
        } else {
            supervisorSlotTop.appendChild(supervisorFieldWrap);
            supervisorSlotProject.classList.add('hidden');
            requesterFieldWrap.classList.remove('md:col-span-2');

            zoneFieldWrap.classList.remove('hidden');
            zoneSelect.setAttribute('required', 'true');
            startDateFieldWrap.classList.remove('md:col-span-2');
        }
    });

    // Show/hide workflow stage when project work topic is selected
    projectWorkTopicSelect.addEventListener('change', (e) => {
        if (e.target.value !== '') {
            workflowStageContainer.classList.remove('hidden');
            workflowStageSelect.setAttribute('required', 'true');
        } else {
            workflowStageContainer.classList.add('hidden');
            workflowStageSelect.removeAttribute('required');
            workflowStageSelect.value = '';
        }
    });

    const statusSelect = document.getElementById('f-status');
    const noteContainer = document.getElementById('note-container');
    const noteInput = document.getElementById('f-note');
    const finishedContainer = document.getElementById('finished-container');
    const completedDateInput = document.getElementById('f-completedDate');

    statusSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const noteRequiredMark = document.getElementById('note-required-mark');
        if (val === 'เสร็จสมบูรณ์แล้ว') {
            noteContainer.classList.add('hidden');
            finishedContainer.classList.remove('hidden');
            completedDateInput.setAttribute('required', 'true');
            noteInput.removeAttribute('required');
            noteRequiredMark.classList.add('hidden');
        } else {
            noteContainer.classList.remove('hidden');
            finishedContainer.classList.add('hidden');
            completedDateInput.removeAttribute('required');

            // "ยังไม่เริ่ม" (ยังไม่เริ่มดำเนินการ) ต้องระบุหมายเหตุ/สาเหตุด้วยเสมอ
            if (val === 'ยังไม่เริ่ม') {
                noteInput.setAttribute('required', 'true');
                noteRequiredMark.classList.remove('hidden');
            } else {
                noteInput.removeAttribute('required');
                noteRequiredMark.classList.add('hidden');
            }
        }
    });

    // Image Upload Handlers (รองรับแนบได้หลายรูปต่อหัวข้อ)
    setupMultiImageUpload('f-formFile', 'form', 'preview-form-grid');
    setupMultiImageUpload('f-beforeFile', 'before', 'preview-before-grid');
    setupMultiImageUpload('f-afterFile', 'after', 'preview-after-grid');

    // Form Submit
    document.getElementById('complaint-form').addEventListener('submit', saveForm);
}

// ผูก event การเลือกไฟล์รูปภาพสำหรับหัวข้อที่แนบได้หลายรูป (form / before / after)
// เมื่อเลือกไฟล์ใหม่ รูปจะถูกเพิ่มเข้าไปต่อจากรูปเดิมที่แนบไว้แล้ว ไม่ได้แทนที่
function setupMultiImageUpload(inputId, type, gridId) {
    document.getElementById(inputId).addEventListener('change', function(e) {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const jobs = files.map((file) => {
            // Check size (< 5MB) ก่อนอ่านไฟล์
            if (file.size > 5 * 1024 * 1024) {
                showToast(`ไฟล์ "${file.name}" มีขนาดใหญ่เกินไป (จำกัด 5MB) จึงข้ามไฟล์นี้`, 'error');
                return Promise.resolve(null);
            }
            // ย่อ/บีบอัดรูปก่อนเก็บ เพราะ Firestore จำกัดขนาดเอกสารไว้ที่ 1MB ต่อรายการ
            return compressImage(file, 800, 0.55).catch((err) => {
                console.error('Compress image error:', err);
                showToast(`ไม่สามารถประมวลผลรูปภาพ "${file.name}" ได้`, 'error');
                return null;
            });
        });

        Promise.all(jobs).then((dataUrls) => {
            dataUrls.filter(Boolean).forEach((dataUrl) => currentImages[type].push(dataUrl));
            renderPreviewGrid(type, gridId);
            e.target.value = ''; // เคลียร์ input เพื่อให้เลือกไฟล์ซ้ำ (หรือไฟล์เดิม) เพิ่มได้อีก
        });
    });
}

// วาดรูปตัวอย่างที่แนบไว้ทั้งหมดของหัวข้อนั้น พร้อมปุ่มลบรายรูป
function renderPreviewGrid(type, gridId) {
    const grid = document.getElementById(gridId);
    grid.innerHTML = currentImages[type].map((src, idx) => `
        <div class="w-24 h-24 flex-shrink-0 relative">
            <button type="button" onclick="removeImageAt('${type}', ${idx})" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600"><i data-lucide="x" class="w-3 h-3"></i></button>
            <img src="${src}" class="w-full h-full object-cover rounded-xl border border-gray-300 shadow-sm cursor-pointer" onclick="openImageViewer(this.src)">
        </div>
    `).join('');
    lucide.createIcons({ root: grid });
    updateImageSizeIndicator();
}

// อัปเดตมิเตอร์แสดงขนาดข้อมูลโดยประมาณ (รูปภาพ+ข้อความ) เทียบกับงบ 900KB ของ Firestore แบบเรียลไทม์
// ให้ผู้ใช้เห็นก่อนกดบันทึกว่าใกล้เต็มขีดจำกัดหรือยัง แทนที่จะรู้ตัวตอนกดบันทึกแล้วเจอ error เท่านั้น
function updateImageSizeIndicator() {
    const indicator = document.getElementById('image-size-indicator');
    const bar = document.getElementById('image-size-bar');
    const label = document.getElementById('image-size-label');
    if (!indicator || !bar || !label) return;

    const totalImages = currentImages.form.length + currentImages.before.length + currentImages.after.length;
    if (totalImages === 0) {
        indicator.classList.add('hidden');
        return;
    }
    indicator.classList.remove('hidden');

    const approxItem = buildItemFromForm(document.getElementById('entry-id').value, true);
    const approxSize = new Blob([JSON.stringify(approxItem)]).size;
    const percent = Math.min(100, (approxSize / FIRESTORE_DOC_SIZE_BUDGET) * 100);
    const kb = Math.round(approxSize / 1024);
    const budgetKb = Math.round(FIRESTORE_DOC_SIZE_BUDGET / 1024);

    label.textContent = `ขนาดข้อมูลรูปภาพโดยประมาณ: ${kb} KB / ${budgetKb} KB`;
    bar.style.width = `${percent}%`;

    if (percent >= 100) {
        bar.className = 'h-full rounded-full bg-red-500 transition-all';
        label.className = 'text-xs font-bold text-red-600';
    } else if (percent >= 80) {
        bar.className = 'h-full rounded-full bg-yellow-500 transition-all';
        label.className = 'text-xs font-bold text-yellow-600';
    } else {
        bar.className = 'h-full rounded-full bg-emerald-500 transition-all';
        label.className = 'text-xs font-semibold text-gray-500';
    }
}

// ย่อขนาดรูปภาพและแปลงเป็น JPEG คุณภาพที่กำหนด เพื่อให้ไฟล์เล็กพอที่จะเก็บใน Firestore ได้
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('โหลดรูปภาพไม่สำเร็จ'));
            img.src = evt.target.result;
        };
        reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        reader.readAsDataURL(file);
    });
}

const IMAGE_GRID_IDS = { form: 'preview-form-grid', before: 'preview-before-grid', after: 'preview-after-grid' };

// ลบรูปภาพรายรูปออกจากหัวขัดที่ระบุ (form / before / after) ตามตำแหน่ง index
function removeImageAt(type, idx) {
    currentImages[type].splice(idx, 1);
    renderPreviewGrid(type, IMAGE_GRID_IDS[type]);
}

function resetForm() {
    document.getElementById('complaint-form').reset();
    document.getElementById('entry-id').value = '';
    
    // reset UI state
    document.getElementById('sub-department-container').classList.add('hidden');
    document.getElementById('f-subDepartment').removeAttribute('required');

    // Reset planning division complaint topic container (shown only for ฝ่ายแผน)
    document.getElementById('planning-topic-container').classList.add('hidden');
    document.getElementById('f-planningTopic').removeAttribute('required');

    // Reset project work topic container (shown only for งานโครงการ)
    document.getElementById('project-work-container').classList.add('hidden');
    document.getElementById('f-projectWorkTopic').removeAttribute('required');

    // Reset workflow stage container
    document.getElementById('workflow-stage-container').classList.add('hidden');
    document.getElementById('f-workflowStage').removeAttribute('required');

    // Reset supervisor field back to its default position (next to requester)
    document.getElementById('supervisor-slot-top').appendChild(document.getElementById('supervisor-field-wrap'));
    document.getElementById('supervisor-slot-project').classList.add('hidden');
    document.getElementById('requester-field-wrap').classList.remove('md:col-span-2');

    // Reset zone field back to visible + required
    document.getElementById('zone-field-wrap').classList.remove('hidden');
    document.getElementById('f-zone').setAttribute('required', 'true');
    document.getElementById('startdate-field-wrap').classList.remove('md:col-span-2');
    
    document.getElementById('f-status').value = 'ยังไม่เริ่ม';
    document.getElementById('note-container').classList.remove('hidden');
    document.getElementById('finished-container').classList.add('hidden');
    document.getElementById('f-completedDate').removeAttribute('required');
    document.getElementById('f-status').dispatchEvent(new Event('change'));

    currentImages = { form: [], before: [], after: [] };
    renderPreviewGrid('form', 'preview-form-grid');
    renderPreviewGrid('before', 'preview-before-grid');
    renderPreviewGrid('after', 'preview-after-grid');
    document.getElementById('f-formFile').value = '';
    document.getElementById('f-beforeFile').value = '';
    document.getElementById('f-afterFile').value = '';

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('f-startDate').value = today;
}

function populateForm(item) {
    document.getElementById('entry-id').value = item.id;
    document.getElementById('f-title').value = item.title;
    document.getElementById('f-receiveNo').value = item.receiveNo;
    document.getElementById('f-requester').value = item.requester;
    document.getElementById('f-supervisor').value = item.supervisor;
    
    const dept = document.getElementById('f-department');
    dept.value = item.department;
    // Trigger change so the sub-department (งานโยธา) or project work topic (งานโครงการ) section shows as needed
    dept.dispatchEvent(new Event('change'));
    
    if(item.subDepartment) document.getElementById('f-subDepartment').value = item.subDepartment;

    if(item.planningTopic) document.getElementById('f-planningTopic').value = item.planningTopic;

    // Load project work topic and workflow stage if they exist
    if(item.projectWorkTopic) {
        const projectWorkSelect = document.getElementById('f-projectWorkTopic');
        projectWorkSelect.value = item.projectWorkTopic;
        projectWorkSelect.dispatchEvent(new Event('change')); // Trigger visibility of workflow stage
    }
    
    if(item.workflowStage) document.getElementById('f-workflowStage').value = item.workflowStage;
    
    document.getElementById('f-zone').value = item.zone;
    document.getElementById('f-startDate').value = item.startDate;
    document.getElementById('f-contactType').value = item.contactType;
    document.getElementById('f-contactInfo').value = item.contactInfo;
    
    const stat = document.getElementById('f-status');
    stat.value = item.status;
    stat.dispatchEvent(new Event('change'));

    if (item.note) document.getElementById('f-note').value = item.note;
    if (item.completedDate) document.getElementById('f-completedDate').value = item.completedDate;

    currentImages.form = normalizeImgArray(item.formImgs);
    currentImages.before = normalizeImgArray(item.beforeImgs, item.beforeImg);
    currentImages.after = normalizeImgArray(item.afterImgs, item.afterImg);
    renderPreviewGrid('form', 'preview-form-grid');
    renderPreviewGrid('before', 'preview-before-grid');
    renderPreviewGrid('after', 'preview-after-grid');
}

// อ่านค่าทั้งหมดจากฟอร์มปัจจุบันมาประกอบเป็น object คำร้อง — ใช้ร่วมกันทั้งตอนบันทึกจริงและตอนคำนวณมิเตอร์ขนาดข้อมูล
function buildItemFromForm(id, isNew) {
    return {
        id: isNew ? Date.now() : parseInt(id),
        title: document.getElementById('f-title').value,
        receiveNo: document.getElementById('f-receiveNo').value,
        requester: document.getElementById('f-requester').value,
        supervisor: document.getElementById('f-supervisor').value,
        department: document.getElementById('f-department').value,
        subDepartment: document.getElementById('f-subDepartment').value,
        planningTopic: document.getElementById('f-planningTopic').value,
        projectWorkTopic: document.getElementById('f-projectWorkTopic').value,
        workflowStage: document.getElementById('f-workflowStage').value,
        zone: document.getElementById('f-zone').value,
        startDate: document.getElementById('f-startDate').value,
        contactType: document.getElementById('f-contactType').value,
        contactInfo: document.getElementById('f-contactInfo').value,
        status: document.getElementById('f-status').value,
        note: document.getElementById('f-note').value,
        completedDate: document.getElementById('f-completedDate').value,
        formImgs: currentImages.form,
        beforeImgs: currentImages.before,
        afterImgs: currentImages.after,
    };
}

function saveForm(e) {
    e.preventDefault();

    const id = document.getElementById('entry-id').value;
    const isNew = !id;
    const newItem = buildItemFromForm(id, isNew);

    // ตรวจสอบขนาดข้อมูลคร่าวๆ ก่อนบันทึก (Firestore จำกัดไว้ที่ 1MB ต่อรายการ)
    const approxSize = new Blob([JSON.stringify(newItem)]).size;
    if (approxSize > FIRESTORE_DOC_SIZE_BUDGET) {
        const kb = Math.round(approxSize / 1024);
        const budgetKb = Math.round(FIRESTORE_DOC_SIZE_BUDGET / 1024);
        showToast(`ข้อมูล (รวมรูปภาพ) มีขนาดใหญ่เกินไป (~${kb} KB จากขีดจำกัด ${budgetKb} KB) กรุณาลบรูปภาพบางส่วนออก หรือใช้รูปภาพที่เล็กลง`, 'error');
        return;
    }

    db.collection('complaints').doc(String(newItem.id)).set(newItem)
        .then(() => {
            showToast(isNew ? 'บันทึกคำร้องใหม่สำเร็จ' : 'อัปเดตข้อมูลสำเร็จ');
            navigate('dashboard');
        })
        .catch((err) => {
            console.error('Save error:', err);
            showToast('บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่', 'error');
        });
}

function deleteItem(id) {
    openConfirmModal('คุณแน่ใจหรือไม่ที่จะลบคำร้องนี้? ข้อมูลจะไม่สามารถกู้คืนได้', () => {
        db.collection('complaints').doc(String(id)).delete()
            .then(() => {
                closeDetailModal();
                showToast('ลบคำร้องเรียบร้อยแล้ว');
            })
            .catch((err) => {
                console.error('Delete error:', err);
                showToast('ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่', 'error');
            });
    });
}
