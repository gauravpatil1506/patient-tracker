/**
 * High-Precision Payment & WhatsApp Invoice Engine
 * Self-contained token encoding, strict NPCI UPI deep link compliance, and official branding
 */

window.PhysioPayments = (function() {

  // Official Pixel-Perfect WhatsApp SVG Vector
  function getWhatsAppIconSVG(size = 20) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" style="display:inline-block; vertical-align:middle;">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.71 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>`;
  }

  // Format Indian Currency (INR)
  function formatINR(val) {
    const num = parseFloat(val) || 0;
    return "₹" + Math.round(num).toLocaleString('en-IN');
  }

  // Official NPCI compliant UPI Intent URI
  function buildUPIString(payeeVpa, payeeName, amount, cleanAlphanumericNote) {
    const cleanAmount = (parseFloat(amount) || 0).toFixed(2);
    const encodedName = encodeURIComponent(payeeName);
    const note = (cleanAlphanumericNote || 'PhysioClinic').replace(/[^a-zA-Z0-9]/g, '');
    return `upi://pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${note}`;
  }

  // App-Specific UPI URI generators
  function buildAppUPIString(scheme, payeeVpa, payeeName, amount, cleanAlphanumericNote) {
    const cleanAmount = (parseFloat(amount) || 0).toFixed(2);
    const encodedName = encodeURIComponent(payeeName);
    const note = (cleanAlphanumericNote || 'PhysioClinic').replace(/[^a-zA-Z0-9]/g, '');
    
    if (scheme === 'phonepe') {
      return `phonepe://pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${note}`;
    } else if (scheme === 'gpay') {
      return `tez://upi/pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${note}`;
    } else if (scheme === 'paytm') {
      return `paytmmp://pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${note}`;
    }
    return `upi://pay?pa=${payeeVpa}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tn=${note}`;
  }

  // Self-Contained URL-Safe Invoice Token
  function encodeInvoicePayload(patientName, totalAmount, pendingSessions) {
    try {
      const payload = {
        n: patientName,
        t: totalAmount,
        s: (pendingSessions || []).map(sess => ({
          d: sess.date || '',
          a: sess.amount || 0
        }))
      };
      const jsonStr = JSON.stringify(payload);
      const b64 = btoa(encodeURIComponent(jsonStr));
      return encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    } catch (e) {
      console.error("Token encoding error:", e);
      return encodeURIComponent(btoa(encodeURIComponent(patientName)));
    }
  }

  // Decode Self-Contained Invoice Token
  function decodeInvoicePayload(tokenStr) {
    if (!tokenStr) return null;
    try {
      let b64 = decodeURIComponent(tokenStr).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) {
        b64 += '=';
      }
      const raw = decodeURIComponent(atob(b64));
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        return {
          name: parsed.n,
          totalAmount: parsed.t,
          sessions: parsed.s
        };
      }
      return {
        name: raw,
        totalAmount: 0,
        sessions: []
      };
    } catch (e) {
      console.error("Token decoding error:", e);
      return null;
    }
  }

  // In-App Dynamic QR Code Modal
  function showQRModal(title, subtitle, amount, note) {
    const modal = document.getElementById('qrModal');
    if (!modal) return;

    document.getElementById('qrModalTitle').innerText = title;
    document.getElementById('qrModalSub').innerText = subtitle;
    document.getElementById('qrModalAmount').innerText = formatINR(amount);

    const container = document.getElementById('qrCanvasContainer');
    container.innerHTML = '';

    const upiString = buildUPIString(PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, amount, note);

    new QRCode(container, {
      text: upiString,
      width: 200,
      height: 200,
      colorDark: "#004d40",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    modal.classList.add('active');
  }

  function closeQRModal() {
    const modal = document.getElementById('qrModal');
    if (modal) modal.classList.remove('active');
  }

  // Single-session shortcut for 1-tap WhatsApp from dues cards
  function sendSingleSessionWhatsAppInvoice(patientName, sessionDate, amount, sessionType) {
    const phones = PhysioDB.getPatientPhones();
    const phone = phones[PhysioDB.sanitizeName(patientName)] || '';
    const pendingSessions = [{ date: sessionDate, amount: amount }];
    sendWhatsAppInvoice(patientName, pendingSessions, phone);
  }

  // Full WhatsApp Invoice Dispatcher
  function sendWhatsAppInvoice(patientName, pendingSessions, optionalPhone) {
    if (!pendingSessions || pendingSessions.length === 0) {
      alert("No pending dues found for " + patientName);
      return;
    }

    let totalAmount = 0;
    let sessionLines = "";

    pendingSessions.forEach(session => {
      sessionLines += `• ${session.date}: ${formatINR(session.amount)}\n`;
      totalAmount += session.amount;
    });

    if (!optionalPhone) {
      const phones = PhysioDB.getPatientPhones();
      optionalPhone = phones[PhysioDB.sanitizeName(patientName)] || '';
    }

    const token = encodeInvoicePayload(patientName, totalAmount, pendingSessions);
    const baseAppUrl = window.location.origin + window.location.pathname;
    const directInvoiceUrl = `${baseAppUrl}?invoice=${token}`;

    const msg = `Dear ${patientName},

Greetings from *${PhysioConfig.CLINIC_NAME}* (${PhysioConfig.CLINIC_TITLE}).

This is a gentle update regarding your physiotherapy treatment session dues:

*Outstanding Dues Summary:*
${sessionLines}
*Total Outstanding:* ${formatINR(totalAmount)}

💳 *Direct UPI Payment Options:*
• UPI ID: \`${PhysioConfig.CLINIC_UPI_ID}\`
• Name: ${PhysioConfig.CLINIC_PAYEE_NAME}
• Amount: ${formatINR(totalAmount)}
_(Tip: You can copy \`${PhysioConfig.CLINIC_UPI_ID}\` and send directly via GPay / PhonePe / Paytm to bypass browser bank warnings)_

👉 *View Itemized Invoice & Scan QR:*
${directInvoiceUrl}

Kindly clear the dues at your convenience. Wishing you a healthy and speedy recovery! 🌟`;

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

  // WhatsApp Next Appointment Reminder
  function sendAppointmentReminder(patientName, appointmentDate, optionalPhone) {
    if (!optionalPhone) {
      const phones = PhysioDB.getPatientPhones();
      optionalPhone = phones[PhysioDB.sanitizeName(patientName)] || '';
    }

    const msg = `Dear ${patientName},

Greetings from *${PhysioConfig.CLINIC_NAME}*! 🌿

This is a friendly reminder for your upcoming physiotherapy session scheduled on:
📅 *${appointmentDate}*

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
    getWhatsAppIconSVG,
    formatINR,
    buildUPIString,
    buildAppUPIString,
    encodeInvoicePayload,
    decodeInvoicePayload,
    showQRModal,
    closeQRModal,
    sendSingleSessionWhatsAppInvoice,
    sendWhatsAppInvoice,
    sendAppointmentReminder
  };
})();
