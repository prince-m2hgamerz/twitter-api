/**********************************************************************
 * M2H Twitter Video API - Advanced Monitoring Engine
 * Version: 3.0
 * Author: @m2hgamerz
 **********************************************************************/

const os = require("os");
const { performance } = require("perf_hooks");
const axios = require("axios");

// -------------------------------------------------------------------
// STATE STORAGE
// -------------------------------------------------------------------
let totalRequests = 0;
let lastMinuteRequests = [];
let lastErrors = [];
let apiLatencies = [];
let startTime = Date.now();

// -------------------------------------------------------------------
// EVENT LOOP LAG DETECTION
// -------------------------------------------------------------------
let eventLoopLag = 0;

function monitorEventLoop() {
  const start = performance.now();
  setImmediate(() => {
    const end = performance.now();
    eventLoopLag = end - start;
  });
}

setInterval(monitorEventLoop, 1000);


// -------------------------------------------------------------------
// API LATENCY TRACKER
// -------------------------------------------------------------------
function trackLatency(ms) {
  apiLatencies.push(ms);
  if (apiLatencies.length > 1000) apiLatencies.shift();
}


// -------------------------------------------------------------------
// REQUEST RATE (RPS)
// -------------------------------------------------------------------
function trackRequest() {
  const now = Date.now();
  lastMinuteRequests.push(now);
  totalRequests++;

  lastMinuteRequests = lastMinuteRequests.filter(
    ts => now - ts <= 60_000
  );
}

function getRPS() {
  return lastMinuteRequests.length / 60;
}


// -------------------------------------------------------------------
// MEMORY + CPU STATS
// -------------------------------------------------------------------
function getSystemStats() {
  return {
    memory: {
      total: os.totalmem(),
      used: os.totalmem() - os.freemem(),
      free: os.freemem()
    },
    cpu: os.loadavg()[0] // 1-minute CPU load average
  };
}


// -------------------------------------------------------------------
// PING FUNCTION
// -------------------------------------------------------------------
async function pingUrl(url) {
  try {
    const s = performance.now();
    await axios.get(url, { timeout: 3000 });
    const ms = performance.now() - s;
    return { status: "online", ping: ms };
  } catch {
    return { status: "offline", ping: null };
  }
}


// -------------------------------------------------------------------
// MAIN UPTIME DATA BUILDER
// -------------------------------------------------------------------
async function getMonitoringData() {
  const now = Date.now();

  return {
    uptime_ms: now - startTime,
    uptime_str: formatUptime(now - startTime),

    event_loop_lag_ms: Number(eventLoopLag.toFixed(2)),
    requests_per_second: Number(getRPS().toFixed(3)),
    total_requests_tracked: totalRequests,

    avg_api_latency_ms:
      apiLatencies.length === 0
        ? 0
        : Number(
            (
              apiLatencies.reduce((a, b) => a + b, 0) /
              apiLatencies.length
            ).toFixed(2)
          ),

    external_ping: {
      google: await pingUrl("https://www.google.com"),
      cloudflare: await pingUrl("https://1.1.1.1"),
      twitter: await pingUrl("https://twitter.com")
    },

    system: getSystemStats(),

    last_errors: lastErrors.slice(-10)
  };
}


// -------------------------------------------------------------------
// ERROR TRACKER
// -------------------------------------------------------------------
function logError(err) {
  lastErrors.push({
    message: err.message || err.toString(),
    time: new Date().toISOString()
  });

  if (lastErrors.length > 50) lastErrors.shift();
}


// -------------------------------------------------------------------
// UPTIME FORMATTER
// -------------------------------------------------------------------
function formatUptime(ms) {
  let sec = Math.floor(ms / 1000);
  let min = Math.floor(sec / 60);
  let hr = Math.floor(min / 60);
  let day = Math.floor(hr / 24);

  sec %= 60;
  min %= 60;
  hr %= 24;

  return `${day}d ${hr}h ${min}m ${sec}s`;
}


// -------------------------------------------------------------------
// EXPORTS
// -------------------------------------------------------------------
module.exports = {
  trackRequest,
  trackLatency,
  logError,
  getMonitoringData
};
