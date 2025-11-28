/* ============================================================
   M2H ADMIN PANEL — ADMIN API WRAPPER
   ============================================================ */

console.log("Admin API Loaded");

let ADMIN_TOKEN = null;

// Expose token setter so admin.js can assign it after login
window.setAdminToken = function(token) {
  ADMIN_TOKEN = token;
};


/* ============================================================
   API Request Helper
   ============================================================ */
async function apiRequest(endpoint, method = "GET", body = null) {
  if (!ADMIN_TOKEN) {
    console.error("Admin token missing!");
    return { success: false, error: "Unauthorized" };
  }

  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json"
    }
  };

  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(endpoint, options);
    return await res.json();
  } catch (err) {
    console.error("Admin API Error:", err);
    return { success: false, error: err.message };
  }
}


/* ============================================================
   MAIN ADMIN API OBJECT
   ============================================================ */
const AdminAPI = {

  /* ------------------------ LOGIN ------------------------ */
  async login() {
    const key = document.getElementById("admin-key-input").value.trim();

    if (!key) return;

    ADMIN_TOKEN = key;
    setAdminToken(key);

    try {
      const res = await fetch("/api/admin/data", {
        headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
      });

      if (!res.ok) throw new Error("Invalid Admin Key");

      document.getElementById("login-screen").classList.add("hidden");
      document.getElementById("admin-panel").classList.remove("hidden");

      AdminUI.switchTab("dashboard");

    } catch (err) {
      document.getElementById("login-error").classList.remove("hidden");
    }
  },

  /* ------------------------ LOGOUT ------------------------ */
  logout() {
    ADMIN_TOKEN = null;
    document.getElementById("admin-panel").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
  },


  /* =======================================================
                    BAN IP SYSTEM
  ======================================================= */
  async banIP() {
    const ip = document.getElementById("ban-ip-input").value.trim();
    if (!ip) return;

    const res = await apiRequest("/api/admin/ban", "POST", { ip });

    const status = document.getElementById("ban-status");

    if (res.success) {
      status.innerText = "IP Banned Successfully!";
      status.classList.remove("hidden");
      status.classList.add("text-green-400");
    } else {
      status.innerText = "Failed to Ban IP!";
      status.classList.remove("hidden");
      status.classList.add("text-red-400");
    }

    setTimeout(() => status.classList.add("hidden"), 2000);
  },


  /* =======================================================
                    RESET STATISTICS
  ======================================================= */
  async resetStats() {
    if (!confirm("Are you sure you want to RESET ALL STATS?")) return;

    await apiRequest("/api/admin/reset-stats", "POST");

    alert("Statistics Reset Successfully!");
    AdminUI.switchTab("dashboard");
  },


  /* =======================================================
                    CLEAR ALL REQUESTS
  ======================================================= */
  async clearRequests() {
    if (!confirm("Delete ALL API Requests?")) return;

    await apiRequest("/api/admin/clear-requests", "POST");

    alert("All Requests Cleared!");
    AdminUI.switchTab("requests");
  },


  /* =======================================================
                    CLEAR ALL VIDEOS
  ======================================================= */
  async clearVideos() {
    if (!confirm("Delete ALL Video Records?")) return;

    await apiRequest("/api/admin/clear-videos", "POST");

    alert("All Videos Deleted!");
    AdminUI.switchTab("videos");
  },


  /* =======================================================
                    FETCH SYSTEM LOGS
  ======================================================= */
  async getLogs() {
    return await apiRequest("/api/admin/logs", "GET");
  }
};


/* ============================================================
   MAKE AdminAPI available globally
   ============================================================ */
window.AdminAPI = AdminAPI;
