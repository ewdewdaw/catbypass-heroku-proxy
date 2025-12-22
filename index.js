const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const TARGET = 'https://catbypass.catapis.uk';

// Root route for Heroku health check
app.get('/', (req, res) => {
    res.send('CatBypass Heroku Proxy is running!');
});

// Proxy all other requests to the real server
app.all('*', async (req, res) => {
    // Forward the full path to the target server
    const url = TARGET + req.originalUrl;
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
