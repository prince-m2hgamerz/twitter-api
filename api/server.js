/********************************************************************
 * M2H Twitter Video API — SERVER v3.0 (Ultimate Edition)
 * With Full Monitoring + Supabase + Admin Panel + Twitsave Engine
 * Author: @m2hgamerz
 ********************************************************************/

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const userAgent = require("user-agents");
const { createClient } = require("@supabase/supabase-js");

const Monitor = require("./monitor.js"); // 🟦 Monitoring Module

const app = express();
const PUBLIC = path.join(__dirname, "../public");

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// -------------------------------------------------------------------------------
// DEV METADATA (added to every response)
// -------------------------------------------------------------------------------
function devInfo(extra = {}) {
  return {
    developer: "@m2hgamerz",
    telegram: "https://t.me/m2hgamerz",
    github: "prince-m2hgamerz",
    api_version: "3.0",
    timestamp: new Date().toISOString(),
    ping_ms: extra._ping || undefined,
    ...extra
  };
}


// -------------------------------------------------------------------------------
// BAN SYSTEM (Global check before all endpoints)
// -------------------------------------------------------------------------------
app.use(async (req, res, next) => {
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.ip ||
      "unknown";

    const { data } = await supabase
      .from("bans")
      .select("*")
      .eq("ip_address", ip)
      .maybeSingle();

    if (data) {
      return res.status(403).json(
        devInfo({
          success: false,
          error: "Your IP has been banned."
        })
      );
    }
  } catch {}

  next();
});


// -------------------------------------------------------------------------------
// GLOBAL REQUEST MONITORING
// -------------------------------------------------------------------------------
app.use(async (req, res, next) => {
  Monitor.trackRequest();
  next();
});


// -------------------------------------------------------------------------------
// Supabase Request Logging
// -------------------------------------------------------------------------------
function getClientInfo(req) {
  const ua = req.headers["user-agent"] || "Unknown";

  return {
    ip_address:
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.ip ||
      "unknown",

    user_agent: ua,
    device_type: ua.includes("Mobile")
      ? "Mobile"
      : ua.includes("Tablet")
      ? "Tablet"
      : "Desktop",

    browser: ua.includes("Firefox")
      ? "Firefox"
      : ua.includes("Chrome")
      ? "Chrome"
      : ua.includes("Safari")
      ? "Safari"
      : "Other",

    platform: ua.includes("Windows")
      ? "Windows"
      : ua.includes("Android")
      ? "Android"
      : ua.includes("Mac")
      ? "Mac"
      : "Other"
  };
}

async function logRequest(req, url, endpoint) {
  const info = getClientInfo(req);

  await supabase.from("requests").insert({
    ...info,
    twitter_url: url,
    endpoint
  });
}


// -------------------------------------------------------------------------------
// Twitsave functions
// -------------------------------------------------------------------------------
function getTwitsaveHeaders() {
  return {
    "user-agent": new userAgent().toString(),
    accept: "*/*"
  };
}

function getTweetId(url) {
  return url.match(/status\/(\d+)/)?.[1] || null;
}

function parseTwitsave(html, url) {
  const $ = cheerio.load(html);

  const result = {
    tweetInfo: {
      author: $('a[href*="twitter.com"]').first().text().trim(),
      text: $("p.m-2").text().trim(),
      date: $("a.text-xs").first().text().trim()
    },
    downloadLinks: [],
    thumbnail: $("video").attr("poster") || null,
    preview: $("video").attr("src") || null
  };

  $("a[href*='/download?file=']").each((i, el) => {
    result.downloadLinks.push({
      url: "https://twitsave.com" + $(el).attr("href"),
      type: "mp4"
    });
  });

  return result;
}


// -------------------------------------------------------------------------------
// Save Video to Supabase
// -------------------------------------------------------------------------------
async function storeVideo(tweetId, parsed) {
  const exists = await supabase
    .from("videos")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (exists.data) {
    await supabase
      .from("videos")
      .update({
        total_downloads: exists.data.total_downloads + 1,
        last_fetched: new Date()
      })
      .eq("tweet_id", tweetId);
  } else {
    await supabase.from("videos").insert({
      tweet_id: tweetId,
      author: parsed.tweetInfo.author,
      tweet_text: parsed.tweetInfo.text,
      tweet_date: parsed.tweetInfo.date,
      thumbnail_url: parsed.thumbnail,
      total_downloads: 1
    });

    await supabase.rpc("increment_stat", { field_name: "total_videos" });
  }
}


// -------------------------------------------------------------------------------
// STATIC ROUTES (SPA)
// -------------------------------------------------------------------------------
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/admin", (_, res) => res.sendFile(path.join(PUBLIC, "admin.html")));
app.get("/docs", (_, res) => res.sendFile(path.join(PUBLIC, "docs.html")));
app.get("/playground", (_, res) => res.sendFile(path.join(PUBLIC, "playground.html")));


// -------------------------------------------------------------------------------
// /api/download
// -------------------------------------------------------------------------------
app.get("/api/download", async (req, res) => {
  const start = Date.now();

  try {
    const { url } = req.query;

    if (!url) {
      return res.json(
        devInfo({
          success: false,
          error: "Twitter URL required"
        })
      );
    }

    await logRequest(req, url, "/api/download");

    const tweetId = getTweetId(url);
    if (!tweetId) {
      return res.json(
        devInfo({
          success: false,
          error: "Invalid tweet URL"
        })
      );
    }

    const html = await axios.get(
      `https://twitsave.com/info?url=${encodeURIComponent(url)}`,
      { headers: getTwitsaveHeaders() }
    );

    const parsed = parseTwitsave(html.data, url);

    if (!parsed.downloadLinks.length) {
      return res.json(
        devInfo({
          success: false,
          error: "No downloadable videos found"
        })
      );
    }

    await storeVideo(tweetId, parsed);

    const latency = Date.now() - start;
    Monitor.trackLatency(latency);

    return res.json(
      devInfo({
        success: true,
        tweetId,
        ...parsed,
        _ping: latency
      })
    );
  } catch (e) {
    Monitor.logError(e);

    return res.json(
      devInfo({
        success: false,
        error: e.message
      })
    );
  }
});


// -------------------------------------------------------------------------------
// API STATS
// -------------------------------------------------------------------------------
app.get("/api/stats", async (req, res) => {
  const { data: stats } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const videos = await supabase.from("videos").select("*");
  const reqs = await supabase.from("requests").select("*");

  res.json(
    devInfo({
      success: true,
      statistics: {
        totalRequests: stats?.total_requests || 0,
        totalVideos: stats?.total_videos || 0,
        uniqueIPs: new Set(reqs.data?.map(r => r.ip_address)).size,
        memoryUsage: process.memoryUsage()
      }
    })
  );
});


// -------------------------------------------------------------------------------
// FULL HEALTH CHECK + MONITORING DATA
// -------------------------------------------------------------------------------
app.get("/api/health-full", async (req, res) => {
  const start = Date.now();
  const monitor = await Monitor.getMonitoringData();
  const latency = Date.now() - start;

  res.json(
    devInfo({
      success: true,
      health: "OK",
      monitor,
      _ping: latency
    })
  );
});


// -------------------------------------------------------------------------------
// SIMPLE UPTIME
// -------------------------------------------------------------------------------
app.get("/api/uptime", async (req, res) => {
  const monitor = await Monitor.getMonitoringData();

  res.json(
    devInfo({
      success: true,
      uptime: monitor.uptime_str,
      system: monitor.system,
      event_loop_lag_ms: monitor.event_loop_lag_ms
    })
  );
});


// -------------------------------------------------------------------------------
// PING
// -------------------------------------------------------------------------------
app.get("/api/ping", (req, res) => {
  const start = Date.now();
  const ping = Date.now() - start;

  res.json(
    devInfo({
      success: true,
      ping_ms: ping
    })
  );
});


// -------------------------------------------------------------------------------
// ADMIN AUTH MIDDLEWARE
// -------------------------------------------------------------------------------
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token || token !== process.env.ADMIN_KEY) {
    return res.status(401).json(
      devInfo({
        success: false,
        error: "Unauthorized"
      })
    );
  }

  next();
}


// -------------------------------------------------------------------------------
// ADMIN: FULL DATA
// -------------------------------------------------------------------------------
app.get("/api/admin/data", adminAuth, async (req, res) => {
  const stats = await supabase.from("stats").select("*").eq("id", 1).maybeSingle();
  const videos = await supabase.from("videos").select("*");
  const requests = await supabase.from("requests").select("*");
  const monitor = await Monitor.getMonitoringData();

  res.json(
    devInfo({
      success: true,
      stats: stats.data,
      videos: videos.data,
      requests: requests.data,
      monitor
    })
  );
});


// -------------------------------------------------------------------------------
// ADMIN: BAN
// -------------------------------------------------------------------------------
app.post("/api/admin/ban", adminAuth, async (req, res) => {
  const { ip } = req.body;

  if (!ip)
    return res.json(devInfo({ success: false, error: "IP required" }));

  await supabase.from("bans").insert({ ip_address: ip });

  res.json(devInfo({ success: true, message: "IP banned" }));
});


// -------------------------------------------------------------------------------
// ADMIN: RESET STATS
// -------------------------------------------------------------------------------
app.post("/api/admin/reset-stats", adminAuth, async (req, res) => {
  await supabase
    .from("stats")
    .update({ total_requests: 0, total_videos: 0 })
    .eq("id", 1);

  res.json(devInfo({ success: true }));
});


// -------------------------------------------------------------------------------
// ADMIN: CLEAR REQUESTS
// -------------------------------------------------------------------------------
app.post("/api/admin/clear-requests", adminAuth, async (req, res) => {
  await supabase.from("requests").delete().neq("id", 0);

  res.json(devInfo({ success: true }));
});


// -------------------------------------------------------------------------------
// ADMIN: CLEAR VIDEOS
// -------------------------------------------------------------------------------
app.post("/api/admin/clear-videos", adminAuth, async (req, res) => {
  await supabase.from("videos").delete().neq("id", 0);
  await supabase.from("stats").update({ total_videos: 0 }).eq("id", 1);

  res.json(devInfo({ success: true }));
});


// -------------------------------------------------------------------------------
// ADMIN: LOGS
// -------------------------------------------------------------------------------
app.get("/api/admin/logs", adminAuth, async (req, res) => {
  const { data } = await supabase
    .from("logs")
    .select("*")
    .order("id", { ascending: false })
    .limit(100);

  res.json(
    devInfo({
      success: true,
      logs: data
        ? data.map(l => `[${l.created_at}] ${l.message}`)
        : []
    })
  );
});


// -------------------------------------------------------------------------------
// GLOBAL HEALTH
// -------------------------------------------------------------------------------
app.get("/health", (_, res) => {
  res.json(
    devInfo({
      success: true,
      status: "OK"
    })
  );
});


// -------------------------------------------------------------------------------
// LOCAL SERVER
// -------------------------------------------------------------------------------
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () =>
    console.log("🔥 Local Server: http://localhost:3000")
  );
}

module.exports = app;
