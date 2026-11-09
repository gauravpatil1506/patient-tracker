/**
 * Master Application Orchestrator
 * Routing, Lifecycle, Service Worker Registration, Toast Notifications, and Firebase Migration UI
 */

window.PhysioApp = (function() {
  let currentModalContext = '';
  let globalPatients = [];

  // Bootstrapping
  async function init() {
    initTheme();
    registerServiceWorker();

    // Check if URL is in Patient Invoice Viewer mode (?invoice=TOKEN)
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceToken = urlParams.get('invoice');
    if (invoiceToken) {
      renderStandaloneInvoiceMode(invoiceToken);
      return;
    }

    // Doctor Clinic Mode: Initialize IndexedDB
    updateSyncIndicator("syncing");
    const visits = await PhysioDB.init();
    updateGlobalPatientsList(visits);

    // Initial render active tab instantly
    PhysioClinical.initPainSelectors();
    PhysioClinical.renderQuickPatientsBar();
    renderCurrentTab('tab1');
    
    const dateInput = document.getElementById('date');
    if (dateInput && !dateInput.value) {
      dateInput.valueAsDate = new Date();
    }

    // Populate Settings modal status
    updateSettingsModalBackendInfo();

    // Subscribe to DB mutations
    PhysioDB.subscribe(updatedVisits => {
      updateGlobalPatientsList(updatedVisits);
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) renderCurrentTab(activeTab.id);
    });

    // Background sync with cloud
    PhysioDB.syncWithCloud(status => {
      updateSyncIndicator(status);
    });

    // Network listeners
    window.addEventListener('online', () => {
      updateSyncIndicator("syncing");
      PhysioDB.syncWithCloud(status => updateSyncIndicator(status));
    });

    window.addEventListener('offline', () => {
      updateSyncIndicator("offline");
      showToast("Operating Offline - All changes saved locally", "info");
    });

    // Setup Fee / Paid auto-sync
    const feeInput = document.getElementById('totalFee');
    if (feeInput) {
      feeInput.addEventListener('input', () => {
        const pType = document.getElementById('paymentType')?.value;
        if (pType === 'Online' || pType === 'Cash') {
          const paidInput = document.getElementById('amountPaid');
          if (paidInput) paidInput.value = feeInput.value;
        }
      });
    }
  }

  // Register Service Worker for Instant PWA Caching
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
          console.warn('SW registration skipped:', err);
        });
      });
    }
  }

  // Theme Management
  function initTheme() {
    const saved = localStorage.getItem(PhysioConfig.STORAGE_KEYS.THEME) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }

  function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme') || 'light';
    const next = curr === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.THEME, next);
    updateThemeIcon(next);
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'tab5') {
      PhysioAnalytics.renderDashboard();
    }
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = theme === 'dark' ? '☀️' : '🌙';
  }

  // Sleek Status Indicator (Non-intrusive)
  function updateSyncIndicator(status) {
    const pill = document.getElementById('syncIndicator');
    if (!pill) return;

    const backend = PhysioDB.getActiveBackend();
    const label = backend === 'firebase' ? 'Firestore' : 'Cloud';

    if (status === 'syncing') {
      pill.className = 'sync-pill syncing';
      pill.innerHTML = `<span class="status-dot pulse"></span><span>${label}</span>`;
      pill.style.opacity = '1';
    } else if (status === 'offline') {
      if (!navigator.onLine) {
        pill.className = 'sync-pill offline';
        pill.innerHTML = `<span class="status-dot offline"></span><span>Offline</span>`;
        pill.style.opacity = '1';
      } else {
        pill.style.opacity = '0';
      }
    } else {
      pill.className = 'sync-pill synced';
      pill.innerHTML = `<span class="status-dot online"></span><span>${label}</span>`;
      pill.style.opacity = '1';
      setTimeout(() => {
        if (pill.classList.contains('synced')) {
          pill.style.opacity = '0.35';
        }
      }, 3000);
    }
  }

  // 1-Tap Payment Method Pill Selector for Tab 1
  function setPaymentMethod(mode) {
    const hidden = document.getElementById('paymentType');
    const feeInput = document.getElementById('totalFee');
    const paidInput = document.getElementById('amountPaid');
    if (!hidden) return;

    hidden.value = mode === 'unpaid' ? 'Pending' : mode.charAt(0).toUpperCase() + mode.slice(1);

    document.querySelectorAll('.pay-method-pill').forEach(pill => {
      if (pill.getAttribute('data-mode') === mode) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    const feeVal = parseFloat(feeInput?.value) || 0;
    if (mode === 'unpaid') {
      if (paidInput) paidInput.value = '0';
    } else {
      if (paidInput && (parseFloat(paidInput.value) === 0 || !paidInput.value)) {
        if (feeVal > 0) paidInput.value = feeVal;
      }
    }
  }

  // Toast Notifications
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // Global Patient Cache
  function updateGlobalPatientsList(visits) {
    const names = new Set();
    visits.forEach(v => {
      if (v.name) names.add(v.name);
    });
    globalPatients = Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  // Tab Navigation Routing
  function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');

    const targetNav = document.getElementById(`nav-${tabId}`);
    if (targetNav) targetNav.classList.add('active');

    renderCurrentTab(tabId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderCurrentTab(tabId) {
    if (tabId === 'tab1') {
      PhysioClinical.renderQuickPatientsBar();
    } else if (tabId === 'tab2') {
      PhysioLedger.renderUpcomingAndRecent();
    } else if (tabId === 'tab3') {
      PhysioLedger.renderLedger();
    } else if (tabId === 'tab4') {
      PhysioClinical.renderPatientHistory();
    } else if (tabId === 'tab5') {
      PhysioAnalytics.renderDashboard();
    }
  }

  // Patient Slide-Up Modal Drawer
  function openPatientModal(context) {
    currentModalContext = context;
    const modal = document.getElementById('patientSearchModal');
    const input = document.getElementById('modalSearchInput');
    modal.classList.add('active');
    input.value = '';
    renderModalList('');
    setTimeout(() => input.focus(), 150);
  }

  function closePatientModal() {
    const modal = document.getElementById('patientSearchModal');
    modal.classList.remove('active');
  }

  function renderModalList(filterText) {
    const list = document.getElementById('modalPatientList');
    const query = (filterText || '').trim().toLowerCase();
    const filtered = globalPatients.filter(p => p.toLowerCase().includes(query));

    let html = '';
    if (query && !filtered.some(p => p.toLowerCase() === query)) {
      const properName = PhysioDB.sanitizeName(filterText);
      html += `
      <div class="sheet-item sheet-item-new" onclick="PhysioApp.selectFromModal('${properName.replace(/'/g, "\\'")}')">
        <span>➕ Add New: <strong>${properName}</strong></span>
      </div>`;
    }

    if (currentModalContext === 'tab3') {
      html += `<div class="sheet-item" onclick="PhysioApp.selectFromModal('')"><em>📋 Show All Patients</em></div>`;
    }

    filtered.forEach(p => {
      html += `<div class="sheet-item" onclick="PhysioApp.selectFromModal('${p.replace(/'/g, "\\'")}')">${p}</div>`;
    });

    if (filtered.length === 0 && !query) {
      html = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 14px;">No patients found.</div>';
    }

    list.innerHTML = html;
  }

  function selectFromModal(patientName) {
    if (currentModalContext === 'tab1') {
      document.getElementById('name').value = patientName;
      document.getElementById('btnTab1Patient').innerHTML = patientName ? `<strong>${patientName}</strong>` : 'Select Patient...';
      if (patientName) PhysioClinical.quickSelectPatient(patientName);
    } else if (currentModalContext === 'tab3') {
      document.getElementById('ledgerPatientSelect').value = patientName;
      document.getElementById('btnTab3Patient').innerHTML = patientName ? `<strong>${patientName}</strong>` : '📋 All Patients';
      PhysioLedger.renderLedger();
    } else if (currentModalContext === 'tab4') {
      document.getElementById('patientSelect').value = patientName;
      document.getElementById('btnTab4Patient').innerHTML = patientName ? `<strong>${patientName}</strong>` : 'Choose Patient...';
      PhysioClinical.renderPatientHistory();
    } else if (currentModalContext === 'tab5') {
      document.getElementById('analyticsPatientSelect').value = patientName;
      document.getElementById('btnTab5Patient').innerHTML = patientName ? `<strong>${patientName}</strong>` : 'Select Patient...';
      PhysioAnalytics.renderPatientAnalytics();
    }

    closePatientModal();
  }

  // Settings & Migration Modal
  function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    updateSettingsModalBackendInfo();
    modal.classList.add('active');
  }

  function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');
  }

  function updateSettingsModalBackendInfo() {
    const badge = document.getElementById('backendStatusBadge');
    if (!badge) return;
    const backend = PhysioDB.getActiveBackend();
    if (backend === 'firebase') {
      badge.innerHTML = `<span style="color:var(--success); font-weight:700;">🔥 Firebase Firestore Active</span>`;
    } else {
      badge.innerHTML = `<span style="color:var(--accent); font-weight:700;">📊 Google Sheets Active</span>`;
    }
  }

  async function handleSaveFirebaseConfig() {
    const textarea = document.getElementById('firebaseConfigInput');
    const raw = textarea.value.trim();
    if (!raw) {
      showToast("Please paste configuration JSON", "error");
      return;
    }
    try {
      const cfg = JSON.parse(raw);
      if (!cfg.projectId || !cfg.apiKey) {
        throw new Error("Invalid Firebase config object");
      }
      localStorage.setItem(PhysioConfig.STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(cfg));
      const ok = PhysioDB.initFirebase(cfg);
      if (ok) {
        showToast("Firebase Config saved & connected!", "success");
      } else {
        showToast("Firebase Config saved (offline initialization)", "info");
      }
    } catch (e) {
      showToast("Invalid JSON format. Check brackets and quotes.", "error");
    }
  }

  async function handleStartFirebaseMigration() {
    const btn = document.getElementById('btnStartMigration');
    btn.disabled = true;
    btn.innerText = "Migrating to Firestore...";
    showToast("Starting Firestore migration...", "info");

    try {
      const result = await PhysioDB.migrateAllToFirebase((done, total) => {
        btn.innerText = `Migrating (${done}/${total})...`;
      });
      showToast(`Success! Migrated ${result.migratedVisits} visits & ${result.migratedPatients} patients!`, "success");
      updateSettingsModalBackendInfo();
      updateSyncIndicator("success");
    } catch (e) {
      console.error(e);
      showToast("Migration error: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerText = "🔥 Migrate to Firestore";
    }
  }

  function handleSwitchBackend(type) {
    PhysioDB.setActiveBackend(type);
    updateSettingsModalBackendInfo();
    updateSyncIndicator("success");
    showToast(`Switched backend to ${type.toUpperCase()}`, "info");
  }

  // ========================================================
  // STANDALONE INVOICE PORTAL FOR PATIENTS
  // ========================================================
  async function renderStandaloneInvoiceMode(token) {
    const payload = PhysioPayments.decodeInvoicePayload(token);
    document.getElementById('doctorAppView').style.display = 'none';

    const portalMount = document.getElementById('patientInvoiceMount');
    portalMount.style.display = 'flex';

    if (!payload || !payload.name) {
      portalMount.innerHTML = `
      <div class="invoice-card">
        <div style="font-size:3rem; margin-bottom:12px;">❌</div>
        <h2 style="color:var(--danger); margin:0 0 8px 0; font-size:1.4rem;">Invoice Not Found</h2>
        <p style="color:var(--text-muted); font-size:14px; line-height:1.5;">This payment link appears to be invalid or expired. Please contact ${PhysioConfig.CLINIC_NAME}.</p>
      </div>`;
      return;
    }

    const patientName = payload.name;
    let totalDue = payload.totalAmount || 0;
    let sessions = payload.sessions || [];

    // If payload did not carry itemized sessions, fallback to local DB if available
    if (totalDue === 0 && sessions.length === 0) {
      try {
        const visits = await PhysioDB.init();
        const cleanName = PhysioDB.sanitizeName(patientName);
        const patientVisits = visits.filter(v => v.name === cleanName);

        patientVisits.forEach(v => {
          const pType = (v.paymentType || '').toLowerCase().trim();
          const fee = parseFloat(v.totalFee) || 0;
          const paid = parseFloat(v.amountPaid) || 0;
          if (pType === 'pending' || ((pType === 'cash' || pType === 'online') && paid < fee)) {
            const bal = fee - paid;
            totalDue += bal;
            const d = v.date ? new Date(v.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Session";
            sessions.push({ d: d, a: bal });
          }
        });
      } catch (e) {
        console.warn("Local DB fallback lookup skipped:", e);
      }
    }

    if (totalDue === 0) {
      portalMount.innerHTML = `
      <div class="invoice-card">
        <div style="font-size:3rem; margin-bottom:12px;">✅</div>
        <h2 style="color:var(--success); margin:0 0 8px 0; font-size:1.4rem;">All Dues Cleared</h2>
        <p style="color:var(--text-main); font-size:15px; margin-bottom:16px;">Hello <strong>${patientName}</strong>, you have no outstanding dues with ${PhysioConfig.CLINIC_NAME}.</p>
        <div style="font-size:13px; color:var(--text-muted);">Thank you for your timely payment! 🌟</div>
      </div>`;
      return;
    }

    let itemsHtml = '';
    sessions.forEach(item => {
      itemsHtml += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--border-subtle); font-size:14px;">
        <span style="color:var(--text-main); font-weight:500;">${item.d || 'Physiotherapy Session'}</span>
        <strong style="color:var(--text-main);">${PhysioPayments.formatINR(item.a)}</strong>
      </div>`;
    });

    const upiLink = PhysioPayments.buildUPIString(PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, totalDue, "PhysioClinic");

    portalMount.innerHTML = `
    <div class="invoice-card">
      <div class="invoice-clinic-header">
        <div class="invoice-clinic-name">${PhysioConfig.CLINIC_NAME}</div>
        <div class="invoice-clinic-sub">${PhysioConfig.CLINIC_TITLE}</div>
      </div>
      
      <div class="invoice-badge-due">
        <div class="invoice-badge-label">TOTAL OUTSTANDING DUE</div>
        <div class="invoice-badge-amount">${PhysioPayments.formatINR(totalDue)}</div>
        <div class="invoice-patient-tag">Patient: <strong>${patientName}</strong></div>
      </div>

      ${itemsHtml ? `
      <div class="invoice-breakdown-card">
        <div class="invoice-breakdown-title">Treatment Sessions</div>
        ${itemsHtml}
      </div>` : ''}

      <a href="${upiLink}" class="btn-main invoice-pay-btn">
        ⚡ Pay ${PhysioPayments.formatINR(totalDue)} via UPI
      </a>

      <div class="invoice-qr-wrap">
        <div class="invoice-qr-title">Or scan QR with GPay, PhonePe, Paytm, BHIM:</div>
        <div id="patientQrCanvasContainer" class="invoice-qr-canvas"></div>
      </div>

      <button class="btn-main btn-secondary" style="margin-top:14px; padding:12px; font-size:13px;" onclick="PhysioApp.copyUPI()">
        📋 Copy UPI ID: <strong>${PhysioConfig.CLINIC_UPI_ID}</strong>
      </button>

      <div class="invoice-security-footer">
        🔒 NPCI Verified • Direct Account-to-Account UPI Transfer
      </div>
    </div>`;

    setTimeout(() => {
      const qrBox = document.getElementById('patientQrCanvasContainer');
      if (qrBox && window.QRCode) {
        new QRCode(qrBox, {
          text: upiLink,
          width: 170,
          height: 170,
          colorDark: "#004d40",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
      }
    }, 60);
  }

  function copyUPI() {
    navigator.clipboard.writeText(PhysioConfig.CLINIC_UPI_ID).then(() => {
      showToast("✓ UPI ID copied to clipboard!", "success");
    }).catch(() => {
      showToast("UPI ID: " + PhysioConfig.CLINIC_UPI_ID, "info");
    });
  }

  return {
    init,
    toggleTheme,
    switchTab,
    showToast,
    setPaymentMethod,
    openPatientModal,
    closePatientModal,
    renderModalList,
    selectFromModal,
    openSettingsModal,
    closeSettingsModal,
    copyUPI,
    handleSaveFirebaseConfig,
    handleStartFirebaseMigration,
    handleSwitchBackend
  };
})();

window.addEventListener('DOMContentLoaded', PhysioApp.init);
