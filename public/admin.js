/* ============================================================
   M2H ADMIN PANEL — FRONTEND LOGIC (SPA)
   ============================================================ */

console.log("Admin UI Loaded");

// GLOBAL TOKEN PROVIDED BY admin-api.js
// DO NOT REDECLARE ADMIN_TOKEN HERE

// HTML ELEMENTS
const loginScreen = document.getElementById("login-screen");
const adminPanel = document.getElementById("admin-panel");
const pageTitle = document.getElementById("page-title");


// ============================================================
// ADMIN UI CONTROLLER  (Global)
// ============================================================
const AdminUI = {

  switchTab(tabId) {
    console.log("Switching to:", tabId);

    // Hide all tabs
    document.querySelectorAll(".tab-page").forEach(tab =>
      tab.classList.add("hidden")
    );

    // Show active tab
    const tab = document.getElementById(`tab-${tabId}`);
    if (tab) {
      tab.classList.remove("hidden");
    }

    // Sidebar active button
    document.querySelectorAll(".nav-item").forEach(btn =>
      btn.classList.remove("active")
    );
    const activeBtn = document.querySelector(
      `button[onclick="AdminUI.switchTab('${tabId}')"]`
    );
    if (activeBtn) activeBtn.classList.add("active");

    // Update page title
    pageTitle.innerText =
      tabId.charAt(0).toUpperCase() + tabId.slice(1);

    // Load dynamic content
    if (tabId === "dashboard") loadDashboard();
    if (tabId === "videos") loadVideos();
    if (tabId === "requests") loadRequests();
    if (tabId === "logs") loadLogs();

    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("hidden-sidebar");
  },

  toggleTheme() {
    document.documentElement.classList.toggle("light");
  }
};


// ============================================================
// LOGIN UI HANDLER (uses AdminAPI.login)
// ============================================================
async function doLogin() {
  await AdminAPI.login();
}


// ============================================================
// LOAD DASHBOARD
// ============================================================
async function loadDashboard() {
  console.log("Loading dashboard...");

  const res = await fetch("/api/admin/data", {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();
  const stats = data.stats;
  const requests = data.requests;

  // Basic stats
  document.getElementById("stat-total-requests").innerText =
    stats.total_requests;

  document.getElementById("stat-total-videos").innerText =
    stats.total_videos;

  const uniqueIPs = new Set(requests.map(r => r.ip_address));
  document.getElementById("stat-unique-ips").innerText =
    uniqueIPs.size;

  loadDeviceChart(requests);
  loadRequestsChart(requests);
}


// ============================================================
// DEVICE ANALYTICS CHART
// ============================================================
function loadDeviceChart(requests) {
  const counts = { Mobile: 0, Desktop: 0, Tablet: 0 };

  requests.forEach(r => {
    if (counts[r.device_type] !== undefined) {
      counts[r.device_type]++;
    }
  });

  new Chart(document.getElementById("chart-devices"), {
    type: "doughnut",
    data: {
      labels: ["Mobile", "Desktop", "Tablet"],
      datasets: [
        {
          data: [counts.Mobile, counts.Desktop, counts.Tablet],
          backgroundColor: ["#3b82f6", "#16a34a", "#a855f7"],
          borderWidth: 0
        }
      ]
    }
  });
}


// ============================================================
// REQUEST ANALYTICS CHART
// ============================================================
function loadRequestsChart(requests) {
  const hours = new Array(24).fill(0);

  requests.forEach(r => {
    try {
      const d = new Date(r.created_at);
      hours[d.getHours()]++;
    } catch {}
  });

  new Chart(document.getElementById("chart-requests"), {
    type: "line",
    data: {
      labels: hours.map((_, i) => `${i}:00`),
      datasets: [
        {
          label: "Requests per Hour",
          data: hours,
          fill: false,
          borderColor: "#3b82f6",
          tension: 0.25
        }
      ]
    }
  });
}


// ============================================================
// LOAD VIDEOS TAB
// ============================================================
async function loadVideos() {
  const res = await fetch("/api/admin/data", {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();
  const videos = data.videos;

  const container = document.getElementById("videos-list");
  container.innerHTML = "";

  videos.sort((a, b) => b.total_downloads - a.total_downloads);

  videos.forEach(v => {
    container.innerHTML += `
      <div class="glass-card p-4">
        <img src="${v.thumbnail_url || "/placeholder.png"}"
             class="rounded w-full h-40 object-cover mb-3">

        <h3 class="font-bold">${v.author}</h3>
        <p class="text-sm opacity-70">${v.tweet_text.slice(0, 90)}...</p>

        <div class="mt-3 flex justify-between items-center">
          <span class="text-blue-400 font-bold">${v.total_downloads} downloads</span>
          <a href="https://twitter.com/i/status/${v.tweet_id}"
             class="text-sm text-blue-300 underline"
             target="_blank">View</a>
        </div>
      </div>
    `;
  });
}


// ============================================================
// LOAD REQUESTS TAB
// ============================================================
async function loadRequests() {
  const res = await fetch("/api/admin/data", {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();
  const container = document.getElementById("requests-table-body");

  container.innerHTML = data.requests
    .map(
      r => `
      <tr>
        <td>${r.ip_address}</td>
        <td>${r.device_type}</td>
        <td>${r.browser}</td>
        <td>${r.platform}</td>
        <td>${r.endpoint}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>
    `
    )
    .join("");
}


// ============================================================
// LOAD LOGS TAB
// ============================================================
async function loadLogs() {
  const res = await fetch("/api/admin/logs", {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();
  document.getElementById("logs-output").innerText =
    data.logs.join("\n");
}


// ============================================================
// MAKE AdminUI GLOBAL (THIS FIXES YOUR ERRORS)
// ============================================================
window.AdminUI = AdminUI;
