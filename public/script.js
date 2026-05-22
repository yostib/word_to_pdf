// script.js - All frontend functionality

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
    showResult(`Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
}

function showResult(message, type) {
    result.innerHTML = `<div class="result-${type}">${type === 'success' ? '✓' : type === 'error' ? '❌' : 'ℹ️'} ${message}</div>`;
}

function showLoading(message) {
    result.innerHTML = `<div class="result-info"><span class="spinner"></span> ${message}</div>`;
}

// Conversion
convertBtn.addEventListener('click', async () => {
    if (!selectedFile) {
        showResult('Please select a file first', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('document', selectedFile);
    
    showLoading('Converting... Please wait');
    convertBtn.disabled = true;
    
    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            showResult(`${data.message}<br>File size: ${(data.size / 1024 / 1024).toFixed(2)} MB`, 'success');
        } else {
            const error = await response.json();
            showResult(`Error: ${error.error}`, 'error');
        }
    } catch (error) {
        showResult(`Error: ${error.message}`, 'error');
    } finally {
        convertBtn.disabled = false;
    }
});