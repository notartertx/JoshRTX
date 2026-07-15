    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
    import { getFirestore, collection, addDoc, serverTimestamp, doc, setDoc, getDoc, getDocs, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
    import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

    const firebaseConfig = {
        apiKey: "AIzaSyCXgMaQahGfDoNFhiICGPIYvkutomamcP8",
        authDomain: "website-handler-16595.firebaseapp.com",
        projectId: "website-handler-16595",
        storageBucket: "website-handler-16595.firebasestorage.app",
        messagingSenderId: "684874972754",
        appId: "1:684874972754:web:7e65440679a42afa74e98b",
        measurementId: "G-B2L0TLL60P"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);

    window.db_loadCMS = async function(docId) {
        try {
            const docSnap = await getDoc(doc(db, "system_cms", docId));
            if (docSnap.exists()) return docSnap.data();
            return null;
        } catch (error) { sysLog('ERROR', `CMS Load error: ${error.message}`); return null; }
    };

    window.db_logTransmission = async function(collectionName, dataPayload) {
        if (!navigator.onLine) { sysLog('WARNING', `Network offline. Dropping log: ${collectionName}`); return { success: false, error: "No Internet Connection" }; }
        try {
            const payloadWithTime = { ...dataPayload, timestamp: serverTimestamp() };
            const docRef = await addDoc(collection(db, collectionName), payloadWithTime);
            sysLog('FIREBASE', `Transmission recorded: ${collectionName}`);
            return { success: true, id: docRef.id };
        } catch (error) { sysLog('ERROR', `Firebase Write Failed: ${error.message}`); return { success: false, error: error.message }; }
    };

    window.db_saveCMS = async function(dataPayload) {
        if (!navigator.onLine) return { success: false, error: "No Internet Connection" };
        try {
            await setDoc(doc(db, "system_cms", "main_portfolio"), dataPayload, { merge: true });
            sysLog('FIREBASE', 'System config saved to DB');
            return { success: true };
        } catch (error) { sysLog('ERROR', `Firebase Save Failed: ${error.message}`); return { success: false, error: error.message }; }
    };

    window.db_fetchData = async function(collectionName) {
        try {
            sysLog('FIREBASE', `Fetching data: ${collectionName}`);
            const snapshot = await getDocs(collection(db, collectionName));
            let results = [];
            snapshot.forEach(d => results.push({ id: d.id, ...d.data() }));
            results.sort((a, b) => {
                let timeA = a.timestamp ? a.timestamp.toMillis() : 0;
                let timeB = b.timestamp ? b.timestamp.toMillis() : 0;
                return timeB - timeA;
            });
            return results;
        } catch (error) { sysLog('ERROR', `Fetch error on ${collectionName}: ${error.message}`); return []; }
    };

    window.db_secureLogin = async function(email, password) {
        try {
            sysLog('SYSTEM', `Auth attempt: ${email}`);
            await signInWithEmailAndPassword(auth, email, password);
            sysLog('SYSTEM', `Auth success: ${email}`);
            return true;
        } catch (error) { sysLog('WARNING', `Auth failed: ${error.message}`); return false; }
    };

    window.db_uploadMediaFile = async function(file, mediaType, progressCallback) {
        return new Promise((resolve, reject) => {
            sysLog('MEDIA', `Upload Started: ${file.name}`);
            if (!navigator.onLine) { sysLog('ERROR', 'Upload Failed: No Internet Connection'); return reject("No Internet Connection"); }
            const url = "https://api.cloudinary.com/v1_1/dlpylfdxi/auto/upload";
            const fd = new FormData();
            fd.append("file", file);
            fd.append("upload_preset", "storage");
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.upload.onprogress = function(e) { if (e.lengthComputable && progressCallback) progressCallback((e.loaded / e.total) * 100); };
            xhr.onload = async function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const response = JSON.parse(xhr.responseText);
                    sysLog('MEDIA', `Upload Success: ${response.secure_url}`);
                    const meta = { type: mediaType, filename: file.name, public_id: response.public_id, secure_url: response.secure_url, url: response.secure_url, bytes: response.bytes, createdAt: response.created_at || new Date().toISOString() };
                    try { const payload = { ...meta, timestamp: serverTimestamp() }; const docRef = await addDoc(collection(db, 'system_media'), payload); meta.id = docRef.id; } catch(e) {}
                    resolve(meta);
                } else { sysLog('ERROR', `Upload Failed: ${xhr.responseText}`); reject(JSON.parse(xhr.responseText).error?.message || "Upload failed"); }
            };
            xhr.onerror = function() { sysLog('ERROR', 'Network error during upload.'); reject("Network error."); };
            xhr.send(fd);
        });
    };

    window.db_deleteMediaByUrl = async function(url) {
        if (!url) return;
        try {
            const q = query(collection(db, 'system_media'), where('secure_url', '==', url));
            const snap = await getDocs(q);
            snap.forEach(async (docSnap) => { await deleteDoc(doc(db, 'system_media', docSnap.id)); });
            const q2 = query(collection(db, 'system_media'), where('url', '==', url));
            const snap2 = await getDocs(q2);
            snap2.forEach(async (docSnap) => { await deleteDoc(doc(db, 'system_media', docSnap.id)); });
            sysLog('FIREBASE', `Removed DB reference for media: ${url}`);
        } catch(e) { sysLog('ERROR', `Auto delete metadata failed: ${e.message}`); }
    };

    window.db_deleteDocument = async function(collectionName, docId) {
        if (!navigator.onLine) return { success: false, error: "No Internet Connection" };
        try {
            await deleteDoc(doc(db, collectionName, docId));
            sysLog('FIREBASE', `Deleted: ${collectionName}/${docId}`);
            return { success: true };
        } catch (error) { sysLog('ERROR', `Delete failed: ${error.message}`); return { success: false, error: error.message }; }
    };
