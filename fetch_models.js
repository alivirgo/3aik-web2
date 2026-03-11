const https = require('https');

https.get('https://text.pollinations.ai/models', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log("Raw Data:", data);
        try {
            const models = JSON.parse(data);
            console.log("--- Models ---");
            models.forEach(m => {
                console.log(`- ID: ${m.name || m.id || m.model || 'N/A'}`);
            });
        } catch (e) {
            console.error("JSON Parse Error:", e.message);
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
