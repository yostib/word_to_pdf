// script.js - Complete frontend with PDF download

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const result = document.getElementById('result');
let selectedFile = null;

// Drag & Drop Handlers
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

// File Validation
function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext !== 'docx' && ext !== 'doc') {
        showResult('Please upload a .docx or .doc file', 'error');
        return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
        showResult('File too large. Max size is 10MB', 'error');
        return;
    }
    
    selectedFile = file;
    showResult(`✓ Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
}

function showResult(message, type) {
    result.innerHTML = `<div class="result-${type}">${message}</div>`;
}

function showLoading(message) {
    result.innerHTML = `<div class="result-info"><span class="spinner"></span> ${message}</div>`;
}

// Enhanced conversion with queue handling
convertBtn.addEventListener('click', async () => {
    if (!selectedFile) {
        showResult('Please select a file first', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('document', selectedFile);
    
    showLoading('Converting to PDF... This may take a few seconds');
    convertBtn.disabled = true;
    convertBtn.textContent = 'Converting...';
    
    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });
        
        // Check if queued
        const queuePosition = response.headers.get('X-Queue-Position');
        if (response.status === 202 && queuePosition > 1) {
            showResult(`⏳ Server is busy. Your file is #${queuePosition} in queue. Please wait...`, 'info');
        }
        
        if (response.ok) {
            // Get the PDF as a blob
            const blob = await response.blob();
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // Get filename
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'converted.pdf';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            } else {
                filename = selectedFile.name.replace(/\.docx?$/i, '.pdf');
            }
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showResult(`✓ Success! ${filename} has been downloaded.`, 'success');
            
            // Reset for next conversion
            selectedFile = null;
            fileInput.value = '';
        } else if (response.status === 429) {
            const error = await response.json();
            showResult(`⏰ ${error.error}`, 'error');
        } else {
            const error = await response.json();
            showResult(`❌ Error: ${error.error}`, 'error');
        }
    } catch (error) {
        showResult(`❌ Error: ${error.message}`, 'error');
    } finally {
        convertBtn.disabled = false;
        convertBtn.textContent = 'Convert to PDF →';
    }
});