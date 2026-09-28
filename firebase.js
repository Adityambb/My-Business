import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  linkWithCredential,
  onAuthStateChanged,
  inMemoryPersistence,
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
let persistenceReady = Promise.resolve();

if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  // Keep authentication only in memory. A full page reload clears the
  // session, so the private ledger asks for credentials again.
  persistenceReady = setPersistence(auth, inMemoryPersistence).catch((error) => {
    console.error("Firebase persistence setup failed:", error);
    throw error;
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

  await persistenceReady;

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signInEmailPassword(email, password) {
  if (!configured) {
    throw new Error("Firebase is not configured yet.");
  }

  await persistenceReady;

  const result = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  return result.user;
}

export async function resetEmailPassword(email) {
  if (!configured) {
    throw new Error("Firebase is not configured yet.");
  }

  await sendPasswordResetEmail(auth, email.trim());
}

export async function linkCurrentUserWithPassword(email, password) {
  if (!configured || !auth?.currentUser) {
    throw new Error("No signed-in user is available for password setup.");
  }

  const credential = EmailAuthProvider.credential(email.trim(), password);
  const result = await linkWithCredential(auth.currentUser, credential);
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
