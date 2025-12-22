const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const TARGET = 'https://catbypass.catapis.uk';

// Root route for Heroku health check
app.get('/', (req, res) => {
    res.send('CatBypass Heroku Proxy is running!');
});

// Static files handler - always return as binary
app.get('/static/*', async (req, res) => {
    const url = TARGET + req.originalUrl;
    console.log('Static file:', url);
    try {
        const response = await fetch(url);
        const buffer = await response.buffer();
        
        // Determine content type from extension
        const ext = req.originalUrl.split('.').pop().toLowerCase();
        const mimeTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'ico': 'image/x-icon',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'css': 'text/css',
            'js': 'application/javascript'
        };
        const contentType = mimeTypes[ext] || response.headers.get('content-type') || 'application/octet-stream';
        
        res.set('Content-Type', contentType);
        res.status(response.status);
        res.send(buffer);
    } catch (e) {
        console.error('Static file error:', e.message);
        res.status(500).json({ error: 'Static file error', message: e.message });
    }
});

// Profile picture raw endpoints - return binary images
app.get('/api/profile/*/pic/raw', async (req, res) => {
    const url = TARGET + req.originalUrl;
    console.log('Profile pic raw:', url);
    try {
        const response = await fetch(url);
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.startsWith('image/')) {
            const buffer = await response.buffer();
            res.set('Content-Type', contentType);
            res.status(response.status);
            res.send(buffer);
        } else {
            // It's JSON (error or redirect)
            const data = await response.text();
            res.set('Content-Type', 'application/json');
            res.status(response.status);
            res.send(data);
        }
    } catch (e) {
        console.error('Profile pic error:', e.message);
        res.status(500).json({ error: 'Profile pic error', message: e.message });
    }
});

// Proxy all other requests to the real server
app.all('*', async (req, res) => {
    // Forward the full path to the target server
    const url = TARGET + req.originalUrl;
    console.log('Proxy:', req.method, url);
    try {
        const options = {
            method: req.method,
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        };
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            options.body = JSON.stringify(req.body);
        }
        const response = await fetch(url, options);
        const data = await response.text();
        
        // Always set JSON content type for API responses
        res.set('Content-Type', 'application/json');
        res.status(response.status);
        
        try {
            // Validate it's JSON and send
            JSON.parse(data);
            res.send(data);
        } catch {
            // If not valid JSON, wrap error in JSON
            res.json({ error: 'Invalid response from server', raw: data.substring(0, 200) });
        }
    } catch (e) {
        res.status(500).json({ error: 'Proxy error', message: e.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('Proxy server running on port', PORT);
});
