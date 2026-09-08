// ==========================================================
//  เชื่อมต่อ Google Apps Script Web App (Backend อ่าน/เขียน Google Sheet)
//  API_URL มาจากไฟล์ config.js ที่โหลดก่อนไฟล์นี้
// ==========================================================
function showAppDialog(message, requireConfirmation) {
    const dialog = document.getElementById('appDialog');
    const messageBox = document.getElementById('appDialogMessage');
    const cancelButton = document.getElementById('appDialogCancel');
    const okButton = document.getElementById('appDialogOk');
    if (!dialog || !messageBox || !okButton) return Promise.resolve(true);

    messageBox.textContent = message;
    cancelButton.style.display = requireConfirmation ? 'inline-block' : 'none';
    dialog.classList.add('show');

    return new Promise(resolve => {
        const close = result => {
            dialog.classList.remove('show');
            okButton.removeEventListener('click', onOk);
            cancelButton.removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk = () => close(true);
        const onCancel = () => close(false);
        okButton.addEventListener('click', onOk);
        cancelButton.addEventListener('click', onCancel);
        okButton.focus();
    });
}

function showAppAlert(message) { return showAppDialog(message, false); }
function showAppConfirm(message) { return showAppDialog(message, true); }

async function apiGet(action, params) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    if (params) {
        Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
    }
    const res = await fetch(url.toString());
    return res.json();
}

async function apiPost(action, payload) {
    // ใช้ text/plain เพื่อเลี่ยง CORS preflight ของ Apps Script Web App
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload: payload || {} })
    });
    return res.json();
}

// ==========================================================
//  Helper: เวลาปัจจุบัน (โซนไทย) รูปแบบ yyyy-MM-dd HH:mm:ss
// ==========================================================
function nowBangkokString() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function todayBangkokISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    return `${map.year}-${map.month}-${map.day}`;
}

// แปลงวันที่แบบไทย (เช่น "02 ก.ย. 2026 19:22") หรือ Date ให้เป็น yyyy-MM-dd
const THAI_MONTHS = {
    'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
    'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12
};
const MONTH_RE = new RegExp(
    '^(\\d{1,2})\\s+(' +
    Object.keys(THAI_MONTHS).map(k => k.replace(/\./g, '\\.')).join('|') +
    ')\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?'
);

function toISODate(v) {
    let d;
    if (v instanceof Date) {
        d = v;
    } else {
        const s = String(v || '').trim();
        if (!s) return null;
        const m = s.match(MONTH_RE);
        if (m) {
            const day = parseInt(m[1], 10);
            const month = THAI_MONTHS[m[2]];
            const year = parseInt(m[3], 10);
            const hour = m[4] ? parseInt(m[4], 10) : 0;
            const minute = m[5] ? parseInt(m[5], 10) : 0;
            d = new Date(year, month - 1, day, hour, minute);
        } else {
            d = new Date(s);
        }
    }
    if (!d || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
}

function shortLogistic(m) {
    const s = String(m || '').trim();
    const match = s.match(/-TH-(.+)$/i);
    return match ? match[1].trim() : s;
}

function containsCI(str, sub) {
    return String(str || '').toLowerCase().indexOf(String(sub).toLowerCase()) !== -1;
}

function containsTH(str, sub) {
    return String(str || '').indexOf(sub) !== -1;
}

// ==========================================================
//  State
// ==========================================================
let productsMap = {};
let db = { products: [], orders: [], replacements: [], cuts: [] };
let currentPage = { products: 1, orders: 1, substitutes: 1, cuts: 1 };
let rowsPerPage = { products: 10, orders: 10, substitutes: 10, cuts: 10 };
let pendingExcelData = null;
let fuayData = [];

let currentQC = { trackingNo: '', items: [] };

document.addEventListener('DOMContentLoaded', function () {
    loadData();
    setupOldSkuDropdown();
    setupScanAutoSelect();
    loadFuayData();

    const excelInput = document.getElementById('excelFileInput');
    if (excelInput) excelInput.addEventListener('change', previewExcelFile);
});

// ==========================================================
//  โหลดข้อมูลหลัก (products, orders, substitutes, cuts)
//  จาก Google Sheet ผ่าน Apps Script (action=getAllData)
// ==========================================================
async function loadData() {
    try {
        const result = await apiGet('getAllData');
        if (result.error) throw new Error(result.error);

        db = {
            orders: result.orders || [],
            products: result.products || [],
            replacements: result.replacements || [],
            cuts: result.cuts || []
        };

        productsMap = {};
        db.products.forEach(p => { if (p.skuMerchant) productsMap[p.skuMerchant.trim()] = p.brand; });

        renderTables();
        setupNewSkuDatalist();
    } catch (err) {
        console.error("Error loading data:", err);
        showAppAlert("เกิดข้อผิดพลาดในการโหลดข้อมูล: " + err.message);
    }
}

function setupOldSkuDropdown() {
    const trackingInput = document.getElementById('subTracking');
    const skuSelect = document.getElementById('subOldSku');
    const qtyInput = document.getElementById('subOldQty');
    if (trackingInput && skuSelect) {
        trackingInput.addEventListener('input', function () {
            populateOrderSkuOptions(this.value.trim(), 'subOldSku', 'subOldQty');
        });
        skuSelect.addEventListener('change', function () {
            const opt = this.selectedOptions[0];
            if (opt && opt.dataset.qty && qtyInput) qtyInput.value = opt.dataset.qty;
        });
    }

    const delTrackingInput = document.getElementById('delTracking');
    const delSkuSelect = document.getElementById('delSku');
    const delQtyInput = document.getElementById('delQty');
    if (delTrackingInput && delSkuSelect) {
        delTrackingInput.addEventListener('input', function () {
            populateOrderSkuOptions(this.value.trim(), 'delSku', 'delQty');
        });
        delSkuSelect.addEventListener('change', function () {
            const opt = this.selectedOptions[0];
            if (opt && opt.dataset.qty && delQtyInput) delQtyInput.value = opt.dataset.qty;
        });
    }

    setupNewSkuDatalist();
}

function setupScanAutoSelect() {
    const scanOrder = document.getElementById('scanOrder');
    const scanItem = document.getElementById('scanItem');
    if (scanOrder) scanOrder.addEventListener('focus', function () { this.select(); });
    if (scanItem) scanItem.addEventListener('focus', function () { this.select(); });
}

function populateOrderSkuOptions(trackingNo, selectId, qtyId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">-- เลือก SKU --</option>';
    const qtyInput = qtyId ? document.getElementById(qtyId) : null;
    if (qtyInput) qtyInput.value = 1;

    if (!trackingNo) return;

    const order = (db.orders || []).find(o =>
        String(o.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase()
    );

    if (!order || !order.items || order.items.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(ไม่พบ SKU ในออเดอร์นี้)';
        select.appendChild(opt);
        return;
    }

    order.items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.sku;
        opt.textContent = `${it.sku} (จำนวน ${it.qty})`;
        opt.dataset.qty = it.qty;
        select.appendChild(opt);
    });
}

function setupNewSkuDatalist() {
    const listEl = document.getElementById('listNewSku');
    if (!listEl) return;
    listEl.innerHTML = '';
    (db.products || []).forEach(p => {
        if (!p.skuMerchant) return;
        const opt = document.createElement('option');
        opt.value = p.skuMerchant;
        opt.label = p.brand ? `${p.skuMerchant} (${p.brand})` : p.skuMerchant;
        listEl.appendChild(opt);
    });
}

function findProductBySkuOrGtin(code) {
    if (!code) return null;
    const val = String(code).trim().toLowerCase();
    return (db.products || []).find(p =>
        (p.skuMerchant && String(p.skuMerchant).trim().toLowerCase() === val) ||
        (p.gtin && String(p.gtin).trim().toLowerCase() === val)
    ) || null;
}

// ==========================================================
//  Pagination / Render (เหมือนเดิมทั้งหมด ไม่เปลี่ยนแปลง)
// ==========================================================
function paginateList(list, page, perPage) {
    const total = list.length;
    const totalPages = Math.ceil(total / perPage) || 1;
    const current = Math.min(Math.max(1, page), totalPages);
    const start = (current - 1) * perPage;
    const items = list.slice(start, start + perPage);
    return { items, totalPages, currentPage: current, totalItems: total };
}

function renderPaginationControls(containerId, key, paginated) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="pagination-info">
            แสดงหน้า ${paginated.currentPage} จาก ${paginated.totalPages} (ทั้งหมด ${paginated.totalItems} รายการ)
            &nbsp;|&nbsp; แสดงต่อหน้า:
            <select onchange="changeRowsPerPage('${key}', this.value)" style="padding:2px 5px; margin-left:5px;">
                <option value="10" ${rowsPerPage[key] == 10 ? 'selected' : ''}>10</option>
                <option value="20" ${rowsPerPage[key] == 20 ? 'selected' : ''}>20</option>
                <option value="50" ${rowsPerPage[key] == 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
        <div class="pagination-btns">
            <button class="page-btn" onclick="changePage('${key}', -1)" ${paginated.currentPage <= 1 ? 'disabled' : ''}>◄ ก่อนหน้า</button>
            <button class="page-btn" onclick="changePage('${key}', 1)" ${paginated.currentPage >= paginated.totalPages ? 'disabled' : ''}>ถัดไป ►</button>
        </div>
    `;
}

function changePage(key, dir) { currentPage[key] += dir; renderTables(); }
function changeRowsPerPage(key, val) { rowsPerPage[key] = parseInt(val); currentPage[key] = 1; renderTables(); }

function renderOrders() {
    const input = document.getElementById('searchOrderInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = db.orders || [];

    const filtered = list.filter(o => {
        const tracking = String(o.trackingNo || '').toLowerCase();
        const items = String(o.itemsStr || '').toLowerCase();
        return tracking.includes(f) || items.includes(f);
    });

    const paginated = paginateList(filtered, currentPage.orders, rowsPerPage.orders);
    const tbody = document.getElementById('tbOrders');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลออเดอร์</td></tr>`;
        renderPaginationControls('pageOrdContainer', 'orders', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(o => {
        const tracking = o.trackingNo || '-';
        const items = o.itemsStr || '-';
        const status = o.status || 'Pending';
        const qcTime = o.qcTime || '-';
        const isDone = status === 'Completed' || status === 'QC แล้ว' || status === 'สำเร็จ';

        return `
            <tr>
                <td><b>${tracking}</b></td>
                <td>${items}</td>
                <td class="text-center">
                    <span class="badge ${isDone ? 'badge-completed' : 'badge-pending'}">
                        ${isDone ? 'QC แล้ว' : 'รอ QC'}
                    </span>
                </td>
                <td class="text-center" style="font-size:12px; color:#666;">${qcTime}</td>
                <td class="text-center">
                    <button class="btn-revert" onclick="revertQC('${tracking}')">🔄 ยกเลิก</button>
                </td>
            </tr>
        `;
    }).join('');

    renderPaginationControls('pageOrdContainer', 'orders', paginated);
}

function renderProducts() {
    const input = document.getElementById('searchProdInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = db.products || [];

    const filtered = list.filter(p =>
        (p.brand && p.brand.toLowerCase().includes(f)) ||
        (p.skuMerchant && p.skuMerchant.toLowerCase().includes(f)) ||
        (p.gtin && p.gtin.toLowerCase().includes(f))
    );

    const paginated = paginateList(filtered, currentPage.products, rowsPerPage.products);
    const tbody = document.getElementById('tbProducts');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลสินค้า</td></tr>`;
        renderPaginationControls('pageProdContainer', 'products', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(p => `
        <tr>
            <td><b>${p.brand || '-'}</b></td>
            <td><span class="sku-code">${p.skuMerchant}</span></td>
            <td>${p.gtin || '-'}</td>
            <td class="text-center">
                <button class="btn-revert" onclick="deleteProductRow('${p.rowIndex}')">🗑️ ลบ</button>
            </td>
        </tr>
    `).join('');

    renderPaginationControls('pageProdContainer', 'products', paginated);
}

function renderSubReplace() {
    const input = document.getElementById('searchReplaceInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const list = (db.replacements || []).filter(item => {
        const tracking = String(item.trackingNo || '').toLowerCase();
        const oldSku = String(item.oldSku || '').toLowerCase();
        const newSku = String(item.newSku || '').toLowerCase();
        return tracking.includes(f) || oldSku.includes(f) || newSku.includes(f);
    });

    const tbody = document.getElementById('tbSubReplace');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลสินค้าทดแทน</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(item => `
        <tr>
            <td>${item.trackingNo}</td>
            <td><span class="badge badge-old">${item.oldSku}</span></td>
            <td class="text-center">${item.qty}</td>
            <td><span class="badge badge-completed">${item.newSku}</span></td>
            <td class="text-center">${item.qty}</td>
            <td class="text-center">${item.timestamp}</td>
            <td class="text-center">
                <button class="btn-revert" onclick="deleteSubstituteRow('${item.rowIndex}')">🗑️ ลบ</button>
            </td>
        </tr>
    `).join('');
}

function renderSubDelete() {
    const input = document.getElementById('searchDeleteInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const cutsData = db.cuts || [];

    const filtered = cutsData.filter(item => {
        const tracking = String(item.trackingNo || '').toLowerCase();
        const sku = String(item.sku || '').toLowerCase();
        return tracking.includes(f) || sku.includes(f);
    });

    const paginated = paginateList(filtered, currentPage.substitutes, rowsPerPage.substitutes);
    const tbody = document.getElementById('tbSubDelete');
    if (!tbody) return;

    if (paginated.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูลรายการตัดสินค้าออก</td></tr>`;
        renderPaginationControls('pageDeleteContainer', 'substitutes', paginated);
        return;
    }

    tbody.innerHTML = paginated.items.map(item => {
        const tracking = item.trackingNo || '-';
        const sku = item.sku || '-';
        const qty = item.qty || 1;
        const timestamp = item.timestamp || '-';
        const rowIndex = item.rowIndex;

        return `
            <tr>
                <td><b>${tracking}</b></td>
                <td><span class="badge badge-old">${sku}</span></td>
                <td class="text-center">${qty}</td>
                <td class="text-center"><span class="badge badge-pending">ตัดรายการออก</span></td>
                <td class="text-center" style="color:#666; font-size:12px;">${timestamp}</td>
                <td class="text-center">
                    <button class="btn-revert" onclick="deleteCutRow('${rowIndex}')">🗑️ ลบ</button>
                </td>
            </tr>
        `;
    }).join('');

    renderPaginationControls('pageDeleteContainer', 'substitutes', paginated);
}

function renderTables() {
    renderOrders();
    renderProducts();
    renderSubReplace();
    renderSubDelete();
}

function filterOrders() { currentPage.orders = 1; renderOrders(); }
function filterProducts() { currentPage.products = 1; renderProducts(); }
function filterSubstitutes() { currentPage.substitutes = 1; renderSubReplace(); renderSubDelete(); }

function toggleSubMenu() {
    const sub = document.getElementById('subMenuSubstitutes');
    const arrow = document.getElementById('arrowSub');
    if (!sub) return;
    if (sub.classList.contains('open')) { sub.classList.remove('open'); arrow.innerText = '▼'; }
    else { sub.classList.add('open'); arrow.innerText = '▲'; }
}

function switchPage(pageId, btnId, isSubMenu = false) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sub-btn').forEach(s => s.classList.remove('active'));

    document.getElementById(pageId).classList.add('active');

    if (isSubMenu) {
        document.getElementById('btnSubDropdown').classList.add('active');
        document.getElementById(btnId).classList.add('active');
        document.getElementById('subMenuSubstitutes').classList.add('open');
        document.getElementById('arrowSub').innerText = '▲';
    } else {
        document.getElementById(btnId).classList.add('active');
    }

    renderTables();
    closeMobileMenu();
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar || !overlay) return;
    if (sidebar.classList.contains('mobile-open')) closeMobileMenu();
    else { sidebar.classList.add('mobile-open'); overlay.classList.add('show'); }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('show');
}

// ==========================================================
//  Actions ที่เขียนข้อมูล (ตอนนี้คุยกับ Google Sheet ผ่าน Apps Script)
// ==========================================================
async function revertQC(trackingNo) {
    if (!await showAppConfirm(`ต้องการยกเลิกสถานะ QC ของ Tracking: ${trackingNo} (กลับเป็น "รอ QC") หรือไม่?`)) return;
    try {
        const result = await apiPost('resetQCStatus', { trackingNo });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'รีเซ็ตสถานะเรียบร้อย');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteProductRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการลบสินค้ารายการนี้หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'Products', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'ลบรายการเรียบร้อยแล้ว');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteSubstituteRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการลบรายการทดแทนนี้หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'Substitute products', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'ลบรายการเรียบร้อยแล้ว');
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteCutRow(rowIndex) {
    if (!await showAppConfirm('คุณต้องการยกเลิก/ลบรายการตัดสินค้านี้ ใช่หรือไม่?')) return;
    try {
        const result = await apiPost('deleteRowBySheetAndIndex', { sheetName: 'cut', rowIndex: Number(rowIndex) });
        if (!result.success) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

function handleOrderScan(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('scanOrder');
    const tracking = input.value.trim();
    if (!tracking) return;

    const order = (db.orders || []).find(o => String(o.trackingNo || '').toLowerCase() === tracking.toLowerCase());

    if (!order) {
        showMessage('❌ ไม่พบข้อมูล Tracking No. นี้ในระบบ', 'error');
        input.select(); input.focus();
        return;
    }

    const status = order.status || '';
    const isAlreadyDone = status === 'Completed' || status === 'QC แล้ว' || status === 'สำเร็จ';
    if (isAlreadyDone) {
        const qcTime = order.qcTime || '-';
        playFeedbackSound('error');
        showMessage(`⚠️ ออเดอร์ ${tracking} ผ่าน QC ไปแล้วเมื่อ ${qcTime}`, 'error');
        input.value = ''; input.focus();
        return;
    }

    currentQC.trackingNo = order.trackingNo;
    currentQC.items = parseOrderItems(order.itemsStr || '');

    document.getElementById('txtTracking').innerText = currentQC.trackingNo;
    document.getElementById('orderDetail').style.display = 'block';

    const scanItemInput = document.getElementById('scanItem');
    scanItemInput.disabled = false;
    scanItemInput.value = '';
    scanItemInput.focus();

    showMessage(`✅ ดึงข้อมูลออเดอร์ ${currentQC.trackingNo} เรียบร้อย`, 'success');
    renderQCItems();
}

function parseOrderItems(itemsStr) {
    if (!itemsStr) return [];
    const rawList = itemsStr.split(/,|\n/);
    const result = [];
    rawList.forEach(raw => {
        let text = raw.trim();
        if (!text) return;
        let qty = 1;
        const match = text.match(/\((\d+)\)\s*$/);
        if (match) { qty = parseInt(match[1], 10); text = text.slice(0, match.index).trim(); }
        result.push({ sku: text, qty: qty, scannedQty: 0 });
    });
    return result;
}

function handleItemScan(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('scanItem');
    const barcode = input.value.trim();
    if (!barcode) return;

    let matchedSku = barcode;
    const prodMatch = findProductBySkuOrGtin(barcode);
    if (prodMatch) matchedSku = prodMatch.skuMerchant;

    const item = currentQC.items.find(i => i.sku.trim().toLowerCase() === matchedSku.trim().toLowerCase());

    if (!item) {
        showMessage(`❌ สินค้า SKU/บาร์โค้ด [${barcode}] ไม่อยู่ในออเดอร์นี้!`, 'error');
        input.value = ''; input.select();
        return;
    }

    const targetQty = item.qty || 1;
    if (item.scannedQty >= targetQty) {
        showMessage(`⚠️ สินค้า SKU [${item.sku}] ครบจำนวนแล้ว!`, 'error');
        input.value = ''; input.select();
        return;
    }

    item.scannedQty++;
    input.value = '';
    renderQCItems();

    const isAllDone = currentQC.items.every(i => i.scannedQty >= (i.qty || 1));
    if (isAllDone) {
        showMessage(`🎉 ตรวจสอบออเดอร์ ${currentQC.trackingNo} ครบถ้วนแล้ว!`, 'success');
        saveQCSuccess(currentQC.trackingNo);
    } else {
        showMessage(`👍 สแกน ${item.sku} สำเร็จ (${item.scannedQty}/${targetQty})`, 'success');
    }
}

function renderQCItems(itemsList) {
    const tbody = document.getElementById('tbQCItems');
    if (!tbody) return;

    const items = itemsList || currentQC.items || [];
    let scannedTotal = 0, requiredTotal = 0;

    tbody.innerHTML = items.map(item => {
        const scanned = Number(item.scannedQty || 0);
        const qty = Number(item.qty || 1);
        scannedTotal += scanned;
        requiredTotal += qty;

        const cleanSku = (item.sku || '').trim();
        const brandName = productsMap[cleanSku] || '-';
        const isDone = scanned >= qty;
        const statusBadge = isDone
            ? '<span class="badge" style="background:#d4edda; color:#155724; padding:4px 8px; border-radius:4px;">ครบถ้วน</span>'
            : '<span class="badge" style="background:#fff3cd; color:#856404; padding:4px 8px; border-radius:4px;">รอสแกน</span>';

        return `
            <tr style="${isDone ? 'background-color: #f8f9fa;' : ''}">
                <td><span style="background:#f1f3f5; padding:2px 6px; border-radius:4px; font-weight:bold;">${cleanSku || '-'}</span></td>
                <td>${brandName}</td>
                <td class="text-center">${scanned} / ${qty}</td>
                <td class="text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    updateQCSummary(scannedTotal, requiredTotal);
}

function updateQCSummary(scannedTotal, requiredTotal) {
    const badge = document.getElementById('totalItemsBadge');
    if (!badge) return;
    badge.innerText = `สแกนแล้ว ${scannedTotal} / ${requiredTotal} ชิ้น`;
    badge.style.backgroundColor = (scannedTotal === requiredTotal && requiredTotal > 0) ? '#28a745' : '#17a2b8';
}

async function saveQCSuccess(trackingNo) {
    try {
        await apiPost('updateQCStatus', { trackingNo, status: 'Completed' });
        loadData();
        setTimeout(resetScanUI, 600);
    } catch (err) {
        console.error('Error updating QC status:', err);
    }
}

function resetScanUI() {
    const orderDetail = document.getElementById('orderDetail');
    const scanOrder = document.getElementById('scanOrder');
    const scanItem = document.getElementById('scanItem');
    if (orderDetail) orderDetail.style.display = 'none';
    if (scanOrder) scanOrder.value = '';
    if (scanItem) { scanItem.value = ''; scanItem.disabled = true; }
    currentQC = { trackingNo: '', items: [] };
    if (scanOrder) scanOrder.focus();
}

function showMessage(text, type) {
    const msgDiv = document.getElementById('msg');
    if (!msgDiv) return;
    msgDiv.className = `msg ${type}`;
    msgDiv.innerText = text;
    msgDiv.style.display = 'block';
    playFeedbackSound(type);
    setTimeout(() => { msgDiv.style.display = 'none'; }, 4000);
}

let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

function playBeep(frequency, duration, waveType, delay, volume) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const startTime = ctx.currentTime + (delay || 0);
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = waveType || 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    const peakVolume = volume || 0.25;
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(peakVolume, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
}

function playFeedbackSound(type) {
    try {
        if (type === 'success') { playBeep(880, 0.12, 'sine', 0, 0.22); playBeep(1318, 0.14, 'sine', 0.1, 0.22); }
        else if (type === 'error') { playBeep(220, 0.28, 'square', 0, 0.2); }
    } catch (e) {}
}

async function saveProduct(e) {
    if (e && e.preventDefault) e.preventDefault();

    const data = {
        brand: document.getElementById('prodBrand') ? document.getElementById('prodBrand').value.trim() : '',
        skuMerchant: document.getElementById('prodSkuMerchant') ? document.getElementById('prodSkuMerchant').value.trim() : '',
        gtin: document.getElementById('prodGtin') ? document.getElementById('prodGtin').value.trim() : ''
    };

    if (!data.skuMerchant) { showAppAlert('กรุณากรอก SKU สินค้า'); return; }

    try {
        const result = await apiPost('addProduct', data);
        if (result.success === false) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'บันทึกสินค้าเรียบร้อยแล้ว');
        const form = document.getElementById('frmAddProduct');
        if (form) form.reset();
        loadData();
    } catch (err) {
        showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function removeItemFromOrder(e) {
    if (e && e.preventDefault) e.preventDefault();

    const trackingInput = document.getElementById('delTracking');
    const skuInput = document.getElementById('delSku');
    const qtyInput = document.getElementById('delQty');

    const data = {
        trackingNo: trackingInput ? trackingInput.value.trim() : '',
        sku: skuInput ? skuInput.value.trim() : '',
        qty: qtyInput ? Number(qtyInput.value) : 1
    };

    if (!data.trackingNo || !data.sku) {
        showAppAlert('กรุณากรอก Tracking No. และเลือก SKU สินค้าที่ต้องการตัดออกจากรายการ');
        return;
    }

    const order = (db.orders || []).find(o => String(o.trackingNo || '').trim().toLowerCase() === data.trackingNo.toLowerCase());
    const skuExistsInOrder = !!(order && order.items && order.items.some(it => String(it.sku || '').trim().toLowerCase() === data.sku.toLowerCase()));
    if (!skuExistsInOrder) {
        showAppAlert(`❌ ไม่พบ SKU "${data.sku}" ในออเดอร์ "${data.trackingNo}"\nกรุณาเลือก SKU จากรายการที่มีอยู่ในออเดอร์นี้เท่านั้น`);
        return;
    }

    const isDuplicate = (db.cuts || []).some(item =>
        String(item.trackingNo || '').trim().toLowerCase() === data.trackingNo.toLowerCase() &&
        String(item.sku || '').trim().toLowerCase() === data.sku.toLowerCase()
    );
    if (isDuplicate) {
        showAppAlert(`❌ Tracking No. "${data.trackingNo}" กับ SKU "${data.sku}" มีข้อมูลรายการตัดสินค้าออกอยู่แล้วในระบบ ไม่สามารถบันทึกซ้ำได้\nกรุณาลบรายการเดิมก่อน หากต้องการแก้ไข`);
        return;
    }

    if (await showAppConfirm(`ยืนยันการตัด SKU: ${data.sku} ออกจาก Tracking: ${data.trackingNo} ใช่หรือไม่?`)) {
        try {
            const result = await apiPost('deleteOrderItem', data);
            if (result.success === false) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
            showAppAlert(result.message || 'บันทึกข้อมูลลงชีต cut เรียบร้อยแล้ว!');
            if (trackingInput) trackingInput.value = '';
            if (skuInput) skuInput.innerHTML = '<option value="">-- เลือก SKU --</option>';
            if (qtyInput) qtyInput.value = '1';
            loadData();
        } catch (err) {
            showAppAlert('เกิดข้อผิดพลาด: ' + err.message);
        }
    }
}

async function saveReplaceAction(e) {
    if (e && e.preventDefault) e.preventDefault();

    const trackingNo = document.getElementById('subTracking') ? document.getElementById('subTracking').value.trim() : '';
    const oldSku = document.getElementById('subOldSku') ? document.getElementById('subOldSku').value.trim() : '';
    const oldQty = document.getElementById('subOldQty') ? document.getElementById('subOldQty').value : 1;
    const newSkuRaw = document.getElementById('subNewSku') ? document.getElementById('subNewSku').value.trim() : '';

    if (!trackingNo || !oldSku || !newSkuRaw) {
        showAppAlert('❌ กรุณากรอก Tracking No., เลือก SKU เดิม และ SKU ใหม่ ให้ครบถ้วน');
        return;
    }

    const matchedProduct = findProductBySkuOrGtin(newSkuRaw);
    if (!matchedProduct) {
        showAppAlert(`❌ ไม่พบ SKU/GTIN "${newSkuRaw}" ในระบบสินค้า\nกรุณาเพิ่มสินค้านี้ในหน้า "จัดการสินค้า (Products)" ก่อน หรือเลือกจากรายการ SKU ที่มีอยู่แล้ว`);
        return;
    }
    const newSku = matchedProduct.skuMerchant;

    const isDuplicate = (db.replacements || []).some(item =>
        String(item.trackingNo || '').trim().toLowerCase() === trackingNo.toLowerCase() &&
        String(item.oldSku || '').trim().toLowerCase() === oldSku.toLowerCase()
    );
    if (isDuplicate) {
        showAppAlert(`❌ Tracking No. "${trackingNo}" กับ SKU เดิม "${oldSku}" มีข้อมูลสินค้าทดแทนอยู่แล้วในระบบ ไม่สามารถบันทึกซ้ำได้\nกรุณาลบรายการเดิมก่อน หากต้องการแก้ไข`);
        return;
    }

    const data = { trackingNo, oldSku, qty: Number(oldQty), newSku, newQty: Number(oldQty) };

    try {
        const result = await apiPost('saveSubstitute', data);
        if (result.success === false) { showAppAlert(result.message || 'เกิดข้อผิดพลาด'); return; }
        showAppAlert(result.message || 'บันทึกสินค้าทดแทนเรียบร้อยแล้ว');
        const form = document.getElementById('formSubstitute');
        if (form) form.reset();
        const skuSelect = document.getElementById('subOldSku');
        if (skuSelect) skuSelect.innerHTML = '<option value="">-- เลือก SKU เดิม --</option>';
        loadData();
    } catch (err) {
        showAppAlert("❌ เกิดข้อผิดพลาดจากระบบ: " + err.message);
    }
}

// ==========================================================
//  ทำฟวย (Upload Excel) → เขียนเข้า collection "fuayEntries"
//  คอลัมน์อ้างอิงตามตำแหน่งเดิม: A=0 tracking, H=7 remark,
//  I=8 วันที่, M=12 โลจิสติกส์, N=13 สถานะแพลตฟอร์ม, O=14 สถานะคำสั่งซื้อ
// ==========================================================
function previewExcelFile() {
    const fileInput = document.getElementById('excelFileInput');
    const file = fileInput.files[0];
    pendingExcelData = null;
    document.getElementById('excelPreviewHeader').innerHTML = '';
    document.getElementById('excelPreviewBody').innerHTML = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

            if (!rows || rows.length === 0) {
                showUploadStatus('❌ ไม่พบข้อมูลในไฟล์ที่เลือก', 'error');
                return;
            }

            const headers = rows[0].map(h => String(h || '').trim());
            const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell || '').trim() !== ''));

            pendingExcelData = { headers, rows: dataRows };
            renderExcelPreview(headers, dataRows);
            showUploadStatus(`✅ อ่านไฟล์สำเร็จ พบ ${dataRows.length} แถวข้อมูล พร้อมอัปโหลด`, 'success');
        } catch (err) {
            showUploadStatus('❌ ไม่สามารถอ่านไฟล์นี้ได้: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderExcelPreview(headers, dataRows) {
    const headerRow = document.getElementById('excelPreviewHeader');
    const body = document.getElementById('excelPreviewBody');
    headerRow.innerHTML = headers.map(h => `<th>${h}</th>`).join('');
    const previewRows = dataRows.slice(0, 10);
    body.innerHTML = previewRows.map(r => '<tr>' + headers.map((h, i) => `<td>${r[i] !== undefined ? r[i] : ''}</td>`).join('') + '</tr>').join('');
    if (dataRows.length > 10) {
        body.innerHTML += `<tr><td colspan="${headers.length}" class="text-center" style="color:#888;">... และอีก ${dataRows.length - 10} แถว</td></tr>`;
    }
}

function showUploadStatus(text, type) {
    const box = document.getElementById('uploadStatusBox');
    if (!box) return;
    box.className = `msg ${type}`;
    box.innerText = text;
    box.style.display = 'block';
}

async function uploadExcelFile() {
    if (!pendingExcelData || !pendingExcelData.rows || pendingExcelData.rows.length === 0) {
        showAppAlert('กรุณาเลือกไฟล์ Excel ที่มีข้อมูลก่อนอัปโหลด');
        return;
    }

    if (!await showAppConfirm(`ยืนยันการนำเข้าข้อมูล ${pendingExcelData.rows.length} แถว แทนที่ข้อมูล "ฟวย" เดิมทั้งหมดหรือไม่?`)) return;

    showUploadStatus('⏳ กำลังอัปโหลดข้อมูล กรุณารอสักครู่...', 'success');

    try {
        const result = await apiPost('importExcelToOrdersSheet', {
            headers: pendingExcelData.headers,
            rows: pendingExcelData.rows
        });

        if (result.success === false) {
            showUploadStatus('❌ ' + (result.message || 'เกิดข้อผิดพลาด'), 'error');
            return;
        }

        showUploadStatus('✅ ' + (result.message || 'นำเข้าข้อมูลเรียบร้อยแล้ว'), 'success');
        document.getElementById('excelFileInput').value = '';
        document.getElementById('excelPreviewHeader').innerHTML = '';
        document.getElementById('excelPreviewBody').innerHTML = '';
        pendingExcelData = null;
        loadFuayData();
    } catch (err) {
        showUploadStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
}

// ==========================================================
//  ฟวย: คำนวณ ค้าง/วิกฤติ/ยิง/แฟลช/เช็ค
//  (คำนวณฝั่ง Apps Script จากชีต "ลงข้อมูล" โดยตรง action=getFuayData)
// ==========================================================
async function loadFuayData() {
    try {
        const result = await apiGet('getFuayData');
        if (!result.success) {
            console.error('Error loading Fuay data:', result.message);
            return;
        }

        fuayData = result.data || [];
        window.fuayHeaders = (result.headers || ["ค้าง ย", "ค้าง ว", "วิกฤติ", "ยิง", "แฟลช"]).slice(0, 5);
        renderFuayTable();
        renderFuaySummary(result.summary);
    } catch (err) {
        console.error('Error loading Fuay data:', err);
    }
}

function renderFuaySummary(summary) {
    const grid = document.getElementById('fuaySummaryGrid');
    if (!grid) return;
    if (!summary) { grid.innerHTML = ''; return; }

    function card(label, value, extraClass) {
        return `<div class="fuay-box ${extraClass || ''}">
                    <div class="fuay-box-label">${label}</div>
                    <div class="fuay-box-value">${value}</div>
                </div>`;
    }
    function metricRow(mainLabel, s, mainExtra) {
        return `
            ${card(mainLabel, s.total, 'fuay-box-main ' + (mainExtra || ''))}
            ${card('เจอ', s.found, 'fuay-metric-found')}
            ${card('หาย', s.missing, 'fuay-metric-missing')}
            ${card('ส่ง', s.shipped, 'fuay-metric-shipped')}
            ${card('ค้าง', s.pending, 'fuay-metric-pending')}
        `;
    }

    grid.innerHTML = `
        <div class="fuay-summary-row">${metricRow('ฟ ทั้งหมด', summary.flash)}</div>
        <div class="fuay-summary-row fuay-summary-group">
            <div class="fuay-box fuay-box-main fuay-box-tall">
                <div class="fuay-box-label">ย+ว ทั้งหมด</div>
                <div class="fuay-box-value">${summary.yingWikritTotal}</div>
            </div>
            <div class="fuay-summary-subrows">
                <div class="fuay-summary-row">${metricRow('ย', summary.ying)}</div>
                <div class="fuay-summary-row">${metricRow('ว', summary.wikrit)}</div>
            </div>
        </div>
    `;
}

function renderFuayTable() {
    const tbody = document.getElementById('tbFuayData');
    const headerRow = document.getElementById('fuayTableHeader');
    if (!tbody) return;

    const input = document.getElementById('searchFuayInput');
    const f = input ? input.value.toLowerCase().trim() : '';
    const headers = (window.fuayHeaders || ['ค้าง ย', 'ค้าง ว', 'วิกฤติ', 'ยิง', 'แฟลช']).slice(0, 5);

    const counts = [0, 0, 0, 0, 0];
    fuayData.forEach(row => {
        if (row.col1) counts[0]++;
        if (row.col2) counts[1]++;
        if (row.col3) counts[2]++;
        if (row.col4) counts[3]++;
        if (row.col5) counts[4]++;
    });

    if (headerRow) headerRow.innerHTML = headers.map((h, idx) => `<th>${h || '-'} (${counts[idx]})</th>`).join('');

    if (fuayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:#6c757d;">ไม่พบข้อมูล</td></tr>`;
        return;
    }

    function cellHtml(value) {
        if (!value) return '-';
        if (f && value.toLowerCase().includes(f)) {
            return `<span style="background-color:#fff3cd; padding:2px 6px; border-radius:4px; font-weight:bold;">${value}</span>`;
        }
        return value;
    }

    tbody.innerHTML = fuayData.map(row => `
        <tr>
            <td>${cellHtml(row.col1)}</td>
            <td>${cellHtml(row.col2)}</td>
            <td>${cellHtml(row.col3)}</td>
            <td>${cellHtml(row.col4)}</td>
            <td>${cellHtml(row.col5)}</td>
        </tr>
    `).join('');
}

async function handleFuaySearchEnter(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const input = document.getElementById('searchFuayInput');
    const trackingNo = input.value.trim();
    if (!trackingNo) return;

    const statusBox = document.getElementById('fuayCheckStatus');
    if (statusBox) { statusBox.className = 'msg success'; statusBox.innerText = '⏳ กำลังบันทึก...'; statusBox.style.display = 'block'; }

    try {
        const result = await apiPost('addCheckedTracking', { trackingNo });

        if (statusBox) {
            statusBox.className = result.success ? 'msg success' : 'msg error';
            statusBox.innerText = result.message || (result.success ? `✅ บันทึก "${trackingNo}" เรียบร้อยแล้ว` : '❌ เกิดข้อผิดพลาด');
            statusBox.style.display = 'block';
        }
        if (result.success) loadFuayData();
    } catch (err) {
        if (statusBox) {
            statusBox.className = 'msg error';
            statusBox.innerText = '❌ เกิดข้อผิดพลาด: ' + err.message;
            statusBox.style.display = 'block';
        }
    }
}
