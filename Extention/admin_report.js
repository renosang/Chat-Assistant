const REPORT_KEY = "gemini_quality_logs";

function renderReports() {
    const params = new URLSearchParams(window.location.search);
    const userFilter = params.get('user');

    console.log("[Report] Initializing for user:", userFilter);

    const body = document.getElementById('report-body');
    const empty = document.getElementById('empty-msg');
    if (!body || !empty) return;

    // Get filter values
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const actionFilter = document.getElementById('actionFilter').value;
    const keyword = (document.getElementById('keywordSearch')?.value || "").toLowerCase();

    const fetchLogs = () => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            // Extension Context: Fetch from local storage
            chrome.storage.local.get(REPORT_KEY, (data) => {
                const allLogs = data[REPORT_KEY] || [];
                processLogs(allLogs);
            });
        } else {
            // Web Context: Fetch from Backend API
            const API_BASE = "https://gemini-config-api.vercel.app/api";
            let url = `${API_BASE}/report/list?t=${Date.now()}`;
            if (userFilter) url += `&account=${encodeURIComponent(userFilter)}`;
            if (actionFilter && actionFilter !== 'all') url += `&action=${encodeURIComponent(actionFilter)}`;
            if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
            if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

            fetch(url)
                .then(r => r.json())
                .then(data => processLogs(data))
                .catch(err => {
                    console.error("[Report] API Error:", err);
                    body.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center">Lỗi khi tải dữ liệu từ server. Vui lòng kiểm tra kết nối mạng.</td></tr>`;
                });
        }
    };

    const processLogs = (allLogs) => {
        let logs = Array.isArray(allLogs) ? [...allLogs] : [];

        // Sort by time descending
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Apply local filtering in Extension mode (API already filters mostly)
        const isExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

        if (isExtension) {
            if (userFilter) {
                const cleanFilter = userFilter.toUpperCase();
                logs = logs.filter(log => (log.account || "").toUpperCase() === cleanFilter || (log.user || "").toUpperCase() === cleanFilter);
            }
            if (actionFilter && actionFilter !== 'all') {
                logs = logs.filter(log => log.action === actionFilter);
            }
            if (startDate) {
                const s = new Date(startDate); s.setHours(0, 0, 0, 0);
                logs = logs.filter(log => new Date(log.timestamp) >= s);
            }
            if (endDate) {
                const e = new Date(endDate); e.setHours(23, 59, 59, 999);
                logs = logs.filter(log => new Date(log.timestamp) <= e);
            }
        }

        // Global Keyword Search (Applied in both contexts for flexibility)
        if (keyword) {
            logs = logs.filter(log => {
                const text = `${log.brand} ${log.platform} ${log.customerId} ${log.user} ${log.details?.suggested || ''} ${log.details?.issue || ''}`.toLowerCase();
                return text.includes(keyword);
            });
        }

        renderTable(logs);
    };

    const renderTable = (logs) => {
        body.innerHTML = '';
        if (logs.length === 0) {
            empty.style.display = 'block';
            ['total-actions', 'fixes', 'bypasses'].forEach(id => document.getElementById(id).textContent = '0');
            return;
        }
        empty.style.display = 'none';

        let fixCount = 0;
        let bypassCount = 0;

        logs.forEach(log => {
            if (log.action === 'apply_fix') fixCount++;
            if (log.action === 'bypass_block') bypassCount++;

            const tr = document.createElement('tr');
            const dateStr = new Date(log.timestamp).toLocaleString('vi-VN', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });

            const actionBadge = log.action === 'apply_fix' ?
                '<span class="badge badge-apply">Sửa lỗi</span>' :
                '<span class="badge badge-bypass">Bỏ qua</span>';

            const detailDisplay = log.action === 'apply_fix' ?
                `Gợi ý: "<i>${(log.details?.suggested || "").slice(0, 40)}...</i>"` :
                `Vẫn gửi khi: <b>${log.details?.issue || "N/A"}</b>`;

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><strong>${log.user || 'Unknown'}</strong><br><small style="color:#64748b">${log.group || ''}</small></td>
                <td>${log.brand || 'N/A'} - ${(log.platform || '').toUpperCase()}<br><small style="color:#64748b">ID: ${log.customerId || 'N/A'}</small></td>
                <td>${actionBadge}</td>
                <td>${detailDisplay}</td>
            `;
            body.appendChild(tr);
        });

        document.getElementById('total-actions').textContent = logs.length;
        document.getElementById('fixes').textContent = fixCount;
        document.getElementById('bypasses').textContent = bypassCount;
    };

    fetchLogs();
}

// Auto render on load
document.addEventListener('DOMContentLoaded', () => {
    // Detect context and adjust UI
    const isExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (isExtension) {
        document.body.classList.add('is-extension');
    } else {
        // Quick Auth check for Web context
        if (localStorage.getItem('adminToken') !== 'true') {
            window.location.href = 'index.html';
            return;
        }
    }

    // Set default dates: 30 days ago to today
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);

    const formatInputDate = (d) => d.toISOString().split('T')[0];
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    if (startDateInput && !startDateInput.value) startDateInput.value = formatInputDate(start);
    if (endDateInput && !endDateInput.value) endDateInput.value = formatInputDate(end);

    renderReports();

    // Logout logic
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
                localStorage.removeItem('adminToken');
                window.location.href = 'index.html';
            }
        });
    }

    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', renderReports);
    }

    const btnApplyFilters = document.getElementById('btnApplyFilters');
    if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', renderReports);
    }
});
