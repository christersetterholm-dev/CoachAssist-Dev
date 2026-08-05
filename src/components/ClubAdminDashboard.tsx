import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Landmark, Trash2, Edit3, Users, Shield, ShieldAlert, Check, PlusCircle, Search, Mail, Phone, Fingerprint, Settings, ArrowRight, UserPlus, Save, Smartphone, X, Database, Server, HardDrive, Cloud, RefreshCw, Download, Upload, Globe, Cpu, CheckCircle2, AlertTriangle, AlertCircle, Calendar, Link, Copy, ExternalLink, FileSpreadsheet, FileText, Camera, Loader2, Key, UserCheck, Sparkles, Filter, ArrowUpDown, RotateCcw } from 'lucide-react';
import { Club, ClubMetadata, ClubTeam, ClubMember, SquadPlayer, TrainingSettings, TrainingSession } from '../types';
import { db, storage, getApiUrl, ref, uploadBytes, getDownloadURL } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import PwaIconGenerator from './PwaIconGenerator';
import ImageCropper from './ImageCropper';
import { CachedImage } from './CachedImage';
import { syncTeamCalendar } from '../utils/calendarSync';
import { deduplicateClubMembers, deduplicateSquad, syncAllTeamSquadsToClubMembers } from '../lib/clubUtils';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

interface ClubAdminDashboardProps {
  userId: string;
  userEmail: string;
  isRootAdmin?: boolean;
  isCoachOrAdmin?: boolean;
  userRoles?: string[];
  onBack?: () => void;
  teamUrl?: string;
  onUpdateTeamUrl?: (url: string) => void;
  adminUrl?: string;
  onUpdateAdminUrl?: (url: string) => void;
  seriesUrl?: string;
  onUpdateSeriesUrl?: (url: string) => void;
  activeClubId?: string | null;
  activeTeamId?: string | null;
  onSelectActiveTeam?: (clubId: string, teamId: string) => void;
  activeSquad?: SquadPlayer[];
  onUpdateSquad?: (squad: SquadPlayer[]) => void;
  trainingSettings?: TrainingSettings;
  onUpdateSettings?: (settings: TrainingSettings) => void;
  sessions?: TrainingSession[];
  onUpdateSessions?: (sessions: TrainingSession[]) => void;
}

export default function ClubAdminDashboard({
  userId,
  userEmail,
  isRootAdmin = false,
  isCoachOrAdmin = false,
  userRoles = [],
  onBack,
  teamUrl = 'https://www.svenskalag.se/',
  onUpdateTeamUrl,
  adminUrl = 'https://www.svenskalag.se/admin',
  onUpdateAdminUrl,
  seriesUrl = 'https://minfotboll.svenskfotboll.se/',
  onUpdateSeriesUrl,
  activeClubId,
  activeTeamId,
  onSelectActiveTeam,
  activeSquad: _activeSquad,
  onUpdateSquad,
  trainingSettings,
  onUpdateSettings,
  sessions,
  onUpdateSessions,
}: ClubAdminDashboardProps) {
  const isAuthorized = isRootAdmin || isCoachOrAdmin || userRoles.includes('admin') || userRoles.includes('coach');

  if (!isAuthorized) {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 text-center space-y-4 bg-white dark:bg-zinc-900 rounded-3xl border border-red-200 dark:border-red-900/40 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert size={32} />
        </div>
        <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Åtkomst nekad</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed">
          Du har inte behörighet att se eller ändra förenings- och laginställningar. Denna vy är endast tillgänglig för godkända tränare och administratörer.
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all cursor-pointer shadow-md active:scale-95 text-xs"
          >
            Gå tillbaka till träningar
          </button>
        )}
      </div>
    );
  }
  // Navigation tabs within admin
  const [activeTab, setActiveTab] = useState<'clubs' | 'teams' | 'members' | 'user_accounts' | 'calendar_sync' | 'pwa_icons' | 'database_env' | 'root_admins'>(() => isRootAdmin ? 'clubs' : 'teams');

  // Master lists
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [clubMetadata, setClubMetadata] = useState<ClubMetadata | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const selectedClubIdRef = useRef<string | null>(null);

  // User Accounts & Password Management State
  const [userAccounts, setUserAccounts] = useState<Array<{
    id: string;
    email: string;
    username: string | null;
    hasLoggedIn: boolean;
    tempPassword?: string | null;
    createdAt?: number;
  }>>([]);
  const [loadingUserAccounts, setLoadingUserAccounts] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userTeamFilter, setUserTeamFilter] = useState('all');

  // Single User Edit Modal State
  const [editingUserAccount, setEditingUserAccount] = useState<{
    id: string;
    name: string;
    email: string;
    username: string | null;
    hasLoggedIn: boolean;
    tempPassword?: string | null;
  } | null>(null);
  const [accountEmailInput, setAccountEmailInput] = useState('');
  const [accountUsernameInput, setAccountUsernameInput] = useState('');
  const [accountPasswordInput, setAccountPasswordInput] = useState('');
  const [isSavingUserAccount, setIsSavingUserAccount] = useState(false);
  const [userAccountError, setUserAccountError] = useState('');

  // Bulk Generation State
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkGenSuccessMsg, setBulkGenSuccessMsg] = useState('');
  const [copiedUserKey, setCopiedUserKey] = useState<string | null>(null);

  // Root Admins list state
  const [rootAdminsList, setRootAdminsList] = useState<{ email: string; assignedAt: number; role?: string; uid?: string }[]>([]);
  const [newRootAdminEmail, setNewRootAdminEmail] = useState('');
  const [rootAdminActionLoading, setRootAdminActionLoading] = useState(false);
  const [rootAdminError, setRootAdminError] = useState('');

  // Database & Environment Management State
  const [tempTeamUrl, setTempTeamUrl] = useState(teamUrl);
  const [tempAdminUrl, setTempAdminUrl] = useState(adminUrl);
  const [tempSeriesUrl, setTempSeriesUrl] = useState(seriesUrl);

  // Calendar Sync State for Team
  const [tempIcsUrl, setTempIcsUrl] = useState(trainingSettings?.icsUrl || '');
  const [forceOverwriteCalendar, setForceOverwriteCalendar] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [calendarSyncMsg, setCalendarSyncMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [calSyncSaved, setCalSyncSaved] = useState(false);
  const [copiedCalFeed, setCopiedCalFeed] = useState(false);

  // Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSourceTab, setImportSourceTab] = useState<'file' | 'paste'>('file');
  const [importPasteText, setImportPasteText] = useState('');
  const [importSelectedTeamIds, setImportSelectedTeamIds] = useState<string[]>([]);
  const [importRoleMode, setImportRoleMode] = useState<'auto' | 'force_player' | 'force_coach'>('auto');
  const [importDuplicateMode, setImportDuplicateMode] = useState<'merge' | 'skip' | 'add_all'>('merge');
  const [parsedImportMembers, setParsedImportMembers] = useState<Array<{
    id: string;
    fullName: string;
    email: string;
    phone: string;
    personnummer: string;
    role: 'coach' | 'player';
    position?: string;
    number?: string;
  }>>([]);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempTeamUrl(teamUrl);
    setTempAdminUrl(adminUrl);
    setTempSeriesUrl(seriesUrl);
    if (trainingSettings?.icsUrl) {
      setTempIcsUrl(trainingSettings.icsUrl);
    }
  }, [teamUrl, adminUrl, seriesUrl, trainingSettings?.icsUrl]);

  const handleSyncTeamCalendar = async () => {
    const urlToUse = tempIcsUrl.trim();
    if (!urlToUse) {
      setCalendarSyncMsg({ type: 'error', text: 'Ange en giltig kalenderlänk (webcal/ics) för laget först.' });
      return;
    }

    setIsSyncingCalendar(true);
    setCalendarSyncMsg({ type: 'info', text: 'Hämtar och tolkar lagets kalenderhändelser...' });

    try {
      const result = await syncTeamCalendar(urlToUse, sessions || [], forceOverwriteCalendar);

      if (result.success) {
        if (onUpdateSessions) {
          onUpdateSessions(result.updatedSessions);
        }
        const updatedSettings: TrainingSettings = {
          ...(trainingSettings || { defaultStartTime: '18:00' }),
          icsUrl: urlToUse,
          lastSyncedAt: result.lastSyncedAt,
          lastSyncCount: result.addedCount + result.updatedCount
        };
        if (onUpdateSettings) {
          onUpdateSettings(updatedSettings);
        }

        setCalendarSyncMsg({
          type: 'success',
          text: result.message
        });
      } else {
        setCalendarSyncMsg({
          type: 'error',
          text: result.message
        });
      }
    } catch (err: any) {
      setCalendarSyncMsg({
        type: 'error',
        text: err?.message || 'Ett oväntat fel uppstod vid synkning.'
      });
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const [dbConfig, setDbConfig] = useState<{
    mode: 'hybrid' | 'local_sqlite' | 'firestore_only';
    dbPath?: string;
    dbSize?: number;
    isProduction?: boolean;
    firestoreConfigured?: boolean;
    firestoreProjectId?: string | null;
    firestoreDatabaseId?: string | null;
    firestoreUrl?: string | null;
    customFirestoreProjectId?: string;
    customFirestoreApiKey?: string;
    customRemoteUrl?: string;
    updatedAt?: number;
    updatedBy?: string;
  }>({ mode: 'hybrid' });
  const [dbConfigLoading, setDbConfigLoading] = useState(false);
  const [dbConfigMessage, setDbConfigMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // Loading & Action states
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<{ type: 'save' | 'delete' | 'create'; status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'create', status: 'idle' });

  // Creation/Edit Forms states
  const [newClubName, setNewClubName] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  // Member form state
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingMember, setEditingMember] = useState<ClubMember | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberPersonnummer, setMemberPersonnummer] = useState('');
  const [memberPosition, setMemberPosition] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [memberPhotoUrl, setMemberPhotoUrl] = useState('');
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const handleMemberPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => setImageToCrop(reader.result as string));
    reader.readAsDataURL(file);

    if (e.target) e.target.value = '';
  };

  const onCropCompleteMemberPhoto = async (croppedBlob: Blob) => {
    setImageToCrop(null);
    setIsUploadingPhoto(true);

    try {
      // 1. First try persistent local/SQLite server upload endpoint
      const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
      const formData = new FormData();
      formData.append('file', croppedBlob, `member_${Date.now()}.${extension}`);

      const res = await fetch(getApiUrl('/api/upload'), {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          setMemberPhotoUrl(data.url);
          setIsUploadingPhoto(false);
          return;
        }
      }
    } catch (serverErr) {
      console.warn('Server upload fallback:', serverErr);
    }

    try {
      // 2. Try Firebase Storage
      const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
      const fileName = `member_${Date.now()}.${extension}`;
      const memberPath = editingMember ? `members/${editingMember.userId}/${fileName}` : `members/temp/${fileName}`;
      const storageRef = ref(storage, memberPath);
      
      const uploadResult = await uploadBytes(storageRef, croppedBlob);
      const downloadURL = await getDownloadURL(uploadResult.ref);

      setMemberPhotoUrl(downloadURL);
    } catch (err) {
      console.error('Failed to upload member photo to storage, falling back to data URL:', err);
      // 3. Fallback to Data URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setMemberPhotoUrl(reader.result as string);
      };
      reader.readAsDataURL(croppedBlob);
    } finally {
      setIsUploadingPhoto(false);
    }
  };
  const [memberRoles, setMemberRoles] = useState<('admin' | 'coach' | 'player' | 'parent')[]>([]);
  const [memberTeams, setMemberTeams] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState<'all' | 'admin' | 'coach' | 'player' | 'parent'>('all');
  const [memberTeamFilter, setMemberTeamFilter] = useState<string>('all');
  const [memberSortBy, setMemberSortBy] = useState<'name-asc' | 'name-desc' | 'role' | 'number' | 'team'>('name-asc');

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token') || localStorage.getItem('coachassist_jwt_token') || localStorage.getItem('jwt_token') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-id': userId || '',
      'x-user-email': userEmail || ''
    };
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  // Fetch user accounts for club/members
  const fetchUserAccounts = async () => {
    setLoadingUserAccounts(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/users'), {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setUserAccounts(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch user accounts:', err);
    } finally {
      setLoadingUserAccounts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'user_accounts') {
      fetchUserAccounts();
    }
  }, [activeTab]);

  const allMemberAccounts = React.useMemo(() => {
    const result: Array<{
      id: string;
      memberId: string;
      name: string;
      role: string;
      email: string;
      username: string | null;
      hasLoggedIn: boolean;
      tempPassword?: string | null;
      teamName?: string;
      phone?: string;
    }> = [];
    const processedUserIds = new Set<string>();

    for (const m of members) {
      const userMatch = userAccounts.find(u =>
        (u.id && (u.id === m.userId || u.id === m.id)) ||
        (u.email && m.email && u.email.trim().toLowerCase() === m.email.trim().toLowerCase())
      );

      const teamNames = (m.teams || []).map(tId => {
        const t = clubMetadata?.teams?.find(team => team.id === tId);
        return t ? t.name : tId;
      }).join(', ');

      const userId = userMatch?.id || m.userId || m.id || crypto.randomUUID();
      processedUserIds.add(userId);
      if (userMatch?.id) processedUserIds.add(userMatch.id);

      const roleLabel = m.roles?.includes('admin') ? 'Admin' :
                        m.roles?.includes('coach') ? 'Tränare' :
                        m.roles?.includes('parent') ? 'Förälder' : 'Spelare';

      result.push({
        id: userId,
        memberId: m.userId || m.id || userId,
        name: m.fullName || m.name || m.email.split('@')[0],
        role: roleLabel,
        email: m.email,
        username: userMatch?.username || null,
        hasLoggedIn: userMatch?.hasLoggedIn || false,
        tempPassword: userMatch?.tempPassword || null,
        teamName: teamNames || 'Alla lag',
        phone: m.phone
      });
    }

    for (const u of userAccounts) {
      if (!processedUserIds.has(u.id)) {
        result.push({
          id: u.id,
          memberId: u.id,
          name: u.username || u.email.split('@')[0],
          role: 'Användare',
          email: u.email,
          username: u.username || null,
          hasLoggedIn: u.hasLoggedIn,
          tempPassword: u.tempPassword || null,
          teamName: 'Förening'
        });
      }
    }

    return result;
  }, [members, userAccounts, clubMetadata]);

  const filteredMemberAccounts = React.useMemo(() => {
    return allMemberAccounts.filter(acc => {
      const q = userSearchQuery.trim().toLowerCase();
      const matchesSearch = !q ||
        acc.name.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        (acc.username && acc.username.toLowerCase().includes(q)) ||
        (acc.id && acc.id.toLowerCase().includes(q));

      const matchesTeam = userTeamFilter === 'all' ||
        (acc.teamName && acc.teamName.toLowerCase().includes(userTeamFilter.toLowerCase()));

      return matchesSearch && matchesTeam;
    });
  }, [allMemberAccounts, userSearchQuery, userTeamFilter]);

  const handleBulkGenerateCredentials = async (targetTeamId?: string) => {
    setIsBulkGenerating(true);
    setBulkGenSuccessMsg('');
    try {
      let targetMembers = members;
      if (targetTeamId && targetTeamId !== 'all') {
        targetMembers = members.filter(m => {
          if (!m.teams || m.teams.length === 0) return false;
          return m.teams.some(tId => {
            if (tId === targetTeamId) return true;
            const foundTeam = clubMetadata?.teams?.find(ct => ct.id === tId || ct.name === tId);
            return foundTeam?.name === targetTeamId || foundTeam?.id === targetTeamId;
          });
        });
      }
      if (targetMembers.length === 0) {
        targetMembers = members;
      }

      const payload = targetMembers.map(m => ({
        id: m.userId || m.id || crypto.randomUUID(),
        name: m.fullName || m.name,
        email: m.email,
        role: m.roles?.includes('admin') ? 'Admin' : m.roles?.includes('coach') ? 'Tränare' : 'Spelare'
      }));

      const res = await fetch(getApiUrl('/api/admin/users/bulk-generate'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ members: payload })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Generering misslyckades');
      }

      const data = await res.json();

      // Sync initial active club profile docs for created accounts
      const targetClubId = selectedClub?.id || activeClubId;
      if (data.accounts && Array.isArray(data.accounts) && targetClubId) {
        for (const acc of data.accounts) {
          try {
            const profileRef = doc(db, 'users', acc.id, 'data', 'profile');
            const pSnap = await getDoc(profileRef);
            if (!pSnap.exists()) {
              await setDoc(profileRef, {
                fullName: acc.name || acc.email?.split('@')[0],
                email: acc.email?.trim().toLowerCase(),
                username: acc.username || null,
                activeClubId: targetClubId,
                activeTeamId: activeTeamId || 'club_global',
                status: 'approved',
                onboardingCompleted: false,
                createdAt: Date.now()
              }, { merge: true });
            } else {
              await setDoc(profileRef, {
                activeClubId: targetClubId,
                status: 'approved'
              }, { merge: true });
            }
          } catch (pErr) {
            console.error('Failed setting initial profile for generated user account:', pErr);
          }
        }
      }

      setBulkGenSuccessMsg(`Genererade / uppdaterade konton för ${data.accounts?.length || 0} medlemmar!`);
      await fetchUserAccounts();
    } catch (err: any) {
      alert(err.message || 'Ett fel uppstod vid generering av konton');
    } finally {
      setIsBulkGenerating(false);
    }
  };

  const handleSaveUserAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserAccount) return;

    setIsSavingUserAccount(true);
    setUserAccountError('');

    try {
      const res = await fetch(getApiUrl('/api/admin/users/update'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: editingUserAccount.id,
          newEmail: accountEmailInput,
          newUsername: accountUsernameInput,
          newPassword: accountPasswordInput ? accountPasswordInput : undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kunde inte spara användarkontot.');
      }

      setEditingUserAccount(null);
      setAccountPasswordInput('');
      await fetchUserAccounts();
    } catch (err: any) {
      setUserAccountError(err.message || 'Fel vid sparande av konto');
    } finally {
      setIsSavingUserAccount(false);
    }
  };

  const handleQuickResetPassword = async (acc: typeof allMemberAccounts[0]) => {
    const words = ['Snabb', 'Stark', 'Fokus', 'Smidig', 'Taktik', 'Kämpe', 'Laganda', 'Spelare', 'Ledare'];
    const word = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    const newPass = `${word}-${num}`;

    try {
      const res = await fetch(getApiUrl('/api/admin/users/update'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId: acc.id,
          newEmail: acc.email,
          newUsername: acc.username,
          newPassword: newPass
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunde inte slumpa lösenord.');
      setBulkGenSuccessMsg(`Nytt tillfälligt lösenord skapat för ${acc.name}: ${newPass}`);
      setTimeout(() => setBulkGenSuccessMsg(''), 6000);
      await fetchUserAccounts();
    } catch (err: any) {
      alert(err.message || 'Ett fel uppstod vid skapande av lösenord.');
    }
  };

  const handleQuickGenerateUsername = async (acc: typeof allMemberAccounts[0]) => {
    try {
      const res = await fetch(getApiUrl('/api/admin/users/bulk-generate'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          members: [{
            id: acc.id,
            name: acc.name,
            email: acc.email,
            role: acc.role
          }]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunde inte generera användarnamn.');
      setBulkGenSuccessMsg(`Användarnamn genererat för ${acc.name}!`);
      setTimeout(() => setBulkGenSuccessMsg(''), 4000);
      await fetchUserAccounts();
    } catch (err: any) {
      alert(err.message || 'Kunde inte generera användarnamn.');
    }
  };

  const exportAccountsToExcel = (accountsToExport: typeof allMemberAccounts) => {
    const exportRows = accountsToExport.map(m => ({
      'Namn': m.name || '-',
      'Roll': m.role || 'Medlem',
      'Lag': m.teamName || 'Alla lag',
      'E-post': m.email || '-',
      'Användarnamn': m.username || 'Ej valt',
      'Lösenord': m.hasLoggedIn ? '••••••••' : (m.tempPassword || 'Ej genererat'),
      'Inloggningsstatus': m.hasLoggedIn ? 'Inloggad första gången (Lösenord dolt)' : 'Ej inloggad (Tillfälligt lösenord)',
      'UUID (Användar-ID)': m.id
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 16 },
      { wch: 18 },
      { wch: 28 },
      { wch: 20 },
      { wch: 20 },
      { wch: 34 },
      { wch: 38 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Medlemskonton');

    const clubNameStr = selectedClub?.name?.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_') || 'Klubb';
    const fileName = `Medlemskonton_${clubNameStr}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const exportAccountsToCSV = (accountsToExport: typeof allMemberAccounts) => {
    const exportRows = accountsToExport.map(m => ({
      'Namn': m.name || '-',
      'Roll': m.role || 'Medlem',
      'Lag': m.teamName || 'Alla lag',
      'E-post': m.email || '-',
      'Användarnamn': m.username || 'Ej valt',
      'Lösenord': m.hasLoggedIn ? '••••••••' : (m.tempPassword || 'Ej genererat'),
      'Inloggningsstatus': m.hasLoggedIn ? 'Inloggad första gången (Lösenord dolt)' : 'Ej inloggad (Tillfälligt lösenord)',
      'UUID (Användar-ID)': m.id
    }));

    const csv = Papa.unparse(exportRows, { delimiter: ';' });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const clubNameStr = selectedClub?.name?.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_') || 'Klubb';
    link.download = `Medlemskonton_${clubNameStr}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUserKey(key);
    setTimeout(() => setCopiedUserKey(null), 2000);
  };

  // Load root admins
  const loadRootAdmins = async () => {
    try {
      const rootAdminsListDoc = await getDoc(doc(db, 'admins', 'root_admins_list'));
      if (rootAdminsListDoc.exists()) {
        const data = rootAdminsListDoc.data();
        if (data && Array.isArray(data.admins)) {
          setRootAdminsList(data.admins);
          return;
        }
      }
      // If it doesn't exist, fall back to initial configuration list
      const initialList = [
        { email: 'christer.setterholm@gmail.com', assignedAt: Date.now(), role: 'root_admin' },
        { email: 'christer@setterholm.se', assignedAt: Date.now(), role: 'root_admin' }
      ];
      setRootAdminsList(initialList);
    } catch (e) {
      console.error('Failed to load root admins:', e);
    }
  };

  useEffect(() => {
    if (isRootAdmin && activeTab === 'root_admins') {
      loadRootAdmins();
    }
  }, [isRootAdmin, activeTab]);

  const handleAddRootAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRootAdminEmail.trim()) return;
    
    setRootAdminActionLoading(true);
    setRootAdminError('');
    try {
      const lowerEmail = newRootAdminEmail.trim().toLowerCase();
      
      // Check if already in list
      if (rootAdminsList.some(adm => adm.email.toLowerCase() === lowerEmail)) {
        throw new Error('E-postadressen är redan en root-admin.');
      }
      
      const updatedAdmins = [
        ...rootAdminsList,
        {
          email: lowerEmail,
          assignedAt: Date.now(),
          role: 'root_admin'
        }
      ];
      
      await setDoc(doc(db, 'admins', 'root_admins_list'), { admins: updatedAdmins });
      setRootAdminsList(updatedAdmins);
      setNewRootAdminEmail('');
    } catch (err: any) {
      setRootAdminError(err.message || 'Kunde inte lägga till root-admin.');
    } finally {
      setRootAdminActionLoading(false);
    }
  };

  const handleRemoveRootAdmin = async (emailToRemove: string) => {
    const lowerEmail = emailToRemove.trim().toLowerCase();
    const hardcodedRoots = ['christer.setterholm@gmail.com', 'christer@setterholm.se'];
    
    if (hardcodedRoots.includes(lowerEmail)) {
      alert('Det går inte att ta bort systemets ursprungliga root-administratörer.');
      return;
    }
    
    if (lowerEmail === userEmail.trim().toLowerCase()) {
      if (!confirm('Är du säker på att du vill ta bort ditt eget root-administratörskonto? Du kommer att förlora root-behörigheter.')) {
        return;
      }
    } else {
      if (!confirm(`Är du säker på att du vill ta bort ${emailToRemove} som root-administratör?`)) {
        return;
      }
    }
    
    setRootAdminActionLoading(true);
    setRootAdminError('');
    try {
      const updatedAdmins = rootAdminsList.filter(adm => adm.email.toLowerCase() !== lowerEmail);
      await setDoc(doc(db, 'admins', 'root_admins_list'), { admins: updatedAdmins });
      setRootAdminsList(updatedAdmins);
    } catch (err: any) {
      setRootAdminError(err.message || 'Kunde inte ta bort root-admin.');
    } finally {
      setRootAdminActionLoading(false);
    }
  };

  const fetchDbConfig = async () => {
    setDbConfigLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/system/db-config'));
      if (res.ok) {
        const data = await res.json();
        setDbConfig(data);
      }
    } catch (e) {
      console.error('Error fetching db config:', e);
    } finally {
      setDbConfigLoading(false);
    }
  };

  useEffect(() => {
    if (isRootAdmin && activeTab === 'database_env') {
      fetchDbConfig();
    }
  }, [isRootAdmin, activeTab]);

  const handleSaveDbConfig = async (newMode: 'hybrid' | 'local_sqlite' | 'firestore_only') => {
    setDbConfigLoading(true);
    setDbConfigMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/system/db-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: newMode,
          customFirestoreProjectId: dbConfig.customFirestoreProjectId || '',
          customFirestoreApiKey: dbConfig.customFirestoreApiKey || '',
          customRemoteUrl: dbConfig.customRemoteUrl || ''
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDbConfig(prev => ({ ...prev, mode: newMode }));
        setDbConfigMessage({
          type: 'success',
          text: `Databasläget ändrades till "${newMode === 'local_sqlite' ? 'Fristående Lokal SQLite' : newMode === 'hybrid' ? 'Hybrid (SQLite + Cloud-synk)' : 'Endast Cloud Firestore'}".`
        });
      } else {
        setDbConfigMessage({ type: 'error', text: data.error || 'Kunde inte spara inställningarna.' });
      }
    } catch (err) {
      setDbConfigMessage({ type: 'error', text: 'Nätverksfel vid sparning.' });
    } finally {
      setDbConfigLoading(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncingNow(true);
    setDbConfigMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/system/db-sync-now'), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDbConfigMessage({ type: 'success', text: data.message || 'Synkronisering slutförd!' });
      } else {
        setDbConfigMessage({ type: 'error', text: data.error || 'Synkronisering misslyckades.' });
      }
    } catch (err) {
      setDbConfigMessage({ type: 'error', text: 'Nätverksfel vid synkronisering.' });
    } finally {
      setIsSyncingNow(false);
    }
  };

  const handleExportBackup = () => {
    window.open(getApiUrl('/api/system/db-export'), '_blank');
  };

  const handleImportBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setIsImporting(true);
    setDbConfigMessage(null);
    try {
      const text = await importFile.text();
      const dump = JSON.parse(text);
      const res = await fetch(getApiUrl('/api/system/db-import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dump)
      });
      const data = await res.json();
      if (res.ok) {
        setDbConfigMessage({ type: 'success', text: `Säkerhetskopia importerad framgångsrikt! (${data.importedRecords} poster)` });
        setImportFile(null);
        fetchDbConfig();
      } else {
        setDbConfigMessage({ type: 'error', text: data.error || 'Importen misslyckades.' });
      }
    } catch (err: any) {
      setDbConfigMessage({ type: 'error', text: 'Ogiltig JSON-fil eller importfel: ' + err.message });
    } finally {
      setIsImporting(false);
    }
  };

  // Load all clubs on mount (Root admin sees all clubs; regular users only see their own assigned/member clubs)
  const loadClubs = async (selectFirst = false) => {
    setIsLoading(true);
    try {
      const docRef = doc(db, 'shared_leaderboards', 'all_clubs');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const list: Club[] = snap.data().clubs || [];
        let availableClubs: Club[] = [];

        if (isRootAdmin) {
          availableClubs = list;
        } else {
          // Filter list for non-root admins to only show their assigned/member clubs
          const filtered: Club[] = [];
          for (const c of list) {
            if (activeClubId && c.id === activeClubId) {
              filtered.push(c);
              continue;
            }
            try {
              const membersSnap = await getDoc(doc(db, 'clubs', c.id, 'teams', 'club_global', 'data', 'members'));
              if (membersSnap.exists()) {
                const membersList: ClubMember[] = membersSnap.data().members || [];
                const isMem = membersList.some(m => m.userId === userId || (m.email && userEmail && m.email.trim().toLowerCase() === userEmail.trim().toLowerCase()));
                if (isMem) filtered.push(c);
              }
            } catch (e) {}
          }
          availableClubs = filtered;
        }

        setClubs(availableClubs);
        if (availableClubs.length > 0 && (selectFirst || !selectedClub)) {
          const currentActive = availableClubs.find(c => c.id === activeClubId);
          setSelectedClub(currentActive || availableClubs[0]);
        }
      } else {
        setClubs([]);
      }
    } catch (err) {
      console.error('Failed to load clubs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadClubs(true);
  }, []);

  // Load selected club details (metadata & members) when selectedClub changes
  const handleSelectClub = async (club: Club) => {
    selectedClubIdRef.current = club.id;
    setSelectedClub(club);
    setClubMetadata(null);
    setMembers([]);

    if (onSelectActiveTeam) {
      try {
        const metadataRef = doc(db, 'clubs', club.id, 'teams', 'club_global', 'data', 'metadata');
        const metaSnap = await getDoc(metadataRef);
        const teams = metaSnap.exists() ? (metaSnap.data().teams || []) : [];
        const defaultTeamId = teams.length > 0 ? teams[0].id : 'club_global';
        onSelectActiveTeam(club.id, defaultTeamId);
      } catch (err) {
        console.error("Failed to load metadata for active team switch:", err);
        onSelectActiveTeam(club.id, 'club_global');
      }
    }
  };

  useEffect(() => {
    if (!selectedClub) {
      setClubMetadata(null);
      setMembers([]);
      return;
    }

    selectedClubIdRef.current = selectedClub.id;
    const targetClubId = selectedClub.id;

    async function loadClubDetails() {
      try {
        const metadataRef = doc(db, 'clubs', targetClubId, 'teams', 'club_global', 'data', 'metadata');
        const membersRef = doc(db, 'clubs', targetClubId, 'teams', 'club_global', 'data', 'members');

        const [metaSnap, memSnap] = await Promise.all([
          getDoc(metadataRef),
          getDoc(membersRef)
        ]);

        if (selectedClubIdRef.current !== targetClubId) return;

        let metaData: ClubMetadata;
        if (metaSnap.exists()) {
          metaData = metaSnap.data() as ClubMetadata;
        } else {
          // Initialize metadata if missing
          metaData = { id: targetClubId, name: selectedClub!.name, teams: [] };
          await setDoc(metadataRef, metaData);
        }

        let membersData: ClubMember[];
        if (memSnap.exists()) {
          membersData = memSnap.data().members || [];
        } else {
          // Initialize members with creator as admin
          membersData = [
            {
              userId: userId,
              email: userEmail,
              fullName: userEmail.split('@')[0],
              roles: ['admin', 'coach'],
              teams: []
            }
          ];
          await setDoc(membersRef, { members: membersData });
        }

        if (selectedClubIdRef.current !== targetClubId) return;

        setClubMetadata(metaData);
        setMembers(membersData);

        // Auto-sync squad photos & player info from all team squads in this club
        const teamIds = (metaData.teams || []).map(t => t.id);
        if (teamIds.length > 0) {
          const syncedMembers = await syncAllTeamSquadsToClubMembers(targetClubId, teamIds);
          if (syncedMembers && syncedMembers.length > 0 && selectedClubIdRef.current === targetClubId) {
            setMembers(syncedMembers);
          }
        }
      } catch (err) {
        console.error('Failed to load club details:', err);
      }
    }

    loadClubDetails();
  }, [selectedClub]);

  // Create new club
  const handleCreateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClubName.trim()) return;

    setActionStatus({ type: 'create', status: 'loading' });
    try {
      const clubId = 'club_' + Math.random().toString(36).substring(2, 11);
      const newClub: Club = {
        id: clubId,
        name: newClubName.trim()
      };

      // 1. Add to clubs list
      const updatedClubs = [...clubs, newClub];
      await setDoc(doc(db, 'shared_leaderboards', 'all_clubs'), { clubs: updatedClubs });

      // 2. Initialize club global docs
      const metadataRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'metadata');
      const membersRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'members');

      const initialMeta: ClubMetadata = { id: clubId, name: newClub.name, teams: [] };
      const initialMembers: ClubMember[] = [
        {
          userId: userId,
          email: userEmail,
          fullName: userEmail.split('@')[0],
          roles: ['admin', 'coach'],
          teams: []
        }
      ];

      await Promise.all([
        setDoc(metadataRef, initialMeta),
        setDoc(membersRef, { members: initialMembers })
      ]);

      setClubs(updatedClubs);
      setClubMetadata(initialMeta);
      setMembers(initialMembers);
      selectedClubIdRef.current = clubId;
      setSelectedClub(newClub);

      if (onSelectActiveTeam) {
        onSelectActiveTeam(newClub.id, 'club_global');
      }

      setNewClubName('');
      setActionStatus({ type: 'create', status: 'success', message: `Föreningen "${newClub.name}" skapades framgångsrikt!` });
      setTimeout(() => setActionStatus({ type: 'create', status: 'idle' }), 3000);
    } catch (err) {
      console.error('Failed to create club:', err);
      setActionStatus({ type: 'create', status: 'error', message: 'Kunde inte skapa föreningen. Försök igen.' });
    }
  };

  // Add new team to selected club
  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClub || !newTeamName.trim()) return;

    setActionStatus({ type: 'save', status: 'loading' });
    try {
      const teamId = 'team_' + Math.random().toString(36).substring(2, 11);
      const newTeam: ClubTeam = {
        id: teamId,
        name: newTeamName.trim()
      };

      const baseMeta: ClubMetadata = (clubMetadata && clubMetadata.id === selectedClub.id)
        ? clubMetadata
        : { id: selectedClub.id, name: selectedClub.name, teams: [] };

      const updatedTeams = [...(baseMeta.teams || []), newTeam];
      const updatedMeta: ClubMetadata = { ...baseMeta, teams: updatedTeams };

      // Ensure active user member record has teamId included in their teams array
      let updatedMembers = [...members];
      if (updatedMembers.length === 0) {
        updatedMembers = [{
          userId: userId,
          email: userEmail,
          fullName: userEmail.split('@')[0],
          roles: ['admin', 'coach'],
          teams: [teamId]
        }];
      } else {
        updatedMembers = updatedMembers.map(m => {
          if (m.userId === userId || (m.email && m.email.trim().toLowerCase() === userEmail.trim().toLowerCase())) {
            const currentTeams = m.teams || [];
            if (!currentTeams.includes(teamId)) {
              return { ...m, teams: [...currentTeams, teamId] };
            }
          }
          return m;
        });
      }

      const metadataRef = doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'metadata');
      const membersRef = doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members');

      await Promise.all([
        setDoc(metadataRef, updatedMeta),
        setDoc(membersRef, { members: updatedMembers })
      ]);
      
      setClubMetadata(updatedMeta);
      setMembers(updatedMembers);
      setNewTeamName('');

      // Always set newly created team as active team
      if (onSelectActiveTeam) {
        onSelectActiveTeam(selectedClub.id, newTeam.id);
      }

      setActionStatus({ type: 'save', status: 'success', message: `Laget "${newTeam.name}" har lagts till!` });
      setTimeout(() => setActionStatus({ type: 'save', status: 'idle' }), 3000);
    } catch (err) {
      console.error('Failed to add team:', err);
      setActionStatus({ type: 'save', status: 'error', message: 'Kunde inte lägga till laget.' });
    }
  };

  // Process and parse raw imported rows for Members & Squads
  const processParsedImportRows = (rows: string[][], overrideRoleMode?: 'auto' | 'force_player' | 'force_coach') => {
    const roleMode = overrideRoleMode || importRoleMode;
    const result: Array<{
      id: string;
      fullName: string;
      email: string;
      phone: string;
      personnummer: string;
      role: 'coach' | 'player';
      position?: string;
      number?: string;
      photoUrl?: string;
    }> = [];

    const leaderKeywords = [
      'tränare', 'ledare', 'lagledare', 'coach', 'manager', 'materialförvaltare', 
      'materialare', 'kiropraktor', 'fysio', 'physio', 'fysioterapeut', 'naprapat', 'massör',
      'analytiker', 'läkare', 'fys', 'assisterande', 'huvudtränare', 'målvaktstränare', 'fystränare', 'ledarskap'
    ];

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const rawRow = rows[rowIdx];
      if (!rawRow || rawRow.length === 0) continue;

      const cells = rawRow.map(c => String(c || '').trim());
      const lineText = cells.join(' ').toLowerCase();

      // Skip header
      if (rowIdx === 0 && (lineText.includes('namn') || lineText.includes('e-post') || lineText.includes('email') || lineText.includes('telefon') || lineText.includes('roll'))) {
        continue;
      }

      let fullName = '';
      let email = '';
      let phone = '';
      let personnummer = '';
      let position = '';
      let number = '';
      let photoUrl = '';
      let isLeader = false;

      for (const cell of cells) {
        if (!cell) continue;

        // Photo URL / Image
        if (cell.startsWith('http://') || cell.startsWith('https://') || cell.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|svg)($|\?)/i.test(cell)) {
          photoUrl = cell;
          continue;
        }

        // Email
        if (cell.includes('@') && cell.includes('.')) {
          email = cell.toLowerCase();
          continue;
        }

        // Phone
        if (/^[\+\d\s\-]{7,16}$/.test(cell) && !/^\d{10,12}$/.test(cell.replace(/\D/g, ''))) {
          phone = cell;
          continue;
        }

        // Personnummer
        const digitsOnly = cell.replace(/\D/g, '');
        if ((digitsOnly.length === 10 || digitsOnly.length === 12) && (cell.includes('-') || /^(19|20)\d{8,10}$/.test(cell) || /^\d{6}\-\d{4}$/.test(cell))) {
          personnummer = cell;
          continue;
        }

        // Role / Position
        const lowerCell = cell.toLowerCase();
        if (leaderKeywords.some(kw => lowerCell.includes(kw))) {
          isLeader = true;
          position = cell;
          continue;
        }

        // Jersey number
        if (/^\d{1,3}$/.test(cell) && parseInt(cell) <= 99 && !number) {
          number = cell;
          continue;
        }

        // Name
        if (!fullName && cell.length >= 2 && !/^\d+$/.test(cell)) {
          fullName = cell;
        } else if (fullName && !position && cell.length <= 15 && !/^\d+$/.test(cell)) {
          position = cell;
        }
      }

      if (!fullName) continue;

      let finalRole: 'coach' | 'player' = isLeader ? 'coach' : 'player';
      if (roleMode === 'force_player') finalRole = 'player';
      if (roleMode === 'force_coach') finalRole = 'coach';

      result.push({
        id: crypto.randomUUID(),
        fullName,
        email,
        phone,
        personnummer,
        role: finalRole,
        position: position || undefined,
        number: number || undefined,
        photoUrl: photoUrl || undefined
      });
    }

    setParsedImportMembers(result);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        complete: (results) => {
          const rows = results.data as string[][];
          processParsedImportRows(rows);
        },
        header: false
      });
    } else if (extension === 'xlsx' || extension === 'xls') {
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
        processParsedImportRows(data);
      };
      reader.readAsBinaryString(file);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteImport = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim());
    const rows = lines.map(line => {
      if (line.includes('\t')) return line.split('\t');
      if (line.includes(';')) return line.split(';');
      if (line.includes(',')) return line.split(',');
      return [line];
    });
    processParsedImportRows(rows);
  };

  // Execute import to global club members + team squads
  const handleExecuteImport = async () => {
    if (!selectedClub || parsedImportMembers.length === 0) return;
    if (importSelectedTeamIds.length === 0) {
      alert("Välj minst ett lag som de importerade personerna ska kopplas till.");
      return;
    }

    setIsProcessingImport(true);
    try {
      const membersRef = doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members');
      const membersSnap = await getDoc(membersRef);
      let currentMembers: ClubMember[] = membersSnap.exists() ? (membersSnap.data().members || []) : [];
      currentMembers = deduplicateClubMembers(currentMembers);

      let countNew = 0;
      let countUpdated = 0;

      for (const item of parsedImportMembers) {
        const cleanName = item.fullName.trim();
        const cleanEmail = item.email.trim().toLowerCase();
        const cleanPnr = (item.personnummer || '').replace(/\D/g, '');
        const cleanNum = (item.number || '').trim();

        const idx = currentMembers.findIndex(m => {
          const mEmail = (m.email || '').trim().toLowerCase();
          const mName = (m.fullName || '').trim().toLowerCase();
          const mPnr = (m.personnummer || '').replace(/\D/g, '');
          const mNum = (m.number || '').trim();

          if (item.id && m.userId === item.id) return true;
          if (cleanPnr && mPnr && cleanPnr === mPnr) return true;
          if (cleanEmail && mEmail === cleanEmail) return true;
          if (mName === cleanName.toLowerCase()) {
            if (cleanNum && mNum) return cleanNum === mNum;
            return true;
          }
          return false;
        });

        if (idx !== -1) {
          if (importDuplicateMode === 'skip') {
            continue;
          }

          if (importDuplicateMode === 'merge') {
            const existing = currentMembers[idx];
            const existingRoles = existing.roles || [];
            const existingTeams = existing.teams || [];

            const updatedRoles = Array.from(new Set([...existingRoles, item.role]));
            const updatedTeams = Array.from(new Set([...existingTeams, ...importSelectedTeamIds]));

            currentMembers[idx] = {
              ...existing,
              fullName: cleanName,
              email: item.email || existing.email || '',
              phone: item.phone || existing.phone,
              personnummer: item.personnummer || existing.personnummer,
              position: item.position || existing.position,
              number: item.number || existing.number,
              photoUrl: item.photoUrl || existing.photoUrl,
              roles: updatedRoles,
              teams: updatedTeams
            };
            countUpdated++;
          } else if (importDuplicateMode === 'add_all') {
            currentMembers.push({
              userId: 'player_' + Math.random().toString(36).substring(2, 10),
              email: item.email || '',
              fullName: cleanName,
              phone: item.phone || undefined,
              personnummer: item.personnummer || undefined,
              position: item.position || undefined,
              number: item.number || undefined,
              photoUrl: item.photoUrl || undefined,
              roles: [item.role],
              teams: [...importSelectedTeamIds]
            });
            countNew++;
          }
        } else {
          const newMember: ClubMember = {
            userId: item.id || 'player_' + Math.random().toString(36).substring(2, 10),
            email: item.email || '',
            fullName: cleanName,
            phone: item.phone || undefined,
            personnummer: item.personnummer || undefined,
            position: item.position || undefined,
            number: item.number || undefined,
            photoUrl: item.photoUrl || undefined,
            roles: [item.role],
            teams: [...importSelectedTeamIds]
          };
          currentMembers.push(newMember);
          countNew++;
        }
      }

      currentMembers = deduplicateClubMembers(currentMembers);
      await setDoc(membersRef, { members: currentMembers, updatedAt: Date.now() });
      setMembers(currentMembers);

      // Sync into each selected team's squad document
      for (const teamId of importSelectedTeamIds) {
        try {
          const squadRef = doc(db, 'clubs', selectedClub.id, 'teams', teamId, 'data', 'squad');
          const squadSnap = await getDoc(squadRef);
          let teamSquad: SquadPlayer[] = squadSnap.exists() ? (squadSnap.data().squad || []) : [];
          teamSquad = deduplicateSquad(teamSquad);

          for (const item of parsedImportMembers) {
            const cleanName = item.fullName.trim();
            const cleanEmail = item.email.trim().toLowerCase();
            const cleanPnr = (item.personnummer || '').replace(/\D/g, '');
            const cleanNum = (item.number || '').trim();
            const targetSquadRole: 'leader' | 'player' = item.role === 'coach' ? 'leader' : 'player';

            const spIdx = teamSquad.findIndex(sp => {
              const spEmail = (sp.email || '').trim().toLowerCase();
              const spName = (sp.name || '').trim().toLowerCase();
              const spPnr = (sp.personnummer || '').replace(/\D/g, '');
              const spNum = (sp.number || '').trim();

              if (item.id && sp.id === item.id) return true;
              if (cleanPnr && spPnr && cleanPnr === spPnr) return true;
              if (cleanEmail && spEmail === cleanEmail) return true;
              if (spName === cleanName.toLowerCase()) {
                if (cleanNum && spNum) return cleanNum === spNum;
                return true;
              }
              return false;
            });

            if (spIdx !== -1) {
              if (importDuplicateMode === 'skip') continue;
              if (importDuplicateMode === 'merge') {
                teamSquad[spIdx] = {
                  ...teamSquad[spIdx],
                  name: cleanName,
                  email: item.email || teamSquad[spIdx].email,
                  phone: item.phone || teamSquad[spIdx].phone,
                  personnummer: item.personnummer || teamSquad[spIdx].personnummer,
                  role: targetSquadRole,
                  position: item.position || teamSquad[spIdx].position,
                  number: item.number || teamSquad[spIdx].number,
                  photoUrl: item.photoUrl || teamSquad[spIdx].photoUrl
                };
              } else if (importDuplicateMode === 'add_all') {
                teamSquad.push({
                  id: crypto.randomUUID(),
                  name: cleanName,
                  email: item.email || undefined,
                  phone: item.phone || undefined,
                  personnummer: item.personnummer || undefined,
                  role: targetSquadRole,
                  position: item.position || undefined,
                  number: item.number || undefined,
                  photoUrl: item.photoUrl || undefined
                });
              }
            } else {
              teamSquad.push({
                id: item.id || crypto.randomUUID(),
                name: cleanName,
                email: item.email || undefined,
                phone: item.phone || undefined,
                personnummer: item.personnummer || undefined,
                role: targetSquadRole,
                position: item.position || undefined,
                number: item.number || undefined,
                photoUrl: item.photoUrl || undefined
              });
            }
          }

          teamSquad = deduplicateSquad(teamSquad);
          await setDoc(squadRef, { squad: teamSquad, updatedAt: Date.now() });

          if (activeTeamId === teamId && onUpdateSquad) {
            onUpdateSquad(teamSquad);
          }
        } catch (err) {
          console.error(`Failed to sync squad for team ${teamId}:`, err);
        }
      }

      setShowImportModal(false);
      setParsedImportMembers([]);
      setImportPasteText('');
      setActionStatus({
        type: 'save',
        status: 'success',
        message: `Importering klar! ${countNew} nya och ${countUpdated} uppdaterade medlemmar sparades och synkades till dina valda lag.`
      });

      // Auto-generate accounts & usernames for all imported members
      try {
        if (currentMembers.length > 0) {
          const payload = currentMembers.map(m => ({
            id: m.userId,
            name: m.fullName,
            email: m.email,
            role: m.roles?.includes('admin') ? 'Admin' : m.roles?.includes('coach') ? 'Tränare' : 'Spelare'
          }));
          fetch(getApiUrl('/api/admin/users/bulk-generate'), {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ members: payload })
          }).then(() => fetchUserAccounts()).catch(err => console.error(err));
        }
      } catch (e) {
        console.error('Import account auto gen error:', e);
      }

      setTimeout(() => setActionStatus({ type: 'save', status: 'idle' }), 4000);
    } catch (err) {
      console.error('Failed to execute import:', err);
      setActionStatus({ type: 'save', status: 'error', message: 'Kunde inte genomföra importeringen.' });
    } finally {
      setIsProcessingImport(false);
    }
  };

  // Delete a team from the club
  const handleDeleteTeam = async (teamId: string) => {
    if (!selectedClub || !clubMetadata) return;
    const team = clubMetadata.teams.find(t => t.id === teamId);
    if (!team) return;

    if (!window.confirm(`Är du säker på att du vill ta bort laget "${team.name}"? Det tar inte bort sparad träningsdata, men laget kopplas bort från klubben.`)) {
      return;
    }

    try {
      const updatedTeams = clubMetadata.teams.filter(t => t.id !== teamId);
      const updatedMeta = { ...clubMetadata, teams: updatedTeams };

      // Also clean up references in member profiles
      const updatedMembers = members.map(m => ({
        ...m,
        teams: m.teams.filter(tid => tid !== teamId)
      }));

      await Promise.all([
        setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'metadata'), updatedMeta),
        setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members'), { members: updatedMembers })
      ]);

      setClubMetadata(updatedMeta);
      setMembers(updatedMembers);
    } catch (err) {
      console.error('Failed to delete team:', err);
      alert('Misslyckades att ta bort laget.');
    }
  };

  // Open member dialog for creating or editing
  const openMemberForm = (member: ClubMember | null = null) => {
    setActionStatus({ type: 'save', status: 'idle' });
    if (member) {
      setEditingMember(member);
      const emailVal = member.email && !member.email.includes('@noemail.local') ? member.email : '';
      setMemberEmail(emailVal);
      setMemberName(member.fullName || '');
      setMemberPhone(member.phone || '');
      setMemberPersonnummer(member.personnummer || '');
      setMemberPosition(member.position || '');
      setMemberNumber(member.number || '');
      setMemberPhotoUrl(member.photoUrl || '');
      setMemberRoles(member.roles && member.roles.length > 0 ? member.roles : ['player']);
      setMemberTeams(member.teams || []);
    } else {
      setEditingMember(null);
      setMemberEmail('');
      setMemberName('');
      setMemberPhone('');
      setMemberPersonnummer('');
      setMemberPosition('');
      setMemberNumber('');
      setMemberPhotoUrl('');
      setMemberRoles(['player']);
      setMemberTeams([]);
    }
    setShowMemberForm(true);
  };

  // Save member
  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClub) {
      setActionStatus({ type: 'save', status: 'error', message: 'Ingen förening är vald.' });
      return;
    }

    const cleanName = memberName.trim();
    if (!cleanName) {
      setActionStatus({ type: 'save', status: 'error', message: 'Vänligen ange medlemmens fullständiga namn.' });
      return;
    }

    let cleanEmail = memberEmail.trim().toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setActionStatus({ type: 'save', status: 'error', message: 'Ange en giltig e-postadress (t.ex. namn@exempel.se) eller lämna fältet tomt.' });
      return;
    }

    setActionStatus({ type: 'save', status: 'loading' });
    try {
      let updatedMembers = [...members];
      const targetUserId = editingMember?.userId || 'user_' + Math.random().toString(36).substring(2, 11);

      if (!cleanEmail) {
        cleanEmail = `${targetUserId}@noemail.local`;
      }

      const displayEmail = cleanEmail.includes('@noemail.local') ? '' : cleanEmail;

      const newOrUpdatedMember: ClubMember = {
        userId: targetUserId,
        email: displayEmail || cleanEmail,
        fullName: cleanName,
        phone: memberPhone.trim() || undefined,
        personnummer: memberPersonnummer.trim() || undefined,
        position: memberPosition.trim() || undefined,
        number: memberNumber.trim() || undefined,
        photoUrl: memberPhotoUrl.trim() || undefined,
        roles: memberRoles && memberRoles.length > 0 ? memberRoles : ['player'],
        teams: memberTeams
      };

      if (editingMember) {
        const origUserId = editingMember.userId;
        const origEmail = editingMember.email ? editingMember.email.trim().toLowerCase() : '';
        const origName = editingMember.fullName ? editingMember.fullName.trim().toLowerCase() : '';

        // Filter out ALL existing duplicate entries for this person so no stale duplicate corrupts the save
        updatedMembers = updatedMembers.filter(m => {
          const mUserId = m.userId;
          const mEmail = m.email ? m.email.trim().toLowerCase() : '';
          const mName = m.fullName ? m.fullName.trim().toLowerCase() : '';

          if (origUserId && mUserId === origUserId) return false;
          if (origEmail && !origEmail.includes('@noemail.local') && mEmail === origEmail) return false;
          if (origName && mName === origName.toLowerCase()) return false;
          if (displayEmail && mEmail === displayEmail.toLowerCase()) return false;
          if (cleanName && mName === cleanName.toLowerCase()) return false;
          return true;
        });

        updatedMembers.push(newOrUpdatedMember);
      } else {
        // Adding new
        if (displayEmail && updatedMembers.some(m => m.email && m.email.trim().toLowerCase() === displayEmail.toLowerCase())) {
          setActionStatus({ type: 'save', status: 'error', message: 'En medlem med denna e-postadress finns redan i föreningen!' });
          return;
        }
        updatedMembers.push(newOrUpdatedMember);
      }

      // Deduplicate members list to ensure no duplicate entries exist
      updatedMembers = deduplicateClubMembers(updatedMembers);

      await setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members'), { 
        members: updatedMembers,
        updatedAt: Date.now()
      });
      
      // Also sync member into each team's squad
      if (clubMetadata?.teams) {
        for (const team of clubMetadata.teams) {
          const teamId = team.id;
          const isAssigned = memberTeams.includes(teamId);

          try {
            const squadRef = doc(db, 'clubs', selectedClub.id, 'teams', teamId, 'data', 'squad');
            const squadSnap = await getDoc(squadRef);
            let teamSquad: SquadPlayer[] = squadSnap.exists() ? (squadSnap.data().squad || []) : [];

            const isLeader = newOrUpdatedMember.roles.includes('coach') || newOrUpdatedMember.roles.includes('admin');
            const role: 'leader' | 'player' = isLeader ? 'leader' : 'player';

            // Filter out any stale duplicate entries for this player in team squad
            teamSquad = teamSquad.filter(sp => {
              const spEmail = (sp.email || '').trim().toLowerCase();
              const spName = (sp.name || '').trim().toLowerCase();

              if (newOrUpdatedMember.userId && sp.id === newOrUpdatedMember.userId) return false;
              if (displayEmail && spEmail === displayEmail.toLowerCase()) return false;
              if (cleanName && spName === cleanName.toLowerCase()) return false;
              return true;
            });

            if (isAssigned) {
              teamSquad.push({
                id: newOrUpdatedMember.userId,
                name: newOrUpdatedMember.fullName,
                email: displayEmail || undefined,
                phone: newOrUpdatedMember.phone,
                personnummer: newOrUpdatedMember.personnummer,
                position: newOrUpdatedMember.position,
                number: newOrUpdatedMember.number,
                photoUrl: newOrUpdatedMember.photoUrl,
                role
              });
            }

            teamSquad = deduplicateSquad(teamSquad);
            await setDoc(squadRef, { squad: teamSquad, updatedAt: Date.now() });

            if (activeTeamId === teamId && onUpdateSquad) {
              onUpdateSquad(teamSquad);
            }
          } catch (err) {
            console.error(`Error syncing member to team squad for ${teamId}:`, err);
          }
        }
      }

      setMembers(updatedMembers);
      setActionStatus({ 
        type: 'save', 
        status: 'success', 
        message: editingMember ? 'Medlemsuppgifter och roller uppdaterade!' : 'Medlem tillagd i föreningen och laget!' 
      });

      // Auto-generate/sync user account in backend
      try {
        const syncEmail = displayEmail || `${targetUserId}@member.coachassist.app`;
        fetch(getApiUrl('/api/admin/users/bulk-generate'), {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            members: [{
              id: newOrUpdatedMember.userId,
              name: newOrUpdatedMember.fullName,
              email: syncEmail,
              role: newOrUpdatedMember.roles?.includes('admin') ? 'Admin' : newOrUpdatedMember.roles?.includes('coach') ? 'Tränare' : 'Spelare'
            }]
          })
        }).then(() => fetchUserAccounts()).catch(err => console.error(err));
      } catch (e) {
        console.error('Account auto sync error:', e);
      }

      // Close modal after brief success confirmation so user sees feedback
      setTimeout(() => {
        setShowMemberForm(false);
        setActionStatus({ type: 'save', status: 'idle' });
      }, 1200);
    } catch (err: any) {
      console.error('Failed to save member:', err);
      setActionStatus({ 
        type: 'save', 
        status: 'error', 
        message: 'Kunde inte spara medlemmen. ' + (err?.message || 'Kontrollera anslutningen och försök igen.') 
      });
    }
  };

  // Delete a member
  const handleDeleteMember = async (memberEmailToDelete: string) => {
    if (!selectedClub) return;
    if (memberEmailToDelete.toLowerCase() === userEmail.toLowerCase()) {
      alert("Du kan inte ta bort din egen administratörsrättighet från panelen.");
      return;
    }

    if (!window.confirm(`Är du säker på att du vill ta bort medlemmen med e-post ${memberEmailToDelete} från föreningen?`)) {
      return;
    }

    try {
      const updatedMembers = members.filter(m => m.email !== memberEmailToDelete);
      await setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members'), { members: updatedMembers });
      
      setMembers(updatedMembers);
    } catch (err) {
      console.error('Failed to delete member:', err);
      alert('Kunde inte ta bort medlemmen.');
    }
  };

  // Helper toggle role list
  const toggleRole = (role: 'admin' | 'coach' | 'player' | 'parent') => {
    if (memberRoles.includes(role)) {
      setMemberRoles(memberRoles.filter(r => r !== role));
    } else {
      setMemberRoles([...memberRoles, role]);
    }
  };

  // Helper toggle team assignment
  const toggleTeamAssignment = (teamId: string) => {
    if (memberTeams.includes(teamId)) {
      setMemberTeams(memberTeams.filter(tid => tid !== teamId));
    } else {
      setMemberTeams([...memberTeams, teamId]);
    }
  };

  // Member role counts for quick filtering pills
  const roleCounts = useMemo(() => {
    const counts = {
      all: members.length,
      admin: 0,
      coach: 0,
      player: 0,
      parent: 0,
      unassigned: 0
    };
    members.forEach(m => {
      if (m.roles?.includes('admin')) counts.admin++;
      if (m.roles?.includes('coach')) counts.coach++;
      if (m.roles?.includes('player')) counts.player++;
      if (m.roles?.includes('parent')) counts.parent++;
      if (!m.teams || m.teams.length === 0) counts.unassigned++;
    });
    return counts;
  }, [members]);

  // Filter and sort members
  const filteredMembers = useMemo(() => {
    return members
      .filter(m => {
        // 1. Text Search Query
        const query = memberSearchQuery.toLowerCase().trim();
        if (query) {
          const matchName = m.fullName ? m.fullName.toLowerCase().includes(query) : false;
          const matchEmail = m.email && !m.email.includes('@noemail.local') && m.email.toLowerCase().includes(query);
          const matchPhone = m.phone && m.phone.includes(query);
          const matchPnr = m.personnummer && m.personnummer.includes(query);
          const matchNumber = m.number && m.number.toString().includes(query);
          const matchPosition = m.position && m.position.toLowerCase().includes(query);
          if (!matchName && !matchEmail && !matchPhone && !matchPnr && !matchNumber && !matchPosition) {
            return false;
          }
        }

        // 2. Role Filter
        if (memberRoleFilter !== 'all') {
          if (!m.roles || !m.roles.includes(memberRoleFilter)) {
            return false;
          }
        }

        // 3. Team Filter
        if (memberTeamFilter === 'unassigned') {
          if (m.teams && m.teams.length > 0) return false;
        } else if (memberTeamFilter !== 'all') {
          if (!m.teams || !m.teams.includes(memberTeamFilter)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (memberSortBy === 'name-asc') {
          return (a.fullName || '').localeCompare(b.fullName || '', 'sv');
        }
        if (memberSortBy === 'name-desc') {
          return (b.fullName || '').localeCompare(a.fullName || '', 'sv');
        }
        if (memberSortBy === 'number') {
          const numA = typeof a.number === 'number' ? a.number : parseInt(a.number || '999', 10);
          const numB = typeof b.number === 'number' ? b.number : parseInt(b.number || '999', 10);
          return numA - numB;
        }
        if (memberSortBy === 'role') {
          const roleOrder: Record<string, number> = { admin: 1, coach: 2, player: 3, parent: 4 };
          const getMinRole = (roles?: string[]) => {
            if (!roles || roles.length === 0) return 99;
            return Math.min(...roles.map(r => roleOrder[r] || 50));
          };
          return getMinRole(a.roles) - getMinRole(b.roles);
        }
        if (memberSortBy === 'team') {
          const teamA = a.teams && a.teams.length > 0 ? a.teams[0] : 'zzz';
          const teamB = b.teams && b.teams.length > 0 ? b.teams[0] : 'zzz';
          return teamA.localeCompare(teamB, 'sv');
        }
        return 0;
      });
  }, [members, memberSearchQuery, memberRoleFilter, memberTeamFilter, memberSortBy]);

  return (
    <div className="w-full max-w-6xl mx-auto p-1.5 sm:p-6 min-w-0 overflow-x-hidden" id="club-admin-dashboard">
      {/* Upper Navigation & Club Select Panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl sm:rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-3.5 sm:p-7 mb-6 w-full min-w-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-zinc-100 dark:border-zinc-800 w-full min-w-0">
          <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 cursor-pointer active:scale-95 transition-all shrink-0"
                title="Tillbaka till profil"
              >
                <ArrowRight size={18} className="rotate-180" />
              </button>
            )}
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Shield size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-lg sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tight break-words">Klubb- & Lagadministration</h1>
                {isRootAdmin && (
                  <span className="text-[10px] font-black uppercase tracking-wider bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md border border-red-100/40 dark:border-red-900/40 animate-pulse">
                    Root Admin
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate">Skala din verksamhet, hantera medlemsroller och skapa nya lag.</p>
            </div>
          </div>

          {/* Club Dropdown */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
            <label className="text-[11px] sm:text-xs font-black uppercase text-zinc-400 shrink-0">Välj förening:</label>
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
              <select
                value={selectedClub?.id || ''}
                onChange={(e) => {
                  const found = clubs.find(c => c.id === e.target.value);
                  if (found) handleSelectClub(found);
                }}
                className="w-full sm:w-auto px-3.5 py-2 sm:py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl font-bold text-xs sm:text-sm focus:outline-none focus:border-indigo-500 cursor-pointer min-w-0 truncate"
              >
                {clubs.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {clubs.length === 0 && <option value="">Inga föreningar skapade</option>}
              </select>

              {selectedClub && (
                selectedClub.id === activeClubId ? (
                  <span className="px-2.5 py-1.5 text-[11px] sm:text-xs font-extrabold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl flex items-center gap-1.5 shrink-0">
                    <Check size={14} />
                    <span className="hidden sm:inline">Aktiv förening</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelectClub(selectedClub)}
                    className="px-3 py-1.5 text-[11px] sm:text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm cursor-pointer shrink-0 transition-all flex items-center gap-1"
                  >
                    <span>Välj som aktiv</span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-1.5 sm:gap-2 mt-3.5 sm:mt-5 overflow-x-auto pb-2 no-scrollbar w-full min-w-0 snap-x">
          {isRootAdmin && (
            <button
              onClick={() => setActiveTab('clubs')}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all cursor-pointer shrink-0 ${
                activeTab === 'clubs'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                  : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <Landmark size={16} />
              <span>Skapa Förening</span>
            </button>
          )}
          
          <button
            disabled={!selectedClub}
            onClick={() => setActiveTab('teams')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 ${
              activeTab === 'teams'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Settings size={16} />
            <span>Hantera Lag ({clubMetadata?.teams?.length || 0})</span>
          </button>

          <button
            disabled={!selectedClub}
            onClick={() => setActiveTab('members')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 ${
              activeTab === 'members'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Users size={16} />
            <span>Medlemmar & Roller ({members.length})</span>
          </button>

          <button
            disabled={!selectedClub}
            onClick={() => setActiveTab('user_accounts')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 ${
              activeTab === 'user_accounts'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Key size={16} />
            <span>Konto & Lösenord ({allMemberAccounts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('calendar_sync')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all cursor-pointer shrink-0 ${
              activeTab === 'calendar_sync'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Calendar size={16} />
            <span>Kalender & Webb</span>
          </button>

          <button
            onClick={() => setActiveTab('pwa_icons')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all cursor-pointer shrink-0 ${
              activeTab === 'pwa_icons'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Smartphone size={16} />
            <span>PWA-Ikonpaket</span>
          </button>

          <button
            onClick={() => setActiveTab('database_env')}
            className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all cursor-pointer shrink-0 ${
              activeTab === 'database_env'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100 dark:shadow-none'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-100 dark:border-zinc-850'
            }`}
          >
            <Database size={16} />
            <span>Databas & Molnsynk</span>
          </button>

          {isRootAdmin && (
            <button
              onClick={() => setActiveTab('root_admins')}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all cursor-pointer shrink-0 ${
                activeTab === 'root_admins'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-100 dark:shadow-none'
                  : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-100 dark:border-zinc-850'
              }`}
            >
              <Shield size={16} />
              <span>System-Admins ({rootAdminsList.length || 2})</span>
            </button>
          )}
        </div>
      </div>

      {/* ACTION ALERTS */}
      {actionStatus.status === 'success' && actionStatus.message && (
        <div className="p-4 mb-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-sm flex items-center gap-2">
          <Check size={18} className="shrink-0" />
          <span>{actionStatus.message}</span>
        </div>
      )}
      {actionStatus.status === 'error' && actionStatus.message && (
        <div className="p-4 mb-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 font-bold text-sm flex items-center gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <span>{actionStatus.message}</span>
        </div>
      )}

      {/* CLUBS TAB */}
      {activeTab === 'clubs' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-5 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-2">Ny förening</h2>
            <p className="text-xs text-zinc-500 mb-5 font-medium leading-relaxed">Lägg till en ny fristående klubb i systemet för att börja lägga upp trupper och lag.</p>
            
            <form onSubmit={handleCreateClub} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-400 uppercase tracking-wider mb-2">Föreningens Namn</label>
                <input
                  type="text"
                  required
                  placeholder="t.ex. IFK Göteborg"
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                />
              </div>
              
              <button
                type="submit"
                disabled={actionStatus.status === 'loading'}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-5 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <PlusCircle size={16} />
                <span>Registrera Förening</span>
              </button>
            </form>
          </div>

          <div className="md:col-span-7 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-5">Registrerade Föreningar</h2>
            {clubs.length > 0 ? (
              <div className="space-y-3">
                {clubs.map(c => {
                  const isActive = c.id === activeClubId;
                  const isSelected = selectedClub?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => handleSelectClub(c)}
                      className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50/30 border-indigo-500 dark:bg-indigo-950/10 dark:border-indigo-500/50 shadow-sm'
                          : 'bg-zinc-50 hover:bg-zinc-100/60 dark:bg-zinc-950 dark:hover:bg-zinc-950/60 border-zinc-150 dark:border-zinc-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-indigo-55/10 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                          <Landmark size={20} />
                        </div>
                        <div>
                          <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white">{c.name}</h3>
                          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5">ID: {c.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-xs flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-100 dark:border-emerald-950/40">
                            <Check size={12} />
                            <span>Aktiv förening</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectClub(c);
                            }}
                            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-bold text-xs bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-950/40 transition-all cursor-pointer"
                          >
                            Välj som aktiv
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-400 dark:text-zinc-500">
                <Landmark size={40} className="mx-auto mb-3" />
                <p className="text-xs font-bold">Inga föreningar registrerade än.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TEAMS TAB */}
      {activeTab === 'teams' && selectedClub && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-5 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-2">Nytt lag i {selectedClub.name}</h2>
            <p className="text-xs text-zinc-500 mb-5 font-medium leading-relaxed">Varje förening kan rymma flera olika åldersgrupper eller representationslag.</p>

            <form onSubmit={handleAddTeam} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-400 uppercase tracking-wider mb-2">Lagets Namn</label>
                <input
                  type="text"
                  required
                  placeholder="t.ex. Pojkar 2012 eller Damlaget"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-5 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <PlusCircle size={16} />
                <span>Lägg till lag</span>
              </button>
            </form>
          </div>

          <div className="md:col-span-7 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-5">Aktiva Lag ({clubMetadata?.teams?.length || 0})</h2>
            {clubMetadata?.teams && clubMetadata.teams.length > 0 ? (
              <div className="space-y-3">
                {clubMetadata.teams.map(team => (
                  <div
                    key={team.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 rounded-2xl border border-zinc-150 dark:border-zinc-800 bg-zinc-55/30 dark:bg-zinc-950 gap-3 min-w-0"
                  >
                    <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-55/10 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Settings size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white truncate">{team.name}</h3>
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5 truncate">ID: {team.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-100 dark:border-zinc-800/60">
                      {selectedClub.id === activeClubId && team.id === activeTeamId ? (
                        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-black bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                          <Check size={14} />
                          <span>Aktivt lag</span>
                        </span>
                      ) : (
                        onSelectActiveTeam && (
                          <button
                            type="button"
                            onClick={() => onSelectActiveTeam(selectedClub.id, team.id)}
                            className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
                          >
                            Välj som aktivt lag
                          </button>
                        )
                      )}
                      <button
                        onClick={() => handleDeleteTeam(team.id)}
                        className="text-red-500 hover:text-red-650 p-2 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all cursor-pointer"
                        title="Ta bort lag"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-400 dark:text-zinc-500">
                <Settings size={40} className="mx-auto mb-3" />
                <p className="text-xs font-bold">Inga lag skapade för denna förening än.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MEMBERS TAB */}
      {activeTab === 'members' && selectedClub && (
        <div className="space-y-6">
          {/* Members search, filter & sort controls */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl sm:rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-3.5 sm:p-6 w-full min-w-0 space-y-4">
            {/* Search input & Main Action Buttons */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 w-full min-w-0">
              <div className="relative flex-1 w-full min-w-0">
                <span className="absolute left-3.5 top-3 text-zinc-400">
                  <Search size={18} />
                </span>
                <input
                  type="text"
                  placeholder="Sök på namn, e-post, telefon, tröjnummer, position..."
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-9 py-2.5 sm:py-3 bg-zinc-50 hover:bg-zinc-100/50 dark:bg-zinc-950 dark:hover:bg-zinc-950/50 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-500 font-semibold text-xs sm:text-sm min-w-0"
                />
                {memberSearchQuery && (
                  <button
                    onClick={() => setMemberSearchQuery('')}
                    className="absolute right-3 top-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    title="Rensa sökning"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto shrink-0">
                <button
                  onClick={() => {
                    setImportSelectedTeamIds(clubMetadata?.teams?.map(t => t.id) || []);
                    setParsedImportMembers([]);
                    setShowImportModal(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-md shadow-emerald-100 dark:shadow-none w-full sm:w-auto flex-1 sm:flex-none"
                >
                  <Upload size={16} />
                  <span>Importera trupp / medlemmar</span>
                </button>

                <button
                  onClick={() => openMemberForm(null)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none w-full sm:w-auto flex-1 sm:flex-none"
                >
                  <UserPlus size={16} />
                  <span>Lägg till medlem</span>
                </button>
              </div>
            </div>

            {/* Filter Dropdowns & Sorting */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col md:flex-row items-stretch md:items-end justify-between gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1">
                {/* Role Filter */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1">
                    <Filter size={11} className="text-indigo-500" />
                    <span>Roll</span>
                  </label>
                  <select
                    value={memberRoleFilter}
                    onChange={(e) => setMemberRoleFilter(e.target.value as any)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl font-bold text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="all">Alla roller ({roleCounts.all})</option>
                    <option value="player">Spelare ({roleCounts.player})</option>
                    <option value="coach">Tränare / Ledare ({roleCounts.coach})</option>
                    <option value="admin">Föreningsadmin ({roleCounts.admin})</option>
                    <option value="parent">Förälder ({roleCounts.parent})</option>
                  </select>
                </div>

                {/* Team Filter */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1">
                    <Shield size={11} className="text-indigo-500" />
                    <span>Lagtillhörighet</span>
                  </label>
                  <select
                    value={memberTeamFilter}
                    onChange={(e) => setMemberTeamFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl font-bold text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="all">Alla lag</option>
                    <option value="unassigned">Ej i något lag ({roleCounts.unassigned})</option>
                    {clubMetadata?.teams?.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* Sort By */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1">
                    <ArrowUpDown size={11} className="text-indigo-500" />
                    <span>Sortera efter</span>
                  </label>
                  <select
                    value={memberSortBy}
                    onChange={(e) => setMemberSortBy(e.target.value as any)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl font-bold text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="name-asc">Namn (A–Ö)</option>
                    <option value="name-desc">Namn (Ö–A)</option>
                    <option value="role">Roll (Admin → Tränare → Spelare)</option>
                    <option value="number">Tröjnummer (1..99)</option>
                    <option value="team">Första lag</option>
                  </select>
                </div>
              </div>

              {/* Reset button if filters active */}
              {(memberSearchQuery || memberRoleFilter !== 'all' || memberTeamFilter !== 'all' || memberSortBy !== 'name-asc') && (
                <button
                  onClick={() => {
                    setMemberSearchQuery('');
                    setMemberRoleFilter('all');
                    setMemberTeamFilter('all');
                    setMemberSortBy('name-asc');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 justify-center"
                  title="Återställ alla filtreringar"
                >
                  <RotateCcw size={13} />
                  <span>Rensa filter</span>
                </button>
              )}
            </div>

            {/* Quick Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setMemberRoleFilter('all');
                  setMemberTeamFilter('all');
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  memberRoleFilter === 'all' && memberTeamFilter === 'all'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm'
                    : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Alla ({roleCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setMemberRoleFilter('player')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  memberRoleFilter === 'player'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-sky-700 dark:text-sky-300'
                }`}
              >
                Spelare ({roleCounts.player})
              </button>
              <button
                type="button"
                onClick={() => setMemberRoleFilter('coach')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  memberRoleFilter === 'coach'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                Tränare ({roleCounts.coach})
              </button>
              <button
                type="button"
                onClick={() => setMemberRoleFilter('admin')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  memberRoleFilter === 'admin'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                }`}
              >
                Admins ({roleCounts.admin})
              </button>
              {roleCounts.unassigned > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMemberRoleFilter('all');
                    setMemberTeamFilter('unassigned');
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    memberTeamFilter === 'unassigned'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  Ej i något lag ({roleCounts.unassigned})
                </button>
              )}
            </div>
          </div>

          {/* MEMBER DIALOG FORM (FIXED BACKDROP MODAL OVERLAY) */}
          {showMemberForm && (
            <div 
              className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
              onClick={() => setShowMemberForm(false)}
            >
              <div 
                className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 sm:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-auto animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
                  <h3 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white">
                    {editingMember ? 'Redigera medlemsuppgifter' : 'Lägg till ny medlem i föreningen'}
                  </h3>
                  <button
                    onClick={() => setShowMemberForm(false)}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
                    title="Stäng"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleSaveMember} className="space-y-5">
                  {actionStatus.status === 'error' && actionStatus.message && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-bold text-xs flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{actionStatus.message}</span>
                    </div>
                  )}

                  {actionStatus.status === 'success' && actionStatus.message && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-2">
                      <Check size={16} className="shrink-0" />
                      <span>{actionStatus.message}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Medlemmens fullständiga namn</label>
                      <input
                        type="text"
                        required
                        placeholder="t.ex. Kalle Nilsson"
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">E-postadress (Valfritt om inloggning ej används ännu)</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-zinc-400">
                          <Mail size={16} />
                        </span>
                        <input
                          type="text"
                          placeholder="kalle@exempel.se (valfritt)"
                          value={memberEmail}
                          onChange={(e) => setMemberEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Mobilnummer (Valfritt)</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-zinc-400">
                          <Phone size={16} />
                        </span>
                        <input
                          type="tel"
                          placeholder="070-123 45 67"
                          value={memberPhone}
                          onChange={(e) => setMemberPhone(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Personnummer (Valfritt)</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-zinc-400">
                          <Fingerprint size={16} />
                        </span>
                        <input
                          type="text"
                          placeholder="ÅÅÅÅMMDD-XXXX"
                          value={memberPersonnummer}
                          onChange={(e) => setMemberPersonnummer(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Position / Roll (Valfritt)</label>
                      <input
                        type="text"
                        placeholder="t.ex. MV, MB, Forward eller Tränare"
                        value={memberPosition}
                        onChange={(e) => setMemberPosition(e.target.value)}
                        className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Tröjnummer (Valfritt)</label>
                      <input
                        type="text"
                        placeholder="t.ex. 10"
                        value={memberNumber}
                        onChange={(e) => setMemberNumber(e.target.value)}
                        className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Profilbild</label>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
                      <div className="w-16 h-16 rounded-2xl bg-zinc-200 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center shrink-0 overflow-hidden relative shadow-inner">
                        {isUploadingPhoto ? (
                          <Loader2 size={22} className="animate-spin text-indigo-600" />
                        ) : memberPhotoUrl ? (
                          <CachedImage src={memberPhotoUrl} alt="Profilbild" className="w-full h-full object-cover" />
                        ) : (
                          <Users size={28} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 w-full space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shadow-sm">
                            <Camera size={14} />
                            <span>Ladda upp bild</span>
                            <input type="file" className="hidden" accept="image/*" onChange={handleMemberPhotoUpload} />
                          </label>
                          {memberPhotoUrl && (
                            <button
                              type="button"
                              onClick={() => setMemberPhotoUrl('')}
                              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-bold text-xs px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/40 transition-all cursor-pointer"
                            >
                              Ta bort bild
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder="Eller klistra in bild-URL (https://...)"
                          value={memberPhotoUrl}
                          onChange={(e) => setMemberPhotoUrl(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-indigo-500 font-medium text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Role Toggles */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-1">Roll(er) i föreningen</label>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3 font-medium">Bocka i alla roller som gäller för personen (t.ex. både Spelare och Tränare, eller Tränare och Admin).</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {[
                        { id: 'admin', label: 'Föreningsadmin', desc: 'Hantera lag, föreningar och roller.', color: 'purple' },
                        { id: 'coach', label: 'Tränare', desc: 'Skapa och ändra träningar, trupper, laguppställningar.', color: 'emerald' },
                        { id: 'player', label: 'Spelare', desc: 'Kan läsa träningar, se laguppställningar och närvaro.', color: 'sky' },
                        { id: 'parent', label: 'Förälder', desc: 'Se träningar, laguppställningar samt barnets närvaro.', color: 'amber' }
                      ].map(r => {
                        const active = memberRoles.includes(r.id as any);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => toggleRole(r.id as any)}
                            className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                              active
                                ? r.color === 'purple' ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30' :
                                  r.color === 'emerald' ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30' :
                                  r.color === 'sky' ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/30' :
                                  'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30'
                                : 'bg-zinc-50 hover:bg-zinc-100/50 border-zinc-200 dark:bg-zinc-950 dark:hover:bg-zinc-900/60 dark:border-zinc-800'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-extrabold text-xs sm:text-sm text-zinc-900 dark:text-white flex items-center gap-1.5">
                                <span>{r.label}</span>
                              </span>
                              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                active ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                              }`}>
                                {active && <Check size={12} strokeWidth={3} />}
                              </div>
                            </div>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium leading-tight">{r.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Team Assignments */}
                  {clubMetadata?.teams && clubMetadata.teams.length > 0 && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Koppla medlemmen till lag</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {clubMetadata.teams.map(t => {
                          const active = memberTeams.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTeamAssignment(t.id)}
                              className={`py-2.5 px-3 rounded-xl border text-xs font-bold text-center transition-all truncate cursor-pointer ${
                                active
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                  : 'bg-zinc-50 hover:bg-zinc-100/50 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                              }`}
                            >
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-col-reverse sm:flex-row justify-end gap-2.5 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setShowMemberForm(false)}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-extrabold text-xs cursor-pointer text-center"
                    >
                      Avbryt
                    </button>
                    <button
                      type="submit"
                      disabled={actionStatus.status === 'loading'}
                      className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none"
                    >
                      {actionStatus.status === 'loading' ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Sparar uppgifter...</span>
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          <span>Spara medlemsuppgifter</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Members Table / List */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white tracking-tight">
                  Medlemslista ({filteredMembers.length} av {members.length})
                </h2>
                <p className="text-[11px] text-zinc-500 font-medium">
                  {filteredMembers.length === members.length
                    ? 'Visar alla registrerade medlemmar i föreningen'
                    : `Visar ${filteredMembers.length} medlemmar baserat på valda filter`}
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="p-12 text-center text-sm text-zinc-500 font-medium">Laddar medlemmar...</div>
            ) : filteredMembers.length > 0 ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredMembers.map((member, idx) => (
                  <div
                    key={member.userId || member.email || `mem-${idx}`}
                    className="p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/40 transition-all w-full min-w-0"
                  >
                    <div className="flex items-start gap-3 sm:gap-3.5 min-w-0 flex-1">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 flex items-center justify-center shrink-0 overflow-hidden">
                        {member.photoUrl ? (
                          <CachedImage src={member.photoUrl} alt={member.fullName} className="w-full h-full object-cover" />
                        ) : (
                          <Users size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-extrabold text-sm text-zinc-900 dark:text-white leading-tight truncate">{member.fullName}</h4>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-bold min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0 max-w-full">
                            <Mail size={12} className="shrink-0" />
                            <span className="truncate max-w-[200px] sm:max-w-none">{member.email}</span>
                          </span>
                          {member.phone && (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <Phone size={12} />
                              <span>{member.phone}</span>
                            </span>
                          )}
                          {member.personnummer && (
                            <span className="flex items-center gap-1.5 shrink-0 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                              <Fingerprint size={10} />
                              <span>{member.personnummer}</span>
                            </span>
                          )}
                          {member.position && (
                            <span className="flex items-center gap-1 shrink-0 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              <span>{member.position}</span>
                            </span>
                          )}
                          {member.number && (
                            <span className="flex items-center gap-1 shrink-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-black">
                              <span>#{member.number}</span>
                            </span>
                          )}
                        </div>

                        {/* Display member teams */}
                        {clubMetadata?.teams && member.teams && member.teams.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 min-w-0">
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mr-1 mt-0.5">Lag:</span>
                            {member.teams.map(tid => {
                              const t = clubMetadata.teams.find(team => team.id === tid);
                              return t ? (
                                <span key={tid} className="text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded truncate max-w-[120px]">
                                  {t.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Member roles and action buttons */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-100 dark:border-zinc-800/60 w-full sm:w-auto">
                      <div className="flex flex-wrap gap-1.5">
                        {member.roles.map(r => (
                          <span
                            key={r}
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              r === 'admin'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400'
                                : r === 'coach'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                : r === 'player'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                            }`}
                          >
                            {r === 'admin' ? 'Admin' : r === 'coach' ? 'Tränare' : r === 'player' ? 'Spelare' : 'Förälder'}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openMemberForm(member)}
                          className="text-zinc-600 hover:text-indigo-600 dark:text-zinc-400 p-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-all cursor-pointer"
                          title="Redigera medlem"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          disabled={member.email.toLowerCase() === userEmail.toLowerCase()}
                          onClick={() => handleDeleteMember(member.email)}
                          className="text-red-500 hover:text-red-650 p-2 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          title="Ta bort medlem"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 px-4 text-zinc-400 dark:text-zinc-500">
                <Users size={40} className="mx-auto mb-3 opacity-60" />
                <p className="text-sm font-extrabold text-zinc-700 dark:text-zinc-300">Inga medlemmar hittades</p>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
                  Det finns inga medlemmar som matchar din valda sökning eller filtrering.
                </p>
                {(memberSearchQuery || memberRoleFilter !== 'all' || memberTeamFilter !== 'all' || memberSortBy !== 'name-asc') && (
                  <button
                    onClick={() => {
                      setMemberSearchQuery('');
                      setMemberRoleFilter('all');
                      setMemberTeamFilter('all');
                      setMemberSortBy('name-asc');
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all cursor-pointer"
                  >
                    <RotateCcw size={13} />
                    <span>Rensa filter och visa alla</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* IMPORT MEMBERS & SQUAD MODAL */}
          {showImportModal && selectedClub && (
            <div 
              className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
              onClick={() => setShowImportModal(false)}
            >
              <div 
                className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 sm:p-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto my-auto animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                      <Upload size={20} className="text-emerald-600 dark:text-emerald-400" />
                      <span>Importera spelare & ledare till {selectedClub.name}</span>
                    </h3>
                    <p className="text-xs text-zinc-500 font-medium mt-0.5">
                      Ladda upp Excel / CSV eller klistra in en lista. Importerade medlemmar sparas i medlemsregistret och synkas till valda lag.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Source Tabs */}
                  <div className="flex items-center gap-2 p-1 bg-zinc-100 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setImportSourceTab('file')}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        importSourceTab === 'file'
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                      }`}
                    >
                      <FileSpreadsheet size={16} />
                      <span>Excel / CSV Fil</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportSourceTab('paste')}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        importSourceTab === 'paste'
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                      }`}
                    >
                      <FileText size={16} />
                      <span>Klistra in Text</span>
                    </button>
                  </div>

                  {/* Input Controls */}
                  {importSourceTab === 'file' ? (
                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Välj Excel- (.xlsx, .xls) eller CSV-fil</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-zinc-50 dark:bg-zinc-950 hover:bg-emerald-50/20 dark:hover:bg-emerald-950/10 p-8 rounded-2xl text-center cursor-pointer transition-all"
                      >
                        <FileSpreadsheet size={40} className="mx-auto mb-3 text-emerald-600 dark:text-emerald-400" />
                        <p className="text-sm font-extrabold text-zinc-900 dark:text-white">Klicka för att bläddra eller släpp filen här</p>
                        <p className="text-xs text-zinc-400 font-medium mt-1">Stödjer kolumner för Namn, E-post, Telefon, Personnummer, Roll/Position, Tröjnummer</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".xlsx, .xls, .csv"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Klistra in rader (från Excel / Google Sheets / Text)</label>
                      <textarea
                        rows={5}
                        placeholder={"Kalle Nilsson\tkalle@exempel.se\t0701234567\tSpelare\nAnna Svensson\tanna@exempel.se\tTränare"}
                        value={importPasteText}
                        onChange={(e) => {
                          setImportPasteText(e.target.value);
                          handlePasteImport(e.target.value);
                        }}
                        className="w-full p-4 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:border-emerald-500 font-mono text-xs"
                      />
                    </div>
                  )}

                  {/* Team Assignments */}
                  {clubMetadata?.teams && clubMetadata.teams.length > 0 && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                      <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">
                        Välj vilka lag de importerade medlemmarna ska kopplas till
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {clubMetadata.teams.map(t => {
                          const active = importSelectedTeamIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                if (active) {
                                  setImportSelectedTeamIds(importSelectedTeamIds.filter(id => id !== t.id));
                                } else {
                                  setImportSelectedTeamIds([...importSelectedTeamIds, t.id]);
                                }
                              }}
                              className={`py-2.5 px-3 rounded-xl border text-xs font-bold text-center transition-all truncate cursor-pointer ${
                                active
                                  ? 'bg-emerald-50 border-emerald-500 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-500/60'
                                  : 'bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {active ? '✓ ' : ''}{t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Role Detection Mode */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Rolltilldelning</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'auto', label: 'Automatisk (Tränare/Spelare)' },
                        { id: 'force_player', label: 'Tvinga alla som Spelare' },
                        { id: 'force_coach', label: 'Tvinga alla som Tränare' }
                      ].map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setImportRoleMode(m.id as any);
                            if (parsedImportMembers.length > 0) {
                              setParsedImportMembers(prev => prev.map(p => ({
                                ...p,
                                role: m.id === 'force_player' ? 'player' : m.id === 'force_coach' ? 'coach' : p.role
                              })));
                            }
                          }}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all text-center cursor-pointer ${
                            importRoleMode === m.id
                              ? 'bg-indigo-50 border-indigo-500 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duplicate Strategy Option */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">
                      Hantering av befintliga medlemmar (Dubbletter)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'merge', label: 'Slå ihop & Uppdatera', desc: 'Uppdatera befintliga poster och lägg till nya' },
                        { id: 'skip', label: 'Hoppa över befintliga', desc: 'Importera endast helt nya personer' },
                        { id: 'add_all', label: 'Skapa som nya', desc: 'Skapa nya poster för alla rader' }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setImportDuplicateMode(opt.id as any)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            importDuplicateMode === opt.id
                              ? 'bg-emerald-50 border-emerald-500 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-500'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          <div className="font-extrabold text-xs">{opt.label}</div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Parsed Preview Table */}
                  {parsedImportMembers.length > 0 && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider">
                          Förhandsgranskning ({parsedImportMembers.length} personer hittades)
                        </span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                          {parsedImportMembers.filter(p => p.role === 'coach').length} ledare, {parsedImportMembers.filter(p => p.role === 'player').length} spelare
                        </span>
                      </div>

                      <div className="max-h-56 overflow-y-auto overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full min-w-0">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-zinc-100 dark:bg-zinc-950 text-zinc-500 sticky top-0 font-bold">
                            <tr>
                              <th className="p-3">Namn</th>
                              <th className="p-3">Roll</th>
                              <th className="p-3">E-post</th>
                              <th className="p-3">Telefon</th>
                              <th className="p-3">Personnr</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {parsedImportMembers.map((m, idx) => (
                              <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-950/50">
                                <td className="p-3 font-extrabold text-zinc-900 dark:text-white">{m.fullName}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                    m.role === 'coach'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                      : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                  }`}>
                                    {m.role === 'coach' ? 'Tränare/Ledare' : 'Spelare'}
                                  </span>
                                </td>
                                <td className="p-3 text-zinc-600 dark:text-zinc-400 font-medium">{m.email || '-'}</td>
                                <td className="p-3 text-zinc-600 dark:text-zinc-400 font-medium">{m.phone || '-'}</td>
                                <td className="p-3 text-zinc-600 dark:text-zinc-400 font-medium">{m.personnummer || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Submit Actions */}
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setShowImportModal(false)}
                      className="px-5 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      disabled={parsedImportMembers.length === 0 || importSelectedTeamIds.length === 0 || isProcessingImport}
                      onClick={handleExecuteImport}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-6 py-3 rounded-xl text-xs flex items-center gap-2 active:scale-95 transition-all cursor-pointer shadow-md shadow-emerald-100 dark:shadow-none"
                    >
                      {isProcessingImport ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      <span>Importera och Synka Till Lag ({parsedImportMembers.length})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* USER ACCOUNTS & PASSWORDS TAB */}
      {activeTab === 'user_accounts' && selectedClub && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-5 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2.5">
                  <Key size={22} className="text-indigo-600 dark:text-indigo-400" />
                  <span>Konto- & Lösenordshantering</span>
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mt-1 max-w-2xl">
                  Här har du full översikt över alla medlemmars inloggningskonton. Du kan redigera användarnamn, byta lösenord eller slumpa nya tillfälliga lösenord för medlemmar. Aktiva användares lösenord visas säkert dolda (••••••••).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={isBulkGenerating}
                  onClick={() => handleBulkGenerateCredentials(userTeamFilter)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none"
                >
                  {isBulkGenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  <span>Generera användarnamn & lösenord för alla</span>
                </button>
                <button
                  onClick={() => exportAccountsToExcel(filteredMemberAccounts)}
                  className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-emerald-100 dark:shadow-none"
                >
                  <FileSpreadsheet size={15} />
                  <span>Excel (.xlsx)</span>
                </button>
                <button
                  onClick={() => exportAccountsToCSV(filteredMemberAccounts)}
                  className="px-3.5 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer border border-zinc-200 dark:border-zinc-700"
                >
                  <Download size={15} />
                  <span>CSV</span>
                </button>
              </div>
            </div>

            {bulkGenSuccessMsg && (
              <div className="mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 size={16} />
                <span>{bulkGenSuccessMsg}</span>
              </div>
            )}
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 rounded-2xl border border-zinc-150 dark:border-zinc-800 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block mb-1">Totalt Medlemmar</span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-zinc-900 dark:text-white">{allMemberAccounts.length}</span>
                <Users size={18} className="text-zinc-400" />
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 rounded-2xl border border-zinc-150 dark:border-zinc-800 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">Med Användarnamn</span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                  {allMemberAccounts.filter(a => !!a.username).length}
                </span>
                <Fingerprint size={18} className="text-indigo-400" />
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 rounded-2xl border border-zinc-150 dark:border-zinc-800 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-green-600 dark:text-green-400 block mb-1">Inloggade Konton</span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-green-600 dark:text-green-400">
                  {allMemberAccounts.filter(a => a.hasLoggedIn).length}
                </span>
                <UserCheck size={18} className="text-green-500" />
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 rounded-2xl border border-zinc-150 dark:border-zinc-800 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-1">Tillfälliga Lösenord</span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-amber-600 dark:text-amber-400">
                  {allMemberAccounts.filter(a => !a.hasLoggedIn).length}
                </span>
                <Key size={18} className="text-amber-500" />
              </div>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto flex-1">
                {/* Search */}
                <div className="relative w-full sm:w-72">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Sök på namn, användarnamn, e-post, UUID..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-500"
                  />
                  {userSearchQuery && (
                    <button onClick={() => setUserSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Team Filter */}
                {clubMetadata?.teams && clubMetadata.teams.length > 0 && (
                  <select
                    value={userTeamFilter}
                    onChange={(e) => setUserTeamFilter(e.target.value)}
                    className="w-full sm:w-auto px-3.5 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="all">Alla lag i föreningen</option>
                    {clubMetadata.teams.map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Accounts List (Responsive Cards) */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="font-black text-base text-zinc-900 dark:text-white flex items-center gap-2">
                <Users size={18} className="text-zinc-500" />
                <span>Kontoöversikt ({filteredMemberAccounts.length})</span>
              </h3>
              {loadingUserAccounts && (
                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" /> Uppdaterar konton...
                </span>
              )}
            </div>

            {filteredMemberAccounts.length > 0 ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredMemberAccounts.map(acc => (
                  <div
                    key={acc.id}
                    className="p-4 sm:p-5 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/40 transition-all space-y-3.5"
                  >
                    {/* Upper row: Member basic info & status badges */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-black text-sm flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-900/40">
                          {acc.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-extrabold text-sm sm:text-base text-zinc-900 dark:text-white">{acc.name}</h4>
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40">
                              {acc.role}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                              {acc.teamName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                              <Mail size={12} className="text-zinc-400" />
                              {acc.email}
                            </span>
                            <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                              <span className="font-sans font-bold">UUID:</span>
                              <button
                                onClick={() => copyToClipboard(acc.id, `uuid-${acc.id}`)}
                                className="hover:text-indigo-600 transition-colors cursor-pointer text-[10px] underline decoration-dotted"
                                title="Klicka för att kopiera UUID"
                              >
                                {acc.id.substring(0, 16)}...
                              </button>
                              {copiedUserKey === `uuid-${acc.id}` && (
                                <span className="text-[9px] text-emerald-600 font-bold">Kopierat!</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Login status badge */}
                      <div className="shrink-0">
                        {acc.hasLoggedIn ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 font-black text-xs">
                            <CheckCircle2 size={13} />
                            <span>Inloggad konto</span>
                          </span>
                        ) : acc.tempPassword ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 font-black text-xs">
                            <Key size={13} />
                            <span>Ej inloggad ännu</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 font-bold text-xs">
                            <span>Konto saknas</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle row: Credentials details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-zinc-50 dark:bg-zinc-950/60 rounded-2xl border border-zinc-150 dark:border-zinc-800/80">
                      {/* Username */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Användarnamn:</span>
                        {acc.username ? (
                          <span className="text-xs font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2.5 py-1 rounded-lg border border-indigo-100 dark:border-indigo-900/40">
                            @{acc.username}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickGenerateUsername(acc)}
                            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Sparkles size={12} />
                            <span>Generera användarnamn</span>
                          </button>
                        )}
                      </div>

                      {/* Password / Temp password */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Lösenord:</span>
                        {acc.hasLoggedIn ? (
                          <span className="text-xs font-mono font-bold text-zinc-400 bg-zinc-200 dark:bg-zinc-800 px-2.5 py-1 rounded-lg tracking-widest">
                            ••••••••
                          </span>
                        ) : acc.tempPassword ? (
                          <div className="flex items-center gap-1.5 bg-amber-100 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/60 px-2.5 py-1 rounded-lg">
                            <span className="text-xs font-mono font-black text-amber-900 dark:text-amber-200">
                              {acc.tempPassword}
                            </span>
                            <button
                              onClick={() => copyToClipboard(acc.tempPassword!, `pwd-${acc.id}`)}
                              className="text-amber-700 hover:text-amber-900 dark:text-amber-300 p-0.5 cursor-pointer"
                              title="Kopiera lösenord"
                            >
                              {copiedUserKey === `pwd-${acc.id}` ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400 italic">Ej valt</span>
                        )}
                      </div>
                    </div>

                    {/* Bottom row: Direct Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => handleQuickResetPassword(acc)}
                        className="px-3 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border border-amber-200 dark:border-amber-800/50"
                        title="Skapa ett nytt tillfälligt lösenord för användaren"
                      >
                        <Sparkles size={13} />
                        <span>Slumpa nytt lösenord</span>
                      </button>

                      <button
                        onClick={() => {
                          setEditingUserAccount(acc);
                          setAccountEmailInput(acc.email);
                          setAccountUsernameInput(acc.username || '');
                          setAccountPasswordInput('');
                          setUserAccountError('');
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-indigo-100 dark:shadow-none"
                      >
                        <Edit3 size={13} />
                        <span>Ändra konto</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
                <Key size={36} className="mx-auto mb-2 opacity-60" />
                <p className="text-xs font-bold">Inga medlemskonton hittades.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT SINGLE USER ACCOUNT MODAL */}
      {editingUserAccount && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setEditingUserAccount(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 sm:p-8 w-full max-w-lg my-auto animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6 border-b border-zinc-100 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                  <Key size={20} className="text-indigo-600 dark:text-indigo-400" />
                  <span>Hantera Inloggningsuppgifter</span>
                </h3>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  För {editingUserAccount.name} ({editingUserAccount.email})
                </p>
              </div>
              <button
                onClick={() => setEditingUserAccount(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveUserAccount} className="space-y-4">
              {userAccountError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs font-bold">
                  {userAccountError}
                </div>
              )}

              {/* UUID */}
              <div>
                <label className="block text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  UUID (Användar-ID)
                </label>
                <input
                  type="text"
                  readOnly
                  value={editingUserAccount.id}
                  className="w-full px-3.5 py-2.5 bg-zinc-100 dark:bg-zinc-950 text-zinc-500 font-mono text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl cursor-not-allowed"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  E-postadress *
                </label>
                <input
                  type="email"
                  required
                  value={accountEmailInput}
                  onChange={(e) => setAccountEmailInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-xs"
                />
              </div>

              {/* Username */}
              <div>
                <label className="block text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Användarnamn
                </label>
                <input
                  type="text"
                  placeholder="t.ex. johan_s (3-20 tecken)"
                  value={accountUsernameInput}
                  onChange={(e) => setAccountUsernameInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-xs"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                    Nytt Lösenord / Byte
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const words = ['Snabb', 'Stark', 'Fokus', 'Smidig', 'Taktik', 'Kämpe', 'Laganda', 'Spelare', 'Ledare'];
                      const word = words[Math.floor(Math.random() * words.length)];
                      const num = Math.floor(1000 + Math.random() * 9000);
                      setAccountPasswordInput(`${word}-${num}`);
                    }}
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Sparkles size={11} />
                    <span>Slumpa lösenord</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder={editingUserAccount.hasLoggedIn ? "Lämna tomt för att behålla nuvarande lösenord" : "Ange nytt eller slumpa lösenord"}
                  value={accountPasswordInput}
                  onChange={(e) => setAccountPasswordInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-mono text-xs font-bold"
                />
                <p className="text-[10px] text-zinc-400 font-medium mt-1">
                  Om du byter lösenord kommer det tillfälliga lösenordet att visas i listan tills medlemmen loggat in på nytt.
                </p>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingUserAccount(null)}
                  className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-extrabold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  disabled={isSavingUserAccount}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none disabled:opacity-50"
                >
                  {isSavingUserAccount ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>Spara ändringar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'root_admins' && isRootAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-5 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-2">Skapa Root-Admin</h2>
            <p className="text-xs text-zinc-500 mb-5 font-medium leading-relaxed">
              Lägg till en ny root-administratör. Dessa konton har full systemomfattande administrativ behörighet till samtliga föreningar, lag, och systeminställningar.
            </p>
            
            <form onSubmit={handleAddRootAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-400 uppercase tracking-wider mb-2">E-postadress</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-400">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    required
                    placeholder="t.ex. administratör@förening.se"
                    value={newRootAdminEmail}
                    onChange={(e) => setNewRootAdminEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-red-500 font-semibold text-sm"
                  />
                </div>
              </div>

              {rootAdminError && (
                <div className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/30 p-3 rounded-xl">
                  {rootAdminError}
                </div>
              )}

              <button
                type="submit"
                disabled={rootAdminActionLoading}
                className="w-full inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-extrabold px-5 py-3 rounded-xl transition-all active:scale-95 cursor-pointer text-xs uppercase tracking-wider"
              >
                <UserPlus size={15} />
                <span>{rootAdminActionLoading ? 'Lägger till...' : 'Skapa Root Admin'}</span>
              </button>
            </form>
          </div>

          <div className="md:col-span-7 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight mb-5">Systemets Root-Administratörer ({rootAdminsList.length})</h2>
            
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {rootAdminsList.map((adm) => {
                const isHardcoded = ['christer.setterholm@gmail.com', 'christer@setterholm.se'].includes(adm.email.toLowerCase());
                return (
                  <div 
                    key={adm.email} 
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/60 rounded-2xl gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-xl">
                        <Shield size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-zinc-850 dark:text-zinc-100">{adm.email}</span>
                          {isHardcoded && (
                            <span className="text-[8px] font-black uppercase tracking-widest bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded border border-amber-150 dark:border-amber-900/30">
                              Systemägare
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-semibold block mt-0.5">
                          Skapad: {new Date(adm.assignedAt || Date.now()).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <button
                      disabled={isHardcoded || rootAdminActionLoading}
                      onClick={() => handleRemoveRootAdmin(adm.email)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 px-3 py-1.5 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end sm:self-auto cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Ta bort</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'database_env' && isRootAdmin && (
        <div className="space-y-8">
          {/* Status Bar / Header */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                  <Database size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Databas & Miljökonfiguration</h2>
                  <p className="text-xs text-zinc-500 font-medium mt-1">
                    Hantera aktiv databas, miljöinställningar och synkronisering för denna installation (Cloud Run vs Webbhotell / Lokal miljö).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-stretch sm:self-auto">
                <button
                  onClick={fetchDbConfig}
                  disabled={dbConfigLoading}
                  className="inline-flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                >
                  <RefreshCw size={14} className={dbConfigLoading ? 'animate-spin' : ''} />
                  <span>Uppdatera status</span>
                </button>
              </div>
            </div>

            {/* Alert message if any */}
            {dbConfigMessage && (
              <div className={`mt-6 p-4 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
                dbConfigMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300'
              }`}>
                {dbConfigMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span>{dbConfigMessage.text}</span>
              </div>
            )}

            {/* System Info Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                <div className="flex items-center gap-2 text-zinc-400 mb-1">
                  <Cpu size={14} />
                  <span className="text-[10px] uppercase tracking-wider font-black">Aktivt Databasläge</span>
                </div>
                <div className="text-sm font-black text-zinc-900 dark:text-white">
                  {dbConfig.mode === 'local_sqlite' ? 'Fristående Lokal SQLite' : dbConfig.mode === 'hybrid' ? 'Hybrid (SQLite + Cloud)' : 'Endast Firestore'}
                </div>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                <div className="flex items-center gap-2 text-zinc-400 mb-1">
                  <HardDrive size={14} />
                  <span className="text-[10px] uppercase tracking-wider font-black">SQLite Storlek</span>
                </div>
                <div className="text-sm font-black text-zinc-900 dark:text-white">
                  {dbConfig.dbSize ? `${(dbConfig.dbSize / 1024).toFixed(1)} KB` : '0 KB'}
                </div>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                <div className="flex items-center gap-2 text-zinc-400 mb-1">
                  <Cloud size={14} />
                  <span className="text-[10px] uppercase tracking-wider font-black">Firestore Status</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${dbConfig.firestoreConfigured && dbConfig.mode !== 'local_sqlite' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-sm font-black text-zinc-900 dark:text-white">
                      {dbConfig.mode === 'local_sqlite' ? 'Inaktiverad (Lokal)' : dbConfig.firestoreConfigured ? 'Konfigurerad' : 'Ej ansluten'}
                    </span>
                  </div>
                  {dbConfig.firestoreUrl && dbConfig.mode !== 'local_sqlite' && (
                    <a
                      href={dbConfig.firestoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
                      title="Öppna databasen i Google Firebase Console"
                    >
                      <ExternalLink size={12} />
                      <span className="hidden sm:inline">Console</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                <div className="flex items-center gap-2 text-zinc-400 mb-1">
                  <Globe size={14} />
                  <span className="text-[10px] uppercase tracking-wider font-black">Servermiljö</span>
                </div>
                <div className="text-sm font-black text-zinc-900 dark:text-white">
                  {dbConfig.isProduction ? 'Produktion / Cloud Run' : 'Utveckling / Webbhotell'}
                </div>
              </div>
            </div>
          </div>

          {/* Database Mode Selector Cards */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
            <h3 className="text-base font-black text-zinc-900 dark:text-white mb-2">Välj Databas- och Lagringsstrategi för denna miljö</h3>
            <p className="text-xs text-zinc-500 mb-6 font-medium">
              Du kan ändra hur denna installation hanterar databasen. För ditt lokala webbhotell väljer du "Fristående Lokal SQLite", medan "Hybrid" rekommenderas för Google Cloud Run.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Option 1: Hybrid */}
              <div
                onClick={() => handleSaveDbConfig('hybrid')}
                className={`p-6 rounded-2xl border-2 transition-all cursor-pointer relative ${
                  dbConfig.mode === 'hybrid'
                    ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50'
                }`}
              >
                {dbConfig.mode === 'hybrid' && (
                  <span className="absolute top-3 right-3 bg-emerald-500 text-white p-1 rounded-full text-xs">
                    <Check size={12} />
                  </span>
                )}
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-xl w-fit mb-4">
                  <Server size={22} />
                </div>
                <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white mb-1">Hybrid (SQLite + Cloud-synk)</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed mb-4">
                  Blixtsnabb prestanda med lokal SQLite. Speglar automatiskt alla ändringar i Google Cloud Firestore så att ingen data försvinner om servern startar om (t.ex. på Cloud Run).
                </p>
                <span className="inline-block text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-100/60 dark:bg-emerald-950/60 px-2 py-1 rounded-md">
                  Rekommenderad för Cloud Run
                </span>
              </div>

              {/* Option 2: Local SQLite */}
              <div
                onClick={() => handleSaveDbConfig('local_sqlite')}
                className={`p-6 rounded-2xl border-2 transition-all cursor-pointer relative ${
                  dbConfig.mode === 'local_sqlite'
                    ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50'
                }`}
              >
                {dbConfig.mode === 'local_sqlite' && (
                  <span className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full text-xs">
                    <Check size={12} />
                  </span>
                )}
                <div className="p-3 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl w-fit mb-4">
                  <HardDrive size={22} />
                </div>
                <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white mb-1">Fristående Lokal SQLite</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed mb-4">
                  Använder enbart den lokala filbaserade SQLite-databasen (<code className="text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded">coachassist.db</code>). Ingen koppling mot Google Cloud krävs.
                </p>
                <span className="inline-block text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-100/60 dark:bg-blue-950/60 px-2 py-1 rounded-md">
                  Perfekt för webbhotell & lokal test
                </span>
              </div>

              {/* Option 3: Firestore Only */}
              <div
                onClick={() => handleSaveDbConfig('firestore_only')}
                className={`p-6 rounded-2xl border-2 transition-all cursor-pointer relative ${
                  dbConfig.mode === 'firestore_only'
                    ? 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/20 shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50'
                }`}
              >
                {dbConfig.mode === 'firestore_only' && (
                  <span className="absolute top-3 right-3 bg-amber-500 text-white p-1 rounded-full text-xs">
                    <Check size={12} />
                  </span>
                )}
                <div className="p-3 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-xl w-fit mb-4">
                  <Cloud size={22} />
                </div>
                <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white mb-1">Endast Cloud Firestore</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed mb-4">
                  Alla förfrågningar och ändringar görs direkt mot Google Cloud Firestore i molnet.
                </p>
                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <span className="inline-block text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-100/60 dark:bg-amber-950/60 px-2 py-1 rounded-md">
                    Endast Moln
                  </span>
                  {dbConfig.firestoreUrl && (
                    <a
                      href={dbConfig.firestoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 underline underline-offset-2 transition-colors"
                    >
                      <ExternalLink size={12} />
                      <span>Öppna i Console</span>
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Active Cloud Firestore Database Banner */}
            {dbConfig.mode !== 'local_sqlite' && dbConfig.firestoreUrl && (
              <div className="mt-6 p-5 bg-gradient-to-r from-amber-50/90 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3.5">
                  <div className="p-3 bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 rounded-xl shrink-0 mt-0.5 sm:mt-0">
                    <Cloud size={22} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs font-black text-amber-950 dark:text-amber-100 uppercase tracking-wide">
                        Aktiv Cloud Firestore-databas
                      </h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200/80 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200">
                        {dbConfig.mode === 'firestore_only' ? 'Endast Cloud Firestore' : 'Hybrid (SQLite + Cloud)'}
                      </span>
                    </div>
                    <p className="text-xs text-amber-900/80 dark:text-amber-200/80 font-medium mt-1 flex flex-wrap items-center gap-2">
                      <span>Projekt: <code className="font-bold bg-amber-100/80 dark:bg-amber-900/80 px-1.5 py-0.5 rounded text-[11px] text-amber-950 dark:text-amber-100">{dbConfig.firestoreProjectId || 'Standard'}</code></span>
                      {dbConfig.firestoreDatabaseId && dbConfig.firestoreDatabaseId !== '(default)' && (
                        <span>Databas: <code className="font-bold bg-amber-100/80 dark:bg-amber-900/80 px-1.5 py-0.5 rounded text-[11px] text-amber-950 dark:text-amber-100">{dbConfig.firestoreDatabaseId}</code></span>
                      )}
                    </p>
                  </div>
                </div>
                <a
                  href={dbConfig.firestoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-extrabold px-4 py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md shadow-amber-500/20 shrink-0 cursor-pointer"
                >
                  <ExternalLink size={14} />
                  <span>Öppna i Firebase Console</span>
                </a>
              </div>
            )}
          </div>

          {/* Backup & Import & Manual Sync Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Export & Import Backup */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
              <h3 className="text-base font-black text-zinc-900 dark:text-white mb-1 flex items-center gap-2">
                <Download size={18} className="text-indigo-500" />
                <span>Flytta Data mellan Miljöer</span>
              </h3>
              <p className="text-xs text-zinc-500 mb-6 font-medium">
                Exportera hela databasen från en miljö (t.ex. Cloud Run) och importera den direkt till ditt lokala webbhotell.
              </p>

              <div className="space-y-5">
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Exportera säkerhetskopia</h4>
                    <p className="text-[11px] text-zinc-500 font-medium">Ladda ner alla användare, lag, trupper, övningar och inställningar som JSON.</p>
                  </div>
                  <button
                    onClick={handleExportBackup}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer shrink-0"
                  >
                    <Download size={14} />
                    <span>Ladda ner JSON</span>
                  </button>
                </div>

                <form onSubmit={handleImportBackup} className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-150 dark:border-zinc-850 space-y-3">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Importera säkerhetskopia</h4>
                    <p className="text-[11px] text-zinc-500 font-medium mb-3">Välj en tidigare exporterad JSON-säkerhetskopia att läsa in i denna databas.</p>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                      className="text-xs text-zinc-600 dark:text-zinc-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-zinc-200 dark:file:bg-zinc-800 file:text-zinc-800 dark:file:text-zinc-200 hover:file:bg-zinc-300 cursor-pointer"
                    />
                  </div>

                  {importFile && (
                    <button
                      type="submit"
                      disabled={isImporting}
                      className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Upload size={14} />
                      <span>{isImporting ? 'Importerar data...' : 'Verkställ Import'}</span>
                    </button>
                  )}
                </form>
              </div>
            </div>

            {/* Manual Sync Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-base font-black text-zinc-900 dark:text-white mb-1 flex items-center gap-2">
                  <RefreshCw size={18} className="text-emerald-500" />
                  <span>Manuell Molnsynkronisering</span>
                </h3>
                <p className="text-xs text-zinc-500 mb-6 font-medium">
                  Trigg en manuell fullständig synkronisering mellan den lokala SQLite-databasen och Google Cloud Firestore.
                </p>

                <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 text-xs text-emerald-800 dark:text-emerald-300 font-medium leading-relaxed mb-6">
                  Detta skickar alla uppdaterade poster i din lokala databas direkt till molnet så att alla klienter ser den senaste datan omedelbart.
                </div>
              </div>

              <button
                onClick={handleSyncNow}
                disabled={isSyncingNow || dbConfig.mode === 'local_sqlite'}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold px-5 py-3 rounded-xl transition-all active:scale-95 cursor-pointer text-xs uppercase tracking-wider"
              >
                <RefreshCw size={16} className={isSyncingNow ? 'animate-spin' : ''} />
                <span>{isSyncingNow ? 'Synkroniserar poster...' : 'Synka till Firestore nu'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'calendar_sync' && (
        <div className="space-y-6">
          {/* Central Kalendersynkronisering för Laget */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                  <Calendar className="text-indigo-600 dark:text-indigo-400" size={20} />
                  <span>Lagets Kalendersynkronisering (Svenskalag / Laget.se / SportAdmin)</span>
                </h2>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  Ange lagets iCal/Webcal-kalenderlänk. Kalendern sparas centralt för laget i molnet och alla inloggade ledare och spelare får automatiskt den uppdaterade kalendern.
                </p>
              </div>
              {trainingSettings?.lastSyncedAt && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold text-xs shrink-0">
                  <RefreshCw size={13} />
                  <span>Senast synkad: {new Date(trainingSettings.lastSyncedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
              )}
            </div>

            {calendarSyncMsg && (
              <div className={`p-4 rounded-2xl mb-6 text-xs font-semibold flex items-center gap-2 ${
                calendarSyncMsg.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                calendarSyncMsg.type === 'error' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800' :
                'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
              }`}>
                {calendarSyncMsg.type === 'success' && <Check size={16} className="shrink-0 text-emerald-500" />}
                {calendarSyncMsg.type === 'error' && <AlertTriangle size={16} className="shrink-0 text-rose-500" />}
                {calendarSyncMsg.type === 'info' && <RefreshCw size={16} className="shrink-0 text-blue-500 animate-spin" />}
                <span>{calendarSyncMsg.text}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Lagets Webcal / ICS Kalenderlänk
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Link size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={tempIcsUrl}
                      onChange={(e) => setTempIcsUrl(e.target.value)}
                      placeholder="webcal://www.svenskalag.se/ical/eller_https://..."
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = {
                        ...(trainingSettings || { defaultStartTime: '18:00' }),
                        icsUrl: tempIcsUrl.trim()
                      };
                      if (onUpdateSettings) onUpdateSettings(updated);
                      setCalendarSyncMsg({ type: 'success', text: 'Kalenderlänk sparad för laget!' });
                      setTimeout(() => setCalendarSyncMsg(null), 3000);
                    }}
                    className="px-5 py-3 bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
                  >
                    <Save size={15} />
                    <span>Spara Länk</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  id="forceOverwriteCalendar"
                  checked={forceOverwriteCalendar}
                  onChange={(e) => setForceOverwriteCalendar(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="forceOverwriteCalendar" className="text-xs text-zinc-600 dark:text-zinc-400 font-medium cursor-pointer">
                  Tvinga uppdatering av redan avslutade eller dolda pass
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                <input
                  type="checkbox"
                  id="showLineupsToPlayersToggle"
                  checked={!!trainingSettings?.showLineupsToPlayers}
                  onChange={(e) => {
                    const updated = {
                      ...(trainingSettings || { defaultStartTime: '18:00' }),
                      showLineupsToPlayers: e.target.checked
                    };
                    if (onUpdateSettings) onUpdateSettings(updated);
                  }}
                  className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <div>
                  <label htmlFor="showLineupsToPlayersToggle" className="text-xs text-zinc-800 dark:text-zinc-200 font-bold cursor-pointer block">
                    Visa laguppställningar för spelare
                  </label>
                  <p className="text-[11px] text-zinc-500 font-medium">
                    Som standard är laguppställningar endast synliga för tränare och admin.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800 mt-4">
                <p className="text-[11px] text-zinc-500 font-medium">
                  Hämtar och importerar alla matcher och träningar från kalenderlänken till laget.
                </p>
                <button
                  type="button"
                  onClick={handleSyncTeamCalendar}
                  disabled={isSyncingCalendar || !tempIcsUrl.trim()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-6 py-3 rounded-xl text-xs transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none active:scale-95 uppercase tracking-wider shrink-0"
                >
                  <RefreshCw size={16} className={isSyncingCalendar ? 'animate-spin' : ''} />
                  <span>{isSyncingCalendar ? 'Hämtar kalender...' : 'Synka Lagets Kalender Nu'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                  <Globe className="text-indigo-600 dark:text-indigo-400" size={20} />
                  <span>Externa Webb- & Adminlänkar</span>
                </h2>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  Hantera kopplingar till föreningens externa hemsida (Svenskalag / Laget.se), adminsida och tabeller.
                </p>
              </div>
              {calSyncSaved && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                  <Check size={14} />
                  <span>Ändringar sparade!</span>
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Lagsida (Laget.se / Svenskalag.se)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={tempTeamUrl}
                      onChange={(e) => setTempTeamUrl(e.target.value)}
                      placeholder="https://www.svenskalag.se/ditt-lag"
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {tempTeamUrl && (
                    <a
                      href={tempTeamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <ExternalLink size={14} />
                      <span className="hidden sm:inline">Öppna</span>
                    </a>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Adminsida (Svenskalag / Laget Admin)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Settings size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={tempAdminUrl}
                      onChange={(e) => setTempAdminUrl(e.target.value)}
                      placeholder="https://www.svenskalag.se/admin"
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {tempAdminUrl && (
                    <a
                      href={tempAdminUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <ExternalLink size={14} />
                      <span className="hidden sm:inline">Öppna</span>
                    </a>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Serie & Tabell (MinFotboll / Fogis)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={tempSeriesUrl}
                      onChange={(e) => setTempSeriesUrl(e.target.value)}
                      placeholder="https://minfotboll.svenskfotboll.se/lag/..."
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {tempSeriesUrl && (
                    <a
                      href={tempSeriesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <ExternalLink size={14} />
                      <span className="hidden sm:inline">Öppna</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (onUpdateTeamUrl) onUpdateTeamUrl(tempTeamUrl);
                    if (onUpdateAdminUrl) onUpdateAdminUrl(tempAdminUrl);
                    if (onUpdateSeriesUrl) onUpdateSeriesUrl(tempSeriesUrl);
                    setCalSyncSaved(true);
                    setTimeout(() => setCalSyncSaved(false), 3000);
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-3 rounded-xl text-xs transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none active:scale-95 uppercase tracking-wider"
                >
                  <Save size={16} />
                  <span>Spara Externa Länkar</span>
                </button>
              </div>
            </div>
          </div>

          {/* Kalendersynk / iCal integration */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2 mb-2">
              <Calendar className="text-indigo-600 dark:text-indigo-400" size={20} />
              <span>Kalendersynkronisering (iCal / Webcal)</span>
            </h2>
            <p className="text-xs text-zinc-500 font-medium mb-6">
              Prenumerera på lagets träningar och matcher direkt i din mobil, Google Kalender, Outlook eller Apple Kalender.
            </p>

            {(() => {
              const calFeedClubId = selectedClub?.id || activeClubId;
              const calFeedTeamId = activeTeamId || 'club_global';
              const calFeedUrl = calFeedClubId
                ? `${window.location.origin}/api/calendar/${calFeedClubId}/${calFeedTeamId}/events.ics`
                : `${window.location.origin}/api/calendar/events.ics`;

              return (
                <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 mb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-indigo-500 tracking-wider">
                          Unik iCal Prenumerationslänk
                        </span>
                        {selectedClub && (
                          <span className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-extrabold">
                            {selectedClub.name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200 mt-1 break-all select-all">
                        {calFeedUrl}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(calFeedUrl);
                        setCopiedCalFeed(true);
                        setTimeout(() => setCopiedCalFeed(false), 2500);
                      }}
                      className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shrink-0 cursor-pointer active:scale-95 shadow-sm"
                    >
                      {copiedCalFeed ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedCalFeed ? 'Kopierad!' : 'Kopiera Länk'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white mb-1">iPhone / iPad / Mac</h4>
                <p className="text-[11px] text-zinc-500 leading-relaxed font-medium">
                  Öppna Kalender-appen &gt; Lägg till prenumerationskalender &gt; Klistra in länken ovan.
                </p>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white mb-1">Google Kalender / Android</h4>
                <p className="text-[11px] text-zinc-500 leading-relaxed font-medium">
                  Gå till calendar.google.com i webbläsaren &gt; Klicka "+" vid Andra kalendrar &gt; Från webbadress.
                </p>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white mb-1">Outlook / Office 365</h4>
                <p className="text-[11px] text-zinc-500 leading-relaxed font-medium">
                  Öppna Outlook &gt; Lägg till kalender &gt; Prenumerera från webben &gt; Klistra in iCal-adressen.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'pwa_icons' && (
        <PwaIconGenerator
          initialLogoUrl="/icon.svg"
          clubName={selectedClub?.name || 'CoachAssist'}
        />
      )}

      {imageToCrop && (
        <ImageCropper
          image={imageToCrop}
          onCropComplete={onCropCompleteMemberPhoto}
          onCancel={() => setImageToCrop(null)}
          aspect={1}
        />
      )}
    </div>
  );
}
