/**********************************************************************
 * M2H ADMIN PANEL — FINAL MERGED VERSION
 * Includes: AdminAPI + UI + Monitoring + Charts (NO ERRORS)
 * Author: @m2hgamerz
 **********************************************************************/

/* ============================================================
   GLOBALS
   ============================================================ */

// Admin token
let ADMIN_TOKEN = localStorage.getItem("ADMIN_TOKEN") || null;

// Base API helper
async function api(url, method = "GET", body = null) {
    const opts = { method, headers: { "Content-Type": "application/json" } };

    if (ADMIN_TOKEN) {
        opts.headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
    }

    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    return await res.json();
}

// Chart instances
let chartDevices = null;
let chartRequests = null;


/* ============================================================
   LOGIN SYSTEM
   ============================================================ */

async function loginAdmin() {
    const key = document.getElementById("admin-key-input").value.trim();
    const loginError = document.getElementById("login-error");

    if (!key) {
        loginError.innerText = "Admin key is required.";
        loginError.classList.remove("hidden");
        return;
    }

    // Test the key
    const test = await fetch("/api/admin/data", {
        headers: { Authorization: `Bearer ${key}` }
    });

    if (test.status === 401) {
        loginError.innerText = "Invalid Admin Key";
        loginError.classList.remove("hidden");
        return;
    }

    // Success
    ADMIN_TOKEN = key;
    localStorage.setItem("ADMIN_TOKEN", key);

    loginError.classList.add("hidden");
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("admin-panel").classList.remove("hidden");

    switchTab("dashboard");
}

function logoutAdmin() {
    ADMIN_TOKEN = null;
    localStorage.removeItem("ADMIN_TOKEN");

    document.getElementById("admin-panel").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
}


/* ============================================================
   TAB SWITCHING
   ============================================================ */
function switchTab(tab) {
    document.querySelectorAll(".admin-section").forEach(sec => sec.style.display = "none");
    document.getElementById(`section-${tab}`).style.display = "block";

    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`nav-${tab}`).classList.add("active");
}


/* ============================================================
   CHART RENDERERS
   ============================================================ */

function renderDeviceChart(requests) {
    const counts = { Mobile: 0, Desktop: 0, Tablet: 0 };

    requests.forEach(r => {
        counts[r.device_type] = (counts[r.device_type] || 0) + 1;
    });

    if (chartDevices) chartDevices.destroy();

    chartDevices = new Chart(document.getElementById("chart-devices"), {
        type: "doughnut",
        data: {
            labels: ["Mobile", "Desktop", "Tablet"],
            datasets: [{
                data: [counts.Mobile, counts.Desktop, counts.Tablet],
                backgroundColor: ["#3b82f6", "#16a34a", "#a855f7"],
                borderWidth: 0
            }]
        }
    });
}

function renderRequestsChart(requests) {
    const hours = new Array(24).fill(0);

    requests.forEach(r => {
        const hour = new Date(r.created_at).getHours();
        hours[hour]++;
    });

    if (chartRequests) chartRequests.destroy();

    chartRequests = new Chart(document.getElementById("chart-requests"), {
        type: "line",
        data: {
            labels: hours.map((_, i) => `${i}:00`),
            datasets: [{
                label: "Requests Per Hour",
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

    document.getElementById("mon-uptime").innerText = m.uptime_str;
    document.getElementById("mon-rps").innerText = m.requests_per_second.toFixed(3);
    document.getElementById("mon-eventlag").innerText = m.event_loop_lag_ms + " ms";
    document.getElementById("mon-latency").innerText = m.avg_api_latency_ms + " ms";

    document.getElementById("mon-ram").innerText =
        (m.system.memory.used / 1024 / 1024).toFixed(1) +
        "MB / " +
        (m.system.memory.total / 1024 / 1024).toFixed(1) + "MB";

    document.getElementById("mon-cpu").innerText = m.system.cpu.toFixed(2);

    document.getElementById("mon-google").innerText =
        `${m.external_ping.google.status} (${m.external_ping.google.ping || "X"} ms)`;
    document.getElementById("mon-cloudflare").innerText =
        `${m.external_ping.cloudflare.status} (${m.external_ping.cloudflare.ping || "X"} ms)`;
    document.getElementById("mon-twitter").innerText =
        `${m.external_ping.twitter.status} (${m.external_ping.twitter.ping || "X"} ms)`;
}


/* ============================================================
   LOAD ADMIN DATA
   ============================================================ */

async function loadAdminData() {
    const data = await api("/api/admin/data");

    if (!data.success) return alert("Invalid admin token!");

    document.getElementById("stat-total-requests").innerText =
        data.stats.total_requests || 0;

    document.getElementById("stat-total-videos").innerText =
        data.stats.total_videos || 0;

    renderDeviceChart(data.requests);
    renderRequestsChart(data.requests);

    // Requests table
    const reqT = document.getElementById("table-requests");
    reqT.innerHTML = "";
    data.requests.slice(-100).reverse().forEach(r => {
        reqT.innerHTML += `
            <tr>
                <td>${r.ip_address}</td>
                <td>${r.device_type}</td>
                <td>${r.browser}</td>
                <td>${r.platform}</td>
                <td>${r.twitter_url || "-"}</td>
                <td>${new Date(r.created_at).toLocaleString()}</td>
            </tr>`;
    });

    // Videos table
    const vidT = document.getElementById("table-videos");
    vidT.innerHTML = "";
    data.videos.slice(-100).reverse().forEach(v => {
        vidT.innerHTML += `
            <tr>
                <td>${v.tweet_id}</td>
                <td>${v.author}</td>
                <td>${v.total_downloads}</td>
                <td>${v.tweet_date}</td>
            </tr>`;
    });
}


/* ============================================================
   ADMIN ACTIONS (MERGED FROM admin-api.js)
   ============================================================ */

async function banIP() {
    const ip = document.getElementById("ban-ip-input").value.trim();
    if (!ip) return alert("Enter IP");

    const r = await api("/api/admin/ban", "POST", { ip });
    alert(r.success ? "Banned!" : r.error);
}

async function resetStats() {
    if (!confirm("Reset ALL stats?")) return;
    await api("/api/admin/reset-stats", "POST", {});
    alert("Stats Reset");
    loadAdminData();
}

async function clearRequests() {
    if (!confirm("Delete ALL request logs?")) return;
    await api("/api/admin/clear-requests", "POST", {});
    alert("Requests cleared");
    loadAdminData();
}

async function clearVideos() {
    if (!confirm("Delete ALL video logs?")) return;
    await api("/api/admin/clear-videos", "POST", {});
    alert("Videos cleared");
    loadAdminData();
}

async function loadLogs() {
    const r = await api("/api/admin/logs");
    const logsBox = document.getElementById("logs-box");
    logsBox.innerHTML = "";

    (r.logs || []).forEach(line => {
        logsBox.innerHTML += `<div class="log-line">${line}</div>`;
    });
}


/* ============================================================
   INIT
   ============================================================ */

window.onload = () => {
    if (!ADMIN_TOKEN) {
        document.getElementById("login-screen").style.display = "flex";
        document.getElementById("admin-panel").style.display = "none";
        return;
    }

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("admin-panel").style.display = "block";

    loadAdminData();
    loadMonitoring();
    loadLogs();

    switchTab("dashboard");
};

// Auto refresh monitoring
setInterval(loadMonitoring, 1000);
