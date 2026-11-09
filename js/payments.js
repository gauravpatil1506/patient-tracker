/**
 * High-Precision Payment & WhatsApp Invoice Engine
 * Resolves URI sandbox blocking, handles base64 encoding, and generates dynamic UPI QR codes
 */

window.PhysioPayments = (function() {
  
  // Format Indian Currency (INR)
  function formatINR(val) {
    const num = parseFloat(val) || 0;
    return "₹" + num.toLocaleString('en-IN');
  }

  // Generate standard UPI Intent URL
  function buildUPIString(payeeVpa, payeeName, amount, note) {
    const cleanAmount = (parseFloat(amount) || 0).toFixed(2);
    const encodedName = encodeURIComponent(payeeName);
    const encodedNote = encodeURIComponent(note || 'Physiotherapy Fee');
    // Important: Query separator MUST be raw '&', NOT '&amp;'
    return `upi://pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${encodedNote}`;
  }

  // Safe Base64URL Encoding for URL tokens
  function encodePatientToken(patientName) {
    if (!patientName) return "";
    const utf8 = unescape(encodeURIComponent(patientName));
    const base64 = btoa(utf8);
    // URL-safe replacement
    return encodeURIComponent(base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  }

  // Safe Base64URL Decoding
  function decodePatientToken(tokenStr) {
    if (!tokenStr) return "";
    try {
      let base64 = decodeURIComponent(tokenStr).replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      return decodeURIComponent(escape(atob(base64)));
    } catch (e) {
      console.error("Token decode error:", e);
      return "";
    }
  }

  // Generate In-App Dynamic QR Code Modal
  function showQRModal(title, subtitle, amount, note) {
    const modal = document.getElementById('qrModal');
    if (!modal) return;

    document.getElementById('qrModalTitle').innerText = title;
    document.getElementById('qrModalSub').innerText = subtitle;
    document.getElementById('qrModalAmount').innerText = formatINR(amount);

    const container = document.getElementById('qrCanvasContainer');
    container.innerHTML = "";

    const upiString = buildUPIString(PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, amount, note);

    // Create high-resolution QR
    new QRCode(container, {
      text: upiString,
      width: 200,
      height: 200,
      colorDark: "#004d40",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    modal.style.display = "flex";
  }

  function closeQRModal() {
    const modal = document.getElementById('qrModal');
    if (modal) modal.style.display = "none";
  }

  // WhatsApp Invoice Dispatcher
  function sendWhatsAppInvoice(patientName, pendingSessions, optionalPhone) {
    if (!patientName || !pendingSessions || pendingSessions.length === 0) return;

    let totalAmount = 0;
    let sessionLines = "";

    pendingSessions.forEach(session => {
      sessionLines += `• ${session.date} - ${formatINR(session.amount)}\n`;
      totalAmount += session.amount;
    });

    const token = encodePatientToken(patientName);
    
    // Direct link to the app's clean invoice viewer mode (runs top-level on domain, not in a sandboxed iframe)
    const baseAppUrl = window.location.origin + window.location.pathname;
    const directInvoiceUrl = `${baseAppUrl}?invoice=${token}`;

    const msg = 
`🌸 *Greetings from ${PhysioConfig.CLINIC_NAME}*

This is a gentle reminder regarding the outstanding balance for your physiotherapy sessions.

📅 *Session Breakdown:*
${sessionLines}
📊 *Total Pending Sessions:* ${pendingSessions.length}
💳 *Total Amount Due:* *${formatINR(totalAmount)}*

👉 *View Invoice & Pay Online:*
${directInvoiceUrl}

Kindly clear the dues at your earliest convenience. Wishing you a speedy and healthy recovery! 🌟`;

    const encodedText = encodeURIComponent(msg);
    let waUrl = `https://wa.me/?text=${encodedText}`;

    // If phone number is available, target patient's WhatsApp directly
    if (optionalPhone) {
      let cleanPhone = optionalPhone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone; // Default to India prefix if 10 digits
      waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;
    }

    // Direct anchor click to bypass PWA popup blockers
    const tempLink = document.createElement('a');
    tempLink.href = waUrl;
    tempLink.target = '_blank';
    tempLink.rel = 'noopener noreferrer';
    document.body.appendChild(tempLink);
    tempLink.click();
    tempLink.remove();
  }

  // Appointment Reminder Dispatcher
  function sendAppointmentReminder(patientName, apptDateStr, optionalPhone) {
    const msg = 
`🌸 *Greetings from ${PhysioConfig.CLINIC_NAME}*

This is a gentle reminder regarding your upcoming physiotherapy session.

📅 *Scheduled Date:* *${apptDateStr}*

Please let me know if you need to reschedule. Wishing you a wonderful day! 🌟`;

    const encodedText = encodeURIComponent(msg);
    let waUrl = `https://wa.me/?text=${encodedText}`;

    if (optionalPhone) {
      let cleanPhone = optionalPhone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
      waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;
    }

    const tempLink = document.createElement('a');
    tempLink.href = waUrl;
    tempLink.target = '_blank';
    tempLink.rel = 'noopener noreferrer';
    document.body.appendChild(tempLink);
    tempLink.click();
    tempLink.remove();
  }

  return {
    formatINR,
    buildUPIString,
    encodePatientToken,
    decodePatientToken,
    showQRModal,
    closeQRModal,
    sendWhatsAppInvoice,
    sendAppointmentReminder
  };
})();
