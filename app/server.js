const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3477;

// Middleware to serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Chat API endpoint
app.use(express.json());
app.post('/chat', async (req, res) => {
    try {
        const response = await axios.post('http://localhost:11434', req.body);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding prompt to Ollama:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
