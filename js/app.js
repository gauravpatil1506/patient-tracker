/**
 * Master Application Orchestrator
 * Routing, Lifecycle, Service Worker Registration, Toast Notifications, and Firebase Migration UI
 */

window.PhysioApp = (function() {
  let currentModalContext = '';
  let globalPatients = [];
  let isWorkspaceInitialized = false;
  let currentPinStr = '';
  let authMode = 'login'; // 'login' | 'setup_create' | 'setup_confirm'
  let tempSetupPin = '';

  // Bootstrapping
  async function init() {
    initTheme();
    registerServiceWorker();
    initSwipeGestures();

    // Check if URL is in Patient Invoice Viewer mode (?invoice=TOKEN)
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceToken = urlParams.get('invoice');
    if (invoiceToken) {
      renderStandaloneInvoiceMode(invoiceToken);
      return;
    }

    // Check Authentication Session
    const session = PhysioAuth.checkSession();
    if (!session) {
      showAuthScreen();
      // Silently pre-warm database in background for instant readiness once unlocked
      PhysioDB.init().then(visits => updateGlobalPatientsList(visits)).catch(() => {});
      return;
    }

    await launchDoctorWorkspace();
  }

  async function launchDoctorWorkspace() {
    const authSec = document.getElementById('authSection');
    const doctorView = document.getElementById('doctorAppView');
    if (authSec) authSec.style.display = 'none';
    if (doctorView) doctorView.style.display = 'block';

    if (isWorkspaceInitialized) return;
    isWorkspaceInitialized = true;

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

  /* -------------------------------------------------------------------------
   * Security & Quick 4-Digit PIN Authentication Handlers
   * ------------------------------------------------------------------------- */
  async function showAuthScreen() {
    const authSec = document.getElementById('authSection');
    const doctorView = document.getElementById('doctorAppView');
    if (doctorView) doctorView.style.display = 'none';
    if (authSec) authSec.style.display = 'flex';

    resetPinDisplay();

    const isConfigured = await PhysioAuth.isPinConfigured();
    if (!isConfigured) {
      authMode = 'setup_create';
      tempSetupPin = '';
      updateAuthUI('Welcome, Dr. Anjali!', 'Create your 4-digit Clinic PIN', '🔒 Initial Setup');
    } else {
      authMode = 'login';
      updateAuthUI('Dr. Anjali Vishwakarma', 'Enter your 4-digit PIN to unlock', '🔒 Clinic Security Lock');
    }

    focusPinInput();
  }

  function updateAuthUI(title, instruction, badge) {
    const titleEl = document.getElementById('authGreetingTitle');
    const instEl = document.getElementById('authInstruction');
    const badgeEl = document.querySelector('.auth-user-badge span');
    if (titleEl) titleEl.innerText = title;
    if (instEl) instEl.innerText = instruction;
    if (badgeEl && badge) badgeEl.innerText = badge;
  }

  function resetPinDisplay() {
    currentPinStr = '';
    const pinInput = document.getElementById('loginPin');
    if (pinInput) pinInput.value = '';
    updateDotsUI();
    const msg = document.getElementById('authMsg');
    if (msg) msg.innerText = '';
  }

  function updateDotsUI() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`pinDot${i}`);
      if (dot) {
        if (i < currentPinStr.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      }
    }
  }

  function focusPinInput() {
    const pinInput = document.getElementById('loginPin');
    if (pinInput) pinInput.focus();
  }

  function triggerHaptic() {
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) {}
    }
  }

  async function handleKeypadPress(action) {
    triggerHaptic();
    const msg = document.getElementById('authMsg');
    if (msg) msg.innerText = '';

    if (action === 'clear') {
      resetPinDisplay();
      return;
    }

    if (action === 'backspace') {
      if (currentPinStr.length > 0) {
        currentPinStr = currentPinStr.slice(0, -1);
        updateDotsUI();
      }
      return;
    }

    if (currentPinStr.length < 4 && /^[0-9]$/.test(action)) {
      currentPinStr += action;
      updateDotsUI();

      if (currentPinStr.length === 4) {
        await executePinSubmission(currentPinStr);
      }
    }
  }

  async function handlePinInput(val) {
    const clean = (val || '').replace(/\D/g, '').substring(0, 4);
    currentPinStr = clean;
    updateDotsUI();

    if (currentPinStr.length === 4) {
      await executePinSubmission(currentPinStr);
    }
  }

  async function executePinSubmission(pin) {
    const msg = document.getElementById('authMsg');
    const card = document.getElementById('authLockCard');

    if (authMode === 'setup_create') {
      tempSetupPin = pin;
      authMode = 'setup_confirm';
      updateAuthUI('Confirm Your PIN', 'Re-enter your 4-digit PIN to confirm', '🔒 Initial Setup');
      resetPinDisplay();
      if (msg) {
        msg.innerText = 'Now re-enter to confirm.';
        msg.style.color = 'var(--primary)';
      }
      return;
    }

    if (authMode === 'setup_confirm') {
      if (pin !== tempSetupPin) {
        if (card) {
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 400);
        }
        if (msg) {
          msg.innerText = 'PINs did not match. Please start over.';
          msg.style.color = 'var(--danger)';
        }
        authMode = 'setup_create';
        tempSetupPin = '';
        setTimeout(() => {
          updateAuthUI('Welcome, Dr. Anjali!', 'Create your 4-digit Clinic PIN', '🔒 Initial Setup');
          resetPinDisplay();
        }, 1200);
        return;
      }

      if (msg) {
        msg.innerText = 'Setting up clinic PIN...';
        msg.style.color = 'var(--primary)';
      }

      try {
        await PhysioAuth.setupPin(pin);
        showToast('✓ PIN configured successfully! Welcome Dr. Anjali', 'success');
        await launchDoctorWorkspace();
      } catch (err) {
        if (msg) {
          msg.innerText = err.message || 'Error setting PIN';
          msg.style.color = 'var(--danger)';
        }
        resetPinDisplay();
      }
      return;
    }

    // Default: 'login' mode
    if (msg) {
      msg.innerText = 'Verifying security PIN...';
      msg.style.color = 'var(--primary)';
    }

    try {
      await PhysioAuth.login(pin);
      showToast('✓ Welcome back, Dr. Anjali!', 'success');
      await launchDoctorWorkspace();
    } catch (err) {
      if (card) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 400);
      }
      if (msg) {
        msg.innerText = err.message || 'Incorrect PIN. Please try again.';
        msg.style.color = 'var(--danger)';
      }
      resetPinDisplay();
    }
  }

  async function promptChangePin() {
    closeSettingsModal();
    const oldPin = prompt("Enter your CURRENT 4-digit PIN:");
    if (oldPin === null) return;
    if (!/^\d{4}$/.test(oldPin.trim())) {
      showToast("Current PIN must be 4 digits", "error");
      return;
    }

    const newPin = prompt("Enter your NEW 4-digit PIN:");
    if (newPin === null) return;
    if (!/^\d{4}$/.test(newPin.trim())) {
      showToast("New PIN must be exactly 4 digits", "error");
      return;
    }

    const confirmPin = prompt("Confirm your NEW 4-digit PIN:");
    if (confirmPin === null) return;
    if (newPin.trim() !== confirmPin.trim()) {
      showToast("New PINs did not match", "error");
      return;
    }

    try {
      await PhysioAuth.changePin(oldPin.trim(), newPin.trim());
      showToast("✓ Security PIN updated successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to update PIN", "error");
    }
  }

  // Keyboard shortcut listener for desktop / laptop entry
  window.addEventListener('keydown', (e) => {
    const authSec = document.getElementById('authSection');
    if (!authSec || authSec.style.display === 'none') return;

    if (e.key >= '0' && e.key <= '9') {
      handleKeypadPress(e.key);
    } else if (e.key === 'Backspace') {
      handleKeypadPress('backspace');
    } else if (e.key === 'Escape') {
      handleKeypadPress('clear');
    }
  });

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

  // Sleek Status Indicator (Zero-clutter badge on Cloud Sync button)
  function updateSyncIndicator(status) {
    const dot = document.getElementById('syncDotBadge');
    if (dot) {
      if (status === 'syncing') {
        dot.className = 'sync-dot-badge syncing';
        dot.title = 'Syncing with Firestore...';
      } else if (status === 'offline' || !navigator.onLine) {
        dot.className = 'sync-dot-badge offline';
        dot.title = 'Operating Offline (Local DB Active)';
      } else {
        dot.className = 'sync-dot-badge online';
        dot.title = 'Connected to Firestore Cloud';
      }
    }

    const pill = document.getElementById('syncIndicator');
    if (pill) {
      if (status === 'syncing') {
        pill.className = 'sync-pill syncing';
      } else if (status === 'offline') {
        pill.className = 'sync-pill offline';
      } else {
        pill.className = 'sync-pill synced';
      }
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

  const TAB_ORDER = ['tab1', 'tab2', 'tab3', 'tab4', 'tab5'];

  // Tab Navigation Routing with Fluid Directional Animations
  function switchTab(tabId, direction = null) {
    const currentActive = document.querySelector('.tab-content.active');
    const currentId = currentActive ? currentActive.id : 'tab1';

    // Auto-infer direction if not explicitly supplied
    if (!direction && currentId !== tabId) {
      const fromIdx = TAB_ORDER.indexOf(currentId);
      const toIdx = TAB_ORDER.indexOf(tabId);
      if (fromIdx !== -1 && toIdx !== -1) {
        direction = toIdx > fromIdx ? 'right' : 'left';
      }
    }

    document.querySelectorAll('.tab-content').forEach(el => {
      el.classList.remove('active', 'slide-from-right', 'slide-from-left');
    });
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.classList.add('active');
      if (direction === 'right') {
        targetTab.classList.add('slide-from-right');
      } else if (direction === 'left') {
        targetTab.classList.add('slide-from-left');
      }
      setTimeout(() => {
        targetTab.classList.remove('slide-from-right', 'slide-from-left');
      }, 240);
    }

    const targetNav = document.getElementById(`nav-${tabId}`);
    if (targetNav) targetNav.classList.add('active');

    renderCurrentTab(tabId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Native Instagram / WhatsApp Style Horizontal Tab Swipe Navigation
  function initSwipeGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isVerticalScroll = false;
    let isSwipeCancelled = false;

    // Elements that must not trigger a tab change
    function isExcludedTarget(el) {
      if (!el) return false;
      return el.closest(
        'input, textarea, select, button, .quick-patients-scroll, .pain-stepper-btn, .pain-value-display, canvas, .medical-pain-card, .sheet-overlay, .modal-overlay, a'
      );
    }

    const appView = document.getElementById('doctorAppView');
    if (!appView) return;

    appView.addEventListener('touchstart', e => {
      // Ignore multi-touch gestures (pinching, etc.)
      if (e.touches.length > 1) {
        isSwipeCancelled = true;
        return;
      }
      // Ignore if a modal or search sheet is currently open
      if (document.querySelector('.sheet-overlay.active, .modal-overlay.active')) {
        isSwipeCancelled = true;
        return;
      }
      // Ignore interactive inputs or carousels
      if (isExcludedTarget(e.target)) {
        isSwipeCancelled = true;
        return;
      }

      isSwipeCancelled = false;
      isVerticalScroll = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    appView.addEventListener('touchmove', e => {
      if (isSwipeCancelled || isVerticalScroll) return;

      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Lock gesture as vertical if vertical movement leads after 8px
      if (absX > 8 || absY > 8) {
        if (absY > absX) {
          isVerticalScroll = true; // User is scrolling vertically
        }
      }
    }, { passive: true });

    appView.addEventListener('touchend', e => {
      if (isSwipeCancelled || isVerticalScroll) return;
      if (!e.changedTouches || e.changedTouches.length === 0) return;

      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const elapsed = Date.now() - touchStartTime;

      // Realistic Instagram / WhatsApp swipe physics:
      // 1. Minimum horizontal travel: 52px (or 35px if quick flick < 250ms)
      // 2. Strict horizontal dominance: horizontal travel must be at least 1.5x vertical travel
      // 3. Time limit: within 500ms
      const isQuickFlick = elapsed <= 260 && absX >= 35 && absY <= 25;
      const isStandardSwipe = elapsed <= 500 && absX >= 52 && absX >= (absY * 1.5);

      if (isQuickFlick || isStandardSwipe) {
        const activeTab = document.querySelector('.tab-content.active');
        const currTabId = activeTab ? activeTab.id : 'tab1';
        const currIdx = TAB_ORDER.indexOf(currTabId);
        if (currIdx === -1) return;

        if (deltaX < 0) {
          // Swiped LEFT (finger moved right to left) -> Go to NEXT Tab
          if (currIdx < TAB_ORDER.length - 1) {
            const nextTabId = TAB_ORDER[currIdx + 1];
            switchTab(nextTabId, 'right');
            if (navigator.vibrate) try { navigator.vibrate(10); } catch(err) {}
          }
        } else {
          // Swiped RIGHT (finger moved left to right) -> Go to PREVIOUS Tab
          if (currIdx > 0) {
            const prevTabId = TAB_ORDER[currIdx - 1];
            switchTab(prevTabId, 'left');
            if (navigator.vibrate) try { navigator.vibrate(10); } catch(err) {}
          }
        }
      }
    }, { passive: true });
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

  // 1-Tap Hard Cloud Sync / Quick Refresh
  async function manualCloudSync() {
    const icon = document.getElementById('headerSyncIcon');
    if (icon) icon.classList.add('spinning');
    updateSyncIndicator("syncing");
    showToast("Checking cloud for new entries...", "info");

    try {
      const count = await PhysioDB.syncWithFirestore();
      showToast(`✓ Cloud Synchronized (${count} visits)`, "success");
      updateSyncIndicator("success");
    } catch (e) {
      console.warn("Manual sync fallback:", e);
      await PhysioDB.syncWithCloud(status => updateSyncIndicator(status));
      showToast("✓ Cloud Synced", "success");
    } finally {
      if (icon) {
        setTimeout(() => icon.classList.remove('spinning'), 700);
      }
    }
  }

  // Settings & Migration Modal
  function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    updateSettingsModalBackendInfo();

    const visits = PhysioDB.getVisits();
    const countEl = document.getElementById('settingsRecordCount');
    if (countEl) {
      countEl.innerText = `${visits.length} Visits • ${globalPatients.length} Patients Active`;
    }

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
      badge.innerHTML = `<span style="color:var(--success); font-weight:700;">🟢 Connected to Cloud Firestore (Real-Time Active)</span>`;
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
      btn.innerText = "🔥 Re-Sync to Firestore";
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

    // Fallback if needed
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
    const gpayLink = PhysioPayments.buildAppUPIString('gpay', PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, totalDue, "PhysioClinic");
    const phonepeLink = PhysioPayments.buildAppUPIString('phonepe', PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, totalDue, "PhysioClinic");
    const paytmLink = PhysioPayments.buildAppUPIString('paytm', PhysioConfig.CLINIC_UPI_ID, PhysioConfig.CLINIC_PAYEE_NAME, totalDue, "PhysioClinic");

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

      <!-- Primary 1-Tap Pay Button -->
      <a href="${upiLink}" class="btn-main invoice-pay-btn">
        ⚡ 1-Tap Pay ${PhysioPayments.formatINR(totalDue)} via UPI
      </a>

      <!-- Direct UPI App Selectors -->
      <div class="upi-app-selector-title">Select your preferred UPI App:</div>
      <div class="upi-app-buttons-grid">
        <a href="${gpayLink}" class="upi-app-btn upi-btn-gpay">
          <span>Google Pay</span>
        </a>
        <a href="${phonepeLink}" class="upi-app-btn upi-btn-phonepe">
          <span>PhonePe</span>
        </a>
        <a href="${paytmLink}" class="upi-app-btn upi-btn-paytm">
          <span>Paytm</span>
        </a>
      </div>

      <!-- Direct UPI ID Copy Box (Risk Policy Workaround) -->
      <div class="vpa-copy-card">
        <div class="vpa-copy-head">
          <span class="vpa-copy-label">Direct UPI ID:</span>
          <button class="vpa-copy-button" onclick="PhysioApp.copyUPI()">📋 Copy ID</button>
        </div>
        <div class="vpa-copy-val">${PhysioConfig.CLINIC_UPI_ID}</div>
        <div class="vpa-copy-note">
          💡 <em>If PhonePe or your bank shows a "safeguard risk alert", copy the UPI ID above and paste it directly into Google Pay or PhonePe to pay with zero warnings.</em>
        </div>
      </div>

      <!-- Dynamic QR Code -->
      <div class="invoice-qr-wrap">
        <div class="invoice-qr-title">Or scan QR with any UPI app:</div>
        <div id="patientQrCanvasContainer" class="invoice-qr-canvas"></div>
      </div>

      <div class="invoice-security-footer">
        🔒 NPCI Compliant • Direct Account-to-Account Bank Transfer
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
      showToast("✓ UPI ID copied! Paste in GPay or PhonePe", "success");
    }).catch(() => {
      showToast("UPI ID: " + PhysioConfig.CLINIC_UPI_ID, "info");
    });
  }

  return {
    init,
    toggleTheme,
    switchTab,
    showToast,
    manualCloudSync,
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
    handleSwitchBackend,
    handleKeypadPress,
    handlePinInput,
    focusPinInput,
    promptChangePin
  };
})();

window.addEventListener('DOMContentLoaded', PhysioApp.init);
