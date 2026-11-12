/**
 * Dr. Anjali Vishwakarma - Physiotherapy & Rehabilitation Clinic
 * Clinic Security & Single-PIN Authentication Engine
 */

window.PhysioAuth = (function() {
  let currentUser = null;
  let currentName = null;
  let currentRole = "Doctor";

  function init() {
    return checkSession();
  }

  function checkSession() {
    const savedUser = localStorage.getItem(PhysioConfig.STORAGE_KEYS.CURRENT_USER);
    const savedName = localStorage.getItem(PhysioConfig.STORAGE_KEYS.CURRENT_NAME);
    const savedRole = localStorage.getItem(PhysioConfig.STORAGE_KEYS.CURRENT_ROLE);

    // Personal device session: stays active until explicitly signed out
    if (savedUser) {
      currentUser = savedUser;
      currentName = savedName || "Dr. Anjali Vishwakarma";
      currentRole = savedRole || "Doctor";
      return { username: currentUser, name: currentName, role: currentRole };
    }
    return null;
  }

  function ensureFirebase() {
    if (typeof firebase !== 'undefined' && PhysioConfig.FIREBASE_CONFIG && PhysioConfig.FIREBASE_CONFIG.projectId) {
      try {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(PhysioConfig.FIREBASE_CONFIG);
        }
        return firebase.apps.length > 0;
      } catch (e) {
        console.warn("Firebase app init check:", e);
      }
    }
    return false;
  }

  /**
   * Fetch authorized PIN with 3-tier fallback:
   * 1. Firestore SDK
   * 2. Firestore REST API (fast, works before SDK loads)
   * 3. LocalStorage / PhysioConfig.DEFAULT_PIN ("2506")
   */
  async function fetchAuthorizedPin() {
    // 1. If online, try Firestore SDK
    if (navigator.onLine) {
      try {
        if (ensureFirebase()) {
          const db = firebase.firestore();
          const docSnap = await db.collection("clinic_meta").doc("security").get();
          if (docSnap.exists) {
            const data = docSnap.data();
            if (data && data.pin) {
              const cloudPin = data.pin.toString().trim();
              localStorage.setItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN, cloudPin);
              return cloudPin;
            }
          }
        }
      } catch (e) {
        console.warn("Firestore SDK PIN check notice:", e);
      }

      // 2. Direct REST API fallback
      try {
        const projectId = PhysioConfig.FIREBASE_CONFIG.projectId;
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/clinic_meta/security`, {
          cache: 'no-store'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.fields && data.fields.pin && data.fields.pin.stringValue) {
            const cloudPin = data.fields.pin.stringValue.trim();
            localStorage.setItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN, cloudPin);
            return cloudPin;
          }
        }
      } catch (e) {
        console.warn("Firestore REST PIN check notice:", e);
      }
    }

    // 3. Cached local PIN or Config baseline
    const localPin = localStorage.getItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN);
    if (localPin) return localPin.trim();

    return PhysioConfig.DEFAULT_PIN || "2506";
  }

  async function savePinToCloud(pin) {
    const cleanPin = pin.toString().trim();
    let synced = false;

    // 1. Try Firestore SDK
    try {
      if (ensureFirebase()) {
        const db = firebase.firestore();
        await db.collection("clinic_meta").doc("security").set({
          pin: cleanPin,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          clinicName: PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma"
        }, { merge: true });
        synced = true;
      }
    } catch (e) {
      console.warn("Firestore SDK PIN save notice:", e);
    }

    // 2. Try REST API patch if SDK wasn't available
    if (!synced) {
      try {
        const projectId = PhysioConfig.FIREBASE_CONFIG.projectId;
        await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/clinic_meta/security?updateMask.fieldPaths=pin`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              pin: { stringValue: cleanPin }
            }
          })
        });
      } catch (e) {
        console.warn("REST PIN patch notice:", e);
      }
    }
  }

  async function login(pin) {
    const cleanPin = (pin || "").toString().trim();
    if (!cleanPin || cleanPin.length !== 4) {
      throw new Error("PIN must be exactly 4 digits.");
    }

    const authorizedPin = await fetchAuthorizedPin();

    if (cleanPin === authorizedPin) {
      return setSession("anjali", PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma", "Doctor");
    } else {
      throw new Error("Incorrect PIN. Access denied.");
    }
  }

  async function changePin(oldPin, newPin) {
    const cleanOld = (oldPin || "").toString().trim();
    const cleanNew = (newPin || "").toString().trim();

    const currentPin = await fetchAuthorizedPin();

    if (cleanOld !== currentPin) {
      throw new Error("Current PIN is incorrect.");
    }

    if (!cleanNew || cleanNew.length !== 4 || !/^\d{4}$/.test(cleanNew)) {
      throw new Error("New PIN must be exactly 4 numeric digits.");
    }

    localStorage.setItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN, cleanNew);
    await savePinToCloud(cleanNew);
    return true;
  }

  function setSession(username, name, role) {
    currentUser = username;
    currentName = name;
    currentRole = role;

    localStorage.setItem(PhysioConfig.STORAGE_KEYS.CURRENT_USER, username);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.CURRENT_NAME, name);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.CURRENT_ROLE, role);
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.LOGIN_TIME, Date.now().toString());

    return { username, name, role };
  }

  function logout() {
    currentUser = null;
    currentName = null;
    currentRole = "Doctor";

    localStorage.removeItem(PhysioConfig.STORAGE_KEYS.CURRENT_USER);
    localStorage.removeItem(PhysioConfig.STORAGE_KEYS.CURRENT_NAME);
    localStorage.removeItem(PhysioConfig.STORAGE_KEYS.CURRENT_ROLE);
    localStorage.removeItem(PhysioConfig.STORAGE_KEYS.LOGIN_TIME);

    window.location.reload();
  }

  function getSession() {
    return {
      username: currentUser,
      name: currentName || "Dr. Anjali Vishwakarma",
      role: currentRole || "Doctor"
    };
  }

  return {
    init,
    checkSession,
    fetchAuthorizedPin,
    login,
    changePin,
    logout,
    getSession
  };
})();
