/**********************************************************************
 * M2H ADMIN PANEL — FULL MERGED VERSION (NO ERRORS)
 * Includes: Admin API + Monitoring + UI + Charts
 * Author: @m2hgamerz
 **********************************************************************/

/* ============================================================
   GLOBALS
   ============================================================ */

let ADMIN_TOKEN = localStorage.getItem("ADMIN_TOKEN") || null;

let chartDevices = null;
let chartRequests = null;

function $(id) {
    return document.getElementById(id);
}

/* ============================================================
   SAFE SETTER (prevents crashes)
   ============================================================ */
function safeSet(id, text) {
    const el = $(id);
    if (el) el.innerText = text;
}

/* ============================================================
   API WRAPPER
   ============================================================ */

async function api(url, method = "GET", body = null) {
    const opts = {
        method,
        headers: { "Content-Type": "application/json" }
    };

    if (ADMIN_TOKEN) {
        opts.headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
    }

    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    return res.json();
}

/* ============================================================
   LOGIN SYSTEM
   ============================================================ */
async function loginAdmin() {
    const key = $("admin-key-input").value.trim();
    const errBox = $("login-error");

    if (!key) {
        errBox.innerText = "Admin key is required.";
        errBox.classList.remove("hidden");
        return;
    }

    const test = await fetch("/api/admin/data", {
        headers: { Authorization: `Bearer ${key}` }
    });

    if (test.status === 401) {
        errBox.innerText = "Invalid Admin Key";
        errBox.classList.remove("hidden");
        return;
    }

    ADMIN_TOKEN = key;
    localStorage.setItem("ADMIN_TOKEN", key);

    $("login-screen").classList.add("hidden");
    $("admin-panel").classList.remove("hidden");

    loadAdminData();
    loadMonitoring();
    loadLogs();

    switchTab("dashboard");
}

function logoutAdmin() {
    ADMIN_TOKEN = null;
    localStorage.removeItem("ADMIN_TOKEN");

    $("admin-panel").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
}

/* ============================================================
   TABS
   ============================================================ */

function switchTab(tab) {
    document.querySelectorAll(".admin-section").forEach(el => el.style.display = "none");
    const section = $("section-" + tab);
    if (section) section.style.display = "block";

    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    const nav = $("nav-" + tab);
    if (nav) nav.classList.add("active");
}

/* ============================================================
   CHARTS (SAFE)
   ============================================================ */

function renderDeviceChart(reqs) {
    if (!$("chart-devices") || !window.Chart) return;

    const counts = { Mobile: 0, Desktop: 0, Tablet: 0 };
    reqs.forEach(r => counts[r.device_type] = (counts[r.device_type] || 0) + 1);

    if (chartDevices) chartDevices.destroy();

    chartDevices = new Chart($("chart-devices"), {
        type: "doughnut",
        data: {
            labels: ["Mobile", "Desktop", "Tablet"],
            datasets: [{
                data: [counts.Mobile, counts.Desktop, counts.Tablet],
                backgroundColor: ["#3b82f6", "#16a34a", "#a855f7"]
            }]
        }
    });
}

function renderRequestsChart(reqs) {
    if (!$("chart-requests") || !window.Chart) return;

    const hours = new Array(24).fill(0);
    reqs.forEach(r => {
        const h = new Date(r.created_at).getHours();
        hours[h]++;
    });

    if (chartRequests) chartRequests.destroy();

    chartRequests = new Chart($("chart-requests"), {
        type: "line",
        data: {
            labels: hours.map((_, i) => `${i}:00`),
            datasets: [{
                label: "Requests/Hour",
                data: hours,
                borderColor: "#3b82f6",
                tension: 0.3
            }]
        }
    });
}

/* ============================================================
   REAL-TIME MONITORING
   ============================================================ */

async function loadMonitoring() {
    const data = await api("/api/health-full");
    if (!data.success) return;

    const m = data.monitor;

    safeSet("mon-uptime", m.uptime_str);
    safeSet("mon-rps", m.requests_per_second.toFixed(3));
    safeSet("mon-eventlag", m.event_loop_lag_ms + " ms");
    safeSet("mon-latency", m.avg_api_latency_ms + " ms");

    if (m.system?.memory) {
        const used = m.system.memory.used / 1024 / 1024;
        const total = m.system.memory.total / 1024 / 1024;
        safeSet("mon-ram", used.toFixed(1) + "MB / " + total.toFixed(1) + "MB");
    }

    if (m.system?.cpu !== undefined) {
        safeSet("mon-cpu", m.system.cpu.toFixed(2));
    }

    safeSet("mon-google", `${m.external_ping.google.status} (${m.external_ping.google.ping || "X"} ms)`);
    safeSet("mon-cloudflare", `${m.external_ping.cloudflare.status} (${m.external_ping.cloudflare.ping || "X"} ms)`);
    safeSet("mon-twitter", `${m.external_ping.twitter.status} (${m.external_ping.twitter.ping || "X"} ms)`);
}

/* ============================================================
   ADMIN DATA LOAD
   ============================================================ */

async function loadAdminData() {
    const d = await api("/api/admin/data");

    if (!d.success) {
        console.warn("Admin token invalid");
        return;
    }

    safeSet("stat-total-requests", d.stats.total_requests);
    safeSet("stat-total-videos", d.stats.total_videos);

    // Charts
    renderDeviceChart(d.requests);
    renderRequestsChart(d.requests);

    // Requests table
    const reqBox = $("table-requests");
    if (reqBox) {
        reqBox.innerHTML = "";
        d.requests.slice(-100).reverse().forEach(r => {
            reqBox.innerHTML += `
                <tr>
                  <td>${r.ip_address}</td>
                  <td>${r.device_type}</td>
                  <td>${r.browser}</td>
                  <td>${r.platform}</td>
                  <td>${r.twitter_url || "-"}</td>
                  <td>${new Date(r.created_at).toLocaleString()}</td>
                </tr>
            `;
        });
    }

    // Videos table
    const vidBox = $("table-videos");
    if (vidBox) {
        vidBox.innerHTML = "";
        d.videos.slice(-100).reverse().forEach(v => {
            vidBox.innerHTML += `
                <tr>
                  <td>${v.tweet_id}</td>
                  <td>${v.author}</td>
                  <td>${v.total_downloads}</td>
                  <td>${v.tweet_date}</td>
                </tr>`;
        });
    }
}

/* ============================================================
   LOGS
   ============================================================ */

async function loadLogs() {
    const r = await api("/api/admin/logs");
    const box = $("logs-box");

    if (!box || !r.logs) return;

    box.innerHTML = "";
    r.logs.forEach(log => {
        box.innerHTML += `<div class="log-line">${log}</div>`;
    });
}

/* ============================================================
   ADMIN ACTIONS
   ============================================================ */

async function banIP() {
    const ip = $("ban-ip-input").value.trim();
    if (!ip) return alert("Enter IP");

    const r = await api("/api/admin/ban", "POST", { ip });
    alert(r.success ? "IP banned" : r.error);
}

async function resetStats() {
    if (!confirm("Reset stats?")) return;
    await api("/api/admin/reset-stats", "POST", {});
    alert("Stats reset");
    loadAdminData();
}

async function clearRequests() {
    if (!confirm("Clear all requests?")) return;
    await api("/api/admin/clear-requests", "POST", {});
    alert("Requests cleared");
    loadAdminData();
}

async function clearVideos() {
    if (!confirm("Clear all videos?")) return;
    await api("/api/admin/clear-videos", "POST", {});
    alert("Videos cleared");
    loadAdminData();
}

/* ============================================================
   GLOBAL INIT
   ============================================================ */

window.onload = () => {
    if (!ADMIN_TOKEN) {
        $("login-screen").style.display = "flex";
        $("admin-panel").style.display = "none";
        return;
    }

    $("login-screen").style.display = "none";
    $("admin-panel").style.display = "block";

    switchTab("dashboard");

    loadAdminData();
    loadMonitoring();
    loadLogs();

    setInterval(loadMonitoring, 1000);
};

/* ============================================================
   EXPOSE METHODS TO HTML
   ============================================================ */

window.loginAdmin = loginAdmin;
window.logoutAdmin = logoutAdmin;
window.switchTab = switchTab;
window.banIP = banIP;
window.resetStats = resetStats;
window.clearRequests = clearRequests;
window.clearVideos = clearVideos;
