// ============================================================
//  TWITTER VIDEO API by @m2hgamerz — FINAL RPC FIXED VERSION
// ============================================================

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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
// DEVICE INFO PARSER
// ============================================================
function getClientInfo(req) {
  const ua = req.headers["user-agent"] || "Unknown";

  const ip =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
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

  return {
    ip_address: ip.split(",")[0].trim(),
    user_agent: ua,
    device_type,
    browser,
    platform
  };
}

// ============================================================
// LOG REQUEST TO SUPABASE (RPC FIXED)
// ============================================================
async function logRequest(req, url, endpoint) {
  const info = getClientInfo(req);

  await supabase.from("requests").insert({
    ...info,
    twitter_url: url,
    endpoint
  });

  // safe RPC call
  const { error } = await supabase.rpc("increment_stat", {
    field_name: "total_requests"
  });

  if (error) console.log("RPC REQUEST ERROR:", error.message);
}

// ============================================================
// TWITSAVE HEADERS
// ============================================================
function getTwitsaveHeaders() {
  return {
    "user-agent": new userAgent().toString(),
    accept: "*/*",
    "cache-control": "no-cache"
  };
}

// ============================================================
// TWEET ID
// ============================================================
function getTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

// ============================================================
// PARSE TWITSAVE
// ============================================================
function extractDownloadLinksFromTwitsave(html, twitterUrl) {
  const $ = cheerio.load(html);

  const result = {
    success: true,
    twitterUrl,
    tweetInfo: {},
    downloadLinks: [],
    thumbnail: null,
    videoPreview: null,
    totalVideosFound: 0
  };

  result.tweetInfo = {
    author: $('a[href*="twitter.com"]').first().text().trim(),
    text: $("p.m-2").text().trim(),
    date: $("a.text-xs").first().text().trim(),
    tweetUrl: $("a.text-xs").attr("href") || twitterUrl
  };

  result.thumbnail = $("video").attr("poster") || null;
  result.videoPreview = $("video").attr("src") || null;

  $("a[href*='/download?file=']").each((_, link) => {
    const href = $(link).attr("href");
    const text = $(link).find(".truncate").text().trim();
    const res = text.match(/(\d+x\d+)/)?.[1] || "unknown";

    let quality = "low";
    if (res.includes("1080") || res.includes("720")) quality = "hd";
    else if (res.includes("360")) quality = "sd";

    result.downloadLinks.push({
      url: "https://twitsave.com" + href,
      resolution: res,
      quality,
      type: "mp4"
    });
  });

  result.totalVideosFound = result.downloadLinks.length;
  return result;
}

// ============================================================
// STORE VIDEO (RPC FIXED)
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

    // safe RPC
    const { error } = await supabase.rpc("increment_stat", {
      field_name: "total_videos"
    });

    if (error) console.log("RPC VIDEO ERROR:", error.message);
  }
}

// ============================================================
// STATIC PAGES
// ============================================================
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
app.get("/docs", (_, res) => res.sendFile(path.join(__dirname, "../public/docs.html")));
app.get("/playground", (_, res) => res.sendFile(path.join(__dirname, "../public/playground.html")));
app.get("/admin", (_, res) => res.sendFile(path.join(__dirname, "../public/admin.html")));

// ============================================================
// DOWNLOAD API
// ============================================================
app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: "URL required" });

    const tweetId = getTweetId(url);
    if (!tweetId) return res.status(400).json({ success: false, error: "Invalid tweet URL" });

    await logRequest(req, url, "/api/download");

    const tsUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
    const html = await axios.get(tsUrl, { headers: getTwitsaveHeaders() });

    const parsed = extractDownloadLinksFromTwitsave(html.data, url);
    if (!parsed.downloadLinks.length)
      return res.status(404).json({ success: false, error: "No video found" });

    await storeVideo(tweetId, parsed);

    res.json({ success: true, tweetId, ...parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// STATS (SAFE VERSION)
// ============================================================
app.get("/api/stats", async (req, res) => {
  const { data: statsRaw } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const stats = statsRaw || { total_requests: 0, total_videos: 0 };

  const { data: videos } = await supabase.from("videos").select("*");
  const { data: requests } = await supabase.from("requests").select("*");

  const deviceStats = {};
  (requests || []).forEach((r) => {
    deviceStats[r.device_type] = (deviceStats[r.device_type] || 0) + 1;
  });

  res.json({
    success: true,
    statistics: {
      totalRequests: stats.total_requests || 0,
      totalVideos: stats.total_videos || 0,
      popularVideos: (videos || [])
        .sort((a, b) => b.total_downloads - a.total_downloads)
        .slice(0, 10),
      deviceStats,
      memoryUsage: {
        requests: requests ? requests.length : 0,
        videos: videos ? videos.length : 0
      }
    }
  });
});

// ============================================================
// RECENT REQUESTS
// ============================================================
app.get("/api/requests/recent", async (req, res) => {
  const limit = Number(req.query.limit) || 50;

  const { data } = await supabase
    .from("requests")
    .select("*")
    .order("id", { ascending: false })
    .limit(limit);

  res.json({ success: true, count: data.length, requests: data });
});

// ============================================================
// VIDEO SEARCH
// ============================================================
app.get("/api/videos/search", async (req, res) => {
  const q = (req.query.author || "").toLowerCase();
  const limit = Number(req.query.limit) || 20;

  let query = supabase.from("videos").select("*");
  if (q) query = query.ilike("author", `%${q}%`);

  const { data } = await query.limit(Math.min(limit, 100));
  res.json({ success: true, results: data });
});

// ============================================================
// ADMIN DATA (SAFE)
// ============================================================
app.get("/api/admin/data", adminAuth, async (req, res) => {
  const { data: statsRaw } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const stats = statsRaw || { total_requests: 0, total_videos: 0 };

  const { data: videos } = await supabase.from("videos").select("*");
  const { data: requests } = await supabase
    .from("requests")
    .select("*")
    .order("id", { ascending: false });

  res.json({
    success: true,
    stats,
    videos: videos || [],
    requests: requests || []
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// LOCAL DEV SERVER
// ============================================================
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () =>
    console.log("🔥 Local server running at http://localhost:3000")
  );
}

module.exports = app;
