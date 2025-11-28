/********************************************************************
 * M2H Twitter Video API — FINAL MERGED SERVER.JS
 * Includes:
 *  - Twitsave API
 *  - Supabase storage
 *  - Global request counter
 *  - Full Admin System
 *  - Ban System
 *  - Logs System
 *  - SPA Admin Panel support
 ********************************************************************/

// Load .env only in development
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const userAgent = require("user-agents");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PUBLIC = path.join(__dirname, "../public");

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

// ============================================================
// SUPABASE CLIENT
// ============================================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


// ============================================================
// BAN SYSTEM (Top-level middleware)
// ============================================================
app.use(async (req, res, next) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;

    const { data } = await supabase
      .from("bans")
      .select("*")
      .eq("ip_address", ip)
      .maybeSingle();

    if (data) {
      return res.status(403).json({
        success: false,
        error: "Your IP is banned from this service."
      });
    }
  } catch {}

  next();
});


// ============================================================
// GLOBAL REQUEST COUNTER — EVERY REQUEST UPDATES total_requests
// ============================================================
app.use(async (req, res, next) => {
  try {
    await supabase.rpc("increment_stat", { field_name: "total_requests" });
  } catch (e) {
    console.log("Request Counter Error:", e.message);
  }
  next();
});


// ============================================================
// CLIENT INFO PARSER
// ============================================================
function getClientInfo(req) {
  const ua = req.headers["user-agent"] || "Unknown";

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.headers["x-real-ip"] ||
    req.ip ||
    "unknown";

  let device_type = "Desktop";
  if (ua.includes("Mobile")) device_type = "Mobile";
  if (ua.includes("Tablet")) device_type = "Tablet";

  let browser = "Unknown";
  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";

  let platform = "Unknown";
  if (ua.includes("Windows")) platform = "Windows";
  else if (ua.includes("Mac")) platform = "Mac";
  else if (ua.includes("Linux")) platform = "Linux";
  else if (ua.includes("Android")) platform = "Android";
  else if (ua.includes("iPhone")) platform = "iOS";

  return { ip_address: ip, user_agent: ua, device_type, browser, platform };
}


// ============================================================
// LOG REQUEST
// ============================================================
async function logRequest(req, url, endpoint) {
  const info = getClientInfo(req);

  await supabase.from("requests").insert({
    ...info,
    twitter_url: url,
    endpoint
  });
}


// ============================================================
// TWITSAVE HELPERS
// ============================================================
function getTwitsaveHeaders() {
  return {
    "user-agent": new userAgent().toString(),
    accept: "*/*",
    "cache-control": "no-cache"
  };
}

function getTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

function extractDownloadLinksFromTwitsave(html, url) {
  const $ = cheerio.load(html);

  const result = {
    success: true,
    twitterUrl: url,
    tweetInfo: {},
    downloadLinks: [],
    thumbnail: $("video").attr("poster") || null,
    videoPreview: $("video").attr("src") || null
  };

  result.tweetInfo = {
    author: $('a[href*="twitter.com"]').first().text().trim(),
    text: $("p.m-2").text().trim(),
    date: $("a.text-xs").first().text().trim()
  };

  $("a[href*='/download?file=']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).find(".truncate").text().trim();
    const res = text.match(/(\d+x\d+)/)?.[1] || "unknown";

    result.downloadLinks.push({
      url: "https://twitsave.com" + href,
      resolution: res,
      type: "mp4"
    });
  });

  result.totalVideosFound = result.downloadLinks.length;
  return result;
}


// ============================================================
// STORE VIDEO IN SUPABASE
// ============================================================
async function storeVideo(tweetId, parsed) {
  const existing = await supabase
    .from("videos")
    .select("*")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (existing.data) {
    await supabase
      .from("videos")
      .update({
        total_downloads: existing.data.total_downloads + 1,
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


// ============================================================
// STATIC PAGES (SPA Admin Fix)
// ============================================================
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/docs", (_, res) => res.sendFile(path.join(PUBLIC, "docs.html")));
app.get("/playground", (_, res) => res.sendFile(path.join(PUBLIC, "playground.html")));
app.get("/admin", (_, res) => res.sendFile(path.join(PUBLIC, "admin.html")));


// ============================================================
// MAIN DOWNLOAD API
// ============================================================
app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL required" });

    const tweetId = getTweetId(url);
    if (!tweetId) return res.status(400).json({ success: false, error: "Invalid Twitter URL" });

    await logRequest(req, url, "/api/download");

    const tsUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
    const html = await axios.get(tsUrl, { headers: getTwitsaveHeaders() });

    const parsed = extractDownloadLinksFromTwitsave(html.data, url);

    if (!parsed.downloadLinks.length) {
      return res.status(404).json({ success: false, error: "No downloadable video found" });
    }

    await storeVideo(tweetId, parsed);

    res.json({ success: true, tweetId, ...parsed });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ============================================================
// API - STATS
// ============================================================
app.get("/api/stats", async (req, res) => {
  const { data: stats } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const { data: videos } = await supabase.from("videos").select("*");
  const { data: requests } = await supabase.from("requests").select("*");

  res.json({
    success: true,
    statistics: {
      totalRequests: stats?.total_requests || 0,
      totalVideos: stats?.total_videos || 0,
      popularVideos: (videos || [])
        .sort((a, b) => b.total_downloads - a.total_downloads)
        .slice(0, 10),
      deviceStats: {},
      memoryUsage: {
        requests: requests?.length || 0,
        videos: videos?.length || 0
      }
    }
  });
});


// ============================================================
// ADMIN AUTH
// ============================================================
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || token !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}


// ============================================================
// ADMIN - FULL DATA
// ============================================================
app.get("/api/admin/data", adminAuth, async (req, res) => {
  const { data: stats } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const { data: videos } = await supabase.from("videos").select("*");
  const { data: requests } = await supabase.from("requests").select("*");

  res.json({
    success: true,
    stats: stats || { total_requests: 0, total_videos: 0 },
    videos: videos || [],
    requests: requests || []
  });
});


// ============================================================
// ADMIN: BAN IP
// ============================================================
app.post("/api/admin/ban", adminAuth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ success: false, error: "IP required" });

  const { error } = await supabase.from("bans").insert({ ip_address: ip });
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true });
});


// ============================================================
// ADMIN: RESET STATISTICS
// ============================================================
app.post("/api/admin/reset-stats", adminAuth, async (req, res) => {
  await supabase.from("stats").update({
    total_requests: 0,
    total_videos: 0
  }).eq("id", 1);

  res.json({ success: true });
});


// ============================================================
// ADMIN: CLEAR REQUESTS
// ============================================================
app.post("/api/admin/clear-requests", adminAuth, async (req, res) => {
  await supabase.from("requests").delete().neq("id", 0);
  res.json({ success: true });
});


// ============================================================
// ADMIN: CLEAR VIDEOS + RESET COUNT
// ============================================================
app.post("/api/admin/clear-videos", adminAuth, async (req, res) => {
  await supabase.from("videos").delete().neq("id", 0);
  await supabase.from("stats").update({ total_videos: 0 }).eq("id", 1);

  res.json({ success: true });
});


// ============================================================
// ADMIN: SYSTEM LOGS
// ============================================================
app.get("/api/admin/logs", adminAuth, async (req, res) => {
  const { data } = await supabase
    .from("logs")
    .select("*")
    .order("id", { ascending: false })
    .limit(150);

  res.json({
    success: true,
    logs: data ? data.map(l => `[${l.created_at}] ${l.message}`) : []
  });
});

// Helper to add server logs
async function addLog(message) {
  await supabase.from("logs").insert({ message });
}


// ============================================================
// HEALTH
// ============================================================
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});


// ============================================================
// START LOCAL SERVER
// ============================================================
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () =>
    console.log("🔥 LOCAL SERVER: http://localhost:3000")
  );
}

module.exports = app;
