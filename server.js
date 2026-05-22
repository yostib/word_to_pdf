const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { rimraf } = require('rimraf');

const app = express();
const PORT = process.env.PORT || 3000;

// Create temp directory for this server run
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Configure multer for memory storage (better for temp files)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
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

// Serve static files (HTML, CSS, JS)
app.use(express.static('public'));

// Conversion endpoint
app.post('/convert', upload.single('document'), async (req, res) => {
    let sessionId = null;
    let inputPath = null;
    let outputPath = null;
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Create unique session ID for this conversion
        sessionId = uuidv4();
        const sessionDir = path.join(tempDir, sessionId);
        fs.mkdirSync(sessionDir);
        
        // Save uploaded file
        const originalExt = path.extname(req.file.originalname);
        const inputFilename = `input${originalExt}`;
        inputPath = path.join(sessionDir, inputFilename);
        fs.writeFileSync(inputPath, req.file.buffer);
        
        // Prepare output path
        const outputFilename = 'output.pdf';
        outputPath = path.join(sessionDir, outputFilename);
        
        // LibreOffice path on Mac
        const libreOfficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
        
        // Check if LibreOffice exists
        if (!fs.existsSync(libreOfficePath)) {
            throw new Error('LibreOffice not found. Please install it from https://www.libreoffice.org/');
        }
        
        // Convert using LibreOffice
        const command = `"${libreOfficePath}" --headless --convert-to pdf --outdir "${sessionDir}" "${inputPath}"`;
        
        await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('LibreOffice error:', stderr);
                    reject(new Error('Conversion failed. Please check if the file is valid.'));
                } else {
                    resolve();
                }
            });
        });
        
        // Check if PDF was created
        if (!fs.existsSync(outputPath)) {
            // Sometimes LibreOffice names it differently
            const files = fs.readdirSync(sessionDir);
            const pdfFile = files.find(f => f.endsWith('.pdf'));
            if (pdfFile) {
                outputPath = path.join(sessionDir, pdfFile);
            } else {
                throw new Error('PDF file was not created');
            }
        }
        
        // Send the PDF file
        const pdfBuffer = fs.readFileSync(outputPath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${req.file.originalname.replace(/\.docx?$/i, '.pdf')}"`);
        res.send(pdfBuffer);
        
        // Cleanup: Delete session folder after sending response
        setTimeout(() => {
            rimraf(sessionDir).catch(console.error);
        }, 1000);
        
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({ error: error.message || 'Conversion failed' });
        
        // Cleanup on error
        if (sessionId) {
            const sessionDir = path.join(tempDir, sessionId);
            rimraf(sessionDir).catch(console.error);
        }
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Temp directory: ${tempDir}`);
    console.log(`🔄 LibreOffice path: /Applications/LibreOffice.app/Contents/MacOS/soffice`);
});