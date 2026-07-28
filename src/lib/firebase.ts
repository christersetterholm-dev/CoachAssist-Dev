export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: any[];
}

export const getApiUrl = (path: string): string => {
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }

  // Allow overriding via environment variable
  const apiBase = (import.meta as any).env?.VITE_API_URL || '';
  if (apiBase) {
    const cleanBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  const pathname = window.location.pathname;
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  
  // Dynamically detect if we are hosted under a subfolder
  // If pathname is not "/" and has segments, the first segment can be our subfolder
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && segments[0] !== 'api' && segments[0] !== 'uploads') {
    return '/' + segments[0] + cleanPath;
  }
  
  return cleanPath;
};

export const auth: any = {
  currentUser: null as User | null
};

export const db: any = {};
export const storage: any = {};
export const googleProvider: any = {};

export class GoogleAuthProvider {}

export const initializeApp = () => ({});
export const getAuth = () => auth;
export const initializeFirestore = () => db;
export const getStorage = () => storage;
export const signInWithPopup = () => {};

// Manage Auth State Change Listeners
const listeners: ((user: User | null) => void)[] = [];

export const onAuthStateChanged = (_authObj: any, callback: (user: User | null) => void) => {
  listeners.push(callback);
  // Trigger callback immediately with current state
  callback(auth.currentUser);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
};

export const signOut = async (_authObj: any) => {
  localStorage.removeItem('token');
  auth.currentUser = null;
  listeners.forEach(cb => cb(null));
};

// Programmatic Modal Sign-In with Email and Password
export const signInWithGoogle = async (_forceSelect = false): Promise<User> => {
  return new Promise<User>((resolve, reject) => {
    if (document.getElementById('custom-auth-modal')) {
      return;
    }

    const isDark = document.documentElement.classList.contains('dark');

    const modal = document.createElement('div');
    modal.id = 'custom-auth-modal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-300';

    modal.innerHTML = `
      <div class="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-8 transform transition-all scale-95 opacity-0 duration-300 flex flex-col gap-6 font-sans">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-indigo-50 dark:bg-zinc-800 rounded-xl text-indigo-600 dark:text-indigo-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <h2 class="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-wide">CoachAssist</h2>
          </div>
          <button id="auth-close-btn" class="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="flex flex-col gap-1">
          <h3 id="auth-title" class="text-lg font-bold text-zinc-850 dark:text-zinc-100">Logga in till ditt konto</h3>
          <p id="auth-subtitle" class="text-xs text-zinc-500 dark:text-zinc-400">Ange din e-postadress och lösenord för att hantera din trupp.</p>
        </div>

        <form id="auth-form" class="space-y-4">
          <div id="auth-email-container">
            <label class="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5" for="auth-email">E-postadress</label>
            <input type="email" id="auth-email" required class="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors" placeholder="coach@lag.se" />
          </div>

          <div id="auth-code-container" class="hidden">
            <label class="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5" for="auth-code">6-siffrig verifieringskod</label>
            <input type="text" id="auth-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-center text-xl font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors" placeholder="123456" autocomplete="one-time-code" />
          </div>

          <div id="auth-password-container">
            <div class="flex items-center justify-between mb-1.5">
              <label id="auth-password-label" class="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider" for="auth-password">Lösenord</label>
              <button type="button" id="auth-forgot-btn" class="text-xs text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 underline font-medium transition-colors">Glömt lösenord?</button>
            </div>
            <input type="password" id="auth-password" required class="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors" placeholder="••••••••" minlength="6" />
          </div>

          <div id="auth-info" class="hidden text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-3.5 py-2.5 rounded-xl"></div>
          <div id="auth-error" class="hidden text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 px-3.5 py-2.5 rounded-xl"></div>

          <button type="submit" id="auth-submit-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-colors shadow-lg shadow-indigo-100 dark:shadow-none flex items-center justify-center gap-2">
            <span>Logga in</span>
          </button>
        </form>

        <div class="flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span id="auth-switch-text">Har du inget konto?</span>
          <button id="auth-switch-btn" class="font-bold text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 underline transition-colors">Skapa konto</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    if (isDark) {
      modal.classList.add('dark');
    }

    setTimeout(() => {
      const card = modal.querySelector('div') as HTMLElement;
      if (card) {
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
      }
    }, 10);

    let authMode: 'login' | 'register' | 'request-reset' | 'verify-reset' = 'login';

    const closeBtn = modal.querySelector('#auth-close-btn') as HTMLButtonElement;
    const switchBtn = modal.querySelector('#auth-switch-btn') as HTMLButtonElement;
    const forgotBtn = modal.querySelector('#auth-forgot-btn') as HTMLButtonElement;
    const form = modal.querySelector('#auth-form') as HTMLFormElement;
    const errorDiv = modal.querySelector('#auth-error') as HTMLDivElement;
    const infoDiv = modal.querySelector('#auth-info') as HTMLDivElement;
    const submitBtn = modal.querySelector('#auth-submit-btn') as HTMLButtonElement;
    const title = modal.querySelector('#auth-title') as HTMLElement;
    const subtitle = modal.querySelector('#auth-subtitle') as HTMLElement;
    const switchText = modal.querySelector('#auth-switch-text') as HTMLElement;
    const passwordLabel = modal.querySelector('#auth-password-label') as HTMLElement;
    const emailInput = modal.querySelector('#auth-email') as HTMLInputElement;
    const codeInput = modal.querySelector('#auth-code') as HTMLInputElement;
    const passwordInput = modal.querySelector('#auth-password') as HTMLInputElement;

    const emailContainer = modal.querySelector('#auth-email-container') as HTMLElement;
    const codeContainer = modal.querySelector('#auth-code-container') as HTMLElement;
    const passwordContainer = modal.querySelector('#auth-password-container') as HTMLElement;

    const cleanUpModal = () => {
      const card = modal.querySelector('div') as HTMLElement;
      if (card) {
        card.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }, 300);
    };

    closeBtn.onclick = () => {
      cleanUpModal();
      reject(new Error('Inloggningen avbröts av användaren'));
    };

    const updateAuthUI = () => {
      errorDiv.classList.add('hidden');
      infoDiv.classList.add('hidden');

      if (authMode === 'register') {
        title.innerText = 'Skapa nytt konto';
        subtitle.innerText = 'Skapa ett konto för att säkert spara din spelartrupp och träningspass.';
        passwordLabel.innerText = 'Lösenord';
        emailContainer.classList.remove('hidden');
        codeContainer.classList.add('hidden');
        passwordContainer.classList.remove('hidden');
        forgotBtn.classList.add('hidden');
        passwordInput.required = true;
        codeInput.required = false;
        submitBtn.querySelector('span')!.innerText = 'Skapa konto';
        switchText.innerText = 'Har du redan ett konto?';
        switchBtn.innerText = 'Logga in';
      } else if (authMode === 'request-reset') {
        title.innerText = 'Återställ lösenord';
        subtitle.innerText = 'Ange din e-postadress för att få en 6-siffrig verifieringskod.';
        emailContainer.classList.remove('hidden');
        codeContainer.classList.add('hidden');
        passwordContainer.classList.add('hidden');
        forgotBtn.classList.add('hidden');
        passwordInput.required = false;
        codeInput.required = false;
        submitBtn.querySelector('span')!.innerText = 'Skicka verifieringskod';
        switchText.innerText = 'Kom du ihåg ditt lösenord?';
        switchBtn.innerText = 'Logga in';
      } else if (authMode === 'verify-reset') {
        title.innerText = 'Mata in verifieringskod';
        subtitle.innerText = 'Ange den 6-siffriga koden vi skickat samt ditt nya lösenord.';
        passwordLabel.innerText = 'Nytt lösenord';
        emailContainer.classList.remove('hidden');
        codeContainer.classList.remove('hidden');
        passwordContainer.classList.remove('hidden');
        forgotBtn.classList.add('hidden');
        passwordInput.required = true;
        codeInput.required = true;
        submitBtn.querySelector('span')!.innerText = 'Återställ & logga in';
        switchText.innerText = 'Vill du börja om?';
        switchBtn.innerText = 'Tillbaka till inloggning';
      } else {
        title.innerText = 'Logga in till ditt konto';
        subtitle.innerText = 'Ange din e-postadress och lösenord för att hantera din trupp.';
        passwordLabel.innerText = 'Lösenord';
        emailContainer.classList.remove('hidden');
        codeContainer.classList.add('hidden');
        passwordContainer.classList.remove('hidden');
        forgotBtn.classList.remove('hidden');
        passwordInput.required = true;
        codeInput.required = false;
        submitBtn.querySelector('span')!.innerText = 'Logga in';
        switchText.innerText = 'Har du inget konto?';
        switchBtn.innerText = 'Skapa konto';
      }
    };

    forgotBtn.onclick = (e) => {
      e.preventDefault();
      authMode = 'request-reset';
      updateAuthUI();
    };

    switchBtn.onclick = (e) => {
      e.preventDefault();
      if (authMode === 'login') {
        authMode = 'register';
      } else {
        authMode = 'login';
      }
      updateAuthUI();
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const code = codeInput.value.trim();

      errorDiv.classList.add('hidden');
      infoDiv.classList.add('hidden');
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-70');

      try {
        if (authMode === 'request-reset') {
          const url = getApiUrl('/api/auth/request-reset');
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const resData = await response.json();
          if (!response.ok) {
            throw new Error(resData.error || 'Begäran om återställning misslyckades.');
          }

          infoDiv.innerText = resData.message || 'Verifieringskod har skickats till din e-postadress.';
          infoDiv.classList.remove('hidden');
          authMode = 'verify-reset';
          updateAuthUI();
          // Keep info message visible after updateAuthUI
          infoDiv.classList.remove('hidden');
          return;
        }

        let endpoint = '/api/auth/login';
        let bodyPayload: any = { email, password };

        if (authMode === 'register') {
          endpoint = '/api/auth/register';
          bodyPayload = { email, password };
        } else if (authMode === 'verify-reset') {
          endpoint = '/api/auth/reset-password';
          bodyPayload = { email, code, newPassword: password };
        }

        const url = getApiUrl(endpoint);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        const resData = await response.json();

        if (!response.ok) {
          throw new Error(resData.error || 'Åtgärden misslyckades');
        }

        localStorage.setItem('token', resData.token);
        auth.currentUser = resData.user;
        listeners.forEach(cb => cb(resData.user));

        cleanUpModal();
        resolve(resData.user);
      } catch (err: any) {
        errorDiv.innerText = err.message || 'Ett fel uppstod';
        errorDiv.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-70');
      }
    };
  });
};

// On module load, restore login session from JWT if exists
const initializeSession = async () => {
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const res = await fetch(getApiUrl('/api/auth/me'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const user = await res.json();
        auth.currentUser = user;
        listeners.forEach(cb => cb(user));
      } else {
        localStorage.removeItem('token');
        listeners.forEach(cb => cb(null));
      }
    } catch (e) {
      console.error('Failed to restore session on startup:', e);
      listeners.forEach(cb => cb(null));
    }
  } else {
    // Notify loaded with no user
    setTimeout(() => listeners.forEach(cb => cb(null)), 50);
  }
};
initializeSession();

// Firestore Client-Side Emulation
export const doc = (_dbObj: any, ...parts: string[]) => {
  return { path: parts.join('/') };
};

export const getDoc = async (docRef: { path: string }) => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(getApiUrl(`/api/docs?path=${encodeURIComponent(docRef.path)}`), {
      headers
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        return { exists: () => false, data: () => null };
      }
      return { exists: () => false, data: () => null };
    }

    const data = await res.json();
    return {
      exists: () => true,
      data: () => data
    };
  } catch (err) {
    console.warn(`[getDoc] Could not load doc ${docRef.path}:`, err);
    return { exists: () => false, data: () => null };
  }
};

export const setDoc = async (docRef: { path: string }, data: any, _options?: { merge?: boolean }) => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(getApiUrl(`/api/docs?path=${encodeURIComponent(docRef.path)}`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ data })
  });

  if (!res.ok) {
    throw new Error('Failed to save doc');
  }
};

// Simulated Firestore Live Polling Listener (onSnapshot)
export const onSnapshot = (docRef: { path: string }, callback: (snapshot: any) => void, _errorCallback?: (error: any) => void) => {
  let isStopped = false;
  
  const poll = async () => {
    if (isStopped) return;
    try {
      const snap = await getDoc(docRef);
      if (!isStopped) {
        callback({
          exists: () => snap.exists(),
          data: () => snap.data(),
          metadata: { hasPendingWrites: false }
        });
      }
    } catch (e) {
      console.error("Error polling snapshot for " + docRef.path, e);
      if (_errorCallback) {
        _errorCallback(e);
      }
    }
  };
  
  poll();
  const interval = setInterval(poll, 15000);
  
  return () => {
    isStopped = true;
    clearInterval(interval);
  };
};

// Storage Client-Side Emulation
export const ref = (_storageObj: any, path: string) => {
  return { path };
};

export const uploadBytes = async (storageRef: { path: string }, blob: Blob) => {
  const token = localStorage.getItem('token');
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('path', storageRef.path);

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(getApiUrl('/api/upload'), {
    method: 'POST',
    headers,
    body: formData
  });

  if (!res.ok) {
    throw new Error('Failed to upload file');
  }

  const data = await res.json();
  return {
    ref: {
      path: storageRef.path,
      url: data.url
    }
  };
};

export const uploadBytesResumable = (storageRef: { path: string }, blob: Blob) => {
  const task = {
    snapshot: {
      ref: storageRef as any,
      bytesTransferred: 100,
      totalBytes: 100
    },
    on: (_event: string, next: (snap: any) => void, error: (err: any) => void, complete: () => void) => {
      uploadBytes(storageRef, blob)
        .then((result) => {
          task.snapshot.ref = result.ref as any;
          next({ bytesTransferred: 100, totalBytes: 100 });
          complete();
        })
        .catch((err) => {
          error(err);
        });
    },
    then: (onfulfilled: any) => {
      return uploadBytes(storageRef, blob).then(onfulfilled);
    }
  };
  return task;
};

export const getDownloadURL = async (refObj: any) => {
  if (refObj && refObj.url) {
    return refObj.url.startsWith('http') ? refObj.url : getApiUrl(refObj.url);
  }
  return getApiUrl(`/uploads/${refObj.path}`);
};

export const deleteObject = async (refObj: any) => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    await fetch(getApiUrl(`/api/delete-file?path=${encodeURIComponent(refObj.path)}`), {
      method: 'DELETE',
      headers
    });
  } catch (e) {
    console.error("Error deleting file:", e);
  }
};

// Existing Error Utilities (kept for full compatibility with original setup)
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Error logged: ', JSON.stringify(errInfo));
}
