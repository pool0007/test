const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/image1.png', (req, res) => {
  const imagePath = path.join(__dirname, '../image1.png');
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: 'image1.png not found' });
  }
});

app.get('/image2.png', (req, res) => {
  const imagePath = path.join(__dirname, '../image2.png');
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: 'image2.png not found' });
  }
});

app.get('/backback.png', (req, res) => {
  const imagePath = path.join(__dirname, '../backback.png');
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: 'backback.png not found' });
  }
});

app.get('/sound.mp3', (req, res) => {
  const soundPath = path.join(__dirname, '../sound.mp3');
  if (fs.existsSync(soundPath)) {
    res.sendFile(soundPath);
  } else {
    res.status(404).json({ error: 'sound.mp3 not found' });
  }
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const db = new sqlite3.Database(':memory:', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        country TEXT,
        totalClicks INTEGER DEFAULT 0,
        lastClick TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS countries (
        countryCode TEXT PRIMARY KEY,
        countryName TEXT,
        totalClicks INTEGER DEFAULT 0
    )`);
    const exampleCountries = [
      { code: 'mx', name: 'México', clicks: 15234 },
      { code: 'es', name: 'España', clicks: 12876 },
      { code: 'ar', name: 'Argentina', clicks: 9876 },
      { code: 'co', name: 'Colombia', clicks: 8765 },
      { code: 'cl', name: 'Chile', clicks: 7654 },
      { code: 'us', name: 'United States', clicks: 6543 },
      { code: 'br', name: 'Brazil', clicks: 5432 },
      { code: 'pe', name: 'Perú', clicks: 4321 },
      { code: 'fr', name: 'France', clicks: 3210 },
      { code: 'de', name: 'Germany', clicks: 2109 }
    ];
    const stmt = db.prepare(`INSERT OR IGNORE INTO countries (countryCode, countryName, totalClicks) VALUES (?, ?, ?)`);
    exampleCountries.forEach(country => {
      stmt.run(country.code, country.name, country.clicks);
    });
    stmt.finalize();
    console.log('✅ Database initialized with sample data');
  });
}

let leaderboardCache = null;
let totalClicksCache = 0;
let lastCacheUpdate = 0;
const CACHE_DURATION = 2000;

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Pop-Dak API is running'
  });
});

app.post('/api/clicks', (req, res) => {
  const { userId, countryCode, countryName, clicks, currentTotal } = req.body;
  if (!userId || !countryCode || !clicks || clicks < 1) {
    return res.status(400).json({ error: 'Missing required fields: userId, countryCode, and clicks' });
  }
  console.log(`🖱️ Processing ${clicks} clicks from user: ${userId}, country: ${countryCode}`);
  leaderboardCache = null;
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, existingUser) => {
      if (err) {
        console.error('❌ Error getting user data:', err);
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Database error' });
      }
      const currentUserClicks = existingUser?.totalClicks || 0;
      const newUserClicks = currentUserClicks + clicks;
      if (currentTotal && newUserClicks < currentTotal) {
        console.warn(`⚠️ Possible data loss: new ${newUserClicks} < current ${currentTotal}`);
        const finalUserClicks = Math.max(newUserClicks, currentTotal);
        db.run(`INSERT OR REPLACE INTO users (userId, country, totalClicks, lastClick) 
                VALUES (?, ?, ?, datetime('now'))`,
          [userId, countryName, finalUserClicks], function (err) {
            if (err) {
              console.error('❌ Error updating user:', err);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Database error updating user' });
            }
          });
      } else {
        db.run(`INSERT OR REPLACE INTO users (userId, country, totalClicks, lastClick) 
                VALUES (?, ?, ?, datetime('now'))`,
          [userId, countryName, newUserClicks], function (err) {
            if (err) {
              console.error('❌ Error updating user:', err);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Database error updating user' });
            }
          });
      }
      db.get(`SELECT totalClicks FROM countries WHERE countryCode = ?`, [countryCode], (err, existingCountry) => {
        if (err) {
          console.error('❌ Error getting country data:', err);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Database error' });
        }
        const currentCountryClicks = existingCountry?.totalClicks || 0;
        const newCountryClicks = currentCountryClicks + clicks;
        db.run(`INSERT OR REPLACE INTO countries (countryCode, countryName, totalClicks) 
                VALUES (?, ?, ?)`,
          [countryCode, countryName, newCountryClicks], function (err) {
            if (err) {
              console.error('❌ Error updating country:', err);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Database error updating country' });
            }
          });
        db.run('COMMIT', (err) => {
          if (err) {
            console.error('❌ Transaction commit error:', err);
            return res.status(500).json({ error: 'Transaction failed' });
          }
          db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, finalUser) => {
            if (err) {
              console.error('❌ Error getting final user clicks:', err);
              return res.status(500).json({ error: 'Database error' });
            }
            const finalUserClicks = finalUser?.totalClicks || newUserClicks;
            console.log(`✅ Successfully processed ${clicks} clicks for user ${userId}. User: ${currentUserClicks} → ${finalUserClicks}, Country: ${currentCountryClicks} → ${newCountryClicks}`);
            res.json({
              userClicks: finalUserClicks,
              message: `Successfully processed ${clicks} clicks`,
              previousUserClicks: currentUserClicks,
              previousCountryClicks: currentCountryClicks
            });
          });
        });
      });
    });
  });
});

app.post('/api/click', (req, res) => {
  const { userId, countryCode, countryName } = req.body;
  if (!userId || !countryCode) {
    return res.status(400).json({ error: 'Missing required fields: userId and countryCode' });
  }
  console.log(`🖱️ Single click from user: ${userId}, country: ${countryCode}`);
  leaderboardCache = null;
  db.serialize(() => {
    db.run(`INSERT OR REPLACE INTO users (userId, country, totalClicks, lastClick) 
            VALUES (?, ?, COALESCE((SELECT totalClicks FROM users WHERE userId = ?), 0) + 1, datetime('now'))`,
      [userId, countryName, userId], function (err) {
        if (err) {
          console.error('Error updating user:', err);
        }
      });
    db.run(`INSERT OR REPLACE INTO countries (countryCode, countryName, totalClicks) 
            VALUES (?, ?, COALESCE((SELECT totalClicks FROM countries WHERE countryCode = ?), 0) + 1)`,
      [countryCode, countryName, countryCode], function (err) {
        if (err) {
          console.error('Error updating country:', err);
        }
      });
    db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, user) => {
      if (err) {
        console.error('Error getting user clicks:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const userClicks = user?.totalClicks || 0;
      db.get(`SELECT SUM(totalClicks) as total FROM countries`, (err, total) => {
        if (err) {
          console.error('Error getting total clicks:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        const response = {
          userClicks: userClicks,
          totalClicks: total?.total || 0,
          leaderboard: leaderboardCache
        };
        console.log(`✅ Single click processed - User: ${userClicks} clicks, Total: ${response.totalClicks} clicks`);
        res.json(response);
      });
    });
  });
});

app.get('/api/leaderboard', (req, res) => {
  const now = Date.now();
  if (leaderboardCache && (now - lastCacheUpdate) < CACHE_DURATION) {
    return res.json({
      leaderboard: leaderboardCache,
      totalClicks: totalClicksCache
    });
  }
  db.all(`SELECT countryCode, countryName, totalClicks 
           FROM countries 
           ORDER BY totalClicks DESC 
           LIMIT 10`, (err, leaderboard) => {
    if (err) {
      console.error('Error fetching leaderboard:', err);
      return res.status(500).json({ error: err.message });
    }
    db.get(`SELECT SUM(totalClicks) as total FROM countries`, (err, total) => {
      if (err) {
        console.error('Error fetching total clicks:', err);
        return res.status(500).json({ error: err.message });
      }
      leaderboardCache = leaderboard || [];
      totalClicksCache = total?.total || 0;
      lastCacheUpdate = Date.now();
      console.log(`📊 Leaderboard updated - Total clicks: ${totalClicksCache}`);
      res.json({
        leaderboard: leaderboardCache,
        totalClicks: totalClicksCache
      });
    });
  });
});

app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId;
  db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, user) => {
    if (err) {
      console.error('Error fetching user data:', err);
      return res.status(500).json({ error: err.message });
    }
    const userClicks = user?.totalClicks || 0;
    console.log(`📊 User data requested: ${userId} - ${userClicks} clicks`);
    res.json({ userClicks: userClicks });
  });
});

app.get('/api/stats', (req, res) => {
  db.serialize(() => {
    db.get(`SELECT COUNT(*) as totalUsers FROM users`, (err, users) => {
      if (err) {
        console.error('Error getting user count:', err);
        return res.status(500).json({ error: err.message });
      }
      db.get(`SELECT COUNT(*) as totalCountries FROM countries`, (err, countries) => {
        if (err) {
          console.error('Error getting country count:', err);
          return res.status(500).json({ error: err.message });
        }
        db.get(`SELECT SUM(totalClicks) as totalClicks FROM countries`, (err, clicks) => {
          if (err) {
            console.error('Error getting total clicks:', err);
            return res.status(500).json({ error: err.message });
          }
          res.json({
            totalUsers: users?.totalUsers || 0,
            totalCountries: countries?.totalCountries || 0,
            totalClicks: clicks?.totalClicks || 0,
            timestamp: new Date().toISOString()
          });
        });
      });
    });
  });
});

app.get('/api/debug/files', (req, res) => {
  const files = [
    'image1.png',
    'image2.png',
    'backback.png',
    'sound.mp3',
    'index.html'
  ];
  const fileStatus = {};
  files.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    fileStatus[file] = {
      exists: fs.existsSync(filePath),
      path: filePath,
      size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
    };
  });
  res.json({
    currentDir: __dirname,
    rootDir: path.join(__dirname, '..'),
    files: fileStatus,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/reset', (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Reset only allowed in development' });
  }
  db.serialize(() => {
    db.run('DELETE FROM users');
    db.run('DELETE FROM countries');
    initializeDatabase();
    leaderboardCache = null;
    totalClicksCache = 0;
    res.json({ message: 'Database reset successfully' });
  });
});

app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '../index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).json({ error: 'index.html not found' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const htmlPath = path.join(__dirname, '../index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).json({ error: 'Page not found' });
  }
});

app.use((err, req, res, next) => {
  console.error('🚨 Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Pop-Dak Server running on port ${PORT}`);
    console.log(`📁 Current directory: ${__dirname}`);
    console.log(`📁 Root directory: ${path.join(__dirname, '..')}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ API endpoints available:`);
    console.log(`   GET  /api/health`);
    console.log(`   POST /api/clicks`);
    console.log(`   POST /api/click`);
    console.log(`   GET  /api/leaderboard`);
    console.log(`   GET  /api/user/:userId`);
    console.log(`   GET  /api/stats`);
    console.log(`   GET  /api/debug/files`);
  });
}
