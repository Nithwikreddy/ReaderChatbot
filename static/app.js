// Cache DOM Elements
const statusApi = document.getElementById('status-api');
const statusDoc = document.getElementById('status-doc');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const docInfoCard = document.getElementById('doc-info-card');
const loadedDocName = document.getElementById('loaded-doc-name');
const loadedDocSize = document.getElementById('loaded-doc-size');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPct = document.getElementById('progress-pct');
const chatStatusBadge = document.getElementById('chat-status-badge');
const chatMessages = document.getElementById('chat-messages');
const chatEmptyState = document.getElementById('chat-empty-state');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSubmitBtn = document.getElementById('chat-submit-btn');
const resetDocBtn = document.getElementById('reset-doc-btn');

let activeSkeleton = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkStatus();
    setupUploadHandlers();
    setupChatHandlers();
    setupResetHandler();
});

// 1. Fetch Backend System Status
async function checkStatus() {
    try {
        const response = await fetch('/status');
        const data = await response.json();
        
        // Update API Badge
        if (data.has_api_key) {
            statusApi.className = 'status-badge status-success';
            statusApi.querySelector('.status-text').textContent = `API: Configured (${capitalize(data.api_provider)})`;
        } else {
            statusApi.className = 'status-badge status-error';
            statusApi.querySelector('.status-text').textContent = 'API Key Missing';
            showErrorBanner('No API key found. Please set GEMINI_API_KEY or OPENAI_API_KEY in your environment, then restart the application.');
        }

        // Update Document Badge & Interface locking
        if (data.document_loaded) {
            statusDoc.className = 'status-badge status-success';
            statusDoc.querySelector('.status-text').textContent = 'Doc Active';
            
            // Unlock Chat
            unlockChat(data.document_name);
        } else {
            statusDoc.className = 'status-badge status-empty';
            statusDoc.querySelector('.status-text').textContent = 'No Doc Active';
            
            // Lock Chat
            lockChat();
        }
    } catch (err) {
        console.error('Error checking system status:', err);
        statusApi.className = 'status-badge status-error';
        statusApi.querySelector('.status-text').textContent = 'Server Offline';
    }
}

// 2. Upload Handlers (Drag and Drop / Click selector)
function setupUploadHandlers() {
    // Click on zone triggers hidden input
    uploadZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });

    // Drag-and-drop visual indicators
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadZone.classList.remove('dragover');
        }, false);
    });

    uploadZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleSelectedFile(files[0]);
        }
    });
}

function handleSelectedFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        showErrorBanner('Invalid file type! Please upload a PDF document.');
        return;
    }
    if (file.size > 10 * 1024 * 1024) { // 10MB Limit
        showErrorBanner('File too large! Max file size limit is 10MB.');
        return;
    }
    
    uploadFile(file);
}

// 3. Upload File to Backend & Animate Progress
async function uploadFile(file) {
    // Show info card, hide upload details
    docInfoCard.classList.remove('hidden');
    loadedDocName.textContent = file.name;
    loadedDocSize.textContent = formatBytes(file.size);
    
    // Clear any previous error banners
    removeErrorBanner();
    
    // Animate a simulated progress bar for parsing/indexing stages
    progressBar.style.width = '0%';
    progressPct.textContent = '0%';
    progressText.textContent = 'Uploading document...';
    
    let progress = 0;
    const progressInterval = setInterval(() => {
        if (progress < 90) {
            // Increments get smaller as it gets closer to 90%
            const increment = Math.max(1, (90 - progress) * 0.15);
            progress += increment;
            
            progressBar.style.width = `${Math.floor(progress)}%`;
            progressPct.textContent = `${Math.floor(progress)}%`;
            
            if (progress > 65) {
                progressText.textContent = 'Generating embeddings and vector indexing...';
            } else if (progress > 35) {
                progressText.textContent = 'Extracting pages & text content...';
            } else {
                progressText.textContent = 'Reading raw PDF binary bytes...';
            }
        }
    }, 250);

    // Prepare multipart form data
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || 'Failed to upload PDF.');
        }

        const data = await response.json();
        
        // Completion state
        progressBar.style.width = '100%';
        progressPct.textContent = '100%';
        progressText.textContent = 'Indexing successfully completed!';
        
        // Trigger status refresh
        await checkStatus();
        
        // Reset message log for the new document
        chatMessages.innerHTML = '';
        chatEmptyState.classList.add('hidden');
        appendBotMessage(`Hello! I have loaded and indexed **"${file.name}"**. You can now ask questions about its content!`);
        
    } catch (err) {
        clearInterval(progressInterval);
        console.error('Upload error:', err);
        progressBar.style.width = '0%';
        progressPct.textContent = 'Error';
        progressText.textContent = 'Processing failed.';
        showErrorBanner(err.message || 'An error occurred during file upload.');
        lockChat();
    }
}

// 3.5. Reset Document Handler
function setupResetHandler() {
    resetDocBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('/reset', {
                method: 'POST'
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Failed to clear document on server.');
            }

            // Clear file input value
            fileInput.value = '';
            
            // Hide progress details
            docInfoCard.classList.add('hidden');
            
            // Re-lock the chat and update system status badges
            await checkStatus();
            
            // Clear message feed and restore the empty state instructions
            chatMessages.innerHTML = '';
            chatEmptyState.classList.remove('hidden');
            
        } catch (err) {
            console.error('Reset error:', err);
            showErrorBanner(err.message || 'An error occurred while resetting the document.');
        }
    });
}

// 4. Chat Q&A Interaction
function setupChatHandlers() {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const questionText = chatInput.value.trim();
        if (!questionText) return;
        
        // Clear input field immediately
        chatInput.value = '';
        
        // Append user question bubble
        appendUserMessage(questionText);
        
        // Hide empty state if visible
        chatEmptyState.classList.add('hidden');
        
        // Append bot typing skeleton
        appendBotSkeleton();
        
        try {
            const response = await fetch('/query', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ question: questionText })
            });
            
            removeBotSkeleton();

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Failed to process query.');
            }
            
            const data = await response.json();
            appendBotMessage(data.answer);
            
        } catch (err) {
            removeBotSkeleton();
            console.error('Query error:', err);
            appendBotMessage(`⚠️ **Error**: ${err.message || 'Unable to retrieve answer. Please try again.'}`);
        }
    });
}

// Helper: Append User Message
function appendUserMessage(text) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message user';
    msgElement.innerHTML = `
        <span class="message-label">You</span>
        <div class="message-bubble">${escapeHTML(text)}</div>
    `;
    chatMessages.appendChild(msgElement);
    scrollToBottom();
}

// Helper: Append Bot Message (Supports Markdown bold / linebreaks)
function appendBotMessage(text) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message bot';
    
    // Simple markdown formatter helper for **bold text** and line breaks
    let formattedText = escapeHTML(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
        
    msgElement.innerHTML = `
        <span class="message-label">DocuQuest AI</span>
        <div class="message-bubble">${formattedText}</div>
    `;
    chatMessages.appendChild(msgElement);
    scrollToBottom();
}

// Helper: Append Bot Typing Skeleton
function appendBotSkeleton() {
    activeSkeleton = document.createElement('div');
    activeSkeleton.className = 'message bot skeleton';
    activeSkeleton.innerHTML = `
        <span class="message-label">DocuQuest AI is thinking</span>
        <div class="message-bubble">
            <div class="skeleton-line s1"></div>
            <div class="skeleton-line s2"></div>
            <div class="skeleton-line s3"></div>
        </div>
    `;
    chatMessages.appendChild(activeSkeleton);
    scrollToBottom();
}

// Helper: Remove Bot Typing Skeleton
function removeBotSkeleton() {
    if (activeSkeleton) {
        activeSkeleton.remove();
        activeSkeleton = null;
    }
}

// UI Lock / Unlock helper utilities
function unlockChat(fileName) {
    chatInput.disabled = false;
    chatInput.placeholder = `Ask a question about "${fileName}"...`;
    chatSubmitBtn.disabled = false;
    
    chatStatusBadge.className = 'chat-badge unlocked';
    chatStatusBadge.textContent = 'Ready';
}

function lockChat() {
    chatInput.disabled = true;
    chatInput.placeholder = 'Please upload a PDF document first...';
    chatSubmitBtn.disabled = true;
    
    chatStatusBadge.className = 'chat-badge';
    chatStatusBadge.textContent = 'Locked';
}

// Error Banner Helpers
function showErrorBanner(message) {
    // Remove existing if present
    removeErrorBanner();
    
    const banner = document.createElement('div');
    banner.id = 'app-error-banner';
    banner.className = 'error-banner';
    banner.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>${escapeHTML(message)}</span>
    `;
    
    // Insert at top of control panel
    const controlPanel = document.querySelector('.control-panel');
    controlPanel.insertBefore(banner, controlPanel.firstChild);
}

function removeErrorBanner() {
    const existing = document.getElementById('app-error-banner');
    if (existing) existing.remove();
}

// Utility formatting methods
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
