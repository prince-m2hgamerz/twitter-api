/* ============================================================
   M2H ADMIN PANEL — FRONTEND LOGIC (SPA)
   ============================================================ */

console.log("Admin UI Loaded");

// GLOBAL STATE
let ADMIN_TOKEN = null;

// HTML ELEMENTS
const loginScreen = document.getElementById("login-screen");
const adminPanel = document.getElementById("admin-panel");
const pageTitle = document.getElementById("page-title");


// ------------------------------------------------------------
//  ADMIN UI CONTROLLER
// ------------------------------------------------------------
const AdminUI = {

  switchTab(tabId) {
    // Hide all tabs
    document.querySelectorAll(".tab-page").forEach(tab => tab.classList.add("hidden"));

    // Activate selected tab
    document.getElementById(`tab-${tabId}`).classList.remove("hidden");

    // Update sidebar active state
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    document.querySelector(`button[onclick="AdminUI.switchTab('${tabId}')"]`).classList.add("active");

    // Update title
    pageTitle.innerText = tabId.charAt(0).toUpperCase() + tabId.slice(1);

    // Load dynamic data
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


// ------------------------------------------------------------
// ADMIN API HANDLER
// ------------------------------------------------------------
const AdminAPI = {

  login() {
    const key = document.getElementById("admin-key-input").value.trim();
    if (!key) return;

    ADMIN_TOKEN = key;

    // Try loading stats to validate
    fetch("/api/admin/data", {
      headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
    })
    .then(res => {
      if (!res.ok) throw new Error("Invalid Key");
      return res.json();
    })
    .then(() => {
      loginScreen.classList.add("hidden");
      adminPanel.classList.remove("hidden");
      AdminUI.switchTab("dashboard");
    })
    .catch(() => {
      document.getElementById("login-error").classList.remove("hidden");
    });
  },

  logout() {
    ADMIN_TOKEN = null;
    adminPanel.classList.add("hidden");
    loginScreen.classList.remove("hidden");
  },

  /* BAN IP */
  banIP() {
    const ip = document.getElementById("ban-ip-input").value.trim();
    if (!ip) return;

    fetch("/api/admin/ban", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ip })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        document.getElementById("ban-status").classList.remove("hidden");
        setTimeout(() => {
          document.getElementById("ban-status").classList.add("hidden");
        }, 2000);
      }
    });
  },

  /* RESET STATS */
  resetStats() {
    if (!confirm("Are you sure you want to reset all statistics?")) return;

    fetch("/api/admin/reset-stats", {
      method: "POST",
      headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
    });

    alert("Statistics Reset!");
    loadDashboard();
  },

  clearRequests() {
    if (!confirm("Delete ALL API Requests?")) return;

    fetch("/api/admin/clear-requests", {
      method: "POST",
      headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
    });

    alert("All requests cleared!");
    loadRequests();
  },

  clearVideos() {
    if (!confirm("Delete ALL Video Records?")) return;

    fetch("/api/admin/clear-videos", {
      method: "POST",
      headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
    });

    alert("All video records cleared!");
    loadVideos();
  }
};


// ------------------------------------------------------------
// LOAD DASHBOARD DATA
// ------------------------------------------------------------
async function loadDashboard() {

  const res = await fetch("/api/admin/data", {
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();

  const stats = data.stats;
  const videos = data.videos;
  const requests = data.requests;

  document.getElementById("stat-total-requests").innerText = stats.total_requests;
  document.getElementById("stat-total-videos").innerText = stats.total_videos;

  // Unique IP Count
  const uniqueIPs = new Set(requests.map(r => r.ip_address));
  document.getElementById("stat-unique-ips").innerText = uniqueIPs.size;

  loadDeviceChart(requests);
  loadRequestsChart(requests);
}


// ------------------------------------------------------------
// DEVICE ANALYTICS CHART
// ------------------------------------------------------------
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
      datasets: [{
        data: [counts.Mobile, counts.Desktop, counts.Tablet],
        backgroundColor: ["#3b82f6", "#22c55e", "#a855f7"],
        borderWidth: 0
      }]
    }
  });
}


// ------------------------------------------------------------
// HOURLY REQUESTS CHART
// ------------------------------------------------------------
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
      labels: hours.map((_, i) => i + ":00"),
      datasets: [{
        label: "Requests per Hour",
        data: hours,
        fill: false,
        borderColor: "#3b82f6",
        tension: 0.25
      }]
    }
  });
}


// ------------------------------------------------------------
// LOAD VIDEOS PAGE
// ------------------------------------------------------------
async function loadVideos() {
  const res = await fetch("/api/admin/data", {
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();

  const videos = data.videos;

  const container = document.getElementById("videos-list");
  container.innerHTML = "";

  videos.sort((a, b) => b.total_downloads - a.total_downloads);

  videos.forEach(v => {
    container.innerHTML += `
      <div class="glass-card p-4">
        <img src="${v.thumbnail_url || '/placeholder.png'}" 
             class="rounded w-full h-40 object-cover mb-3">

        <h3 class="font-bold">${v.author}</h3>
        <p class="text-sm opacity-70">${v.tweet_text.slice(0, 90)}...</p>

        <div class="mt-3 flex justify-between items-center">
          <span class="text-blue-400 font-bold">${v.total_downloads} downloads</span>

          <a href="https://twitter.com/i/status/${v.tweet_id}"
             target="_blank"
             class="text-sm text-blue-300 underline">
             View Tweet
          </a>
        </div>
      </div>
    `;
  });
}


// ------------------------------------------------------------
// LOAD REQUESTS
// ------------------------------------------------------------
async function loadRequests() {
  const res = await fetch("/api/admin/data", {
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();

  const rows = data.requests.map(r => `
    <tr>
      <td>${r.ip_address}</td>
      <td>${r.device_type}</td>
      <td>${r.browser}</td>
      <td>${r.platform}</td>
      <td>${r.endpoint}</td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
    </tr>
  `).join("");

  document.getElementById("requests-table-body").innerHTML = rows;
}


// ------------------------------------------------------------
// LOAD SYSTEM LOGS
// ------------------------------------------------------------
async function loadLogs() {
  const res = await fetch("/api/admin/logs", {
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
  });

  const data = await res.json();
  document.getElementById("logs-output").innerText = data.logs.join("\n");
}
