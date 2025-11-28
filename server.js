const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const userAgent = require('user-agents');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple in-memory storage (resets on serverless function cold start)
let memoryDB = {
  requests: [],
  videos: [],
  downloadLinks: [],
  stats: {
    totalRequests: 0,
    totalVideos: 0
  }
};

// Initialize or load from persistent storage if available
function initializeDatabase() {
  console.log('Using in-memory database (serverless compatible)');
  return memoryDB;
}

// Initialize database
const db = initializeDatabase();

// Helper function to safely serve files
function serveFileSafe(res, filename) {
  try {
    const filePath = path.resolve(__dirname, 'public', filename);
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      // If file doesn't exist, check if .html version exists
      const altPath = filePath.endsWith('.html') ? filePath : filePath + '.html';
      if (fs.existsSync(altPath)) {
        res.sendFile(altPath);
      } else {
        res.status(404).json({
          success: false,
          error: 'Page not found',
          author: '@m2hgamerz',
          telegram: 'https://t.me/m2hgamerz'
        });
      }
    }
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
}

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

    db.requests.push(requestData);
    db.stats.totalRequests = db.requests.length;
    
    // Keep only last 1000 requests to prevent memory issues
    if (db.requests.length > 1000) {
      db.requests = db.requests.slice(-1000);
    }
    
  } catch (error) {
    console.error('Error logging request:', error);
  }
}

// Headers for Twitsave
const getTwitsaveHeaders = () => {
  const agent = new userAgent();
  return {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'user-agent': agent.toString()
  };
};

// Function to extract tweet ID from URL
function getTweetId(twitterUrl) {
  try {
    const match = twitterUrl.match(/status\/(\d+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

// Function to extract download links from Twitsave HTML
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
      author: $('a[href*="twitter.com"]').first().text().trim() || 'Unknown',
      text: $('p.m-2').text().trim() || '',
      date: $('a.text-xs').first().text().trim() || '',
      tweetUrl: $('a.text-xs').first().attr('href') || twitterUrl
    };

    result.thumbnail = $('video').attr('poster') || null;
    result.videoPreview = $('video').attr('src') || null;

    $('a[href*="/download?file="]').each((index, element) => {
      const $link = $(element);
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

      const downloadUrl = `https://twitsave.com${href}`;

      result.downloadLinks.push({
        url: downloadUrl,
        quality: quality,
        resolution: resolution,
        type: 'mp4',
        source: 'twitsave'
      });
    });

    result.totalVideosFound = result.downloadLinks.length;
    return result;

  } catch (error) {
    console.error('Error parsing Twitsave HTML:', error);
    return {
      success: false,
      error: 'Failed to parse Twitsave response',
      twitterUrl: twitterUrl,
      totalVideosFound: 0
    };
  }
}

// Function to store video data in database
async function storeVideoData(tweetId, result) {
  try {
    const existingVideoIndex = db.videos.findIndex(v => v.tweet_id === tweetId);
    
    if (existingVideoIndex !== -1) {
      // Update existing video
      db.videos[existingVideoIndex].total_downloads += 1;
      db.videos[existingVideoIndex].last_fetched = new Date().toISOString();
    } else {
      // Add new video
      db.videos.push({
        tweet_id: tweetId,
        author: result.tweetInfo.author,
        tweet_text: result.tweetInfo.text,
        tweet_date: result.tweetInfo.date,
        thumbnail_url: result.thumbnail,
        total_downloads: 1,
        first_fetched: new Date().toISOString(),
        last_fetched: new Date().toISOString()
      });
      db.stats.totalVideos = db.videos.length;
    }
    
    // Keep only last 500 videos to prevent memory issues
    if (db.videos.length > 500) {
      db.videos = db.videos.slice(-500);
    }
    
  } catch (error) {
    console.error('Error storing video data:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  serveFileSafe(res, 'index.html');
});

app.get('/playground', (req, res) => {
  serveFileSafe(res, 'playground.html');
});

app.get('/docs', (req, res) => {
  serveFileSafe(res, 'docs.html');
});

// Main download endpoint
app.get('/api/download', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Twitter URL is required',
        author: '@m2hgamerz',
        telegram: 'https://t.me/m2hgamerz'
      });
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
      return res.status(400).json({
        success: false,
        error: 'Could not extract tweet ID from URL',
        author: '@m2hgamerz',
        telegram: 'https://t.me/m2hgamerz'
      });
    }

    await logRequest(req, url, '/api/download');

    const twitsaveUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
    const response = await axios.get(twitsaveUrl, {
      headers: getTwitsaveHeaders(),
      timeout: 15000
    });

    const result = extractDownloadLinksFromTwitsave(response.data, url);

    if (!result.success || result.downloadLinks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No download links found',
        twitterUrl: url,
        totalVideosFound: 0,
        author: '@m2hgamerz',
        telegram: 'https://t.me/m2hgamerz'
      });
    }

    await storeVideoData(tweetId, result);

    const finalResponse = {
      success: true,
      twitterUrl: url,
      tweetId: tweetId,
      tweetInfo: result.tweetInfo,
      downloadLinks: result.downloadLinks,
      totalVideosFound: result.totalVideosFound,
      thumbnail: result.thumbnail,
      videoPreview: result.videoPreview,
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz',
      apiVersion: '2.0'
    };

    res.json(finalResponse);

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
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// Statistics endpoint - FIXED
app.get('/api/stats', async (req, res) => {
  try {
    await logRequest(req, 'STATS_REQUEST', '/api/stats');

    // Calculate device stats
    const deviceCounts = {};
    db.requests.forEach(req => {
      deviceCounts[req.device_type] = (deviceCounts[req.device_type] || 0) + 1;
    });

    const deviceStats = Object.entries(deviceCounts).map(([device_type, count]) => ({
      device_type,
      count
    }));

    // Get popular videos (top 10 by downloads)
    const popularVideos = [...db.videos]
      .sort((a, b) => (b.total_downloads || 0) - (a.total_downloads || 0))
      .slice(0, 10)
      .map(video => ({
        tweet_id: video.tweet_id,
        author: video.author,
        total_downloads: video.total_downloads || 0
      }));

    const stats = {
      totalRequests: db.stats.totalRequests || 0,
      totalVideos: db.stats.totalVideos || 0,
      popularVideos: popularVideos,
      deviceStats: deviceStats,
      memoryUsage: {
        requests: db.requests.length,
        videos: db.videos.length
      }
    };

    res.json({
      success: true,
      statistics: stats,
      database: 'memory',
      note: 'Statistics reset on server restart (serverless environment)',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await logRequest(req, 'HEALTH_CHECK', '/health');

    const healthInfo = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: {
        type: 'memory',
        connected: true,
        totalRequests: db.stats.totalRequests || 0,
        totalVideos: db.stats.totalVideos || 0
      },
      service: 'Twitter Video Download API',
      environment: process.env.NODE_ENV || 'development',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    };

    res.json(healthInfo);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: {
        type: 'memory',
        connected: false
      },
      service: 'Twitter Video Download API',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    author: '@m2hgamerz',
    telegram: 'https://t.me/m2hgamerz'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    author: '@m2hgamerz',
    telegram: 'https://t.me/m2hgamerz'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Twitter Video API running on port ${PORT}`);
  console.log(`📊 API Playground: http://localhost:${PORT}/playground`);
  console.log(`📚 Documentation: http://localhost:${PORT}/docs`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
  console.log(`👤 Author: @m2hgamerz`);
  console.log(`📱 Telegram: https://t.me/m2hgamerz`);
  console.log(`🗄️  Database: In-memory (Serverless compatible)`);
});

module.exports = app;