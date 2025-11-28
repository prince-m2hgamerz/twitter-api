/* ============================================================
   M2H ADMIN PANEL — API LAYER
   Handles all backend requests securely
   ============================================================ */

console.log("Admin API Loaded");

// GLOBAL ADMIN TOKEN (shared with admin.js)
let ADMIN_TOKEN = null;

// Make available to admin.js
window.setAdminToken = function (token) {
  ADMIN_TOKEN = token;
};


/* ============================================================
   API BASE CONFIG
   ============================================================ */

const AdminAPI = {

  // --------------------------------------
  // LOGIN
  // --------------------------------------
  async login() {
    const key = document.getElementById("admin-key-input").value.trim();
    const loginError = document.getElementById("login-error");

    if (!key) {
      loginError.innerText = "Admin key is required.";
      loginError.classList.remove("hidden");
      return;
    }

    // Test the key by calling a protected route
    const test = await fetch("/api/admin/data", {
      headers: { Authorization: `Bearer ${key}` }
    });

    if (test.status === 401) {
      loginError.innerText = "Invalid Admin Key";
      loginError.classList.remove("hidden");
      return;
    }

    // Login success
    ADMIN_TOKEN = key;
    window.setAdminToken(key);

    loginError.classList.add("hidden");

    // Hide login screen, show panel
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("admin-panel").classList.remove("hidden");

    AdminUI.switchTab("dashboard");
  },


  // --------------------------------------
  // LOGOUT
  // --------------------------------------
  logout() {
    ADMIN_TOKEN = null;

    document.getElementById("admin-panel").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");

    document.getElementById("admin-key-input").value = "";
  },


  // --------------------------------------
  // FETCH FULL ADMIN DATA
  // --------------------------------------
  async getData() {
    const res = await fetch("/api/admin/data", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    return await res.json();
  },


  // --------------------------------------
  // BAN IP
  // --------------------------------------
  async banIP() {
    const ipInput = document.getElementById("ban-ip-input");
    const ip = ipInput.value.trim();
    const status = document.getElementById("ban-status");

    if (!ip) {
      alert("Enter IP address");
      return;
    }

    const res = await fetch("/api/admin/ban", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ip })
    });

    const data = await res.json();

    if (data.success) {
      status.innerText = "IP Banned Successfully";
      status.classList.remove("hidden");
      setTimeout(() => status.classList.add("hidden"), 3000);
      ipInput.value = "";
    } else {
      alert("Error: " + data.error);
    }
  },


  // --------------------------------------
  // RESET STATISTICS
  // --------------------------------------
  async resetStats() {
    if (!confirm("Reset ALL statistics?")) return;

    const res = await fetch("/api/admin/reset-stats", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const data = await res.json();
    if (data.success) {
      alert("Statistics Reset");
      AdminUI.switchTab("dashboard");
    }
  },


  // --------------------------------------
  // CLEAR ALL REQUESTS
  // --------------------------------------
  async clearRequests() {
    if (!confirm("Delete ALL request logs?")) return;

    const res = await fetch("/api/admin/clear-requests", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const data = await res.json();
    if (data.success) {
      alert("All requests cleared.");
      AdminUI.switchTab("requests");
    }
  },


  // --------------------------------------
  // CLEAR ALL VIDEOS
  // --------------------------------------
  async clearVideos() {
    if (!confirm("Delete ALL video records?")) return;

    const res = await fetch("/api/admin/clear-videos", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const data = await res.json();
    if (data.success) {
      alert("All videos cleared.");
      AdminUI.switchTab("videos");
    }
  },


  // --------------------------------------
  // GET LOGS
  // --------------------------------------
  async getLogs() {
    const res = await fetch("/api/admin/logs", {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const data = await res.json();
    return data.logs || [];
  }
};


// ============================================================
// MAKE AdminAPI GLOBAL (required for HTML onclick)
// ============================================================
window.AdminAPI = AdminAPI;
