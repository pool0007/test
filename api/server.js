const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde la raíz
app.use(express.static(path.join(__dirname, '..')));

// Base de datos SQLite en memoria (para Vercel serverless)
const db = new sqlite3.Database(':memory:', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
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
            { code: 'cl', name: 'Chile', clicks: 7654 }
        ];

        const stmt = db.prepare(`INSERT OR IGNORE INTO countries (countryCode, countryName, totalClicks) VALUES (?, ?, ?)`);
        exampleCountries.forEach(country => {
            stmt.run(country.code, country.name, country.clicks);
        });
        stmt.finalize();
    });
}

// Cache para respuestas rápidas
let leaderboardCache = null;
let totalClicksCache = 0;
let lastCacheUpdate = 0;
const CACHE_DURATION = 2000;

// Rutas de la API
app.post('/api/click', (req, res) => {
    const { userId, countryCode, countryName } = req.body;
    
    // Invalidar cache
    leaderboardCache = null;
    
    db.serialize(() => {
        // Actualizar usuario
        db.run(`INSERT OR REPLACE INTO users (userId, country, totalClicks, lastClick) 
                VALUES (?, ?, COALESCE((SELECT totalClicks FROM users WHERE userId = ?), 0) + 1, datetime('now'))`,
            [userId, countryName, userId]);
        
        // Actualizar país
        db.run(`INSERT OR REPLACE INTO countries (countryCode, countryName, totalClicks) 
                VALUES (?, ?, COALESCE((SELECT totalClicks FROM countries WHERE countryCode = ?), 0) + 1)`,
            [countryCode, countryName, countryCode]);
        
        db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [userId], (err, user) => {
            const userClicks = user?.totalClicks || 0;
            
            db.get(`SELECT SUM(totalClicks) as total FROM countries`, (err, total) => {
                res.json({
                    userClicks: userClicks,
                    totalClicks: total?.total || 0,
                    leaderboard: leaderboardCache
                });
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
            return res.status(500).json({ error: err.message });
        }
        
        db.get(`SELECT SUM(totalClicks) as total FROM countries`, (err, total) => {
            leaderboardCache = leaderboard || [];
            totalClicksCache = total?.total || 0;
            lastCacheUpdate = Date.now();
            
            res.json({
                leaderboard: leaderboardCache,
                totalClicks: totalClicksCache
            });
        });
    });
});

app.get('/api/user/:userId', (req, res) => {
    db.get(`SELECT totalClicks FROM users WHERE userId = ?`, [req.params.userId], (err, user) => {
        res.json({ userClicks: user?.totalClicks || 0 });
    });
});

// Ruta para el frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Manejar todas las rutas del frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Exportar para Vercel
module.exports = app;
