const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const path = require('path');
const userAgent = require('user-agents');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// PostgreSQL Database Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    
    // Create requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        ip_address TEXT,
        user_agent TEXT,
        device_type TEXT,
        browser TEXT,
        platform TEXT,
        twitter_url TEXT,
        endpoint TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create videos table
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        tweet_id TEXT UNIQUE,
        author TEXT,
        tweet_text TEXT,
        tweet_date TEXT,
        thumbnail_url TEXT,
        total_downloads INTEGER DEFAULT 0,
        first_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create download_links table
    await client.query(`
      CREATE TABLE IF NOT EXISTS download_links (
        id SERIAL PRIMARY KEY,
        tweet_id TEXT,
        download_url TEXT,
        direct_url TEXT,
        quality TEXT,
        resolution TEXT,
        type TEXT,
        source TEXT,
        fetch_count INTEGER DEFAULT 0,
        FOREIGN KEY (tweet_id) REFERENCES videos (tweet_id) ON DELETE CASCADE
      )
    `);

    console.log('PostgreSQL database initialized successfully');
    client.release();
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Initialize database on startup
initializeDatabase();

// Function to get client IP and device details
function getClientInfo(req) {
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.connection.remoteAddress || 
             req.socket.remoteAddress ||
             (req.connection.socket ? req.connection.socket.remoteAddress : null);

  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Simple device detection
  let deviceType = 'Desktop';
  let browser = 'Unknown';
  let platform = 'Unknown';

  if (userAgent.includes('Mobile')) {
    deviceType = 'Mobile';
  } else if (userAgent.includes('Tablet')) {
    deviceType = 'Tablet';
  }

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
    const query = `
      INSERT INTO requests (ip_address, user_agent, device_type, browser, platform, twitter_url, endpoint)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    await pool.query(query, [
      clientInfo.ip,
      clientInfo.userAgent,
      clientInfo.deviceType,
      clientInfo.browser,
      clientInfo.platform,
      twitterUrl,
      endpoint
    ]);
  } catch (error) {
    console.error('Error logging request:', error);
  }
}

// Headers for Twitsave with random user agents
const getTwitsaveHeaders = () => {
  const agent = new userAgent();
  return {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'upgrade-insecure-requests': '1',
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
    // Extract tweet information
    result.tweetInfo = {
      author: $('a[href*="twitter.com"]').first().text().trim() || 'Unknown',
      text: $('p.m-2').text().trim() || '',
      date: $('a.text-xs').first().text().trim() || '',
      tweetUrl: $('a.text-xs').first().attr('href') || twitterUrl
    };

    // Extract thumbnail from video poster
    result.thumbnail = $('video').attr('poster') || null;

    // Extract video preview URL
    result.videoPreview = $('video').attr('src') || null;

    // Extract download links from the table
    $('a[href*="/download?file="]').each((index, element) => {
      const $link = $(element);
      const href = $link.attr('href');
      const text = $link.find('.truncate').text().trim();
      
      // Extract resolution from text
      const resolutionMatch = text.match(/Resolution:\s*(\d+x\d+)/i) || text.match(/(\d+x\d+)/);
      const resolution = resolutionMatch ? resolutionMatch[1] : 'unknown';
      
      // Extract quality from resolution
      let quality = 'unknown';
      if (resolution.includes('1688x720') || resolution.includes('1280x720') || resolution.includes('1920x1080')) {
        quality = 'hd';
      } else if (resolution.includes('844x360') || resolution.includes('640x360')) {
        quality = 'sd';
      } else if (resolution.includes('632x270') || resolution.includes('480x270')) {
        quality = 'low';
      }

      // The href contains base64 encoded direct Twitter video URL
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

// Function to store video data in PostgreSQL database
async function storeVideoData(tweetId, result) {
  try {
    // Check if video already exists
    const existingVideo = await pool.query(
      'SELECT * FROM videos WHERE tweet_id = $1',
      [tweetId]
    );

    if (existingVideo.rows.length > 0) {
      // Update existing video
      await pool.query(
        'UPDATE videos SET total_downloads = total_downloads + 1, last_fetched = CURRENT_TIMESTAMP WHERE tweet_id = $1',
        [tweetId]
      );

      // Update download links fetch count
      for (const link of result.downloadLinks) {
        await pool.query(
          'UPDATE download_links SET fetch_count = fetch_count + 1 WHERE tweet_id = $1 AND download_url = $2',
          [tweetId, link.url]
        );
      }
    } else {
      // Insert new video
      await pool.query(
        `INSERT INTO videos (tweet_id, author, tweet_text, tweet_date, thumbnail_url, total_downloads)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [tweetId, result.tweetInfo.author, result.tweetInfo.text, result.tweetInfo.date, result.thumbnail]
      );

      // Insert download links
      for (const link of result.downloadLinks) {
        await pool.query(
          `INSERT INTO download_links (tweet_id, download_url, direct_url, quality, resolution, type, source, fetch_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
          [tweetId, link.url, link.directUrl, link.quality, link.resolution, link.type, link.source]
        );
      }
    }
  } catch (error) {
    console.error('Error storing video data:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playground.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
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

    // Validate Twitter URL
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

    console.log(`Fetching from Twitsave for URL: ${url}`);

    // Log the request
    await logRequest(req, url, '/api/download');

    // Call Twitsave API
    const twitsaveUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
    
    const response = await axios.get(twitsaveUrl, {
      headers: getTwitsaveHeaders(),
      timeout: 15000
    });

    // Extract download links from HTML
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

    // Store data in database
    await storeVideoData(tweetId, result);

    // Prepare final response
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
      if (statusCode === 404) {
        errorMessage = 'Tweet not found or Twitsave service unavailable';
      } else if (statusCode === 403) {
        errorMessage = 'Access denied by Twitsave';
      } else if (statusCode === 429) {
        errorMessage = 'Rate limited by Twitsave. Please try again later.';
      }
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Cannot connect to Twitsave service';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout';
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: error.code,
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// Statistics endpoint
app.get('/api/stats', async (req, res) => {
  try {
    // Log the request
    await logRequest(req, 'STATS_REQUEST', '/api/stats');

    // Get total requests
    const totalRequestsResult = await pool.query('SELECT COUNT(*) as count FROM requests');
    const totalRequests = parseInt(totalRequestsResult.rows[0].count);

    // Get total videos
    const totalVideosResult = await pool.query('SELECT COUNT(*) as count FROM videos');
    const totalVideos = parseInt(totalVideosResult.rows[0].count);

    // Get popular videos
    const popularVideosResult = await pool.query(`
      SELECT tweet_id, author, total_downloads 
      FROM videos 
      ORDER BY total_downloads DESC 
      LIMIT 10
    `);

    // Get device stats
    const deviceStatsResult = await pool.query(`
      SELECT device_type, COUNT(*) as count 
      FROM requests 
      GROUP BY device_type
    `);

    res.json({
      success: true,
      statistics: {
        totalRequests,
        totalVideos,
        popularVideos: popularVideosResult.rows,
        deviceStats: deviceStatsResult.rows
      },
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

// Recent requests endpoint
app.get('/api/requests/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ip_address, device_type, browser, platform, twitter_url, timestamp 
      FROM requests 
      ORDER BY timestamp DESC 
      LIMIT 50
    `);

    res.json({
      success: true,
      recentRequests: result.rows,
      total: result.rows.length,
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  } catch (error) {
    console.error('Recent requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent requests',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// Video search endpoint
app.get('/api/videos/search', async (req, res) => {
  try {
    const { author, limit = 20 } = req.query;

    let query = 'SELECT * FROM videos';
    let params = [];

    if (author) {
      query += ' WHERE author ILIKE $1';
      params.push(`%${author}%`);
    }

    query += ' ORDER BY last_fetched DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      videos: result.rows,
      total: result.rows.length,
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  } catch (error) {
    console.error('Video search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search videos',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Log health check request
    await logRequest(req, 'HEALTH_CHECK', '/health');

    // Test database connection
    const dbResult = await pool.query('SELECT COUNT(*) as count FROM requests');
    const totalRequests = parseInt(dbResult.rows[0].count);

    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        totalRequests: totalRequests
      },
      service: 'Twitter Video Download API with PostgreSQL',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: error.message
      },
      service: 'Twitter Video Download API',
      author: '@m2hgamerz',
      telegram: 'https://t.me/m2hgamerz'
    });
  }
});

// API documentation
app.get('/api', (req, res) => {
  res.json({
    service: 'Twitter Video Download API',
    version: '2.0',
    description: 'Professional API for downloading Twitter videos with PostgreSQL database',
    author: '@m2hgamerz',
    telegram: 'https://t.me/m2hgamerz',
    endpoints: {
      '/api/download': 'Get download links for Twitter video',
      '/api/stats': 'Get API usage statistics',
      '/api/requests/recent': 'Get recent API requests',
      '/api/videos/search': 'Search stored videos',
      '/health': 'Service health check'
    }
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    author: '@m2hgamerz',
    telegram: 'https://t.me/m2hgamerz'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Twitter Video API running on port ${PORT}`);
  console.log(`📊 API Playground: http://localhost:${PORT}/playground`);
  console.log(`📚 Documentation: http://localhost:${PORT}/docs`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
  console.log(`👤 Author: @m2hgamerz`);
  console.log(`📱 Telegram: https://t.me/m2hgamerz`);
  console.log(`🗄️  Database: PostgreSQL`);
});