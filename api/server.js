/********************************************************************
 * M2H Twitter Video API — FINAL server.js
 ********************************************************************/

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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

/* ============================================================
   SUPABASE
   ============================================================ */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


/* ============================================================
   BAN SYSTEM (GLOBAL)
   ============================================================ */
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
      return res.status(403).json({
        success: false,
        error: "Your IP is banned."
      });
    }
  } catch {}

  next();
});


/* ============================================================
   GLOBAL REQUEST COUNTER
   ============================================================ */
app.use(async (req, res, next) => {
  try {
    await supabase.rpc("increment_stat", { field_name: "total_requests" });
  } catch (e) {
    console.log("Request counter error:", e.message);
  }
  next();
});


/* ============================================================
   LOG REQUESTS
   ============================================================ */
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


/* ============================================================
   TWITSAVE FUNCTIONS
   ============================================================ */
function getTwitsaveHeaders() {
  return {
    "user-agent": new userAgent().toString(),
    accept: "*/*"
  };
}

function getTweetId(url) {
  return url.match(/status\/(\d+)/)?.[1] || null;
}

function extractTwitsave(html, url) {
  const $ = cheerio.load(html);

  const result = {
    success: true,
    twitterUrl: url,
    tweetInfo: {
      author: $('a[href*="twitter.com"]').first().text().trim(),
      text: $("p.m-2").text().trim(),
      date: $("a.text-xs").first().text().trim()
    },
    downloadLinks: [],
    thumbnail: $("video").attr("poster") || null,
    videoPreview: $("video").attr("src") || null
  };

  $("a[href*='/download?file=']").each((i, el) => {
    const href = $(el).attr("href");
    result.downloadLinks.push({
      url: "https://twitsave.com" + href,
      type: "mp4"
    });
  });

  result.totalVideosFound = result.downloadLinks.length;
  return result;
}


/* ============================================================
   STORE VIDEO
   ============================================================ */
async function storeVideo(tweetId, data) {
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
      author: data.tweetInfo.author,
      tweet_text: data.tweetInfo.text,
      tweet_date: data.tweetInfo.date,
      thumbnail_url: data.thumbnail,
      total_downloads: 1
    });

    await supabase.rpc("increment_stat", { field_name: "total_videos" });
  }
}


/* ============================================================
   STATIC PAGES (SPA)
   ============================================================ */
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/playground", (_, res) =>
  res.sendFile(path.join(PUBLIC, "playground.html"))
);
app.get("/docs", (_, res) =>
  res.sendFile(path.join(PUBLIC, "docs.html"))
);
app.get("/admin", (_, res) =>
  res.sendFile(path.join(PUBLIC, "admin.html"))
);


/* ============================================================
   /api/download
   ============================================================ */
app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) return res.json({ success: false, error: "URL missing" });

    await logRequest(req, url, "/api/download");

    const tweetId = getTweetId(url);
    if (!tweetId)
      return res.json({ success: false, error: "Invalid tweet URL" });

    const html = await axios.get(
      `https://twitsave.com/info?url=${encodeURIComponent(url)}`,
      { headers: getTwitsaveHeaders() }
    );

    const parsed = extractTwitsave(html.data, url);

    if (!parsed.downloadLinks.length) {
      return res.json({
        success: false,
        error: "No downloadable video found"
      });
    }

    await storeVideo(tweetId, parsed);

    res.json({ success: true, tweetId, ...parsed });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});


/* ============================================================
   /api/stats
   ============================================================ */
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
      memoryUsage: {
        requests: requests?.length || 0,
        videos: videos?.length || 0
      }
    }
  });
});


/* ============================================================
   ADMIN AUTH
   ============================================================ */
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token || token !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  next();
}


/* ============================================================
   ADMIN: FULL DATA
   ============================================================ */
app.get("/api/admin/data", adminAuth, async (req, res) => {
  const stats = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const videos = await supabase.from("videos").select("*");
  const requests = await supabase.from("requests").select("*");

  res.json({
    success: true,
    stats: stats.data,
    videos: videos.data,
    requests: requests.data
  });
});


/* ============================================================
   BAN IP
   ============================================================ */
app.post("/api/admin/ban", adminAuth, async (req, res) => {
  const { ip } = req.body;
  if (!ip)
    return res.json({ success: false, error: "IP required" });

  await supabase.from("bans").insert({ ip_address: ip });
  res.json({ success: true });
});


/* ============================================================
   RESET STATS
   ============================================================ */
app.post("/api/admin/reset-stats", adminAuth, async (req, res) => {
  await supabase
    .from("stats")
    .update({ total_requests: 0, total_videos: 0 })
    .eq("id", 1);

  res.json({ success: true });
});


/* ============================================================
   CLEAR REQUESTS
   ============================================================ */
app.post("/api/admin/clear-requests", adminAuth, async (req, res) => {
  await supabase.from("requests").delete().neq("id", 0);
  res.json({ success: true });
});


/* ============================================================
   CLEAR VIDEOS
   ============================================================ */
app.post("/api/admin/clear-videos", adminAuth, async (req, res) => {
  await supabase.from("videos").delete().neq("id", 0);
  await supabase
    .from("stats")
    .update({ total_videos: 0 })
    .eq("id", 1);

  res.json({ success: true });
});


/* ============================================================
   GET LOGS
   ============================================================ */
app.get("/api/admin/logs", adminAuth, async (req, res) => {
  const { data } = await supabase
    .from("logs")
    .select("*")
    .order("id", { ascending: false })
    .limit(150);

  res.json({
    success: true,
    logs: data
      ? data.map(l => `[${l.created_at}] ${l.message}`)
      : []
  });
});


/* ============================================================
   HEALTH
   ============================================================ */
app.get("/health", (_, res) =>
  res.json({ status: "OK", timestamp: new Date().toISOString() })
);


/* ============================================================
   LOCAL SERVER
   ============================================================ */
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () =>
    console.log("🔥 Local server running at http://localhost:3000")
  );
}

module.exports = app;
