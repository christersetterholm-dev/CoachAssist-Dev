import React, { useState, useEffect, useRef } from 'react';
import { User, Phone, Fingerprint, Check, Save, AtSign, Lock, Key, Eye, EyeOff, ShieldCheck, AlertCircle, Landmark, Info, Link2, Unlink, Camera, Upload, Trash2, Loader2 } from 'lucide-react';
import { UserProfile, Club, ClubMetadata, ClubMember } from '../types';
import { db, getApiUrl, auth, linkGoogleAccount, unlinkGoogleAccount, storage, ref, uploadBytes, getDownloadURL } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import ImageCropper from './ImageCropper';

interface ProfileAndSettingsProps {
  userId: string;
  userEmail: string;
  onProfileUpdated: (profile: UserProfile) => void;
  currentProfile: UserProfile;
  isRootAdmin?: boolean;
}

export default function ProfileAndSettings({
  userId,
  userEmail,
  onProfileUpdated,
  currentProfile,
  isRootAdmin = false,
}: ProfileAndSettingsProps) {
  const [profile, setProfile] = useState<UserProfile>({
    fullName: currentProfile.fullName || '',
    phone: currentProfile.phone || '',
    personnummer: currentProfile.personnummer || '',
    email: currentProfile.email || userEmail || '',
    photoUrl: currentProfile.photoUrl || auth.currentUser?.photoURL || '',
    activeClubId: currentProfile.activeClubId || null,
    activeTeamId: currentProfile.activeTeamId || null,
  });

  const [photoUrl, setPhotoUrl] = useState<string>(currentProfile.photoUrl || auth.currentUser?.photoURL || '');
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [emailInput, setEmailInput] = useState<string>(currentProfile.email || userEmail || '');
  const [usernameInput, setUsernameInput] = useState<string>(currentProfile.username || (auth.currentUser?.username || ''));
  const [memberships, setMemberships] = useState<{ club: Club; roles: string[]; teams: string[]; availableTeams: { id: string; name: string }[] }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [emailUpdateError, setEmailUpdateError] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string>('');

  // Google Account Linking State
  const [googleLinked, setGoogleLinked] = useState<boolean>(auth.currentUser?.googleLinked ?? false);
  const [googleEmail, setGoogleEmail] = useState<string>(auth.currentUser?.googleEmail || '');
  const [hasPassword, setHasPassword] = useState<boolean>(auth.currentUser?.hasPassword ?? true);
  const [googleLinkStatus, setGoogleLinkStatus] = useState<'idle' | 'linking' | 'unlinking' | 'success' | 'error'>('idle');
  const [googleLinkMsg, setGoogleLinkMsg] = useState<string>('');

  // Sync state when props change
  useEffect(() => {
    const fetchedUsername = currentProfile.username || auth.currentUser?.username || '';
    const initialPhoto = currentProfile.photoUrl || auth.currentUser?.photoURL || '';
    setProfile({
      fullName: currentProfile.fullName || '',
      phone: currentProfile.phone || '',
      personnummer: currentProfile.personnummer || '',
      email: currentProfile.email || userEmail || '',
      username: fetchedUsername,
      photoUrl: initialPhoto,
      activeClubId: currentProfile.activeClubId || null,
      activeTeamId: currentProfile.activeTeamId || null,
    });
    setPhotoUrl(initialPhoto);
    setEmailInput(currentProfile.email || userEmail || '');
    setUsernameInput(fetchedUsername);

    const token = localStorage.getItem('token');
    if (token) {
      fetch(getApiUrl('/api/auth/me'), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            if (data.username) {
              if (auth.currentUser) auth.currentUser.username = data.username;
              setUsernameInput(data.username);
              setProfile(prev => ({ ...prev, username: data.username }));
            }
            if (typeof data.googleLinked === 'boolean') {
              setGoogleLinked(data.googleLinked);
            }
            if (data.googleEmail) {
              setGoogleEmail(data.googleEmail);
            }
            if (typeof data.hasPassword === 'boolean') {
              setHasPassword(data.hasPassword);
            }
          }
        })
        .catch(() => {});
    }
  }, [currentProfile, userEmail]);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [passwordMsg, setPasswordMsg] = useState('');

  // Load all clubs and memberships on mount
  useEffect(() => {
    async function loadClubData() {
      setIsLoading(true);
      try {
        // 1. Fetch all clubs master list
        const clubsSnap = await getDoc(doc(db, 'shared_leaderboards', 'all_clubs'));
        const clubList: Club[] = clubsSnap.exists() ? (clubsSnap.data().clubs || []) : [];

        // 2. For each club, fetch members and check if current user is added
        const userMemberships: typeof memberships = [];

        for (const club of clubList) {
          try {
            const membersSnap = await getDoc(doc(db, 'clubs', club.id, 'teams', 'club_global', 'data', 'members'));
            const metadataSnap = await getDoc(doc(db, 'clubs', club.id, 'teams', 'club_global', 'data', 'metadata'));
            
            const members: ClubMember[] = membersSnap.exists() ? (membersSnap.data().members || []) : [];
            const metadata: ClubMetadata | null = metadataSnap.exists() ? metadataSnap.data() as ClubMetadata : null;

            const myMemberRecord = members.find(m => m.userId === userId || m.email.trim().toLowerCase() === userEmail.trim().toLowerCase());

            if (myMemberRecord) {
              // If current photoUrl is empty and member has a photo, sync it
              if (myMemberRecord.photoUrl && !currentProfile.photoUrl && !auth.currentUser?.photoURL) {
                setPhotoUrl(myMemberRecord.photoUrl);
                setProfile(prev => ({ ...prev, photoUrl: myMemberRecord.photoUrl }));
              }
              userMemberships.push({
                club,
                roles: myMemberRecord.roles || [],
                teams: myMemberRecord.teams || [],
                availableTeams: metadata?.teams || []
              });
            } else if (isRootAdmin || club.id === currentProfile.activeClubId) {
              // Root admin can see all clubs in system; active club is also always kept accessible
              userMemberships.push({
                club,
                roles: isRootAdmin ? ['root_admin', 'admin'] : (myMemberRecord?.roles || ['player']),
                teams: (metadata?.teams || []).map(t => t.id),
                availableTeams: metadata?.teams || []
              });
            }
          } catch (err) {
            console.error(`Failed to load details for club ${club.name}:`, err);
          }
        }

        setMemberships(userMemberships);
      } catch (err) {
        console.error('Error loading club list:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadClubData();
  }, [userId, userEmail, isRootAdmin, currentProfile.activeClubId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImageToCrop(reader.result?.toString() || null);
      });
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const onCropComplete = async (croppedBlob: Blob) => {
    setImageToCrop(null);
    setIsUploadingPhoto(true);
    let finalPhotoUrl = '';

    try {
      // 1. Try server upload
      const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
      const formData = new FormData();
      formData.append('file', croppedBlob, `avatar_${userId}_${Date.now()}.${extension}`);

      const res = await fetch(getApiUrl('/api/upload'), {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          finalPhotoUrl = data.url;
        }
      }
    } catch (serverErr) {
      console.warn('Server avatar upload fallback:', serverErr);
    }

    if (!finalPhotoUrl) {
      // 2. Try Storage
      try {
        const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
        const fileName = `avatar_${Date.now()}.${extension}`;
        const avatarPath = `avatars/${userId}/${fileName}`;
        const storageRef = ref(storage, avatarPath);

        const uploadResult = await uploadBytes(storageRef, croppedBlob);
        finalPhotoUrl = await getDownloadURL(uploadResult.ref);
      } catch (err) {
        console.error('Storage avatar upload fallback to data URL:', err);
        // 3. Fallback to Data URL
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              finalPhotoUrl = reader.result;
            }
            resolve();
          };
          reader.readAsDataURL(croppedBlob);
        });
      }
    }

    if (finalPhotoUrl) {
      setPhotoUrl(finalPhotoUrl);
      const updatedProfile: UserProfile = {
        ...profile,
        photoUrl: finalPhotoUrl,
      };
      setProfile(updatedProfile);

      // Save to Firestore user profile
      setDoc(doc(db, 'users', userId, 'data', 'profile'), { photoUrl: finalPhotoUrl }, { merge: true }).catch(() => {});

      // Update in server auth / sqlite
      const token = localStorage.getItem('token');
      if (token) {
        fetch(getApiUrl('/api/auth/update-avatar'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ photoUrl: finalPhotoUrl })
        }).catch(() => {});
      }

      // Sync with active club members registry
      if (profile.activeClubId) {
        getDoc(doc(db, 'clubs', profile.activeClubId, 'teams', 'club_global', 'data', 'members')).then(membersSnap => {
          if (membersSnap.exists()) {
            const members: ClubMember[] = membersSnap.data().members || [];
            const index = members.findIndex(m => m.userId === userId || m.email.trim().toLowerCase() === userEmail.trim().toLowerCase());
            if (index !== -1) {
              members[index] = {
                ...members[index],
                photoUrl: finalPhotoUrl
              };
              setDoc(doc(db, 'clubs', profile.activeClubId!, 'teams', 'club_global', 'data', 'members'), { members }).catch(() => {});
            }
          }
        }).catch(() => {});
      }

      if (auth.currentUser) {
        auth.currentUser.photoURL = finalPhotoUrl;
      }
      onProfileUpdated(updatedProfile);
    }
    setIsUploadingPhoto(false);
  };

  const handleRemovePhoto = async () => {
    setPhotoUrl('');
    const updatedProfile: UserProfile = {
      ...profile,
      photoUrl: undefined,
    };
    setProfile(updatedProfile);

    // Save to Firestore user profile
    setDoc(doc(db, 'users', userId, 'data', 'profile'), { photoUrl: null }, { merge: true }).catch(() => {});

    // Update in server auth / sqlite
    const token = localStorage.getItem('token');
    if (token) {
      fetch(getApiUrl('/api/auth/update-avatar'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ photoUrl: null })
      }).catch(() => {});
    }

    // Sync with active club members registry
    if (profile.activeClubId) {
      getDoc(doc(db, 'clubs', profile.activeClubId, 'teams', 'club_global', 'data', 'members')).then(membersSnap => {
        if (membersSnap.exists()) {
          const members: ClubMember[] = membersSnap.data().members || [];
          const index = members.findIndex(m => m.userId === userId || m.email.trim().toLowerCase() === userEmail.trim().toLowerCase());
          if (index !== -1) {
            members[index] = {
              ...members[index],
              photoUrl: undefined
            };
            setDoc(doc(db, 'clubs', profile.activeClubId!, 'teams', 'club_global', 'data', 'members'), { members }).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    if (auth.currentUser) {
      auth.currentUser.photoURL = null;
    }
    onProfileUpdated(updatedProfile);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    setEmailUpdateError('');
    setUsernameError('');

    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanUsername = usernameInput.trim().toLowerCase();
    const currentUsername = profile.username || (auth.currentUser?.username || '');

    try {
      const token = localStorage.getItem('token');

      // 1. If username has changed, update username in auth backend
      if (cleanUsername && cleanUsername !== currentUsername.trim().toLowerCase()) {
        if (token) {
          const res = await fetch(getApiUrl('/api/auth/update-username'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ newUsername: cleanUsername })
          });

          const data = await res.json();
          if (!res.ok) {
            setUsernameError(data.error || 'Kunde inte uppdatera användarnamnet.');
            setSaveStatus('error');
            return;
          }

          if (data.token) {
            localStorage.setItem('token', data.token);
          }
          if (auth.currentUser) {
            auth.currentUser.username = cleanUsername;
          }
        }
      }

      // 2. If email has changed, update email in auth backend
      if (cleanEmail && cleanEmail !== userEmail.trim().toLowerCase()) {
        if (token) {
          const res = await fetch(getApiUrl('/api/auth/update-email'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ newEmail: cleanEmail })
          });

          const data = await res.json();
          if (!res.ok) {
            setEmailUpdateError(data.error || 'Kunde inte uppdatera e-postadressen.');
            setSaveStatus('error');
            return;
          }

          if (data.token) {
            localStorage.setItem('token', data.token);
          }
        }
      }

      const updatedProfile: UserProfile = {
        ...profile,
        email: cleanEmail,
        username: cleanUsername,
        photoUrl: photoUrl.trim() ? photoUrl.trim() : undefined,
        updatedAt: Date.now(),
      } as any;

      // Save profile doc
      await setDoc(doc(db, 'users', userId, 'data', 'profile'), updatedProfile);

      // Save to server avatar endpoint
      if (token) {
        fetch(getApiUrl('/api/auth/update-avatar'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ photoUrl: photoUrl.trim() || null })
        }).catch(() => {});
      }

      // Update club global members registry to keep details sync'ed
      if (profile.activeClubId) {
        try {
          const membersSnap = await getDoc(doc(db, 'clubs', profile.activeClubId, 'teams', 'club_global', 'data', 'members'));
          if (membersSnap.exists()) {
            const members: ClubMember[] = membersSnap.data().members || [];
            const index = members.findIndex(m => m.userId === userId || m.email.trim().toLowerCase() === userEmail.trim().toLowerCase());
            if (index !== -1) {
              members[index] = {
                ...members[index],
                userId,
                email: cleanEmail,
                fullName: profile.fullName,
                phone: profile.phone,
                personnummer: profile.personnummer,
                photoUrl: photoUrl.trim() ? photoUrl.trim() : undefined
              };
              await setDoc(doc(db, 'clubs', profile.activeClubId, 'teams', 'club_global', 'data', 'members'), { members });
            }
          }
        } catch (e) {
          console.error("Failed to sync personal info into club membership registry:", e);
        }
      }

      if (auth.currentUser) {
        auth.currentUser.photoURL = photoUrl.trim() ? photoUrl.trim() : null;
      }

      setProfile(updatedProfile);
      onProfileUpdated(updatedProfile);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err) {
      console.error('Failed to save profile:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  const handleSelectClubAndTeam = (clubId: string | null, teamId: string | null) => {
    const updatedProfile = {
      ...profile,
      activeClubId: clubId,
      activeTeamId: teamId
    };
    setProfile(updatedProfile);
    onProfileUpdated(updatedProfile);
    
    // Save to Firestore automatically when switching club/team
    setDoc(doc(db, 'users', userId, 'data', 'profile'), {
      ...updatedProfile,
      updatedAt: Date.now(),
    }).catch(err => console.error('Failed to save active club/team selection:', err));
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg('');
    
    if (newPassword.length < 6) {
      setPasswordStatus('error');
      setPasswordMsg('Det nya lösenordet måste vara minst 6 tecken långt.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus('error');
      setPasswordMsg('De nya lösenorden matchar inte.');
      return;
    }

    setPasswordStatus('saving');
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Ingen inloggningstoken hittades. Vänligen logga in igen.');
      }

      const res = await fetch(getApiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kunde inte ändra lösenordet.');
      }

      setPasswordStatus('success');
      setPasswordMsg('Ditt lösenord har uppdaterats!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordStatus('idle'), 4000);
    } catch (err: any) {
      setPasswordStatus('error');
      setPasswordMsg(err.message || 'Ett fel uppstod vid byte av lösenord.');
    }
  };

  const handleLinkGoogle = async () => {
    setGoogleLinkStatus('linking');
    setGoogleLinkMsg('');
    try {
      const res = await linkGoogleAccount(true);
      setGoogleLinked(true);
      setGoogleEmail(res.googleEmail || auth.currentUser?.googleEmail || '');
      setGoogleLinkStatus('success');
      setGoogleLinkMsg(res.message || 'Ditt Google-konto har kopplats samman med ditt CoachAssist-konto!');
      setTimeout(() => setGoogleLinkStatus('idle'), 5000);
    } catch (err: any) {
      setGoogleLinkStatus('error');
      setGoogleLinkMsg(err.message || 'Kunde inte koppla Google-konto.');
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!window.confirm('Är du säker på att du vill koppla bort Google-kontot från ditt CoachAssist-konto?')) {
      return;
    }
    setGoogleLinkStatus('unlinking');
    setGoogleLinkMsg('');
    try {
      const res = await unlinkGoogleAccount();
      setGoogleLinked(false);
      setGoogleEmail('');
      setGoogleLinkStatus('success');
      setGoogleLinkMsg(res.message || 'Google-kontot har kopplats bort.');
      setTimeout(() => setGoogleLinkStatus('idle'), 5000);
    } catch (err: any) {
      setGoogleLinkStatus('error');
      setGoogleLinkMsg(err.message || 'Kunde inte koppla bort Google-konto.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto p-4 sm:p-6" id="profile-settings-page">
      {/* Profile Form & Password Change (Left Column) */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-55/10 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Mina kontaktuppgifter</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Uppdatera dina personuppgifter och kontaktvägar.</p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-5">
            {/* Profile Avatar Card */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 p-4 sm:p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-150 dark:border-zinc-800/80">
              <div className="relative group/avatar shrink-0">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-indigo-600/30 dark:border-indigo-400/30 bg-indigo-50 dark:bg-indigo-950/40 shadow-md flex items-center justify-center">
                  {photoUrl ? (
                    <img src={photoUrl} alt={profile.fullName || 'Profilbild'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-2xl uppercase">
                      {(profile.fullName || emailInput || 'U').charAt(0)}
                    </div>
                  )}
                  {isUploadingPhoto && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white">
                      <Loader2 size={24} className="animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-2 -right-2 p-2 rounded-xl bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  title="Välj eller ändra bild"
                >
                  <Camera size={14} />
                </button>
              </div>

              <div className="flex-1 text-center sm:text-left space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h3 className="text-sm font-extrabold text-zinc-900 dark:text-white">Profilbild</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-900/30 w-fit mx-auto sm:mx-0">
                    Synkad med truppen & föreningen
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                  Bilden visas på din profil, i sidhuvudet och kopplas automatiskt till ditt medlemskort och truppen.
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingPhoto}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-bold border border-zinc-200 dark:border-zinc-700 shadow-xs transition-all cursor-pointer"
                  >
                    <Upload size={13} />
                    <span>Ladda upp bild</span>
                  </button>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={isUploadingPhoto}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-bold border border-red-200/50 dark:border-red-900/30 transition-all cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Ta bort</span>
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Visningsnamn / Fullständigt namn</label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-zinc-400">
                  <User size={18} />
                </span>
                <input
                  type="text"
                  required
                  placeholder="Skriv ditt fullständiga namn..."
                  value={profile.fullName}
                  onChange={e => setProfile(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">E-postadress (Inloggning)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <User size={18} />
                  </span>
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    placeholder="din.epost@doman.se"
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                </div>
                {emailUpdateError && (
                  <p className="text-xs font-bold text-red-500 mt-1.5">{emailUpdateError}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Användarnamn (Inloggning)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <AtSign size={18} />
                  </span>
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={e => setUsernameInput(e.target.value)}
                    placeholder="valfritt_anvandarnamn"
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                </div>
                {usernameError && (
                  <p className="text-xs font-bold text-red-500 mt-1.5">{usernameError}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Mobilnummer</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <Phone size={18} />
                  </span>
                  <input
                    type="tel"
                    placeholder="t.ex. 070-123 45 67"
                    value={profile.phone || ''}
                    onChange={e => setProfile(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider">Personnummer (Valfritt)</label>
                  <span className="text-[10px] text-zinc-400 font-bold bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">Sverige</span>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <Fingerprint size={18} />
                  </span>
                  <input
                    type="text"
                    placeholder="ÅÅÅÅMMDD-XXXX"
                    value={profile.personnummer || ''}
                    onChange={e => setProfile(prev => ({ ...prev, personnummer: e.target.value }))}
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saveStatus === 'saving'}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 px-6 rounded-2xl font-extrabold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-100 dark:shadow-none active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {saveStatus === 'saving' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Sparar...</span>
                  </>
                ) : saveStatus === 'success' ? (
                  <>
                    <Check size={18} />
                    <span>Sparat!</span>
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    <span>Spara ändringar</span>
                  </>
                )}
              </button>
            </div>

            {saveStatus === 'error' && (
              <p className="text-xs text-red-500 font-bold text-center">Något gick fel när profilinställningarna sparades. Prova igen.</p>
            )}
          </form>
        </div>

        {/* Change Password Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Lock size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">{!hasPassword && googleLinked ? 'Skapa lösenord' : 'Byt lösenord'}</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                {!hasPassword && googleLinked
                  ? 'Du loggar för närvarande in med Google. Skapa ett lösenord om du även vill kunna logga in manuellt.'
                  : 'Säkra ditt konto genom att uppdatera ditt lösenord.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Nuvarande lösenord (Valfritt om inloggad)</label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-zinc-400">
                  <Key size={18} />
                </span>
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Lämna tomt om du glömt"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3.5 top-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded-lg focus:outline-none"
                  title={showCurrentPassword ? "Dölj lösenord" : "Visa lösenord"}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Nytt lösenord</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <Lock size={18} />
                  </span>
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Minst 6 tecken"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full pl-11 pr-12 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3.5 top-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded-lg focus:outline-none"
                    title={showNewPassword ? "Dölj lösenord" : "Visa lösenord"}
                  >
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Bekräfta nytt lösenord</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-zinc-400">
                    <Lock size={18} />
                  </span>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Upprepa nytt lösenord"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full pl-11 pr-12 py-3 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white dark:bg-zinc-950 dark:hover:bg-zinc-950/70 dark:focus:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:outline-none transition-all font-semibold text-zinc-900 dark:text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded-lg focus:outline-none"
                    title={showConfirmPassword ? "Dölj lösenord" : "Visa lösenord"}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {passwordMsg && (
              <div className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 ${
                passwordStatus === 'success'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {passwordStatus === 'success' ? <ShieldCheck size={18} /> : <AlertCircle size={18} />}
                <span>{passwordMsg}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={passwordStatus === 'saving'}
                className="w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 py-3.5 px-6 rounded-2xl font-extrabold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
              >
                {passwordStatus === 'saving' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    <span>Uppdaterar lösenord...</span>
                  </>
                ) : (
                  <>
                    <Key size={18} />
                    <span>Uppdatera lösenord</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Google Account Linking Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Link2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Kopplade inloggningsmetoder</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Logga in snabbt och säkert genom att ansluta ditt Google-konto.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shadow-xs shrink-0">
                  <svg className="w-6 h-6" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-zinc-900 dark:text-white">Google-konto</span>
                    {googleLinked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                        <Check size={11} /> Kopplat
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        Ej anslutet
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-medium">
                    {googleLinked && googleEmail ? (
                      <span>Ansluten som <strong className="text-zinc-800 dark:text-zinc-200">{googleEmail}</strong></span>
                    ) : (
                      'Logga in smidigt med ditt Google-konto'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {googleLinked ? (
                  <button
                    type="button"
                    onClick={handleUnlinkGoogle}
                    disabled={googleLinkStatus === 'unlinking' || googleLinkStatus === 'linking'}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-red-200 hover:border-red-300 dark:border-red-900/50 dark:hover:border-red-800 bg-white hover:bg-red-50 dark:bg-zinc-900 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {googleLinkStatus === 'unlinking' ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>Kopplar bort...</span>
                      </>
                    ) : (
                      <>
                        <Unlink size={14} />
                        <span>Koppla bort</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLinkGoogle}
                    disabled={googleLinkStatus === 'linking' || googleLinkStatus === 'unlinking'}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {googleLinkStatus === 'linking' ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Kopplar konto...</span>
                      </>
                    ) : (
                      <>
                        <Link2 size={14} />
                        <span>Koppla Google-konto</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {googleLinkMsg && (
              <div className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 ${
                googleLinkStatus === 'success'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {googleLinkStatus === 'success' ? <ShieldCheck size={18} /> : <AlertCircle size={18} />}
                <span>{googleLinkMsg}</span>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-150 dark:border-zinc-800/80 text-zinc-500 dark:text-zinc-400 text-xs leading-relaxed">
              <p>
                När ditt Google-konto är kopplat kan du logga in antingen via knappen <strong>"Fortsätt med Google"</strong> eller med ditt vanliga användarnamn/e-post och lösenord.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Club & Team Switcher (Right Column) */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-55/10 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Landmark size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Klubbanslutning</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Här hanterar och byter du mellan anslutna klubbar.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400 dark:text-zinc-500">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold">Hämtar anslutningar...</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Personal Option */}
              <button
                onClick={() => handleSelectClubAndTeam(null, null)}
                className={`w-full text-left p-4 rounded-2xl border transition-all relative flex items-center justify-between cursor-pointer ${
                  profile.activeClubId === null
                    ? 'bg-indigo-50/40 border-indigo-500/70 dark:bg-indigo-950/10 dark:border-indigo-500/50 shadow-sm'
                    : 'bg-zinc-50 hover:bg-zinc-100/60 dark:bg-zinc-950 dark:hover:bg-zinc-950/60 border-zinc-150 dark:border-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                    <User size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-white">Personlig Trupp</h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium mt-0.5">Lokal, privat trupp (Offline-läge)</p>
                  </div>
                </div>
                {profile.activeClubId === null && (
                  <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                    <Check size={14} />
                  </span>
                )}
              </button>

              {/* Memberships List */}
              {memberships.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 pt-4 pb-1">
                    <h4 className="text-[11px] font-black uppercase text-zinc-400 tracking-wider">Mina Klubbar</h4>
                  </div>

                  {memberships.map(({ club, roles, teams, availableTeams }) => {
                    const isActive = profile.activeClubId === club.id;
                    const myClubTeams = (roles.includes('admin') || roles.includes('coach') || teams.length === 0)
                      ? availableTeams
                      : availableTeams.filter(t => teams.includes(t.id));
                    
                    return (
                      <div
                        key={club.id}
                        className={`p-4.5 rounded-2xl border transition-all ${
                          isActive
                            ? 'bg-indigo-50/40 border-indigo-500/70 dark:bg-indigo-950/10 dark:border-indigo-500/50 shadow-sm'
                            : 'bg-zinc-50 hover:bg-zinc-100/40 dark:bg-zinc-950 dark:hover:bg-zinc-950/40 border-zinc-150 dark:border-zinc-800/80'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <button
                            onClick={() => {
                              // Auto-select first team they are member of or available team
                              const firstTeamId = teams[0] || (availableTeams.length > 0 ? availableTeams[0].id : 'club_global');
                              handleSelectClubAndTeam(club.id, firstTeamId);
                            }}
                            className="flex items-center gap-3 text-left focus:outline-none flex-1 cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-xl bg-indigo-55/10 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-450 flex items-center justify-center">
                              <Landmark size={20} />
                            </div>
                            <div>
                              <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white leading-tight">{club.name}</h3>
                              <div className="flex items-center gap-1.5 mt-1">
                                {roles.map(r => (
                                  <span
                                    key={r}
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                                      r === 'admin'
                                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400'
                                        : r === 'coach'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                        : r === 'player'
                                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-450'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                    }`}
                                  >
                                    {r === 'admin' ? 'Admin' : r === 'coach' ? 'Tränare' : r === 'player' ? 'Spelare' : 'Förälder'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </button>

                          {isActive && (
                            <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white shrink-0">
                              <Check size={14} />
                            </span>
                          )}
                        </div>

                        {/* Team Selector within Active Club */}
                        {isActive && myClubTeams.length > 0 && (
                          <div className="mt-4 border-t border-zinc-200/50 dark:border-zinc-800/80 pt-3.5 space-y-2">
                            <label className="block text-[10px] font-black text-zinc-550 dark:text-zinc-500 uppercase tracking-wider mb-2">Aktivt lag i klubben</label>
                            <div className="grid grid-cols-2 gap-2">
                              {myClubTeams.map(t => {
                                const isTeamActive = profile.activeTeamId === t.id;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => handleSelectClubAndTeam(club.id, t.id)}
                                    className={`py-2 px-3.5 rounded-xl border font-bold text-xs text-center transition-all cursor-pointer ${
                                      isTeamActive
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                                        : 'bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                                    }`}
                                  >
                                    {t.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/20 text-amber-850 dark:text-amber-400">
                  <div className="flex gap-2.5">
                    <Info size={16} className="shrink-0 mt-0.5" />
                    <p className="text-[11px] font-medium leading-relaxed">
                      Du har för närvarande inga anslutna klubbar. För att gå med i en klubb, kontakta din förenings administratör och be dem lägga till din e-postadress <strong>({userEmail})</strong> till lagets medlemmar.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {imageToCrop && (
        <ImageCropper
          image={imageToCrop}
          onCropComplete={onCropComplete}
          onCancel={() => setImageToCrop(null)}
          aspect={1}
        />
      )}
    </div>
  );
}
