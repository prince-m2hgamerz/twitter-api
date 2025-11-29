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

const app = express();
const PUBLIC = path.join(__dirname, "public");

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

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
      author: $('a[href*="twitter.com"]').first().text().trim() || 'Unknown',
      text: $("p.m-2").text().trim() || '',
      date: $("a.text-xs").first().text().trim() || ''
    },
    downloadLinks: [],
    thumbnail: $("video").attr("poster") || null,
    preview: $("video").attr("src") || null
  };

  $("a[href*='/download?file=']").each((i, el) => {
    const $link = $(el);
    const href = $link.attr('href');
    const text = $link.find('.truncate').text().trim();
    
    const resolutionMatch = text.match(/Resolution:\s*(\d+x\d+)/i) || text.match(/(\d+x\d+)/);
    const resolution = resolutionMatch ? resolutionMatch[1] : 'unknown';
    
    let quality = 'unknown';
    if (resolution.includes('1688x720') || resolution.includes('1280x720') || resolution.includes('1920x1080')) {
      quality = 'hd';
    } else if (resolution.includes('844x360') || resolution.includes('640x360')) {
      quality = 'sd';
    } else if (resolution.includes('632x270') || resolution.includes('480x270')) {
      quality = 'low';
    }

    result.downloadLinks.push({
      url: "https://twitsave.com" + href,
      quality: quality,
      resolution: resolution,
      type: "mp4",
      source: "twitsave"
    });
  });

  return result;
}

// Simple in-memory storage (for Vercel compatibility)
let memoryDB = {
  requests: [],
  videos: [],
  stats: {
    totalRequests: 0,
    totalVideos: 0
  }
};

// Function to get client IP and device details
function getClientInfo(req) {
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.connection.remoteAddress || 
             req.socket.remoteAddress ||
             (req.connection.socket ? req.connection.socket.remoteAddress : null);

  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  let deviceType = 'Desktop';
  let browser = 'Unknown';
  let platform = 'Unknown';

  if (userAgent.includes('Mobile')) deviceType = 'Mobile';
  else if (userAgent.includes('Tablet')) deviceType = 'Tablet';

  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  if (userAgent.includes('Windows')) platform = 'Windows';
  else if (userAgent.includes('Mac')) platform = 'Mac';
  else if (userAgent.includes('Linux')) platform = 'Linux';
  else if (userAgent.includes('Android')) platform = 'Android';
  else if (userAgent.includes('iOS')) platform = 'iOS';

  return {
    ip: ip ? ip.split(',')[0].trim() : 'unknown',
    userAgent,
    deviceType,
    browser,
    platform
  };
}

// Function to log request to database
async function logRequest(req, twitterUrl, endpoint) {
  const clientInfo = getClientInfo(req);
  
  try {
    const requestData = {
      ip_address: clientInfo.ip,
      user_agent: clientInfo.userAgent,
      device_type: clientInfo.deviceType,
      browser: clientInfo.browser,
      platform: clientInfo.platform,
      twitter_url: twitterUrl,
      endpoint: endpoint,
      timestamp: new Date().toISOString()
    };

    memoryDB.requests.push(requestData);
    memoryDB.stats.totalRequests = memoryDB.requests.length;
    
    // Keep only last 1000 requests to prevent memory issues
    if (memoryDB.requests.length > 1000) {
      memoryDB.requests = memoryDB.requests.slice(-1000);
    }
    
  } catch (error) {
    console.error('Error logging request:', error);
  }
}

// Function to store video data in database
async function storeVideoData(tweetId, result) {
  try {
    const existingVideoIndex = memoryDB.videos.findIndex(v => v.tweet_id === tweetId);
    
    if (existingVideoIndex !== -1) {
      // Update existing video
      memoryDB.videos[existingVideoIndex].total_downloads += 1;
      memoryDB.videos[existingVideoIndex].last_fetched = new Date().toISOString();
    } else {
      // Add new video
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
    
    // Keep only last 500 videos to prevent memory issues
    if (memoryDB.videos.length > 500) {
      memoryDB.videos = memoryDB.videos.slice(-500);
    }
    
  } catch (error) {
    console.error('Error storing video data:', error);
  }
}

// -------------------------------------------------------------------------------
// STATIC ROUTES (SPA)
// -------------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

app.get("/docs", (req, res) => {
  res.sendFile(path.join(PUBLIC, "docs.html"));
});

app.get("/playground", (req, res) => {
  res.sendFile(path.join(PUBLIC, "playground.html"));
});

// -------------------------------------------------------------------------------
// /api/download
// -------------------------------------------------------------------------------
app.get("/api/download", async (req, res) => {
  const start = Date.now();

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json(
        devInfo({
          success: false,
          error: "Twitter URL is required"
        })
      );
    }

    if (!url.includes('twitter.com/') && !url.includes('x.com/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Twitter URL. Must be from twitter.com or x.com',
        author: '@m2hgamerz',
        telegram: 'https://t.me/m2hgamerz'
      });
    }

    const tweetId = getTweetId(url);
    if (!tweetId) {
      return res.status(400).json(
        devInfo({
          success: false,
          error: "Could not extract tweet ID from URL"
        })
      );
    }

    await logRequest(req, url, "/api/download");

    const response = await axios.get(
      `https://twitsave.com/info?url=${encodeURIComponent(url)}`,
      { 
        headers: getTwitsaveHeaders(),
        timeout: 15000
      }
    );

    const parsed = parseTwitsave(response.data, url);

    if (!parsed.downloadLinks.length) {
      return res.status(404).json(
        devInfo({
          success: false,
          error: "No downloadable videos found"
        })
      );
    }

    await storeVideoData(tweetId, parsed);

    const latency = Date.now() - start;

    return res.json(
      devInfo({
        success: true,
        twitterUrl: url,
        tweetId: tweetId,
        tweetInfo: parsed.tweetInfo,
        downloadLinks: parsed.downloadLinks,
        totalVideosFound: parsed.downloadLinks.length,
        thumbnail: parsed.thumbnail,
        videoPreview: parsed.preview,
        _ping: latency
      })
    );
  } catch (error) {
    console.error('API Error:', error.message);
    
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.response) {
      statusCode = error.response.status;
      if (statusCode === 404) errorMessage = 'Tweet not found';
      else if (statusCode === 403) errorMessage = 'Access denied';
      else if (statusCode === 429) errorMessage = 'Rate limited';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Cannot connect to Twitsave';
    }
    
    return res.status(statusCode).json(
      devInfo({
        success: false,
        error: errorMessage
      })
    );
  }
});

// -------------------------------------------------------------------------------
// API STATS
// -------------------------------------------------------------------------------
app.get("/api/stats", async (req, res) => {
  try {
    await logRequest(req, 'STATS_REQUEST', '/api/stats');

    // Calculate device stats
    const deviceCounts = {};
    memoryDB.requests.forEach(req => {
      deviceCounts[req.device_type] = (deviceCounts[req.device_type] || 0) + 1;
    });

    const deviceStats = Object.entries(deviceCounts).map(([device_type, count]) => ({
      device_type,
      count
    }));

    // Get popular videos (top 10 by downloads)
    const popularVideos = [...memoryDB.videos]
      .sort((a, b) => (b.total_downloads || 0) - (a.total_downloads || 0))
      .slice(0, 10)
      .map(video => ({
        tweet_id: video.tweet_id,
        author: video.author,
        total_downloads: video.total_downloads || 0
      }));

    const stats = {
      totalRequests: memoryDB.stats.totalRequests || 0,
      totalVideos: memoryDB.stats.totalVideos || 0,
      popularVideos: popularVideos,
      deviceStats: deviceStats,
      memoryUsage: {
        requests: memoryDB.requests.length,
        videos: memoryDB.videos.length
      }
    };

    res.json(
      devInfo({
        success: true,
        statistics: stats,
        database: 'memory',
        note: 'Statistics reset on server restart (serverless environment)'
      })
    );

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json(
      devInfo({
        success: false,
        error: 'Failed to fetch statistics'
      })
    );
  }
});

// -------------------------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------------------------
app.get("/health", async (req, res) => {
  try {
    await logRequest(req, 'HEALTH_CHECK', '/health');

    const healthInfo = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: {
        type: 'memory',
        connected: true,
        totalRequests: memoryDB.stats.totalRequests || 0,
        totalVideos: memoryDB.stats.totalVideos || 0
      },
      service: 'Twitter Video Download API',
      environment: process.env.NODE_ENV || 'development'
    };

    res.json(devInfo(healthInfo));
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json(
      devInfo({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        database: {
          type: 'memory',
          connected: false
        },
        service: 'Twitter Video Download API'
      })
    );
  }
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
// 404 handler
// -------------------------------------------------------------------------------
app.use('*', (req, res) => {
  res.status(404).json(
    devInfo({
      success: false,
      error: 'Endpoint not found'
    })
  );
});

// -------------------------------------------------------------------------------
// Error handling middleware
// -------------------------------------------------------------------------------
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json(
    devInfo({
      success: false,
      error: 'Internal server error'
    })
  );
});

// -------------------------------------------------------------------------------
// For Vercel deployment
// -------------------------------------------------------------------------------
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Twitter Video API running on port ${PORT}`);
    console.log(`📊 API Playground: http://localhost:${PORT}/playground`);
    console.log(`📚 Documentation: http://localhost:${PORT}/docs`);
    console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
    console.log(`👤 Author: @m2hgamerz`);
    console.log(`📱 Telegram: https://t.me/m2hgamerz`);
    console.log(`🗄️  Database: In-memory (Serverless compatible)`);
  });
}

// Export for Vercel
module.exports = app;