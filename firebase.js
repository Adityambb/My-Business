import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes("PASTE_") &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.includes("PASTE_") &&
  firebaseConfig.appId &&
  !firebaseConfig.appId.includes("PASTE_");

let app = null;
let auth = null;
let db = null;

if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  // Keep the Firebase login persisted in this browser/device.
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("Firebase persistence setup failed:", error);
  });
}

function ledgerRef(uid) {
  return doc(db, "users", uid, "ledger", "main");
}

export function isFirebaseConfigured() {
  return Boolean(configured);
}

export function onUserChanged(callback) {
  if (!configured) return () => {};
  return onAuthStateChanged(auth, callback);
}

export async function signInGoogle() {
  if (!configured) {
    throw new Error("Firebase is not configured yet.");
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  // Popup is the reliable choice for a GitHub Pages-hosted app.
  // It avoids the cross-origin storage issue that affects redirect flows on
  // non-Firebase hosting domains.
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutGoogle() {
  if (!configured) return;
  await signOut(auth);
}

export async function loadCloudState(uid) {
  if (!configured) return null;

  const snap = await getDoc(ledgerRef(uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  return data.state || null;
}

export async function saveCloudState(uid, state) {
  if (!configured) return;

  await setDoc(
    ledgerRef(uid),
    {
      state,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}
