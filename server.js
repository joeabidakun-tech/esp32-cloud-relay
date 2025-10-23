// ========================================
// ESP32 Cloud Relay Server - Node.js
// Free deployment on Render.com/Railway
// ========================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const ESP32_AUTH_TOKEN = process.env.ESP32_TOKEN || 'esp32_secret_token_2025';
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'admin123';

// Store connections
let esp32Connection = null;
const webClients = new Set();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS headers for API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ========== HTTP ENDPOINTS ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    esp32Connected: esp32Connection !== null,
    webClients: webClients.size,
    uptime: process.uptime()
  });
});

// Authentication
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === WEB_PASSWORD) {
    res.json({ success: true, token: 'web_access_granted' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Send command to ESP32
app.post('/api/command', (req, res) => {
  const { command } = req.body;
  
  if (!esp32Connection || esp32Connection.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ success: false, message: 'ESP32 not connected' });
  }
  
  try {
    esp32Connection.send(JSON.stringify({
      type: 'command',
      data: command
    }));
    res.json({ success: true, message: 'Command sent to ESP32' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== WEBSOCKET HANDLING ==========

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);
  
  // Identify client type
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // ESP32 identification
      if (data.type === 'esp32_connect' && data.token === ESP32_AUTH_TOKEN) {
        if (esp32Connection) {
          console.log('⚠️ ESP32 already connected, replacing old connection');
          esp32Connection.close();
        }
        
        esp32Connection = ws;
        ws.clientType = 'esp32';
        console.log('✅ ESP32 connected and authenticated');
        
        // Notify all web clients
        broadcastToWebClients({
          type: 'esp32_status',
          connected: true
        });
        
        // Send acknowledgment
        ws.send(JSON.stringify({
          type: 'connected',
          message: 'ESP32 successfully connected to cloud relay'
        }));
        return;
      }
      
      // Web client identification
      if (data.type === 'web_connect') {
        ws.clientType = 'web';
        webClients.add(ws);
        console.log(`✅ Web client connected (Total: ${webClients.size})`);
        
        // Send current ESP32 status
        ws.send(JSON.stringify({
          type: 'esp32_status',
          connected: esp32Connection !== null
        }));
        return;
      }
      
      // Route messages based on client type
      if (ws.clientType === 'esp32') {
        // ESP32 → Web clients
        console.log('ESP32 → Web:', data.type);
        broadcastToWebClients(data);
      } else if (ws.clientType === 'web') {
        // Web → ESP32
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
          console.log('Web → ESP32:', data.type);
          esp32Connection.send(message);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'ESP32 not connected'
          }));
        }
      }
      
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    if (ws.clientType === 'esp32') {
      console.log('❌ ESP32 disconnected');
      esp32Connection = null;
      broadcastToWebClients({
        type: 'esp32_status',
        connected: false
      });
    } else if (ws.clientType === 'web') {
      webClients.delete(ws);
      console.log(`❌ Web client disconnected (Remaining: ${webClients.size})`);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast to all web clients
function broadcastToWebClients(data) {
  const message = JSON.stringify(data);
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ========== SERVER START ==========

server.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 ESP32 Cloud Relay Server Running');
  console.log('========================================');
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
  console.log(`🔐 ESP32 Token: ${ESP32_AUTH_TOKEN}`);
  console.log(`🔑 Web Password: ${WEB_PASSWORD}`);
  console.log('========================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
