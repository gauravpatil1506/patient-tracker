/**
 * Dr. Anjali Vishwakarma - Physiotherapy & Rehabilitation Clinic
 * Clinic Security & 4-Digit Quick PIN Authentication Engine
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

  async function fetchPinFromCloud() {
    try {
      if (navigator.onLine && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        const db = firebase.firestore();
        const docSnap = await db.collection("clinic_meta").doc("security").get();
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data && data.pin) {
            localStorage.setItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN, data.pin.toString());
            return data.pin.toString();
          }
        }
      }
    } catch (e) {
      console.warn("Cloud security PIN fetch notice:", e);
    }
    return null;
  }

  async function savePinToCloud(pin) {
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        const db = firebase.firestore();
        await db.collection("clinic_meta").doc("security").set({
          pin: pin.toString(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          clinicName: PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma"
        }, { merge: true });
      }
    } catch (e) {
      console.warn("Could not sync PIN to Firestore:", e);
    }
  }

  async function isPinConfigured() {
    const localPin = localStorage.getItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN);
    if (localPin) return true;
    const cloudPin = await fetchPinFromCloud();
    return !!cloudPin;
  }

  async function setupPin(pin) {
    const cleanPin = (pin || "").toString().trim();
    if (!cleanPin || cleanPin.length !== 4 || !/^\d{4}$/.test(cleanPin)) {
      throw new Error("PIN must be exactly 4 numeric digits.");
    }
    localStorage.setItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN, cleanPin);
    savePinToCloud(cleanPin).catch(() => {});
    return setSession("anjali", PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma", "Doctor");
  }

  async function login(pin) {
    const cleanPin = (pin || "").toString().trim();
    if (!cleanPin || cleanPin.length !== 4) {
      throw new Error("PIN must be exactly 4 digits.");
    }

    let configuredPin = localStorage.getItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN);
    if (!configuredPin) {
      configuredPin = await fetchPinFromCloud();
    }

    if (!configuredPin) {
      // First-time baseline setup
      return setupPin(cleanPin);
    }

    if (cleanPin === configuredPin) {
      return setSession("anjali", PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma", "Doctor");
    } else {
      // If mismatch, try fetching freshest cloud PIN once in case set on another device
      if (navigator.onLine) {
        const freshCloudPin = await fetchPinFromCloud();
        if (freshCloudPin && cleanPin === freshCloudPin) {
          return setSession("anjali", PhysioConfig.CLINIC_NAME || "Dr. Anjali Vishwakarma", "Doctor");
        }
      }
      throw new Error("Incorrect PIN. Please try again.");
    }
  }

  async function changePin(oldPin, newPin) {
    const cleanOld = (oldPin || "").toString().trim();
    const cleanNew = (newPin || "").toString().trim();

    let currentPin = localStorage.getItem(PhysioConfig.STORAGE_KEYS.SECURE_PIN);
    if (!currentPin) {
      currentPin = await fetchPinFromCloud();
    }

    if (currentPin && cleanOld !== currentPin) {
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
    isPinConfigured,
    setupPin,
    login,
    changePin,
    logout,
    getSession
  };
})();
