const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.raw({ type: '*/*', limit: '50mb' }));

const TARGET = 'https://catbypass.catapis.uk';
const HEROKU_BASE = 'https://catbypa66-d179a5790403.herokuapp.com';

// Root route for Heroku health check
app.get('/', (req, res) => {
    res.send('CatBypass Heroku Proxy is running!');
});

// ===== WEB PROXY ENDPOINT =====
// This proxies external websites directly without going through catbypass.catapis.uk
app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.send(`<!DOCTYPE html>
<html><head><title>CatBypass Proxy</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #1a1a2e; color: #eee; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.container { text-align: center; padding: 40px; }
h1 { background: linear-gradient(135deg, #5865f2, #eb459e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 3em; }
form { margin: 30px 0; }
input[type="url"] { width: 400px; padding: 12px 20px; border: 2px solid #5865f2; border-radius: 25px; background: #16213e; color: #fff; font-size: 16px; }
button { padding: 12px 30px; background: linear-gradient(135deg, #5865f2, #eb459e); border: none; border-radius: 25px; color: white; font-size: 16px; cursor: pointer; margin-left: 10px; }
</style>
</head><body>
<div class="container">
<h1>🐱 CatBypass Proxy</h1>
<p>Enter a URL to browse through the proxy</p>
<form action="/proxy" method="GET">
<input type="url" name="url" placeholder="https://example.com" required>
<button type="submit">Go</button>
</form>
</div>
</body></html>`);
    }
    
    console.log('Web Proxy:', req.method, targetUrl);
    
    try {
        // Prepare headers
        const headers = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
            'Accept-Encoding': 'identity',
        };
        
        // Set referer/origin to target site
        const targetOrigin = new URL(targetUrl).origin;
        headers['Referer'] = targetOrigin + '/';
        headers['Origin'] = targetOrigin;
        
        // Forward body for POST/PUT/PATCH
        const fetchOptions = {
            method: req.method,
            headers: headers,
            redirect: 'follow',
        };
        
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (req.headers['content-type']) {
                headers['Content-Type'] = req.headers['content-type'];
            }
            if (Buffer.isBuffer(req.body)) {
                fetchOptions.body = req.body;
            } else if (typeof req.body === 'object') {
                fetchOptions.body = JSON.stringify(req.body);
            }
        }
        
        const response = await fetch(targetUrl, fetchOptions);
        const contentType = response.headers.get('content-type') || 'text/html';
        const buffer = await response.buffer();
        
        // Check if it's HTML that needs URL rewriting
        if (contentType.includes('text/html')) {
            let html = buffer.toString('utf8');
            
            // Rewrite URLs to go through the proxy
            // Replace absolute URLs with proxy URLs
            html = html.replace(/(href|src|action)=["'](?:https?:)?\/\/([^"']+)["']/gi, (match, attr, url) => {
                const fullUrl = url.startsWith('//') ? 'https:' + url : 'https://' + url;
                return `${attr}="${HEROKU_BASE}/proxy?url=${encodeURIComponent('https://' + url)}"`;
            });
            
            // Replace relative URLs
            html = html.replace(/(href|src|action)=["']\/([^"'\/][^"']*)["']/gi, (match, attr, path) => {
                const fullUrl = targetOrigin + '/' + path;
                return `${attr}="${HEROKU_BASE}/proxy?url=${encodeURIComponent(fullUrl)}"`;
            });
            
            // Inject base tag to help with relative URLs
            if (!html.includes('<base')) {
                html = html.replace(/<head[^>]*>/i, `$&<base href="${targetOrigin}/">`);
            }
            
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else if (contentType.includes('text/css')) {
            let css = buffer.toString('utf8');
            
            // Rewrite url() in CSS
            css = css.replace(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi, (match, url) => {
                return `url("${HEROKU_BASE}/proxy?url=${encodeURIComponent(url)}")`;
            });
            
            res.set('Content-Type', contentType);
            res.send(css);
        } else {
            // Binary content - pass through as-is
            res.set('Content-Type', contentType);
            res.send(buffer);
        }
    } catch (e) {
        console.error('Web proxy error:', e.message);
        res.status(500).send(`<html><body style="background:#1a1a2e;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
            <h1>🐱 Proxy Error</h1>
            <p>Failed to load: ${targetUrl}</p>
            <p style="color:#ff6b6b;">${e.message}</p>
            <a href="javascript:history.back()" style="color:#5865f2;">Go Back</a>
        </body></html>`);
    }
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
