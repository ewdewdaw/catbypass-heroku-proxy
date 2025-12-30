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

// ===== URL ENCODING HELPERS =====
// Use base64 to hide the actual URLs from extensions
function encodeUrl(url) {
    return Buffer.from(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeUrl(encoded) {
    // Add back padding if needed
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return Buffer.from(base64, 'base64').toString('utf8');
}

// Root route for Heroku health check
app.get('/', (req, res) => {
    res.send('CatBypass Heroku Proxy is running!');
});

// ===== STEALTH WEB PROXY ENDPOINT =====
// Uses /s/:encoded format to hide URLs from extension blockers
// The encoded part is base64 of the target URL
app.all('/s/:encoded', async (req, res) => {
    let targetUrl;
    try {
        targetUrl = decodeUrl(req.params.encoded);
    } catch (e) {
        return res.status(400).send('Invalid request');
    }
    
    // Handle the request (shared with /proxy endpoint)
    await handleProxyRequest(req, res, targetUrl, true);
});

// Legacy /proxy endpoint (still works but less stealthy)
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
    
    await handleProxyRequest(req, res, targetUrl, false);
});

// ===== SHARED PROXY HANDLER =====
async function handleProxyRequest(req, res, targetUrl, useStealth) {
    // Helper to build proxy URLs
    const buildProxyUrl = (url) => {
        if (useStealth) {
            return `${HEROKU_BASE}/s/${encodeUrl(url)}`;
        } else {
            return `${HEROKU_BASE}/proxy?url=${encodeURIComponent(url)}`;
        }
    };
    
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
            // Replace absolute URLs with proxy URLs (https:// or //)
            html = html.replace(/(href|src|action|data-src|poster)=["'](https?:\/\/[^"']+)["']/gi, (match, attr, url) => {
                return `${attr}="${buildProxyUrl(url)}"`;
            });
            
            // Handle protocol-relative URLs (//example.com)
            html = html.replace(/(href|src|action|data-src|poster)=["'](\/\/[^"']+)["']/gi, (match, attr, url) => {
                return `${attr}="${buildProxyUrl('https:' + url)}"`;
            });
            
            // Replace root-relative URLs (/path/to/file)
            html = html.replace(/(href|src|action|data-src|poster)=["'](\/[^"'\/][^"']*)["']/gi, (match, attr, path) => {
                const fullUrl = targetOrigin + path;
                return `${attr}="${buildProxyUrl(fullUrl)}"`;
            });
            
            // Rewrite inline styles with url()
            html = html.replace(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi, (match, url) => {
                return `url("${buildProxyUrl(url)}")`;
            });
            
            // Rewrite srcset attributes
            html = html.replace(/srcset=["']([^"']+)["']/gi, (match, srcset) => {
                const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/gi, (url) => buildProxyUrl(url));
                return `srcset="${rewritten}"`;
            });
            
            // Inject script to intercept dynamic requests AND spoof location
            const targetUrlObj = new URL(targetUrl);
            const interceptScript = `
<script>
(function() {
    const PROXY_BASE = "${HEROKU_BASE}";
    const REAL_ORIGIN = "${targetUrlObj.origin}";
    const REAL_HOST = "${targetUrlObj.host}";
    const REAL_HOSTNAME = "${targetUrlObj.hostname}";
    const REAL_HREF = "${targetUrl}";
    const REAL_PATHNAME = "${targetUrlObj.pathname}";
    const REAL_PROTOCOL = "${targetUrlObj.protocol}";
    
    const encodeUrl = (url) => btoa(url).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    const buildProxyUrl = (url) => PROXY_BASE + '/s/' + encodeUrl(url);
    
    // ===== SPOOF LOCATION =====
    // Create a fake location object that looks like the real site
    const fakeLocation = {
        ancestorOrigins: window.location.ancestorOrigins,
        hash: window.location.hash,
        host: REAL_HOST,
        hostname: REAL_HOSTNAME,
        href: REAL_HREF,
        origin: REAL_ORIGIN,
        pathname: REAL_PATHNAME,
        port: "${targetUrlObj.port || ''}",
        protocol: REAL_PROTOCOL,
        search: window.location.search,
        assign: function(url) { window.location.assign(buildProxyUrl(url)); },
        reload: function() { window.location.reload(); },
        replace: function(url) { window.location.replace(buildProxyUrl(url)); },
        toString: function() { return REAL_HREF; }
    };
    
    // Try to override location using Object.defineProperty
    try {
        Object.defineProperty(window, 'location', {
            get: function() { return fakeLocation; },
            configurable: false
        });
    } catch(e) {
        // Location override failed - some browsers prevent this
        console.log('[CatBypass] Location spoof not available');
    }
    
    // Spoof document.location too
    try {
        Object.defineProperty(document, 'location', {
            get: function() { return fakeLocation; },
            configurable: false
        });
    } catch(e) {}
    
    // Spoof document.domain
    try {
        Object.defineProperty(document, 'domain', {
            get: function() { return REAL_HOSTNAME; },
            set: function() {},
            configurable: false
        });
    } catch(e) {}
    
    // Spoof document.URL
    try {
        Object.defineProperty(document, 'URL', {
            get: function() { return REAL_HREF; },
            configurable: false
        });
    } catch(e) {}
    
    // Spoof document.referrer
    try {
        Object.defineProperty(document, 'referrer', {
            get: function() { return REAL_ORIGIN + '/'; },
            configurable: false
        });
    } catch(e) {}
    
    // ===== INTERCEPT FETCH =====
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string' && input.startsWith('http') && !input.includes(PROXY_BASE)) {
            input = buildProxyUrl(input);
        } else if (typeof input === 'string' && input.startsWith('/')) {
            input = buildProxyUrl(REAL_ORIGIN + input);
        }
        return originalFetch.call(this, input, init);
    };
    
    // ===== INTERCEPT XHR =====
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (typeof url === 'string' && url.startsWith('http') && !url.includes(PROXY_BASE)) {
            url = buildProxyUrl(url);
        } else if (typeof url === 'string' && url.startsWith('/')) {
            url = buildProxyUrl(REAL_ORIGIN + url);
        }
        return originalOpen.call(this, method, url, ...args);
    };
    
    // ===== INTERCEPT WEBSOCKET =====
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        // WebSocket proxying would need a different approach
        return new OriginalWebSocket(url, protocols);
    };
    
    // ===== SPOOF postMessage origin checks =====
    const originalPostMessage = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
        if (targetOrigin === '*' || targetOrigin === REAL_ORIGIN) {
            return originalPostMessage.call(this, message, '*', transfer);
        }
        return originalPostMessage.call(this, message, targetOrigin, transfer);
    };
    
    console.log('[CatBypass] Proxy initialized for: ' + REAL_HOSTNAME);
})();
</script>`;
            
            // Inject the script after <head> tag
            html = html.replace(/<head[^>]*>/i, `$&${interceptScript}`);
            
            // Remove base tag if present (we're rewriting all URLs)
            html = html.replace(/<base[^>]*>/gi, '');
            
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else if (contentType.includes('text/css')) {
            let css = buffer.toString('utf8');
            
            // Rewrite url() in CSS
            css = css.replace(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi, (match, url) => {
                return `url("${buildProxyUrl(url)}")`;
            });
            
            // Rewrite relative URLs in CSS
            css = css.replace(/url\(["']?(\/[^"')]+)["']?\)/gi, (match, path) => {
                const fullUrl = targetOrigin + path;
                return `url("${buildProxyUrl(fullUrl)}")`;
            });
            
            res.set('Content-Type', contentType);
            res.send(css);
        } else if (contentType.includes('javascript') || contentType.includes('application/json')) {
            // For JS/JSON, try to rewrite any hardcoded URLs
            let text = buffer.toString('utf8');
            
            // Rewrite absolute URLs in strings
            text = text.replace(/(["'])(https?:\/\/[^"']+)(["'])/gi, (match, q1, url, q2) => {
                // Skip if it's already proxied or is the proxy base
                if (url.includes(HEROKU_BASE)) return match;
                return `${q1}${buildProxyUrl(url)}${q2}`;
            });
            
            res.set('Content-Type', contentType);
            res.send(text);
        } else {
            // Binary content - pass through as-is
            res.set('Content-Type', contentType);
            res.send(buffer);
        }
    } catch (e) {
        console.error('Web proxy error:', e.message);
        res.status(500).send(`<html><body style="background:#1a1a2e;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
            <h1>🐱 Proxy Error</h1>
            <p>Failed to load</p>
            <p style="color:#ff6b6b;">${e.message}</p>
            <a href="javascript:history.back()" style="color:#5865f2;">Go Back</a>
        </body></html>`);
    }
}

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
