import React, { useState, useEffect } from 'react';
import { Landmark, Trash2, Edit3, Users, Shield, Check, PlusCircle, Search, Mail, Phone, Fingerprint, Settings, ArrowRight, UserPlus, Save } from 'lucide-react';
import { Club, ClubMetadata, ClubTeam, ClubMember } from '../types';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface ClubAdminDashboardProps {
  userId: string;
  userEmail: string;
  isRootAdmin?: boolean;
  onBack?: () => void;
}

export default function ClubAdminDashboard({ userId, userEmail, isRootAdmin = false, onBack }: ClubAdminDashboardProps) {
  // Navigation tabs within admin
  const [activeTab, setActiveTab] = useState<'clubs' | 'teams' | 'members' | 'root_admins'>('clubs');

  // Master lists
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [clubMetadata, setClubMetadata] = useState<ClubMetadata | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);

  // Root Admins list state
  const [rootAdminsList, setRootAdminsList] = useState<{ email: string; assignedAt: number; role?: string; uid?: string }[]>([]);
  const [newRootAdminEmail, setNewRootAdminEmail] = useState('');
  const [rootAdminActionLoading, setRootAdminActionLoading] = useState(false);
  const [rootAdminError, setRootAdminError] = useState('');
  
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
  const [memberRoles, setMemberRoles] = useState<('admin' | 'coach' | 'player' | 'parent')[]>([]);
  const [memberTeams, setMemberTeams] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

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

  // Load all clubs on mount
  const loadClubs = async (selectFirst = false) => {
    setIsLoading(true);
    try {
      const docRef = doc(db, 'shared_leaderboards', 'all_clubs');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const list: Club[] = snap.data().clubs || [];
        setClubs(list);
        if (list.length > 0 && (selectFirst || !selectedClub)) {
          setSelectedClub(list[0]);
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
  useEffect(() => {
    if (!selectedClub) {
      setClubMetadata(null);
      setMembers([]);
      return;
    }

    async function loadClubDetails() {
      try {
        const metadataRef = doc(db, 'clubs', selectedClub!.id, 'teams', 'club_global', 'data', 'metadata');
        const membersRef = doc(db, 'clubs', selectedClub!.id, 'teams', 'club_global', 'data', 'members');

        const [metaSnap, memSnap] = await Promise.all([
          getDoc(metadataRef),
          getDoc(membersRef)
        ]);

        if (metaSnap.exists()) {
          setClubMetadata(metaSnap.data() as ClubMetadata);
        } else {
          // Initialize metadata if missing
          const defaultMeta: ClubMetadata = { id: selectedClub!.id, name: selectedClub!.name, teams: [] };
          await setDoc(metadataRef, defaultMeta);
          setClubMetadata(defaultMeta);
        }

        if (memSnap.exists()) {
          setMembers(memSnap.data().members || []);
        } else {
          // Initialize members with creator as admin
          const defaultMembers: ClubMember[] = [
            {
              userId: userId,
              email: userEmail,
              fullName: userEmail.split('@')[0],
              roles: ['admin', 'coach'],
              teams: []
            }
          ];
          await setDoc(membersRef, { members: defaultMembers });
          setMembers(defaultMembers);
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

      await Promise.all([
        setDoc(metadataRef, { id: clubId, name: newClub.name, teams: [] }),
        setDoc(membersRef, {
          members: [
            {
              userId: userId,
              email: userEmail,
              fullName: userEmail.split('@')[0],
              roles: ['admin'],
              teams: []
            }
          ]
        })
      ]);

      setClubs(updatedClubs);
      setSelectedClub(newClub);
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
    if (!selectedClub || !newTeamName.trim() || !clubMetadata) return;

    setActionStatus({ type: 'save', status: 'loading' });
    try {
      const teamId = 'team_' + Math.random().toString(36).substring(2, 11);
      const newTeam: ClubTeam = {
        id: teamId,
        name: newTeamName.trim()
      };

      const updatedTeams = [...(clubMetadata.teams || []), newTeam];
      const updatedMeta = { ...clubMetadata, teams: updatedTeams };

      await setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'metadata'), updatedMeta);
      
      setClubMetadata(updatedMeta);
      setNewTeamName('');
      setActionStatus({ type: 'save', status: 'success', message: `Laget "${newTeam.name}" har lagts till!` });
      setTimeout(() => setActionStatus({ type: 'save', status: 'idle' }), 3000);
    } catch (err) {
      console.error('Failed to add team:', err);
      setActionStatus({ type: 'save', status: 'error', message: 'Kunde inte lägga till laget.' });
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
    if (member) {
      setEditingMember(member);
      setMemberEmail(member.email);
      setMemberName(member.fullName);
      setMemberPhone(member.phone || '');
      setMemberPersonnummer(member.personnummer || '');
      setMemberRoles(member.roles || []);
      setMemberTeams(member.teams || []);
    } else {
      setEditingMember(null);
      setMemberEmail('');
      setMemberName('');
      setMemberPhone('');
      setMemberPersonnummer('');
      setMemberRoles(['player']);
      setMemberTeams([]);
    }
    setShowMemberForm(true);
  };

  // Save member
  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClub || !memberEmail.trim() || !memberName.trim()) return;

    setActionStatus({ type: 'save', status: 'loading' });
    try {
      const cleanEmail = memberEmail.trim().toLowerCase();
      let updatedMembers = [...members];

      const newOrUpdatedMember: ClubMember = {
        userId: editingMember ? editingMember.userId : 'user_temp_' + Math.random().toString(36).substring(2, 11),
        email: cleanEmail,
        fullName: memberName.trim(),
        phone: memberPhone.trim() || undefined,
        personnummer: memberPersonnummer.trim() || undefined,
        roles: memberRoles,
        teams: memberTeams
      };

      if (editingMember) {
        // Update
        const idx = updatedMembers.findIndex(m => m.email === editingMember.email);
        if (idx !== -1) {
          updatedMembers[idx] = newOrUpdatedMember;
        }
      } else {
        // Add new (verify email unique first)
        if (updatedMembers.some(m => m.email === cleanEmail)) {
          setActionStatus({ type: 'save', status: 'error', message: 'En medlem med denna e-postadress finns redan i föreningen!' });
          return;
        }
        updatedMembers.push(newOrUpdatedMember);
      }

      await setDoc(doc(db, 'clubs', selectedClub.id, 'teams', 'club_global', 'data', 'members'), { members: updatedMembers });
      
      setMembers(updatedMembers);
      setShowMemberForm(false);
      setActionStatus({ type: 'save', status: 'success', message: editingMember ? 'Medlemsuppgifter uppdaterade!' : 'Medlem tillagd i föreningen!' });
      setTimeout(() => setActionStatus({ type: 'save', status: 'idle' }), 3000);
    } catch (err) {
      console.error('Failed to save member:', err);
      setActionStatus({ type: 'save', status: 'error', message: 'Kunde inte spara medlemmen.' });
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

  // Filter members based on search
  const filteredMembers = members.filter(m => {
    const query = memberSearchQuery.toLowerCase();
    return (
      m.fullName.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query) ||
      (m.phone && m.phone.includes(query)) ||
      (m.personnummer && m.personnummer.includes(query))
    );
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6" id="club-admin-dashboard">
      {/* Upper Navigation & Club Select Panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-5 sm:p-7 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-6 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3.5">
            {onBack && (
              <button
                onClick={onBack}
                className="w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 cursor-pointer active:scale-95 transition-all shrink-0"
                title="Tillbaka till profil"
              >
                <ArrowRight size={18} className="rotate-180" />
              </button>
            )}
            <div className="w-12 h-12 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Shield size={24} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">Klubb- & Lagadministration</h1>
                {isRootAdmin && (
                  <span className="text-[10px] font-black uppercase tracking-wider bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md border border-red-100/40 dark:border-red-900/40 animate-pulse">
                    Root Admin
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Skala din verksamhet, hantera medlemsroller och skapa nya lag.</p>
            </div>
          </div>

          {/* Club Dropdown */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-black uppercase text-zinc-400 shrink-0">Välj förening:</label>
            <select
              value={selectedClub?.id || ''}
              onChange={(e) => {
                const found = clubs.find(c => c.id === e.target.value);
                if (found) setSelectedClub(found);
              }}
              className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl font-bold text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {clubs.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {clubs.length === 0 && <option value="">Inga föreningar skapade</option>}
            </select>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => setActiveTab('clubs')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
              activeTab === 'clubs'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Landmark size={16} />
            <span>Skapa Förening</span>
          </button>
          
          <button
            disabled={!selectedClub}
            onClick={() => setActiveTab('teams')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              activeTab === 'teams'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Settings size={16} />
            <span>Hantera Lag ({clubMetadata?.teams?.length || 0})</span>
          </button>

          <button
            disabled={!selectedClub}
            onClick={() => setActiveTab('members')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              activeTab === 'members'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Users size={16} />
            <span>Medlemmar & Roller ({members.length})</span>
          </button>

          {isRootAdmin && (
            <button
              onClick={() => setActiveTab('root_admins')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
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
        <div className="p-4 mb-6 rounded-2xl bg-green-55/10 border border-green-250 text-green-700 font-bold text-sm flex items-center gap-2">
          <Check size={18} />
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
                {clubs.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedClub(c)}
                    className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${
                      selectedClub?.id === c.id
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
                    {selectedClub?.id === c.id && (
                      <span className="text-indigo-600 dark:text-indigo-400 font-extrabold text-xs flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-950/40">
                        <Check size={12} />
                        <span>Vald</span>
                      </span>
                    )}
                  </div>
                ))}
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
                    className="flex items-center justify-between p-4 rounded-2xl border border-zinc-150 dark:border-zinc-800 bg-zinc-55/30 dark:bg-zinc-950"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-emerald-55/10 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Settings size={20} />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white">{team.name}</h3>
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5">ID: {team.id}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTeam(team.id)}
                      className="text-red-500 hover:text-red-650 p-2 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
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
          {/* Members search & Add button */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1">
                <span className="absolute left-4 top-3.5 text-zinc-400">
                  <Search size={18} />
                </span>
                <input
                  type="text"
                  placeholder="Sök bland medlemmar på namn, e-post eller telefon..."
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 hover:bg-zinc-100/50 dark:bg-zinc-950 dark:hover:bg-zinc-950/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-500 font-semibold text-sm"
                />
              </div>

              <button
                onClick={() => openMemberForm(null)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-md shadow-indigo-100 dark:shadow-none shrink-0"
              >
                <UserPlus size={18} />
                <span>Lägg till medlem</span>
              </button>
            </div>
          </div>

          {/* MEMBER DIALOG FORM (INLINE BOX ON TOP IF OPEN) */}
          {showMemberForm && (
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border-2 border-indigo-500 shadow-2xl p-6 sm:p-8 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-6 border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <h3 className="text-lg font-black text-zinc-900 dark:text-white">
                  {editingMember ? 'Redigera medlemsuppgifter' : 'Lägg till ny medlem i föreningen'}
                </h3>
                <button
                  onClick={() => setShowMemberForm(false)}
                  className="text-zinc-400 hover:text-zinc-600 text-xs font-bold bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-xl cursor-pointer"
                >
                  Avbryt
                </button>
              </div>

              <form onSubmit={handleSaveMember} className="space-y-5">
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
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Inloggnings-e-post (Måste matcha deras konto)</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-3 text-zinc-400">
                        <Mail size={16} />
                      </span>
                      <input
                        type="email"
                        required
                        disabled={!!editingMember}
                        placeholder="kalle@exempel.se"
                        value={memberEmail}
                        onChange={(e) => setMemberEmail(e.target.value)}
                        className={`w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-sm ${editingMember ? 'opacity-60 cursor-not-allowed' : ''}`}
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

                {/* Role Toggles */}
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                  <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-3">Roll(er) i föreningen (En användare kan ha flera)</label>
                  <div className="flex flex-wrap gap-2.5">
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
                          className={`flex-1 text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                            active
                              ? r.color === 'purple' ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/10' :
                                r.color === 'emerald' ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10' :
                                r.color === 'sky' ? 'border-sky-500 bg-sky-50/40 dark:bg-sky-950/10' :
                                'border-amber-500 bg-amber-50/40 dark:bg-amber-950/10'
                              : 'bg-zinc-50 hover:bg-zinc-100/50 border-zinc-200 dark:bg-zinc-950 dark:hover:bg-zinc-900/60 dark:border-zinc-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-extrabold text-sm text-zinc-900 dark:text-white">{r.label}</span>
                            {active && <span className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px]"><Check size={10} /></span>}
                          </div>
                          <p className="text-[10px] text-zinc-400 font-medium leading-tight">{r.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Team Assignments */}
                {clubMetadata?.teams && clubMetadata.teams.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <label className="block text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-wider mb-2">Koppla medlemmen till lag</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {clubMetadata.teams.map(t => {
                        const active = memberTeams.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggleTeamAssignment(t.id)}
                            className={`py-2 px-3.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                              active
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
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

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowMemberForm(false)}
                    className="px-5 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-extrabold text-xs cursor-pointer"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-extrabold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Save size={14} />
                    <span>Spara medlemsuppgifter</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Members Table / List */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight">Medlemslista ({filteredMembers.length})</h2>
            </div>

            {isLoading ? (
              <div className="p-12 text-center text-sm text-zinc-500 font-medium">Laddar medlemmar...</div>
            ) : filteredMembers.length > 0 ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredMembers.map(member => (
                  <div
                    key={member.email}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/40 transition-all"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 flex items-center justify-center shrink-0">
                        <Users size={18} />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-zinc-900 dark:text-white leading-tight">{member.fullName}</h4>
                        <div className="flex flex-wrap items-center gap-2.5 mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-bold">
                          <span className="flex items-center gap-1.5 shrink-0">
                            <Mail size={12} />
                            <span>{member.email}</span>
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
                        </div>

                        {/* Display member teams */}
                        {clubMetadata?.teams && member.teams && member.teams.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mr-1 mt-0.5">Lag:</span>
                            {member.teams.map(tid => {
                              const t = clubMetadata.teams.find(team => team.id === tid);
                              return t ? (
                                <span key={tid} className="text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded">
                                  {t.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Member roles and action buttons */}
                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="flex gap-1.5">
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
              <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
                <Users size={40} className="mx-auto mb-3" />
                <p className="text-xs font-bold">Hittade inga medlemmar som matchar sökningen.</p>
              </div>
            )}
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
    </div>
  );
}
