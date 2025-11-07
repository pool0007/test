const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde la raíz
app.use(express.static(path.join(__dirname, '..')));

// Rutas específicas para archivos estáticos con manejo de errores
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

// Middleware para logging de requests (para debug)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Base de datos SQLite en memoria (para Vercel serverless)
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

        // Insertar datos de ejemplo
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

// Cache para respuestas rápidas
let leaderboardCache = null;
let totalClicksCache = 0;
let lastCacheUpdate = 0;
const CACHE_DURATION = 2000; // 2 segundos

// Ruta de health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'Pop-Dak API is running' 
    });
});

// Rutas de la API OPTIMIZADAS
app.post('/api/click', (req, res) => {
    const { userId, countryCode, countryName } = req.body;
    
    if (!userId || !countryCode) {
        return res.status(400).json({ error: 'Missing required fields: userId and countryCode' });
    }
    
    console.log(`🖱️ Click received from user: ${userId}, country: ${countryCode}`);
    
    // Invalidar cache
    leaderboardCache = null;
    
    // Usar transacción para mayor velocidad
    db.serialize(() => {
        // Actualizar usuario
        db.run(`INSERT OR REPLACE INTO users (userId, country, totalClicks, lastClick) 
                VALUES (?, ?, COALESCE((SELECT totalClicks FROM users WHERE userId = ?), 0) + 1, datetime('now'))`,
            [userId, countryName, userId], function(err) {
                if (err) {
                    console.error('Error updating user:', err);
                }
            });
        
        // Actualizar país
        db.run(`INSERT OR REPLACE INTO countries (countryCode, countryName, totalClicks) 
                VALUES (?, ?, COALESCE((SELECT totalClicks FROM countries WHERE countryCode = ?), 0) + 1)`,
            [countryCode, countryName, countryCode], function(err) {
                if (err) {
                    console.error('Error updating country:', err);
                }
            });
        
        // Respuesta inmediata sin esperar todas las consultas
        db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, user) => {
            if (err) {
                console.error('Error getting user clicks:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            const userClicks = user?.totalClicks || 0;
            
            // Obtener total rápido
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
                
                console.log(`✅ Click processed - User: ${userClicks} clicks, Total: ${response.totalClicks} clicks`);
                res.json(response);
            });
        });
    });
});

app.get('/api/leaderboard', (req, res) => {
    const now = Date.now();
    
    // Usar cache si está fresco
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
            
            // Actualizar cache
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
        
        res.json({ userClicks: user?.totalClicks || 0 });
    });
});

// Ruta para verificar archivos estáticos
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
            path: filePath
        };
    });
    
    res.json({
        currentDir: __dirname,
        rootDir: path.join(__dirname, '..'),
        files: fileStatus
    });
});

// Ruta principal - servir el HTML
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, '../index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).json({ error: 'index.html not found' });
    }
});

// Manejar todas las rutas del frontend (para SPA)
app.get('*', (req, res) => {
    // Si es una ruta de API, devolver 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    // Para cualquier otra ruta, servir el index.html (SPA)
    const htmlPath = path.join(__dirname, '../index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).json({ error: 'Page not found' });
    }
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('🚨 Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Exportar para Vercel
module.exports = app;

// Solo para desarrollo local
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Pop-Dak Server running on port ${PORT}`);
        console.log(`📁 Current directory: ${__dirname}`);
        console.log(`📁 Root directory: ${path.join(__dirname, '..')}`);
    });
}
