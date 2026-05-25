const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { rimraf } = require('rimraf');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ QUEUE SYSTEM ============
const queue = [];
let activeConversions = 0;
const MAX_CONCURRENT = 2; // Only process 2 files at once

// ============ ANALYTICS ============
const analyticsFile = path.join(__dirname, 'analytics.json');

// Load or create analytics
let analytics = {
  total_conversions: 0,
  total_unique_ips: [],
  daily_stats: {},
  hourly_distribution: {},
  failed_conversions: 0
};

if (fs.existsSync(analyticsFile)) {
  try {
    const data = fs.readFileSync(analyticsFile, 'utf8');
    analytics = JSON.parse(data);
  } catch (e) {
    console.error('Error loading analytics:', e);
  }
}

// Save analytics function
function saveAnalytics() {
  fs.writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));
}

// Update analytics function
function updateAnalytics(ip, success, fileSize) {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();
  
  // Update daily stats
  if (!analytics.daily_stats[today]) {
    analytics.daily_stats[today] = {
      conversions: 0,
      unique_ips: [],
      total_size_mb: 0
    };
  }
  
  if (success) {
    analytics.total_conversions++;
    analytics.daily_stats[today].conversions++;
    analytics.daily_stats[today].total_size_mb += fileSize / (1024 * 1024);
    
    // Track unique IPs
    if (!analytics.total_unique_ips.includes(ip)) {
      analytics.total_unique_ips.push(ip);
    }
    if (!analytics.daily_stats[today].unique_ips.includes(ip)) {
      analytics.daily_stats[today].unique_ips.push(ip);
    }
    
    // Track hourly distribution
    if (!analytics.hourly_distribution[hour]) {
      analytics.hourly_distribution[hour] = 0;
    }
    analytics.hourly_distribution[hour]++;
  } else {
    analytics.failed_conversions++;
  }
  
  saveAnalytics();
}

// ============ RATE LIMITING ============
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5, // 5 conversions per IP per hour
  message: { error: 'Rate limit exceeded. Please try again in an hour.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => {
    // Don't rate limit the admin endpoints
    return req.path === '/admin' || req.path === '/admin/stats';
  },
  validate: {
    keyGeneratorIpFallback: false,
    ipv6Subnet: false
  }
});

// ============ TEMP DIRECTORY ============
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// LibreOffice path
const libreOfficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

// ============ MULTER CONFIG ============
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .docx and .doc files are allowed'));
    }
  }
});

// ============ CONVERSION FUNCTION ============
async function convertFile(inputBuffer, originalName, sessionId, userIP) {
  const sessionDir = path.join(tempDir, sessionId);
  fs.mkdirSync(sessionDir);
  
  let inputPath = null;
  let outputPath = null;
  
  try {
    // Save uploaded file
    const originalExt = path.extname(originalName);
    const inputFilename = `input${originalExt}`;
    inputPath = path.join(sessionDir, inputFilename);
    fs.writeFileSync(inputPath, inputBuffer);
    
    // Prepare output path
    const outputFilename = 'output.pdf';
    outputPath = path.join(sessionDir, outputFilename);
    
    // Convert using LibreOffice
    const command = `"${libreOfficePath}" --headless --convert-to pdf --outdir "${sessionDir}" "${inputPath}"`;
    
    await new Promise((resolve, reject) => {
      exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Conversion failed'));
        } else {
          resolve();
        }
      });
    });
    
    // Check if PDF was created
    if (!fs.existsSync(outputPath)) {
      const files = fs.readdirSync(sessionDir);
      const pdfFile = files.find(f => f.endsWith('.pdf'));
      if (pdfFile) {
        outputPath = path.join(sessionDir, pdfFile);
      } else {
        throw new Error('PDF file was not created');
      }
    }
    
    const pdfBuffer = fs.readFileSync(outputPath);
    
    // Update analytics on success
    updateAnalytics(userIP, true, inputBuffer.length);
    
    return { success: true, pdfBuffer, sessionDir };
    
  } catch (error) {
    // Update analytics on failure
    updateAnalytics(userIP, false, 0);
    throw error;
  }
}

// ============ QUEUE PROCESSOR ============
async function processQueue() {
  if (activeConversions >= MAX_CONCURRENT || queue.length === 0) {
    return;
  }
  
  const job = queue.shift();
  activeConversions++;
  
  try {
    const result = await convertFile(
      job.inputBuffer,
      job.originalName,
      job.sessionId,
      job.userIP
    );
    
    // Send response
    job.res.setHeader('Content-Type', 'application/pdf');
    job.res.setHeader('Content-Disposition', `attachment; filename="${job.originalName.replace(/\.docx?$/i, '.pdf')}"`);
    job.res.send(result.pdfBuffer);
    
    // Cleanup
    setTimeout(() => {
      rimraf(result.sessionDir).catch(console.error);
    }, 1000);
    
  } catch (error) {
    job.res.status(500).json({ error: error.message });
    
    // Cleanup on error
    const sessionDir = path.join(tempDir, job.sessionId);
    rimraf(sessionDir).catch(console.error);
  } finally {
    activeConversions--;
    processQueue(); // Process next job
  }
}

// Add to queue function
function addToQueue(req, res, next) {
  const sessionId = uuidv4();
  const job = {
    inputBuffer: req.file.buffer,
    originalName: req.file.originalname,
    sessionId: sessionId,
    userIP: req.ip || req.connection.remoteAddress,
    res: res
  };
  
  queue.push(job);
  
  // Send queue position to client
  const position = queue.length;
  res.setHeader('X-Queue-Position', position);
  res.setHeader('X-Active-Conversions', activeConversions);
  
  if (position > 1) {
    res.status(202).json({ 
      status: 'queued', 
      position: position,
      message: `Your file is queued. Position: ${position}`
    });
  }
  
  processQueue();
}

// ============ EXPRESS APP ============
app.use(express.static('public'));
app.use('/convert', limiter);

// Conversion endpoint
app.post('/convert', upload.single('document'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Check if LibreOffice exists
  if (!fs.existsSync(libreOfficePath)) {
    return res.status(500).json({ error: 'LibreOffice not installed' });
  }
  
  // Check queue length
  if (queue.length > 20) {
    return res.status(503).json({ error: 'Server is very busy. Please try again in a few minutes.' });
  }
  
  addToQueue(req, res);
});

// ============ ADMIN DASHBOARD ============
app.get('/admin', (req, res) => {
  // Simple password protection (you can change this)
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Admin access required');
  }
  
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];
  
  // CHANGE THIS PASSWORD! (username: admin, password: change_this)
  if (username !== 'admin' || password !== 'convert123') {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid credentials');
  }
  
  // Send admin HTML
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin stats endpoint (JSON)
app.get('/admin/stats', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (credentials[0] !== 'admin' || credentials[1] !== 'convert123') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const queueInfo = {
    current_queue_length: queue.length,
    active_conversions: activeConversions,
    max_concurrent: MAX_CONCURRENT
  };
  
  res.json({
    analytics,
    queue: queueInfo,
    uptime: process.uptime()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    queue_length: queue.length,
    active_conversions: activeConversions,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Temp directory: ${tempDir}`);
  console.log(`🔄 Max concurrent conversions: ${MAX_CONCURRENT}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`🔐 Admin credentials: admin / convert123 (CHANGE THIS!)`);
});