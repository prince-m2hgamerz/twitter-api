const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const userAgent = require('user-agents');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public"))); // Serve static files from public/

// ---------------------------
// In-memory database
// ---------------------------
let memoryDB = {
  requests: [],
  videos: [],
  stats: {
    totalRequests: 0,
    totalVideos: 0
  }
};

// ---------------------------
// Helpers
// ---------------------------
function getClientInfo(req) {
  const ip = req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress || "unknown";

  const agent = req.headers['user-agent'] || "Unknown";

  let deviceType = 'Desktop';
  if (agent.includes("Mobile")) deviceType = "Mobile";
  if (agent.includes("Tablet")) deviceType = "Tablet";

  return {
    ip: ip.split(",")[0].trim(),
    userAgent: agent,
    deviceType
  };
}

async function logRequest(req, twitterUrl, endpoint) {
  const info = getClientInfo(req);

  memoryDB.requests.push({
    ip: info.ip,
    user_agent: info.userAgent,
    device: info.deviceType,
    endpoint: endpoint,
    twitter_url: twitterUrl,
    timestamp: new Date().toISOString()
  });

  memoryDB.stats.totalRequests = memoryDB.requests.length;

  if (memoryDB.requests.length > 1000) {
    memoryDB.requests = memoryDB.requests.slice(-500);
  }
}

function getTwitsaveHeaders() {
  const agent = new userAgent();
  return {
    "accept": "*/*",
    "user-agent": agent.toString()
  };
}

function getTweetId(url) {
  try {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractDownloadLinksFromTwitsave(html, twitterUrl) {
  const $ = cheerio.load(html);

  let result = {
    success: true,
    twitterUrl,
    tweetInfo: {},
    downloadLinks: [],
    thumbnail: null,
    videoPreview: null,
    totalVideosFound: 0
  };

  try {
    result.tweetInfo = {
      author: $('a[href*="twitter.com"]').first().text().trim() || "Unknown",
      text: $('p.m-2').text().trim(),
      date: $('a.text-xs').first().text().trim(),
      tweetUrl: $('a.text-xs').first().attr('href') || twitterUrl
    };

    result.thumbnail = $("video").attr("poster") || null;
    result.videoPreview = $("video").attr("src") || null;

    $('a[href*="/download?file="]').each((i, el) => {
      const link = $(el).attr("href");
      const full = `https://twitsave.com${link}`;

      const text = $(el).find(".truncate").text().trim();
      const match = text.match(/(\d+x\d+)/);
      const res = match ? match[1] : "unknown";

      let quality = "low";
      if (res.includes("720") || res.includes("1080")) quality = "hd";
      if (res.includes("360")) quality = "sd";

      result.downloadLinks.push({
        url: full,
        quality,
        resolution: res,
        type: "mp4"
      });
    });

    result.totalVideosFound = result.downloadLinks.length;
    return result;

  } catch (err) {
    return {
      success: false,
      error: "Parsing failed",
      twitterUrl,
      totalVideosFound: 0
    };
  }
}

async function storeVideoData(tweetId, data) {
  const existing = memoryDB.videos.find(v => v.tweet_id === tweetId);

  if (existing) {
    existing.total_downloads += 1;
    existing.last_fetched = new Date().toISOString();
  } else {
    memoryDB.videos.push({
      tweet_id: tweetId,
      author: data.tweetInfo.author,
      tweet_text: data.tweetInfo.text,
      tweet_date: data.tweetInfo.date,
      thumbnail_url: data.thumbnail,
      total_downloads: 1,
      first_fetched: new Date().toISOString(),
      last_fetched: new Date().toISOString()
    });
    memoryDB.stats.totalVideos = memoryDB.videos.length;
  }

  if (memoryDB.videos.length > 500) {
    memoryDB.videos = memoryDB.videos.slice(-300);
  }
}

// ---------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------

// HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Playground
app.get("/playground", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/playground.html"));
});

// Docs
app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/docs.html"));
});

// ---------------------------
// API: Twitter video download
// ---------------------------
app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ success: false, error: "URL required" });
    }

    if (!url.includes("twitter") && !url.includes("x.com")) {
      return res.status(400).json({ success: false, error: "Invalid Twitter URL" });
    }

    const tweetId = getTweetId(url);
    if (!tweetId)
      return res.status(400).json({ success: false, error: "Cannot extract tweet ID" });

    await logRequest(req, url, "/api/download");

    const twURL = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;

    const response = await axios.get(twURL, {
      headers: getTwitsaveHeaders(),
      timeout: 15000
    });

    const parsed = extractDownloadLinksFromTwitsave(response.data, url);

    if (!parsed.success || parsed.downloadLinks.length === 0)
      return res.status(404).json({ success: false, error: "No video found" });

    await storeVideoData(tweetId, parsed);

    res.json({
      success: true,
      tweetId,
      ...parsed
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Server error"
    });
  }
});

// ---------------------------
// API: Stats
// ---------------------------
app.get("/api/stats", async (req, res) => {
  await logRequest(req, "STATS_REQUEST", "/api/stats");

  res.json({
    success: true,
    totalRequests: memoryDB.stats.totalRequests,
    totalVideos: memoryDB.stats.totalVideos,
    popularVideos: memoryDB.videos.slice(0, 10),
    deviceStats: memoryDB.requests.reduce((acc, r) => {
      acc[r.device] = (acc[r.device] || 0) + 1;
      return acc;
    }, {})
  });
});

// ---------------------------
// HEALTH CHECK
// ---------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    uptime: process.uptime(),
    totalRequests: memoryDB.stats.totalRequests,
    timestamp: new Date().toISOString()
  });
});

// ---------------------------
// Fallback
// ---------------------------
app.use("*", (req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// REQUIRED for Vercel
module.exports = app;
