/**********************************************************************
 * M2H ADMIN DASHBOARD — Final Version
 * Real-time Monitoring + Charts + Logs + Admin Controls
 * Author: @m2hgamerz
 **********************************************************************/

// -------------------------------------------------------------------
// GLOBALS
// -------------------------------------------------------------------
const API_BASE = "";
const ADMIN_TOKEN = localStorage.getItem("ADMIN_TOKEN") || "";

// Chart instances (so we can safely destroy before re-render)
let chartDevices = null;
let chartRequests = null;

// -------------------------------------------------------------------
// HELPER: API CALL
// -------------------------------------------------------------------
async function api(url, method = "GET", body = null, auth = false) {
    const opts = { method, headers: { "Content-Type": "application/json" } };

    if (auth) opts.headers["Authorization"] = "Bearer " + ADMIN_TOKEN;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(API_BASE + url, opts);
    return await res.json();
}

// -------------------------------------------------------------------
// LOGIN SYSTEM
// -------------------------------------------------------------------
async function loginAdmin() {
    const token = document.getElementById("admin-password").value.trim();
    if (!token) return alert("Enter admin key");

    localStorage.setItem("ADMIN_TOKEN", token);
    location.reload();
}

function ensureAuth() {
    if (!ADMIN_TOKEN) {
        document.getElementById("login-screen").style.display = "flex";
        document.getElementById("admin-panel").style.display = "none";
    } else {
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-panel").style.display = "block";
    }
}

// -------------------------------------------------------------------
// UI: NAVIGATION
// -------------------------------------------------------------------
function switchTab(tab) {
    document.querySelectorAll(".admin-section").forEach(sec => sec.style.display = "none");
    document.getElementById(`section-${tab}`).style.display = "block";

    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`nav-${tab}`).classList.add("active");
}

// -------------------------------------------------------------------
// CHARTS
// -------------------------------------------------------------------
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
                label: "Requests / Hour",
                data: hours,
                borderColor: "#3b82f6",
                tension: 0.3
            }]
        }
    });
}

// -------------------------------------------------------------------
// MONITORING LIVE UPDATE
// -------------------------------------------------------------------
async function loadMonitoring() {
    const data = await api("/api/health-full");

    if (!data.success) return;

    const m = data.monitor;

    document.getElementById("mon-uptime").innerText = m.uptime_str;
    document.getElementById("mon-rps").innerText = m.requests_per_second.toFixed(3);
    document.getElementById("mon-eventlag").innerText = m.event_loop_lag_ms + " ms";
    document.getElementById("mon-latency").innerText = m.avg_api_latency_ms + " ms";

    document.getElementById("mon-google").innerText =
        m.external_ping.google.status + " (" + (m.external_ping.google.ping || "X") + " ms)";
    document.getElementById("mon-cloudflare").innerText =
        m.external_ping.cloudflare.status + " (" + (m.external_ping.cloudflare.ping || "X") + " ms)";
    document.getElementById("mon-twitter").innerText =
        m.external_ping.twitter.status + " (" + (m.external_ping.twitter.ping || "X") + " ms)";

    const memUsed = m.system.memory.used / 1024 / 1024;
    const memTotal = m.system.memory.total / 1024 / 1024;

    document.getElementById("mon-ram").innerText =
        memUsed.toFixed(1) + "MB / " + memTotal.toFixed(1) + "MB";

    document.getElementById("mon-cpu").innerText = m.system.cpu.toFixed(2);
}

// -------------------------------------------------------------------
// LOAD FULL ADMIN DATA
// -------------------------------------------------------------------
async function loadAdminData() {
    const data = await api("/api/admin/data", "GET", null, true);

    if (!data.success) return alert("Invalid admin token!");

    // Stats
    document.getElementById("stat-total-requests").innerText =
        data.stats.total_requests || 0;

    document.getElementById("stat-total-videos").innerText =
        data.stats.total_videos || 0;

    // Charts
    renderDeviceChart(data.requests);
    renderRequestsChart(data.requests);

    // Recent Requests Table
    const reqTable = document.getElementById("table-requests");
    reqTable.innerHTML = "";
    data.requests.slice(-50).reverse().forEach(r => {
        reqTable.innerHTML += `
        <tr>
            <td>${r.ip_address}</td>
            <td>${r.device_type}</td>
            <td>${r.browser}</td>
            <td>${r.platform}</td>
            <td>${r.twitter_url || "-"}</td>
            <td>${new Date(r.created_at).toLocaleString()}</td>
        </tr>`;
    });

    // Videos Table
    const vidTable = document.getElementById("table-videos");
    vidTable.innerHTML = "";
    data.videos.slice(-50).reverse().forEach(v => {
        vidTable.innerHTML += `
        <tr>
            <td>${v.tweet_id}</td>
            <td>${v.author}</td>
            <td>${v.total_downloads}</td>
            <td>${v.tweet_date}</td>
        </tr>`;
    });
}

// -------------------------------------------------------------------
// ADMIN ACTIONS
// -------------------------------------------------------------------
async function banIP() {
    const ip = prompt("Enter IP to ban:");
    if (!ip) return;

    const res = await api("/api/admin/ban", "POST", { ip }, true);
    alert(res.success ? "Banned!" : res.error);
}

async function resetStats() {
    if (!confirm("Reset stats?")) return;
    const r = await api("/api/admin/reset-stats", "POST", {}, true);
    alert("Stats reset!");
}

async function clearRequests() {
    if (!confirm("Delete all requests?")) return;
    const r = await api("/api/admin/clear-requests", "POST", {}, true);
    alert("Requests cleared!");
}

async function clearVideos() {
    if (!confirm("Delete all videos?")) return;
    const r = await api("/api/admin/clear-videos", "POST", {}, true);
    alert("Videos cleared!");
}

// -------------------------------------------------------------------
// LOAD LOGS
// -------------------------------------------------------------------
async function loadLogs() {
    const r = await api("/api/admin/logs", "GET", null, true);

    const logs = document.getElementById("logs-box");
    logs.innerHTML = "";

    (r.logs || []).forEach(line => {
        logs.innerHTML += `<div class="log-line">${line}</div>`;
    });
}

// -------------------------------------------------------------------
// AUTO-REFRESH (Monitoring only)
// -------------------------------------------------------------------
setInterval(loadMonitoring, 1000);

// -------------------------------------------------------------------
// INIT
// -------------------------------------------------------------------
window.onload = () => {
    ensureAuth();

    if (ADMIN_TOKEN) {
        loadAdminData();
        loadMonitoring();
        loadLogs();

        switchTab("dashboard");
    }
};
