// ------------------------------------------------------------
// FULL ORIGINAL FUNCTIONALITY RESTORED + VERCEL COMPATIBLE
// ------------------------------------------------------------

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const userAgent = require('user-agents');

const app = express();

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public"))); // static files


// ------------------------------------------------------------
//  IN-MEMORY DATABASE  (original functionality preserved)
// ------------------------------------------------------------
let memoryDB = {
  requests: [],
  videos: [],
  downloadLinks: [],
  stats: {
    totalRequests: 0,
    totalVideos: 0
  }
};


// ------------------------------------------------------------
//  CLIENT INFO (FULL original fields restored)
// ------------------------------------------------------------
function getClientInfo(req) {
  const ip =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown";

  const ua = req.headers["user-agent"] || "Unknown";

  let deviceType = "Desktop";
  if (ua.includes("Mobile")) deviceType = "Mobile";
  if (ua.includes("Tablet")) deviceType = "Tablet";

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
    ip: ip.split(",")[0].trim(),
    user_agent: ua,
    device_type: deviceType,
    browser: browser,
    platform: platform
  };
}


// ------------------------------------------------------------
// LOG REQUEST  (original functionality preserved)
// ------------------------------------------------------------
async function logRequest(req, twitterUrl, endpoint) {
  const info = getClientInfo(req);

  const obj = {
    ip_address: info.ip,
    user_agent: info.user_agent,
    device_type: info.device_type,
    browser: info.browser,
    platform: info.platform,
    twitter_url: twitterUrl,
    endpoint: endpoint,
    timestamp: new Date().toISOString()
  };

  memoryDB.requests.push(obj);
  memoryDB.stats.totalRequests = memoryDB.requests.length;

  if (memoryDB.requests.length > 1000) {
    memoryDB.requests = memoryDB.requests.slice(-700);
  }
}


// ------------------------------------------------------------
// TWITSAVE HEADERS
// ------------------------------------------------------------
function getTwitsaveHeaders() {
  const agent = new userAgent();
  return {
    "accept": "*/*",
    "user-agent": agent.toString(),
    "cache-control": "no-cache",
    "pragma": "no-cache"
  };
}


// ------------------------------------------------------------
// EXTRACT TWEET ID
// ------------------------------------------------------------
function getTweetId(url) {
  try {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}


// ------------------------------------------------------------
// PARSE TWITSAVE HTML (original functionality preserved)
// ------------------------------------------------------------
function extractDownloadLinksFromTwitsave(html, twitterUrl) {
  const $ = cheerio.load(html);

  const result = {
    success: true,
    twitterUrl: twitterUrl,
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

    result.thumbnail = $('video').attr('poster') || null;
    result.videoPreview = $('video').attr('src') || null;

    $('a[href*="/download?file="]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).find(".truncate").text().trim();

      const match = text.match(/(\d+x\d+)/);
      const resolution = match ? match[1] : "unknown";

      let quality = "low";
      if (resolution.includes("720") || resolution.includes("1080")) quality = "hd";
      if (resolution.includes("360")) quality = "sd";

      const finalUrl = "https://twitsave.com" + href;

      result.downloadLinks.push({
        url: finalUrl,
        quality,
        resolution,
        type: "mp4",
        source: "twitsave"
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


// ------------------------------------------------------------
// STORE VIDEO DATA (original analytics functionality)
// ------------------------------------------------------------
async function storeVideoData(tweetId, result) {
  const found = memoryDB.videos.find(v => v.tweet_id === tweetId);

  if (found) {
    found.total_downloads += 1;
    found.last_fetched = new Date().toISOString();
  } else {
    memoryDB.videos.push({
      tweet_id: tweetId,
      author: result.tweetInfo.author,
      tweet_text: result.tweetInfo.text,
      tweet_date: result.tweetInfo.date,
      thumbnail_url: result.thumbnail,
      total_downloads: 1,
      first_fetched: new Date().toISOString(),
      last_fetched: new Date().toISOString()
    });

    memoryDB.stats.totalVideos = memoryDB.videos.length;
  }

  if (memoryDB.videos.length > 500) {
    memoryDB.videos = memoryDB.videos.slice(-400);
  }
}


// ------------------------------------------------------------
// STATIC PAGES
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/playground", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/playground.html"));
});

app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/docs.html"));
});


// ------------------------------------------------------------
// API: DOWNLOAD (FULL ORIGINAL VERSION)
// ------------------------------------------------------------
app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url)
      return res.status(400).json({ success: false, error: "Twitter URL is required" });

    if (!url.includes("twitter") && !url.includes("x.com"))
      return res.status(400).json({ success: false, error: "Invalid Twitter URL" });

    const tweetId = getTweetId(url);
    if (!tweetId)
      return res.status(400).json({ success: false, error: "Cannot extract tweet ID" });

    await logRequest(req, url, "/api/download");

    const twUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;

    const response = await axios.get(twUrl, {
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
      ...parsed,
      author: "@m2hgamerz",
      telegram: "https://t.me/m2hgamerz",
      apiVersion: "2.0"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      author: "@m2hgamerz"
    });
  }
});


// ------------------------------------------------------------
// API: STATS (FULL ORIGINAL VERSION RESTORED)
// ------------------------------------------------------------
app.get("/api/stats", async (req, res) => {
  try {
    await logRequest(req, "STATS_REQUEST", "/api/stats");

    const deviceCounts = {};
    memoryDB.requests.forEach(r => {
      deviceCounts[r.device_type] = (deviceCounts[r.device_type] || 0) + 1;
    });

    const deviceStats = Object.entries(deviceCounts).map(([device_type, count]) => ({
      device_type,
      count
    }));

    const popular = [...memoryDB.videos]
      .sort((a, b) => b.total_downloads - a.total_downloads)
      .slice(0, 10)
      .map(v => ({
        tweet_id: v.tweet_id,
        author: v.author,
        total_downloads: v.total_downloads
      }));

    res.json({
      success: true,
      statistics: {
        totalRequests: memoryDB.stats.totalRequests,
        totalVideos: memoryDB.stats.totalVideos,
        popularVideos: popular,
        deviceStats: deviceStats,
        memoryUsage: {
          requests: memoryDB.requests.length,
          videos: memoryDB.videos.length
        }
      },
      database: "memory",
      note: "Statistics reset on server restart",
      author: "@m2hgamerz",
      telegram: "https://t.me/m2hgamerz"
    });

  } catch (err) {
    res.status(500).json({ success: false, error: "Stats failed" });
  }
});


// ------------------------------------------------------------
// HEALTH CHECK (original)
// ------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    totalRequests: memoryDB.stats.totalRequests,
    totalVideos: memoryDB.stats.totalVideos,
    author: "@m2hgamerz"
  });
});


// ------------------------------------------------------------
// 404 HANDLER
// ------------------------------------------------------------
app.use("*", (req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});


// ------------------------------------------------------------
// REQUIRED FOR VERCEL SERVERLESS
// ------------------------------------------------------------
module.exports = app;
