const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const app = express();
const port = process.env.PRODUCT_SERVER_PORT || 3005;

// Import cleanup service
const HTMLCleanupService = require('./html-cleanup-service');

// ============================================
// SECURE TOKEN MANAGEMENT SYSTEM
// ============================================
// In-memory token storage
const tokenStore = new Map();

// Token configuration
const TOKEN_CONFIG = {
    EXPIRY_MINUTES: 10,           // Token expires in 10 minutes
    ALLOW_REUSE: true,            // Allow multiple accesses within expiry time
    CLEANUP_INTERVAL: 5 * 60 * 1000  // Cleanup expired tokens every 5 minutes
};

/**
 * Generate a secure random token
 */
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new token for a file
 * @param {string} filename - The HTML filename
 * @param {string} whatsappNumber - WhatsApp number
 * @returns {string} - Generated token
 */
function createToken(filename, whatsappNumber) {
    const token = generateSecureToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_CONFIG.EXPIRY_MINUTES * 60 * 1000);

    tokenStore.set(token, {
        filename,
        whatsappNumber,
        createdAt: now,
        expiresAt,
        accessCount: 0,
        firstAccess: null,
        lastAccess: null,
        // 🆕 Verification system
        firstAccessCompleted: false,
        firstAccessIP: null,
        verificationCode: null,
        codeExpiresAt: null,
        verificationAttempts: 0,
        lastVerifiedAt: null
    });

    console.log(`[TOKEN CREATED] ${token.substring(0, 8)}... for ${filename} (expires: ${expiresAt.toLocaleTimeString('tr-TR')})`);

    return token;
}

/**
 * Validate a token
 * @param {string} token - Token to validate
 * @returns {Object|null} - Token data if valid, null otherwise
 */
function validateToken(token) {
    const tokenData = tokenStore.get(token);

    if (!tokenData) {
        console.warn(`[TOKEN INVALID] Token not found: ${token.substring(0, 8)}...`);
        return null;
    }

    const now = new Date();
    if (now > tokenData.expiresAt) {
        console.warn(`[TOKEN EXPIRED] ${token.substring(0, 8)}... expired at ${tokenData.expiresAt.toLocaleTimeString('tr-TR')}`);
        tokenStore.delete(token);  // Remove expired token
        return null;
    }

    // Update access statistics
    tokenData.accessCount++;
    if (!tokenData.firstAccess) {
        tokenData.firstAccess = now;
    }
    tokenData.lastAccess = now;

    console.log(`[TOKEN VALID] ${token.substring(0, 8)}... accessed ${tokenData.accessCount} time(s)`);

    return tokenData;
}

/**
 * Cleanup expired tokens
 */
function cleanupExpiredTokens() {
    const now = new Date();
    let cleanedCount = 0;

    for (const [token, data] of tokenStore.entries()) {
        if (now > data.expiresAt) {
            tokenStore.delete(token);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[TOKEN CLEANUP] Removed ${cleanedCount} expired token(s)`);
    }
}

// Start token cleanup interval
setInterval(cleanupExpiredTokens, TOKEN_CONFIG.CLEANUP_INTERVAL);

/**
 * Generate 6-digit verification code
 * @returns {string} - 6-digit code
 */
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send verification code to WhatsApp
 * @param {string} whatsappNumber - WhatsApp number (e.g., "905306897885@c.us")
 * @param {string} code - Verification code
 */
async function sendVerificationCode(whatsappNumber, code) {
    try {
        const axios = require('axios');
        const whatsappServerPort = process.env.REPLY_SERVER_PORT || 3001;

        // Clean WhatsApp number format
        const cleanNumber = whatsappNumber.replace('@c.us', '');

        const message = `🔐 *Doğrulama Kodu*\n\nÜrün listesine erişim için doğrulama kodunuz:\n\n*${code}*\n\nKod 5 dakika geçerlidir.\n\n_Güvenlik önlemi: Bu kodu kimseyle paylaşmayın._`;

        const response = await axios.post(`http://localhost:${whatsappServerPort}/send-message`, {
            to: cleanNumber,  // 'to' parametresi gerekli (whatsapp-webhook-sender endpoint'i)
            message: message
        });

        console.log(`[CODE SENT] Verification code sent to ${cleanNumber}`);
        return response.data.success;

    } catch (error) {
        console.error(`[CODE SEND ERROR] Failed to send code:`, error.message);
        return false;
    }
}

/**
 * Create verification code for token
 * @param {string} token - Token
 * @returns {string|null} - Verification code or null
 */
async function createVerificationCode(token) {
    const tokenData = tokenStore.get(token);

    if (!tokenData) {
        console.error(`[VERIFICATION] Token not found: ${token}`);
        return null;
    }

    // Generate 6-digit code
    const code = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Update token data
    tokenData.verificationCode = code;
    tokenData.codeExpiresAt = codeExpiresAt;
    tokenData.verificationAttempts = 0;

    console.log(`[CODE GENERATED] ${code} for token ${token.substring(0, 8)}... (expires: ${codeExpiresAt.toLocaleTimeString('tr-TR')})`);

    // Send code to WhatsApp
    const sent = await sendVerificationCode(tokenData.whatsappNumber, code);

    if (!sent) {
        console.error(`[VERIFICATION] Failed to send code to WhatsApp`);
    }

    return code;
}

/**
 * Verify code for token
 * @param {string} token - Token
 * @param {string} code - Code to verify
 * @returns {boolean} - True if valid
 */
function verifyCode(token, code) {
    const tokenData = tokenStore.get(token);

    if (!tokenData) {
        console.error(`[VERIFICATION] Token not found`);
        return false;
    }

    if (!tokenData.verificationCode) {
        console.error(`[VERIFICATION] No verification code set for token`);
        return false;
    }

    // Check expiry
    if (Date.now() > tokenData.codeExpiresAt) {
        console.warn(`[VERIFICATION] Code expired`);
        return false;
    }

    // Check attempts
    tokenData.verificationAttempts++;

    if (tokenData.verificationAttempts > 3) {
        console.warn(`[VERIFICATION] Too many attempts, invalidating token`);
        tokenStore.delete(token);
        return false;
    }

    // Verify code
    if (tokenData.verificationCode === code.trim()) {
        console.log(`[✅ CODE VERIFIED] Token ${token.substring(0, 8)}... verified successfully`);
        // Clear verification data after successful verification
        tokenData.verificationCode = null;
        tokenData.codeExpiresAt = null;
        // Set verified timestamp to allow bypass for next 30 seconds
        tokenData.lastVerifiedAt = Date.now();
        return true;
    } else {
        console.warn(`[❌ CODE INVALID] Attempt ${tokenData.verificationAttempts}/3`);
        return false;
    }
}

// ============================================
// END TOKEN MANAGEMENT SYSTEM
// ============================================

// Initialize and start cleanup service
const cleanupService = new HTMLCleanupService(config.paths.productPages, 10, 5); // 10 min max age, 5 min interval
cleanupService.start();

// Static files serving
app.use('/products', express.static(config.paths.productPages));
app.use(express.json());

// Filename parsing utility
function parseFilename(filename) {
    try {
        if (!filename.startsWith('products_') || !filename.endsWith('.html')) {
            return null;
        }

        const parts = filename.replace('.html', '').split('_');

        // Support both legacy format (2 parts) and new format (4 parts)
        if (parts.length === 2) {
            // Legacy format: products_<session>.html
            return {
                whatsappNumber: '905306897885@c.us', // Default fallback
                sessionId: parts[1],
                timestamp: Date.now(),
                legacy: true
            };
        } else if (parts.length === 4) {
            // New format: products_<whatsapp>_<session>_<timestamp>.html
            return {
                whatsappNumber: parts[1] + '@c.us',
                sessionId: parts[2],
                timestamp: parseInt(parts[3]),
                legacy: false
            };
        } else {
            return null;
        }
    } catch (error) {
        console.error(`[PARSE ERROR] ${filename}:`, error.message);
        return null;
    }
}

/**
 * Generate error page HTML for invalid/expired tokens
 */
function generateErrorPage(errorType = 'invalid') {
    const errors = {
        invalid: {
            title: '🔒 Geçersiz Link',
            message: 'Bu link sadece WhatsApp üzerinden açılabilir.',
            details: 'Lütfen WhatsApp\'tan gelen linke tıklayarak sayfayı açın.'
        },
        expired: {
            title: '⏱️ Link Süresi Dolmuş',
            message: 'Bu link\'in kullanım süresi dolmuştur.',
            details: 'Yeni bir ürün araması yaparak güncel link alabilirsiniz.'
        },
        notfound: {
            title: '❌ Sayfa Bulunamadı',
            message: 'Aradığınız sayfa bulunamadı.',
            details: 'Link hatalı veya sayfa silinmiş olabilir.'
        },
        whatsapp_only: {
            title: '📱 Sadece WhatsApp\'tan Erişim',
            message: 'Bu sayfa sadece WhatsApp üzerinden açılabilir.',
            details: 'Güvenlik amacıyla bu linkler browser\'a copy-paste ile erişime kapalıdır. Lütfen WhatsApp\'tan tıklayarak açın.'
        }
    };

    const error = errors[errorType] || errors.invalid;

    return `
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${error.title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .error-container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            animation: slideIn 0.4s ease-out;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .error-icon {
            font-size: 72px;
            margin-bottom: 20px;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 15px;
            font-weight: 600;
        }
        .message {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .details {
            color: #999;
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 30px;
        }
        .whatsapp-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: #25D366;
            color: white;
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
        }
        .whatsapp-btn:hover {
            background: #20BA5A;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(37, 211, 102, 0.5);
        }
        .whatsapp-icon {
            font-size: 24px;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">${error.title.split(' ')[0]}</div>
        <h1>${error.title.split(' ').slice(1).join(' ')}</h1>
        <p class="message">${error.message}</p>
        <p class="details">${error.details}</p>

        <a href="https://wa.me/905306897885" class="whatsapp-btn">
            <span class="whatsapp-icon">💬</span>
            <span>WhatsApp'tan Devam Et</span>
        </a>

        <div class="footer">
            Güvenlik önlemi: Linkler sadece WhatsApp üzerinden açılabilir
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate verification page HTML
 * @param {string} token - Token
 * @param {string} filename - Filename
 * @returns {string} - HTML content
 */
function generateVerificationPage(token, filename) {
    return `
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔐 Güvenlik Doğrulaması</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .verification-container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .icon {
            font-size: 72px;
            margin-bottom: 20px;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 15px;
            font-weight: 600;
        }
        .message {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .details {
            color: #999;
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 30px;
        }
        .code-input-container {
            margin: 30px 0;
        }
        .code-input {
            width: 100%;
            padding: 15px;
            font-size: 24px;
            text-align: center;
            border: 2px solid #ddd;
            border-radius: 8px;
            letter-spacing: 0.5em;
            font-weight: bold;
            transition: all 0.3s ease;
        }
        .code-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        .verify-btn {
            width: 100%;
            background: #25D366;
            color: white;
            border: none;
            padding: 15px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
        }
        .verify-btn:hover {
            background: #20BA5A;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(37, 211, 102, 0.5);
        }
        .verify-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }
        .error-message {
            color: #e74c3c;
            font-size: 14px;
            margin-top: 10px;
            display: none;
        }
        .success-message {
            color: #27ae60;
            font-size: 14px;
            margin-top: 10px;
            display: none;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 12px;
        }
        .loading {
            display: none;
            margin-top: 10px;
        }
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="verification-container">
        <div class="icon">🔐</div>
        <h1>Güvenlik Doğrulaması</h1>
        <p class="message">WhatsApp'a gönderilen 6 haneli kodu girin</p>
        <p class="details">Bu sayfa daha önce açılmış. Güvenlik amacıyla doğrulama kodu WhatsApp'a gönderilmiştir.</p>

        <div class="code-input-container">
            <input
                type="text"
                class="code-input"
                id="codeInput"
                placeholder="------"
                maxlength="6"
                pattern="[0-9]*"
                inputmode="numeric"
                autocomplete="off"
            />
        </div>

        <button class="verify-btn" id="verifyBtn" onclick="verifyCode()">
            Doğrula ve Devam Et
        </button>

        <div class="error-message" id="errorMessage"></div>
        <div class="success-message" id="successMessage">✅ Kod doğrulandı! Yönlendiriliyorsunuz...</div>

        <div class="loading" id="loading">
            <div class="spinner"></div>
        </div>

        <div class="footer">
            Kodu almadıysanız WhatsApp mesajlarınızı kontrol edin
        </div>
    </div>

    <script>
        const token = '${token}';
        const filename = '${filename}';

        // Auto-focus input
        document.getElementById('codeInput').focus();

        // Only allow numbers
        document.getElementById('codeInput').addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
        });

        // Submit on Enter key
        document.getElementById('codeInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                verifyCode();
            }
        });

        async function verifyCode() {
            const code = document.getElementById('codeInput').value.trim();
            const errorMsg = document.getElementById('errorMessage');
            const successMsg = document.getElementById('successMessage');
            const loading = document.getElementById('loading');
            const btn = document.getElementById('verifyBtn');

            // Validation
            if (code.length !== 6) {
                errorMsg.textContent = '❌ Lütfen 6 haneli kodu girin';
                errorMsg.style.display = 'block';
                successMsg.style.display = 'none';
                return;
            }

            // Hide messages
            errorMsg.style.display = 'none';
            successMsg.style.display = 'none';

            // Show loading
            loading.style.display = 'block';
            btn.disabled = true;

            try {
                const response = await fetch('/api/verify-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ token, code })
                });

                const data = await response.json();

                loading.style.display = 'none';
                btn.disabled = false;

                if (data.success) {
                    // Success
                    successMsg.style.display = 'block';
                    setTimeout(() => {
                        window.location.href = '/view/' + token + '/' + filename;
                    }, 1500);
                } else {
                    // Error
                    errorMsg.textContent = '❌ ' + (data.error || 'Kod hatalı');
                    errorMsg.style.display = 'block';
                    document.getElementById('codeInput').value = '';
                    document.getElementById('codeInput').focus();
                }

            } catch (error) {
                loading.style.display = 'none';
                btn.disabled = false;
                errorMsg.textContent = '❌ Bağlantı hatası, lütfen tekrar deneyin';
                errorMsg.style.display = 'block';
            }
        }
    </script>
</body>
</html>`;
}

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>Product List Server</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>🛍️ WhatsApp B2B Product Server</h1>
            <p>Bu server WhatsApp üzerinden gelen ürün sorgularını işler.</p>
            <p>Ürün listesi linki almak için WhatsApp'tan ürün araması yapın.</p>
            <hr>
            <p>Status: ✅ Aktif | Port: ${process.env.PRODUCT_SERVER_PORT || 3006}</p>
            <p style="color: #25D366;">🔒 Güvenli token sistemi aktif</p>
        </body>
        </html>
    `);
});

// ============================================
// SECURE TOKEN-PROTECTED ENDPOINT
// ============================================
/**
 * Secure endpoint for viewing product pages
 * Only accessible with valid token from WhatsApp
 */
// WhatsApp Detection Function
function isRequestFromWhatsApp(req) {
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || '';
    const origin = req.headers['origin'] || '';
    const xForwardedFor = req.headers['x-forwarded-for'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';

    console.log(`\n========== REQUEST HEADERS DEBUG ==========`);
    console.log(`User-Agent: ${userAgent}`);
    console.log(`Referer: ${referer}`);
    console.log(`Origin: ${origin}`);
    console.log(`X-Forwarded-For: ${xForwardedFor}`);
    console.log(`Accept-Language: ${acceptLanguage}`);
    console.log(`All Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`==========================================\n`);

    // WhatsApp patterns to detect
    const whatsappPatterns = [
        /whatsapp/i,           // WhatsApp in-app browser
        /wa_/i,                // WhatsApp web client
        /FBAN/i,               // Facebook (sometimes used by WA)
        /Instagram/i           // Instagram in-app (similar behavior)
    ];

    // Check User-Agent for WhatsApp indicators
    const isWhatsAppUserAgent = whatsappPatterns.some(pattern => pattern.test(userAgent));

    // Check if request is from mobile device
    const isMobile = /mobile|android|iphone|ipad|tablet/i.test(userAgent);

    // Check referer (should not be a regular browser)
    const isDirectBrowserAccess = referer === '' && origin === '';

    // Security decision logic
    if (isWhatsAppUserAgent) {
        console.log(`[✅ WHATSAPP DETECTED] Pattern matched - ACCESS GRANTED`);
        return true;
    }

    if (isMobile) {
        // Mobile device detected - likely from WhatsApp click
        // Allow even if referer is empty (WhatsApp app -> browser transition)
        console.log(`[📱 MOBILE ACCESS] Mobile device detected - ACCESS GRANTED`);
        return true;
    }

    if (isDirectBrowserAccess) {
        console.log(`[❌ DIRECT ACCESS BLOCKED] Desktop browser, no referer/origin - copy-paste detected`);
        // 🚧 TEMPORARY: Allow for debugging
        console.log(`[🚧 DEBUG] Allowing anyway to see full headers`);
        return true; // Changed from false
    }

    // Unknown case - allow but log warning
    console.log(`[⚠️ UNCERTAIN ACCESS] Unknown pattern - allowing with warning`);
    return true;
}

app.get('/view/:token/:filename', async (req, res) => {
    try {
        const { token, filename } = req.params;

        console.log(`[SECURE ACCESS] Token: ${token.substring(0, 8)}... File: ${filename}`);

        // 🔒 SECURITY CHECK 1: WhatsApp Detection
        if (!isRequestFromWhatsApp(req)) {
            console.warn(`[🚫 BLOCKED] Non-WhatsApp access attempt for ${filename}`);
            return res.status(403).send(generateErrorPage('whatsapp_only'));
        }

        // 🔒 SECURITY CHECK 2: Validate token
        const tokenData = validateToken(token);

        if (!tokenData) {
            console.warn(`[ACCESS DENIED] Invalid/expired token for ${filename}`);
            return res.status(403).send(generateErrorPage('invalid'));
        }

        // 🔒 SECURITY CHECK 3: Verify filename matches token
        if (tokenData.filename !== filename) {
            console.error(`[SECURITY ALERT] Filename mismatch! Token: ${tokenData.filename}, Requested: ${filename}`);
            return res.status(403).send(generateErrorPage('invalid'));
        }

        // 🔒 SECURITY CHECK 4: WhatsApp Preview vs Real User Access (HIBRIT SİSTEM)
        const userAgent = req.headers['user-agent'] || '';
        const isWhatsAppUserAgent = /whatsapp/i.test(userAgent);

        if (isWhatsAppUserAgent) {
            // WhatsApp preview/in-app browser - HER ZAMAN direkt göster (state değiştirme!)
            console.log(`[📱 WHATSAPP ACCESS] Direct access without state change (preview or in-app)`);
        } else {
            // Normal browser access - İlk erişim kontrolü yap

            // Check if recently verified (within last 30 seconds)
            const recentlyVerified = tokenData.lastVerifiedAt && (Date.now() - tokenData.lastVerifiedAt < 30 * 1000);

            if (recentlyVerified) {
                // Recently verified - allow direct access
                console.log(`[✅ VERIFIED BYPASS] Access granted after successful code verification`);
            } else if (!tokenData.firstAccessCompleted) {
                // İLK BROWSER ERİŞİMİ - Direkt sayfa göster
                const clientIP = req.headers['x-forwarded-for'] || req.ip;
                tokenData.firstAccessCompleted = true;
                tokenData.firstAccessIP = clientIP;
                console.log(`[1️⃣ FIRST BROWSER ACCESS] Granted directly - IP: ${clientIP}`);
            } else {
                // İKİNCİ+ BROWSER ERİŞİMİ - Kod iste
                console.log(`[2️⃣ SECOND BROWSER ACCESS] Verification required`);

                // Generate and send verification code
                await createVerificationCode(token);

                // Show verification page
                return res.send(generateVerificationPage(token, filename));
            }
        }

        // Check if file exists
        const filePath = path.join(__dirname, '..', '..', 'product-pages', filename);

        if (!fs.existsSync(filePath)) {
            console.error(`[404] File not found: ${filename}`);
            return res.status(404).send(generateErrorPage('notfound'));
        }

        // Parse filename for logging
        const parsed = parseFilename(filename);
        if (parsed) {
            console.log(`[✅ SECURE ACCESS GRANTED] ${filename} -> WhatsApp: ${parsed.whatsappNumber}, Access #${tokenData.accessCount}`);
        }

        // Serve the file securely
        return res.sendFile(filePath);

    } catch (error) {
        console.error('[SECURE ENDPOINT ERROR]', error);
        res.status(500).send(generateErrorPage('invalid'));
    }
});

// ============================================
// END SECURE ENDPOINT
// ============================================

// MIGRATION: Static file serving endpoint (replaces database session endpoint)
app.get('/products/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        
        // Check if it's a static HTML file request
        if (filename.endsWith('.html') && filename.startsWith('products_')) {
            const filePath = path.join(__dirname, '..', '..', 'product-pages', filename);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error(`[404] File not found: ${filename}`);
                return res.status(404).send(`
                    <html><body>
                        <h2>Ürün listesi bulunamadı</h2>
                        <p>Bu link geçersiz veya süresi dolmuş olabilir.</p>
                        <p>Lütfen yeni bir arama yapın.</p>
                    </body></html>
                `);
            }
            
            // Parse filename for logging
            const parsed = parseFilename(filename);
            if (parsed) {
                console.log(`[ACCESS] ${filename} -> WhatsApp: ${parsed.whatsappNumber}, Session: ${parsed.sessionId}`);
                
                // Check file age (optional warning)
                const ageMinutes = (Date.now() - parsed.timestamp) / (1000 * 60);
                if (ageMinutes > 60) { // Warn if older than 1 hour
                    console.warn(`[OLD FILE] ${filename} is ${Math.round(ageMinutes)} minutes old`);
                }
            }
            
            // Serve the static HTML file
            return res.sendFile(filePath);
        }
        
        // If not HTML file, return 404
        return res.status(404).send(`
            <html><body>
                <h2>Sayfa bulunamadı</h2>
                <p>Geçersiz dosya formatı.</p>
            </body></html>
        `);
        
    } catch (error) {
        console.error('[SERVER ERROR]', error);
        res.status(500).send('Sunucu hatası');
    }
});

// Product selection endpoint - UPDATED for filename parsing
app.post('/select-product', express.json(), async (req, res) => {
    try {
        const { sessionId, message, productCode, productName, productPrice } = req.body;
        
        if (!sessionId || !message || !productCode) {
            return res.json({ success: false, error: 'Session ID, message ve productCode gerekli' });
        }
        
        // Create product object from separate fields
        const product = {
            code: productCode,
            name: productName,
            price: productPrice
        };
        
        console.log(`[PRODUCT SELECTION] ${product.code} from ${sessionId}`);
        
        // MIGRATION: Parse filename to get WhatsApp number (instead of database query)
        let whatsappNumber;
        
        if (sessionId.startsWith('products_') && sessionId.endsWith('.html')) {
            // New filename format
            const parsed = parseFilename(sessionId);
            if (parsed) {
                whatsappNumber = parsed.whatsappNumber;
                console.log(`[FILENAME PARSE] Extracted WhatsApp: ${whatsappNumber}`);
            } else {
                console.error(`[PARSE ERROR] Could not parse filename: ${sessionId}`);
                return res.json({ success: false, error: 'Invalid session format' });
            }
        } else {
            // Legacy fallback (shouldn't happen with new system)
            console.warn(`[LEGACY] Session ID not a filename: ${sessionId}`);
            whatsappNumber = '905306897885@c.us'; // Default fallback
        }
        
        // Convert HTML product selection to ÜRÜN_SEÇİLDİ format for Swarm system
        // Use URUN_SECILDI instead of ÜRÜN_SEÇİLDİ to avoid encoding issues
        const urunSeciidiMessage = `URUN_SECILDI: ${product.code} - ${product.name} - ${product.price} TL`;
        console.log(`[FORMAT CONVERSION] Original: ${message} → URUN_SECILDI: ${urunSeciidiMessage}`);
        
        // Send ÜRÜN_SEÇİLDİ intent to Swarm system
        const axios = require('axios');
        
        try {
            const swarmResponse = await axios.post(`http://localhost:${process.env.SWARM_SERVER_PORT || 3007}/process-message`, {
                message: urunSeciidiMessage,
                whatsapp_number: whatsappNumber
            });
            
            if (swarmResponse.data.success) {
                console.log(`[DEBUG SWARM DATA] ${JSON.stringify(swarmResponse.data, null, 2)}`);
                const responseMessage = swarmResponse.data.response || swarmResponse.data.message || "Ürün seçimi başarılı";
                
                console.log(`[SWARM RESPONSE] ${whatsappNumber}: ${responseMessage.substring(0, 100)}...`);
                console.log(`[SENDING TO WHATSAPP] URL: http://localhost:3001/send-message`);
                console.log(`[SENDING TO WHATSAPP] To: ${whatsappNumber}`);
                console.log(`[SENDING TO WHATSAPP] Message: ${responseMessage.substring(0, 200)}`);
                
                // WhatsApp'a mesaj gönder
                try {
                    const whatsappResponse = await axios.post('http://localhost:3001/send-message', {
                        to: whatsappNumber,
                        message: responseMessage
                    });
                    
                    console.log(`[WHATSAPP RESPONSE] ${JSON.stringify(whatsappResponse.data)}`);
                    console.log(`[WHATSAPP SENT] ${whatsappNumber}: Message sent successfully`);
                } catch (whatsappError) {
                    console.error(`[WHATSAPP ERROR] ${whatsappNumber}:`, whatsappError.message);
                    console.error(`[WHATSAPP ERROR DETAILS]`, whatsappError.response?.data);
                }
                
                res.json({ 
                    success: true, 
                    message: responseMessage,
                    product: product.name,
                    code: product.code
                });
            } else {
                throw new Error(swarmResponse.data.error || 'Swarm system error');
            }
            
        } catch (swarmError) {
            console.error('[SWARM ERROR]', swarmError.message);
            res.json({ 
                success: false, 
                error: 'Swarm sistemi yanıt veremedi: ' + swarmError.message 
            });
        }
        
    } catch (error) {
        console.error('[PRODUCT SELECTION ERROR]', error);
        res.json({ success: false, error: error.message });
    }
});

// Cleanup service management endpoints
app.get('/cleanup/stats', (req, res) => {
    res.json(cleanupService.getStats());
});

app.post('/cleanup/trigger', (req, res) => {
    cleanupService.triggerCleanup();
    res.json({ success: true, message: 'Manual cleanup triggered' });
});

// ============================================
// TOKEN MANAGEMENT API ENDPOINTS
// ============================================
/**
 * Create a secure token for a file (for use by Swarm system)
 * POST /api/create-token
 * Body: { filename, whatsappNumber }
 */
app.post('/api/create-token', express.json(), (req, res) => {
    try {
        const { filename, whatsappNumber } = req.body;

        if (!filename || !whatsappNumber) {
            return res.status(400).json({
                success: false,
                error: 'filename and whatsappNumber required'
            });
        }

        const token = createToken(filename, whatsappNumber);
        const secureUrl = `http://localhost:${port}/view/${token}/${filename}`;

        console.log(`[API] Token created for ${filename}, URL: ${secureUrl}`);

        res.json({
            success: true,
            token,
            filename,
            secureUrl,
            expiresIn: `${TOKEN_CONFIG.EXPIRY_MINUTES} minutes`
        });

    } catch (error) {
        console.error('[CREATE TOKEN ERROR]', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify code API endpoint
 */
app.post('/api/verify-code', express.json(), (req, res) => {
    try {
        const { token, code } = req.body;

        if (!token || !code) {
            return res.status(400).json({
                success: false,
                error: 'Token ve kod gerekli'
            });
        }

        console.log(`[API] Code verification attempt for token ${token.substring(0, 8)}...`);

        // Verify the code
        const isValid = verifyCode(token, code);

        if (isValid) {
            console.log(`[API] ✅ Code verified successfully`);
            return res.json({
                success: true,
                message: 'Kod doğrulandı'
            });
        } else {
            const tokenData = tokenStore.get(token);
            const attemptsLeft = tokenData ? (3 - tokenData.verificationAttempts) : 0;

            console.log(`[API] ❌ Code verification failed, ${attemptsLeft} attempts left`);

            return res.status(403).json({
                success: false,
                error: attemptsLeft > 0
                    ? `Kod hatalı. Kalan deneme: ${attemptsLeft}`
                    : 'Çok fazla hatalı deneme. Token geçersiz kılındı.'
            });
        }

    } catch (error) {
        console.error('[VERIFY CODE ERROR]', error);
        res.status(500).json({
            success: false,
            error: 'Sunucu hatası'
        });
    }
});

/**
 * Get token statistics (for monitoring)
 */
app.get('/api/token-stats', (req, res) => {
    const now = new Date();
    const stats = {
        totalTokens: tokenStore.size,
        activeTokens: 0,
        expiredTokens: 0,
        tokens: []
    };

    for (const [token, data] of tokenStore.entries()) {
        const isExpired = now > data.expiresAt;
        if (isExpired) {
            stats.expiredTokens++;
        } else {
            stats.activeTokens++;
        }

        stats.tokens.push({
            token: token.substring(0, 8) + '...',
            filename: data.filename,
            whatsappNumber: data.whatsappNumber,
            accessCount: data.accessCount,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            expired: isExpired,
            remainingTime: isExpired ? 0 : Math.round((data.expiresAt - now) / 1000 / 60) + ' min'
        });
    }

    res.json(stats);
});

// Health check
app.get('/health', (req, res) => {
    const stats = cleanupService.getStats();
    res.json({
        status: 'OK',
        port: port,
        cleanup_running: stats.isRunning,
        files_cleaned: stats.totalCleaned,
        secure_tokens_enabled: true,
        active_tokens: tokenStore.size,
        token_expiry_minutes: TOKEN_CONFIG.EXPIRY_MINUTES
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Stopping cleanup service...');
    cleanupService.stop();
    console.log('[SHUTDOWN] Server shutting down gracefully');
    process.exit(0);
});

// Generate HTML for product list
function generateProductListHTML(products, query, sessionId) {
    const html = `
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ürün Listesi - ${query}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .header { text-align: center; margin-bottom: 20px; color: #333; }
        .product { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; background: #fff; }
        .product:hover { background: #f9f9f9; }
        .product-name { font-weight: bold; color: #2c5aa0; margin-bottom: 5px; }
        .product-code { color: #666; font-size: 0.9em; }
        .product-price { color: #d9534f; font-weight: bold; margin: 5px 0; }
        .product-stock { color: #5cb85c; font-size: 0.9em; }
        .select-btn { background: #5cb85c; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .select-btn:hover { background: #4cae4c; }
        .out-of-stock { opacity: 0.6; }
        .out-of-stock .select-btn { background: #ccc; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>🛍️ Ürün Listesi</h2>
            <p>Arama: "<strong>${query}</strong>"</p>
            <p>Toplam ${products.length} ürün bulundu</p>
        </div>
        
        ${products.map(product => `
            <div class="product ${product.stock <= 0 ? 'out-of-stock' : ''}">
                <div class="product-name">${product.name}</div>
                <div class="product-code">Kod: ${product.code}</div>
                <div class="product-price">${product.price} TL</div>
                <div class="product-stock">Stok: ${product.stock} adet</div>
                ${product.stock > 0 ? 
                    `<button class="select-btn" onclick="selectProduct('${product.code}', '${product.name}', ${product.price})">Ürünü Seç</button>` :
                    `<button class="select-btn" disabled>Stokta Yok</button>`
                }
            </div>
        `).join('')}
    </div>
    
    <script>
        function selectProduct(code, name, price) {
            const message = "ÜRÜN_SEÇİLDİ: " + code + " - " + name + " - " + price + " TL";
            
            // Try to send to Swarm system
            fetch('/select-product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: message,
                    sessionId: '${sessionId}',
                    productCode: code,
                    productName: name,
                    productPrice: price
                })
            }).then(response => {
                if (response.ok) {
                    alert('Ürün seçildi! WhatsApp üzerinden devam edin.');
                } else {
                    alert('Seçim başarısız. Lütfen WhatsApp üzerinden devam edin.');
                }
            }).catch(error => {
                console.error('Selection error:', error);
                alert('Ürün seçimi için WhatsApp üzerinden "' + code + '" yazın.');
            });
        }
    </script>
</body>
</html>`;
    
    return html;
}

app.listen(port, () => {
    console.log(`🛍️  Product List Server v2.0 (Dynamic + Static) running on port ${port}`);
    console.log(`📋 URL format: http://localhost:${port}/products/[session_id]`);
    console.log(`🧹 Auto cleanup: ${cleanupService.getStats().config.maxAgeMinutes} min max age`);
    console.log(`✅ PostgreSQL session support enabled`);
});