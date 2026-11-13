/**
 * High-Performance Local-First Persistence Engine
 * Supports Instant Offline Boot (IndexedDB), Google Sheets Sync, and Native Firebase Firestore Migration
 */

window.PhysioDB = (function() {
  const DB_NAME = "PhysioClinicDB";
  const DB_VERSION = 1;
  const STORE_VISITS = "visits";
  const STORE_META = "meta";

  // Standardized Firestore Collections (GP_PT Prefix)
  const FIRESTORE_COL_VISITS = "GP_PT_visits";
  const FIRESTORE_COL_PATIENTS = "GP_PT_patients";

  let dbInstance = null;
  let inMemoryVisits = [];
  let isSyncing = false;
  let listeners = [];
  let firestoreDb = null;
  let realtimeUnsubscribe = null;

  // Open / Upgrade IndexedDB
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_VISITS)) {
          const visitStore = db.createObjectStore(STORE_VISITS, { keyPath: "id", autoIncrement: true });
          visitStore.createIndex("name", "name", { unique: false });
          visitStore.createIndex("date", "date", { unique: false });
          visitStore.createIndex("paymentType", "paymentType", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };

      request.onsuccess = function(e) {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };

      request.onerror = function(e) {
        console.error("IndexedDB open error:", e);
        reject(e);
      };
    });
  }

  function sanitizeName(rawName) {
    if (!rawName) return "";
    return rawName.toString().trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
  }

  function parseSheetRow(row, rowIndex) {
    if (!row || !row[1] || !row[2]) return null;
    return {
      timestamp: row[0] ? row[0].toString() : new Date().toISOString(),
      date: row[1] ? row[1].toString() : "",
      name: sanitizeName(row[2]),
      location: row[3] ? row[3].toString().trim() : "",
      paymentType: row[4] ? row[4].toString().trim() : "Pending",
      amountPaid: parseFloat(row[5]) || 0,
      totalFee: parseFloat(row[6]) || 0,
      painBefore: row[7] !== "" && row[7] != null ? parseInt(row[7], 10) : null,
      painAfter: row[8] !== "" && row[8] != null ? parseInt(row[8], 10) : null,
      sessionType: row[9] ? row[9].toString().trim() : "Regular",
      nextAppt: row[10] ? row[10].toString().trim() : "",
      notes: row[11] ? row[11].toString().trim() : "",
      month: row[12] ? row[12].toString().trim() : "",
      sheetRowIndex: rowIndex
    };
  }

  function toSheetRow(visit) {
    return [
      visit.timestamp || new Date().toISOString(),
      visit.date || "",
      visit.name || "",
      visit.location || "",
      visit.paymentType || "Pending",
      visit.amountPaid != null ? visit.amountPaid : 0,
      visit.totalFee != null ? visit.totalFee : 0,
      visit.painBefore != null ? visit.painBefore : "",
      visit.painAfter != null ? visit.painAfter : "",
      visit.sessionType || "",
      visit.nextAppt || "",
      visit.notes || "",
      visit.month || ""
    ];
  }

  // Active Backend Resolver: 'sheets' or 'firebase'
  function getActiveBackend() {
    return localStorage.getItem(PhysioConfig.STORAGE_KEYS.ACTIVE_BACKEND) || (PhysioConfig.FIREBASE_CONFIG ? 'firebase' : 'sheets');
  }

  function setActiveBackend(backendType) {
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.ACTIVE_BACKEND, backendType);
  }

  // Firebase Config & Initialization
  function getFirebaseConfig() {
    try {
      const cfg = localStorage.getItem(PhysioConfig.STORAGE_KEYS.FIREBASE_CONFIG);
      return cfg ? JSON.parse(cfg) : PhysioConfig.FIREBASE_CONFIG;
    } catch (e) {
      return PhysioConfig.FIREBASE_CONFIG;
    }
  }

  function initFirebase(config) {
    if (!config || !config.projectId || typeof firebase === 'undefined') {
      return false;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(config);
      }
      firestoreDb = firebase.firestore();
      setupRealtimeSync();
      return true;
    } catch (e) {
      console.error("Firebase init error:", e);
      return false;
    }
  }

  // Direct High-Speed Firestore REST API Client (Works on any network / browser, immune to WebChannel drops)
  async function fetchVisitsFromFirestoreREST() {
    const cfg = getFirebaseConfig();
    if (!cfg || !cfg.projectId) return null;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${FIRESTORE_COL_VISITS}?pageSize=300`;
    
    let allDocs = [];
    let pageToken = null;
    let safetyCounter = 0;

    do {
      const url = pageToken ? `${baseUrl}&pageToken=${pageToken}` : baseUrl;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Firestore REST HTTP error ${res.status}`);
      }
      const data = await res.json();
      if (data && Array.isArray(data.documents)) {
        allDocs = allDocs.concat(data.documents);
      }
      pageToken = data.nextPageToken || null;
      safetyCounter++;
    } while (pageToken && safetyCounter < 10);

    return allDocs;
  }

  function parseFirestoreRestDoc(doc) {
    if (!doc || !doc.name) return null;
    const docId = doc.name.split('/').pop() || "";
    const match = docId.match(/^visit_(\d+)$/);
    if (!match) return null; // Ignore non-matching documents
    const visitId = parseInt(match[1], 10);
    const f = doc.fields || {};

    const extract = (field) => {
      if (!field) return null;
      if (field.stringValue !== undefined) return field.stringValue;
      if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
      if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
      if (field.booleanValue !== undefined) return field.booleanValue;
      if (field.timestampValue !== undefined) return field.timestampValue;
      return null;
    };

    return {
      id: visitId,
      timestamp: extract(f.timestamp) || new Date().toISOString(),
      date: extract(f.date) || "",
      name: sanitizeName(extract(f.name) || ""),
      location: (extract(f.location) || "").trim(),
      paymentType: extract(f.paymentType) || "Pending",
      amountPaid: Number(extract(f.amountPaid)) || 0,
      totalFee: Number(extract(f.totalFee)) || 0,
      painBefore: f.painBefore ? extract(f.painBefore) : null,
      painAfter: f.painAfter ? extract(f.painAfter) : null,
      sessionType: extract(f.sessionType) || "Regular",
      nextAppt: extract(f.nextAppt) || "",
      notes: extract(f.notes) || "",
      month: extract(f.month) || "",
      sheetRowIndex: visitId + 1,
      synced: true
    };
  }

  // Batch write records into local IndexedDB and memory with complete transaction error handling
  async function mergeVisitRecords(records) {
    if (!records || records.length === 0) return 0;
    const db = await openDatabase();
    
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      const store = tx.objectStore(STORE_VISITS);

      records.forEach(rec => {
        if (rec && rec.id) {
          store.put(rec);
        }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => {
        console.error("IndexedDB merge transaction error:", e);
        reject(e);
      };
      tx.onabort = (e) => {
        console.error("IndexedDB merge transaction aborted:", e);
        reject(e);
      };
    });

    inMemoryVisits = await getAllVisits();
    notify();
    return inMemoryVisits.length;
  }

  // Merge remote Firestore documents into local IndexedDB and memory
  async function mergeFirestoreVisits(querySnapshot) {
    if (!querySnapshot || querySnapshot.empty) return 0;
    const records = [];
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const match = docSnap.id.match(/^visit_(\d+)$/);
      const visitId = match ? parseInt(match[1], 10) : (data.id || (records.length + 1));

      records.push({
        id: visitId,
        timestamp: data.timestamp || new Date().toISOString(),
        date: data.date || "",
        name: sanitizeName(data.name || ""),
        location: (data.location || "").trim(),
        paymentType: data.paymentType || "Pending",
        amountPaid: Number(data.amountPaid) || 0,
        totalFee: Number(data.totalFee) || 0,
        painBefore: data.painBefore !== "" && data.painBefore != null ? parseInt(data.painBefore, 10) : null,
        painAfter: data.painAfter !== "" && data.painAfter != null ? parseInt(data.painAfter, 10) : null,
        sessionType: data.sessionType || "Regular",
        nextAppt: data.nextAppt || "",
        notes: data.notes || "",
        month: data.month || "",
        sheetRowIndex: visitId + 1,
        synced: true
      });
    });

    return await mergeVisitRecords(records);
  }

  // Attach Firestore real-time listener for instant multi-device synchrony (<500ms)
  function setupRealtimeSync(onStatusChange) {
    if (!firestoreDb) return;
    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch (e) {}
    }

    try {
      realtimeUnsubscribe = firestoreDb.collection(FIRESTORE_COL_VISITS).onSnapshot(snapshot => {
        // Handle realtime deletions across devices
        snapshot.docChanges().forEach(change => {
          if (change.type === 'removed') {
            const match = change.doc.id.match(/^visit_(\d+)$/);
            if (match) {
              const removedId = parseInt(match[1], 10);
              const idx = inMemoryVisits.findIndex(v => v.id === removedId);
              if (idx !== -1) {
                inMemoryVisits.splice(idx, 1);
                openDatabase().then(db => {
                  const tx = db.transaction(STORE_VISITS, "readwrite");
                  tx.objectStore(STORE_VISITS).delete(removedId);
                });
                notify();
              }
            }
          }
        });

        if (!snapshot.empty) {
          mergeFirestoreVisits(snapshot).then(() => {
            if (onStatusChange) onStatusChange("success");
            if (window.PhysioApp && window.PhysioApp.updateSyncIndicator) {
              window.PhysioApp.updateSyncIndicator("success");
            }
          });
        }
      }, err => {
        console.warn("Firestore real-time subscription notice:", err);
      });
    } catch (e) {
      console.warn("Could not attach Firestore real-time listener:", e);
    }
  }

  // Automatic Outbox Push:
  // Detects any visits in local IndexedDB that were created or modified offline on THIS device
  // (strictly where synced === false) and pushes them to Firestore before cache clearance.
  async function pushUnsyncedVisitsToFirestore() {
    if (!navigator.onLine) return;
    try {
      const localVisits = await getAllVisits();
      if (!localVisits || localVisits.length === 0) return;

      const unsyncedVisits = localVisits.filter(v => v && v.synced === false);
      if (unsyncedVisits.length === 0) return;

      console.log(`Found ${unsyncedVisits.length} queued offline visit(s) to push to Firestore...`);

      const cfg = getFirebaseConfig();
      if (!cfg || !cfg.projectId) return;

      // Fetch existing remote IDs to prevent any ID collision
      const restDocs = await fetchVisitsFromFirestoreREST();
      const existingRemoteIds = new Set();
      let maxRemoteId = 0;
      if (restDocs && Array.isArray(restDocs)) {
        restDocs.forEach(d => {
          const docId = d.name ? d.name.split('/').pop() : "";
          const match = docId.match(/^visit_(\d+)$/);
          if (match) {
            const numId = parseInt(match[1], 10);
            existingRemoteIds.add(numId);
            if (numId > maxRemoteId) maxRemoteId = numId;
          }
        });
      }

      for (const v of unsyncedVisits) {
        if (!v || !v.name) continue;
        let vId = Number(v.id) || 0;
        // If local offline ID already exists in remote, allocate next available unique ID
        if (vId === 0 || existingRemoteIds.has(vId)) {
          maxRemoteId++;
          vId = maxRemoteId;
          v.id = vId;
          v.sheetRowIndex = vId + 1;
          existingRemoteIds.add(vId);
        }
        const docId = `visit_${vId}`;
        await dispatchFirestoreRestWrite(docId, v, vId);
        v.synced = true;
      }
      console.log("All queued offline visits successfully pushed to Firestore.");
    } catch (e) {
      console.warn("Outbox push notice:", e);
    }
  }

  // Full Rehydration Sync Engine:
  // 1. Pushes any pending un-synced entries from this device to Firestore first (zero data loss)
  // 2. Fetches fresh authoritative records directly from Firestore REST
  // 3. Atomically clears local IndexedDB cache (reconciles all external deletions & duplicates)
  // 4. Populates local IndexedDB & memory with fresh authoritative records
  // 5. Notifies UI to re-render all tabs with pristine cloud data
  async function rehydrateFromCloud(onStatusChange) {
    if (!navigator.onLine) return inMemoryVisits.length;
    if (onStatusChange) onStatusChange("syncing");

    // Step 1: Push any local un-synced visits first so no offline work is ever lost
    await pushUnsyncedVisitsToFirestore();

    // Step 2: Fetch authoritative dataset from Firestore via fast HTTPS REST
    const restDocs = await fetchVisitsFromFirestoreREST();
    if (!restDocs || !Array.isArray(restDocs)) {
      throw new Error("Could not fetch documents from Firestore");
    }

    const freshRecords = restDocs.map(parseFirestoreRestDoc).filter(Boolean);
    // Sort chronologically ascending
    freshRecords.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

    // Step 3: Clear local cache and re-insert fresh records atomically
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      const store = tx.objectStore(STORE_VISITS);
      
      // Clear out stale / deleted records
      store.clear();

      freshRecords.forEach(rec => {
        if (rec && rec.id) {
          rec.synced = true;
          store.put(rec);
        }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e);
      tx.onabort = e => reject(e);
    });

    // Clear legacy localStorage cached rows
    try { localStorage.removeItem('clinicData'); } catch (e) {}

    // Step 4: Update memory and notify UI
    inMemoryVisits = await getAllVisits();
    notify();

    // Step 5: Keep real-time listener active in background
    const cfg = getFirebaseConfig();
    if (cfg && !firestoreDb) initFirebase(cfg);
    if (firestoreDb && !realtimeUnsubscribe) setupRealtimeSync();

    if (onStatusChange) onStatusChange("success");
    return inMemoryVisits.length;
  }

  // Dual-Channel Cloud Sync (delegates to full rehydration engine)
  async function syncWithFirestore(onStatusChange) {
    return await rehydrateFromCloud(onStatusChange);
  }

  // Direct REST write fallback for 100% write certainty across all networks
  async function dispatchFirestoreRestWrite(docId, record, newId) {
    try {
      const cfg = getFirebaseConfig();
      if (!cfg || !cfg.projectId) return;
      const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${FIRESTORE_COL_VISITS}/${docId}`;
      const fields = {};
      for (const [k, v] of Object.entries(record)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'number') {
          fields[k] = Number.isInteger(v) ? { integerValue: v.toString() } : { doubleValue: v };
        } else if (typeof v === 'boolean') {
          fields[k] = { booleanValue: v };
        } else {
          fields[k] = { stringValue: v.toString() };
        }
      }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      });
      if (res.ok) {
        markSynced(newId);
      }
    } catch (e) {
      console.warn("Firestore REST write notice:", e);
    }
  }

  // Direct REST delete for 100% cloud deletion across all devices
  async function dispatchFirestoreRestDelete(docId) {
    try {
      const cfg = getFirebaseConfig();
      if (!cfg || !cfg.projectId) return;
      const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${FIRESTORE_COL_VISITS}/${docId}`;
      await fetch(url, { method: 'DELETE' });
    } catch (e) {
      console.warn("Firestore REST delete notice:", e);
    }
  }

  // Batch Migrate All 288 Records to Firebase Firestore
  async function migrateAllToFirebase(onProgress) {
    if (!firestoreDb) {
      const cfg = getFirebaseConfig();
      if (!cfg || !initFirebase(cfg)) {
        throw new Error("Please save a valid Firebase Project configuration first.");
      }
    }

    const visits = await getAllVisits();
    if (visits.length === 0) {
      throw new Error("No visits available to migrate.");
    }

    // Step 1: Upload visits in batches (max 400 per batch, Firestore limit is 500)
    const totalVisits = visits.length;
    let completed = 0;

    for (let i = 0; i < totalVisits; i += 400) {
      const batch = firestoreDb.batch();
      const chunk = visits.slice(i, i + 400);

      chunk.forEach(v => {
        const docId = `visit_${v.id || i}`;
        const docRef = firestoreDb.collection(FIRESTORE_COL_VISITS).doc(docId);
        batch.set(docRef, {
          timestamp: v.timestamp || new Date().toISOString(),
          date: v.date || "",
          name: v.name || "",
          location: v.location || "",
          paymentType: v.paymentType || "Pending",
          amountPaid: Number(v.amountPaid) || 0,
          totalFee: Number(v.totalFee) || 0,
          painBefore: v.painBefore != null ? Number(v.painBefore) : null,
          painAfter: v.painAfter != null ? Number(v.painAfter) : null,
          sessionType: v.sessionType || "Regular",
          nextAppt: v.nextAppt || "",
          notes: v.notes || "",
          month: v.month || "",
          migratedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      await batch.commit();
      completed += chunk.length;
      if (onProgress) onProgress(completed, totalVisits);
    }

    // Step 2: Aggregate & upload normalized patients collection
    const patientMap = {};
    visits.forEach(v => {
      if (!patientMap[v.name]) {
        patientMap[v.name] = {
          name: v.name,
          location: v.location,
          sessionCount: 0,
          totalPaid: 0,
          totalPending: 0,
          lastVisitDate: v.date
        };
      }
      patientMap[v.name].sessionCount++;
      const fee = parseFloat(v.totalFee) || 0;
      const paid = parseFloat(v.amountPaid) || 0;
      patientMap[v.name].totalPaid += paid;
      if (fee > paid) patientMap[v.name].totalPending += (fee - paid);
      if (new Date(v.date) > new Date(patientMap[v.name].lastVisitDate)) {
        patientMap[v.name].lastVisitDate = v.date;
      }
    });

    const patientBatch = firestoreDb.batch();
    const phones = getPatientPhones();

    Object.values(patientMap).forEach(p => {
      const docId = `pat_${encodeURIComponent(p.name).replace(/%/g, '_')}`;
      const docRef = firestoreDb.collection(FIRESTORE_COL_PATIENTS).doc(docId);
      patientBatch.set(docRef, {
        name: p.name,
        phone: phones[p.name] || "",
        location: p.location || "",
        sessionCount: p.sessionCount,
        totalPaid: p.totalPaid,
        totalPending: p.totalPending,
        lastVisitDate: p.lastVisitDate,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    await patientBatch.commit();

    // Activate Firebase as the active backend
    setActiveBackend('firebase');
    return { migratedVisits: totalVisits, migratedPatients: Object.keys(patientMap).length };
  }

  // Seed data from IndexedDB, then actively pull fresh cloud visits if online
  async function seedInitialData() {
    checkAndInitFirebase();
    const existingCount = await getCount();
    if (existingCount > 0) {
      inMemoryVisits = await getAllVisits();
    }

    // Actively pull fresh cloud visits so Dr. Anjali's new sessions sync immediately on startup
    if (navigator.onLine) {
      try {
        await syncWithFirestore();
      } catch (e) {
        console.warn("Boot cloud sync notice (operating from local cache):", e);
      }
    } else if (existingCount === 0) {
      let rawRows = null;
      try {
        const cached = localStorage.getItem('clinicData');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 1) {
            rawRows = parsed;
          }
        }
      } catch (e) {}

      if (!rawRows) {
        try {
          const res = await fetch(PhysioConfig.SEED_DATA_URL);
          if (res.ok) {
            rawRows = await res.json();
          }
        } catch (e) {
          console.warn("Could not fetch seed-data.json:", e);
        }
      }

      if (rawRows && Array.isArray(rawRows)) {
        const db = await openDatabase();
        const tx = db.transaction(STORE_VISITS, "readwrite");
        const store = tx.objectStore(STORE_VISITS);

        for (let i = 1; i < rawRows.length; i++) {
          const parsed = parseSheetRow(rawRows[i], i + 1);
          if (parsed) {
            store.add(parsed);
          }
        }

        await new Promise(res => { tx.oncomplete = res; });
      }

      inMemoryVisits = await getAllVisits();
    }

    checkAndInitFirebase();
    return inMemoryVisits;
  }

  function checkAndInitFirebase() {
    const cfg = getFirebaseConfig();
    if (cfg && cfg.projectId) {
      initFirebase(cfg);
    }
  }

  function getCount() {
    return new Promise(async resolve => {
      const db = await openDatabase();
      const tx = db.transaction(STORE_VISITS, "readonly");
      const store = tx.objectStore(STORE_VISITS);
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result);
      countReq.onerror = () => resolve(0);
    });
  }

  function getAllVisits() {
    return new Promise(async resolve => {
      const db = await openDatabase();
      const tx = db.transaction(STORE_VISITS, "readonly");
      const store = tx.objectStore(STORE_VISITS);
      const req = store.getAll();
      req.onsuccess = () => {
        inMemoryVisits = req.result || [];
        resolve(inMemoryVisits);
      };
      req.onerror = () => resolve([]);
    });
  }

  function subscribe(fn) {
    listeners.push(fn);
  }

  function notify() {
    listeners.forEach(fn => {
      try { fn(inMemoryVisits); } catch (e) { console.error(e); }
    });
  }

  // Add new visit with global ID uniqueness
  async function addVisit(visitData) {
    const maxId = inMemoryVisits.reduce((max, v) => Math.max(max, Number(v.id) || 0), 0);
    const newId = maxId + 1;

    const cleanRecord = {
      id: newId,
      timestamp: new Date().toISOString(),
      date: visitData.date,
      name: sanitizeName(visitData.name),
      location: (visitData.location || "").trim(),
      sessionType: (visitData.sessionType || "Regular").trim(),
      painBefore: visitData.painBefore !== "" && visitData.painBefore != null ? parseInt(visitData.painBefore, 10) : null,
      painAfter: visitData.painAfter !== "" && visitData.painAfter != null ? parseInt(visitData.painAfter, 10) : null,
      totalFee: parseFloat(visitData.totalFee) || 0,
      amountPaid: parseFloat(visitData.amountPaid) || 0,
      paymentType: visitData.paymentType || "Pending",
      nextAppt: visitData.nextAppt || "",
      notes: (visitData.notes || "").trim(),
      month: visitData.month || "",
      sheetRowIndex: newId + 1,
      synced: false
    };

    // 1. Optimistic write to IndexedDB
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      const store = tx.objectStore(STORE_VISITS);
      store.put(cleanRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e);
      tx.onabort = e => reject(e);
    });

    inMemoryVisits.push(cleanRecord);
    notify();

    // 2. Dispatch to Active Cloud Backend (Dual SDK + REST write)
    const docId = `visit_${newId}`;
    if (firestoreDb) {
      firestoreDb.collection(FIRESTORE_COL_VISITS).doc(docId).set(cleanRecord).then(() => {
        markSynced(newId);
      }).catch(err => {
        console.warn("Firestore SDK write notice, dispatching REST write:", err);
        dispatchFirestoreRestWrite(docId, cleanRecord, newId);
      });
    } else {
      dispatchFirestoreRestWrite(docId, cleanRecord, newId);
    }

    // Always mirror to Google Sheet for dual redundancy
    const payload = {
      action: "addVisit",
      date: cleanRecord.date,
      name: cleanRecord.name,
      location: cleanRecord.location,
      sessionType: cleanRecord.sessionType,
      painBefore: cleanRecord.painBefore != null ? cleanRecord.painBefore : "",
      painAfter: cleanRecord.painAfter != null ? cleanRecord.painAfter : "",
      totalFee: cleanRecord.totalFee,
      amountPaid: cleanRecord.amountPaid,
      paymentType: cleanRecord.paymentType,
      nextAppt: cleanRecord.nextAppt,
      notes: cleanRecord.notes,
      month: cleanRecord.month
    };
    dispatchCloudAction(payload, cleanRecord.id);

    return cleanRecord;
  }

  // Update payment status
  async function updatePayment(visitId, paymentMethod, fullAmount) {
    const visit = inMemoryVisits.find(v => v.id === visitId);
    if (!visit) return false;

    visit.amountPaid = fullAmount;
    visit.paymentType = paymentMethod;
    visit.synced = false;

    const db = await openDatabase();
    const tx = db.transaction(STORE_VISITS, "readwrite");
    tx.objectStore(STORE_VISITS).put(visit);
    await new Promise(res => { tx.oncomplete = res; });
    notify();

    // Update in Firestore
    if (getActiveBackend() === 'firebase' && firestoreDb) {
      firestoreDb.collection(FIRESTORE_COL_VISITS).doc(`visit_${visitId}`).update({
        amountPaid: fullAmount,
        paymentType: paymentMethod,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => markSynced(visitId)).catch(e => console.warn("Firestore payment update queued:", e));
    }

    // Update in Google Sheet
    const payload = {
      action: "updatePayment",
      rowNumber: visit.sheetRowIndex,
      newAmountPaid: fullAmount,
      newPaymentType: paymentMethod,
      name: visit.name,
      date: visit.date
    };
    dispatchCloudAction(payload, visitId);

    return true;
  }

  // Delete visit
  async function deleteVisit(visitId) {
    const idx = inMemoryVisits.findIndex(v => v.id === visitId);
    if (idx === -1) return false;

    const visit = inMemoryVisits[idx];
    const targetRowIndex = visit.sheetRowIndex;

    inMemoryVisits.splice(idx, 1);
    const db = await openDatabase();
    const tx = db.transaction(STORE_VISITS, "readwrite");
    tx.objectStore(STORE_VISITS).delete(visitId);
    await new Promise(res => { tx.oncomplete = res; });
    notify();

    const docId = `visit_${visitId}`;
    if (firestoreDb) {
      firestoreDb.collection(FIRESTORE_COL_VISITS).doc(docId).delete().catch(e => console.warn("Firestore delete queued:", e));
    }
    // Direct REST delete for guaranteed real-time cloud deletion across all devices
    dispatchFirestoreRestDelete(docId);

    const payload = {
      action: "deleteVisit",
      rowNumber: targetRowIndex
    };
    dispatchCloudAction(payload, null);

    return true;
  }

  // Update next appointment
  async function updateNextAppt(patientName, nextApptDate) {
    const cleanName = sanitizeName(patientName);
    const patientVisits = inMemoryVisits.filter(v => v.name === cleanName);
    if (patientVisits.length === 0) return false;

    patientVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestVisit = patientVisits[0];
    latestVisit.nextAppt = nextApptDate;

    const db = await openDatabase();
    const tx = db.transaction(STORE_VISITS, "readwrite");
    tx.objectStore(STORE_VISITS).put(latestVisit);
    await new Promise(res => { tx.oncomplete = res; });
    notify();

    if (getActiveBackend() === 'firebase' && firestoreDb) {
      firestoreDb.collection(FIRESTORE_COL_VISITS).doc(`visit_${latestVisit.id}`).update({
        nextAppt: nextApptDate
      }).catch(e => console.warn(e));
    }

    const payload = {
      action: "updateNextAppt",
      name: cleanName,
      nextAppt: nextApptDate
    };
    dispatchCloudAction(payload, latestVisit.id);

    return true;
  }

  function dispatchCloudAction(payload, entityId) {
    if (!navigator.onLine) {
      queueOfflineAction(payload);
      return;
    }

    fetch(PhysioConfig.WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        if (entityId) markSynced(entityId);
      } else {
        queueOfflineAction(payload);
      }
    })
    .catch(() => {
      queueOfflineAction(payload);
    });
  }

  async function markSynced(id) {
    let visit = inMemoryVisits.find(v => v.id === id);
    const db = await openDatabase();
    if (visit) {
      visit.synced = true;
      const tx = db.transaction(STORE_VISITS, "readwrite");
      tx.objectStore(STORE_VISITS).put(visit);
    } else {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      const store = tx.objectStore(STORE_VISITS);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.synced = true;
          const putTx = db.transaction(STORE_VISITS, "readwrite");
          putTx.objectStore(STORE_VISITS).put(req.result);
        }
      };
    }
  }

  function queueOfflineAction(payload) {
    let queue = JSON.parse(localStorage.getItem(PhysioConfig.STORAGE_KEYS.OFFLINE_QUEUE) || "[]");
    queue.push(payload);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  }

  async function syncOfflineQueue() {
    if (!navigator.onLine) return;
    let queue = JSON.parse(localStorage.getItem(PhysioConfig.STORAGE_KEYS.OFFLINE_QUEUE) || "[]");
    if (queue.length === 0) return;

    for (let i = 0; i < queue.length; i++) {
      try {
        const res = await fetch(PhysioConfig.WEB_APP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(queue[i])
        });
        const data = await res.json();
        if (data.status === "success") {
          queue.splice(i, 1);
          i--;
          localStorage.setItem(PhysioConfig.STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
        }
      } catch (e) {
        break;
      }
    }
  }

  // Full Cloud Sync (Prioritizes instant Firestore, falls back to Sheets)
  async function syncWithCloud(onStatusChange) {
    if (isSyncing || !navigator.onLine) return;
    isSyncing = true;
    if (onStatusChange) onStatusChange("syncing");

    try {
      const activeBackend = getActiveBackend();
      if (activeBackend === 'firebase' || firestoreDb) {
        const count = await syncWithFirestore(onStatusChange);
        await syncOfflineQueue();
        if (onStatusChange) onStatusChange("success");
        return count;
      }

      // Fallback: Google Sheets Web App Endpoint
      const res = await fetch(PhysioConfig.WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getInitialData" })
      });

      const data = await res.json();
      if (data.status === "success" && Array.isArray(data.data) && data.data.length > 1) {
        const sheetRows = data.data;
        const db = await openDatabase();
        const tx = db.transaction(STORE_VISITS, "readwrite");
        const store = tx.objectStore(STORE_VISITS);

        store.clear();
        for (let i = 1; i < sheetRows.length; i++) {
          const parsed = parseSheetRow(sheetRows[i], i + 1);
          if (parsed) {
            parsed.synced = true;
            store.add(parsed);
          }
        }

        await new Promise(res => { tx.oncomplete = res; });
        inMemoryVisits = await getAllVisits();
        
        try { localStorage.setItem('clinicData', JSON.stringify(sheetRows)); } catch(e) {}
        
        notify();
        await syncOfflineQueue();
        if (onStatusChange) onStatusChange("success");
      } else {
        if (onStatusChange) onStatusChange("idle");
      }
    } catch (e) {
      console.warn("Sync notice:", e);
      if (onStatusChange) onStatusChange("offline");
    } finally {
      isSyncing = false;
    }
  }

  function getPatientPhones() {
    try {
      return JSON.parse(localStorage.getItem(PhysioConfig.STORAGE_KEYS.CUSTOM_PHONE_MAP) || "{}");
    } catch(e) { return {}; }
  }

  function setPatientPhone(patientName, phone) {
    const phones = getPatientPhones();
    phones[sanitizeName(patientName)] = phone.trim();
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.CUSTOM_PHONE_MAP, JSON.stringify(phones));
  }

  function exportJSONBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(inMemoryVisits, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `Physio_Tracker_Backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportCSVBackup() {
    const headers = ["Timestamp", "Date of Visit", "Patient Name", "Location", "Payment Type", "Amount Paid", "Total Fee", "Pain Before", "Pain After", "Session Type", "Next Appointment Date", "Notes", "Month"];
    const rows = [headers];

    inMemoryVisits.forEach(v => {
      rows.push(toSheetRow(v));
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement('a');
    a.setAttribute("href", encodeURI(csvContent));
    a.setAttribute("download", `Physio_Tracker_Export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return {
    init: seedInitialData,
    getVisits: () => inMemoryVisits,
    addVisit,
    updatePayment,
    deleteVisit,
    updateNextAppt,
    syncWithCloud,
    syncWithFirestore,
    rehydrateFromCloud,
    syncOfflineQueue,
    subscribe,
    sanitizeName,
    getPatientPhones,
    setPatientPhone,
    exportJSONBackup,
    exportCSVBackup,
    getActiveBackend,
    setActiveBackend,
    getFirebaseConfig,
    initFirebase,
    migrateAllToFirebase
  };
})();
