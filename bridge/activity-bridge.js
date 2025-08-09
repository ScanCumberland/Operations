// Basic placeholder for Activity Bridge server
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Activity Bridge Running'));
app.listen(8091, () => console.log('Bridge running on port 8091'));
