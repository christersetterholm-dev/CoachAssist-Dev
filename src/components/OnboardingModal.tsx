import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { UserProfile, Club, ClubTeam } from '../types';
import { db, doc, getDoc, setDoc, User } from '../lib/firebase';
import { ShieldAlert, Clock, LogOut, Send, User as UserIcon, Phone, FileText, Building2, Users, Edit3, Loader2 } from 'lucide-react';

interface OnboardingModalProps {
  user: User;
  userProfile: UserProfile;
  onProfileUpdated: (updated: UserProfile) => void;
  onLogout: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  user,
  userProfile,
  onProfileUpdated,
  onLogout
}) => {
  const [fullName, setFullName] = useState(userProfile.fullName || user.displayName || '');
  const [email, setEmail] = useState(userProfile.email || user.email || '');
  const [phone, setPhone] = useState(userProfile.phone || '');
  const [personnummer, setPersonnummer] = useState(userProfile.personnummer || '');
  const [requestedRole, setRequestedRole] = useState<'player' | 'leader' | 'parent'>(userProfile.requestedRole || 'player');

  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>(userProfile.requestedClubId || '');
  const [teams, setTeams] = useState<ClubTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(userProfile.requestedTeamId || '');

  const [isLoadingClubs, setIsLoadingClubs] = useState(true);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isEditing, setIsEditing] = useState(!userProfile.onboardingCompleted || userProfile.status !== 'pending');

  // Load all available clubs on mount
  useEffect(() => {
    async function loadClubs() {
      try {
        setIsLoadingClubs(true);
        const clubsSnap = await getDoc(doc(db, 'shared_leaderboards', 'all_clubs'));
        if (clubsSnap.exists()) {
          const list: Club[] = clubsSnap.data().clubs || [];
          setClubs(list);
          if (list.length > 0 && !selectedClubId) {
            setSelectedClubId(list[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load clubs for onboarding:', err);
      } finally {
        setIsLoadingClubs(false);
      }
    }
    loadClubs();
  }, []);

  // Load teams whenever selectedClubId changes
  useEffect(() => {
    if (!selectedClubId) {
      setTeams([]);
      setSelectedTeamId('');
      return;
    }

    async function loadTeams() {
      try {
        setIsLoadingTeams(true);
        const metaSnap = await getDoc(doc(db, 'clubs', selectedClubId, 'teams', 'club_global', 'data', 'metadata'));
        if (metaSnap.exists()) {
          const teamList: ClubTeam[] = metaSnap.data().teams || [];
          setTeams(teamList);
          if (teamList.length > 0) {
            if (!selectedTeamId || !teamList.some(t => t.id === selectedTeamId)) {
              setSelectedTeamId(teamList[0].id);
            }
          } else {
            setSelectedTeamId('');
          }
        } else {
          setTeams([]);
          setSelectedTeamId('');
        }
      } catch (err) {
        console.error('Failed to load teams for onboarding:', err);
        setTeams([]);
      } finally {
        setIsLoadingTeams(false);
      }
    }
    loadTeams();
  }, [selectedClubId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!fullName.trim()) {
      setErrorMsg('Vänligen fyll i ditt namn.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Vänligen fyll i en giltig e-postadress.');
      return;
    }
    if (!selectedClubId) {
      setErrorMsg('Vänligen välj en förening.');
      return;
    }
    if (!selectedTeamId) {
      setErrorMsg('Vänligen välj ett lag.');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone.trim();
      const cleanPnr = personnummer.trim();
      const cleanName = fullName.trim();

      // Update club members list to reflect completed profile info & bind userId
      try {
        const membersSnap = await getDoc(doc(db, 'clubs', selectedClubId, 'teams', 'club_global', 'data', 'members'));
        if (membersSnap.exists()) {
          const membersList = membersSnap.data().members || [];
          let foundMember = membersList.find((m: any) => 
            m.userId === user.uid || (m.email && m.email.trim().toLowerCase() === cleanEmail)
          );

          if (foundMember) {
            foundMember.userId = user.uid;
            foundMember.fullName = cleanName;
            foundMember.name = cleanName;
            foundMember.email = cleanEmail;
            foundMember.phone = cleanPhone;
            foundMember.personnummer = cleanPnr;
          } else {
            membersList.push({
              id: user.uid,
              userId: user.uid,
              fullName: cleanName,
              name: cleanName,
              email: cleanEmail,
              phone: cleanPhone,
              personnummer: cleanPnr,
              roles: requestedRole === 'leader' ? ['coach'] : ['player'],
              teams: [selectedTeamId]
            });
          }

          await setDoc(doc(db, 'clubs', selectedClubId, 'teams', 'club_global', 'data', 'members'), { members: membersList }, { merge: true });
        }
      } catch (memErr) {
        console.error('Failed updating club member record during onboarding:', memErr);
      }

      // Save user profile with onboarding completed and approved status
      const updatedProfile: UserProfile = {
        ...userProfile,
        fullName: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        personnummer: cleanPnr,
        activeClubId: selectedClubId,
        activeTeamId: selectedTeamId,
        requestedRole,
        status: 'approved',
        onboardingCompleted: true
      };

      await setDoc(doc(db, 'users', user.uid, 'data', 'profile'), {
        ...updatedProfile,
        updatedAt: Date.now()
      }, { merge: true });

      onProfileUpdated(updatedProfile);
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to save profile during onboarding:', err);
      setErrorMsg(err?.message || 'Ett fel uppstod när profilen sparades. Vänligen försök igen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoleLabel = (r?: string) => {
    switch (r) {
      case 'leader': return 'Ledare / Tränare';
      case 'parent': return 'Vårdnadshavare';
      default: return 'Spelare';
    }
  };

  const selectedClubName = clubs.find(c => c.id === (userProfile.requestedClubId || selectedClubId))?.name || 'Förening';
  const selectedTeamName = teams.find(t => t.id === (userProfile.requestedTeamId || selectedTeamId))?.name || 'Lag';

  return (
    <div className="fixed inset-0 z-[9990] bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden my-8"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 p-6 sm:p-8 text-white relative">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-indigo-200 text-xs font-black uppercase tracking-widest">
              <ShieldAlert size={16} />
              <span>CoachAssist Medlemskap</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all"
            >
              <LogOut size={14} />
              <span>Logga ut</span>
            </button>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
            Komplettera din profil
          </h2>
          <p className="text-indigo-100 text-xs sm:text-sm mt-1">
            Fyll i dina kontaktuppgifter för att slutföra din profil och komma igång.
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8">
          {/* If already submitted and waiting for approval */}
          {!isEditing && userProfile.status === 'pending' ? (
            <div className="space-y-6">
              <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                  <Clock size={32} className="animate-pulse" />
                </div>
                <h3 className="text-lg font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                  Din medlemsansökan behandlas
                </h3>
                <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300">
                  Din förfrågan har skickats till administratörerna för <span className="font-bold">{selectedClubName} - {selectedTeamName}</span>. Du får tillgång till appen så fort en ledare godkänt ditt konto.
                </p>
              </div>

              {/* Submitted Details Summary */}
              <div className="bg-zinc-50 dark:bg-zinc-950 rounded-2xl p-5 border border-zinc-200 dark:border-zinc-800 space-y-3">
                <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider">Inskickade uppgifter</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-400 block">Namn:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{userProfile.fullName}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block">E-post:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{userProfile.email}</span>
                  </div>
                  {userProfile.phone && (
                    <div>
                      <span className="text-zinc-400 block">Telefon:</span>
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{userProfile.phone}</span>
                    </div>
                  )}
                  {userProfile.personnummer && (
                    <div>
                      <span className="text-zinc-400 block">Personnummer:</span>
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{userProfile.personnummer}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-zinc-400 block">Önskad roll:</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{getRoleLabel(userProfile.requestedRole)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                >
                  <Edit3 size={16} />
                  <span>Ändra uppgifter</span>
                </button>
              </div>
            </div>
          ) : (
            /* Onboarding Form */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMsg && (
                <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl text-red-600 dark:text-red-400 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Personal Details */}
              <div className="space-y-3">
                <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Dina personuppgifter
                </label>
                
                <div className="relative">
                  <UserIcon size={18} className="absolute left-4 top-3.5 text-zinc-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="För- och efternamn..."
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <UserIcon size={18} className="absolute left-4 top-3.5 text-zinc-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="E-postadress..."
                      className="w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                    />
                  </div>

                  <div className="relative">
                    <Phone size={18} className="absolute left-4 top-3.5 text-zinc-400" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="Mobilnummer..."
                      className="w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                    />
                  </div>
                </div>

                <div className="relative">
                  <FileText size={18} className="absolute left-4 top-3.5 text-zinc-400" />
                  <input
                    type="text"
                    value={personnummer}
                    onChange={e => setPersonnummer(e.target.value)}
                    placeholder="Personnummer (ÅÅMMDD-XXXX)..."
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                  />
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                  Din roll i laget
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setRequestedRole('player')}
                    className={`py-3 px-2 rounded-2xl text-xs font-black uppercase tracking-wider border transition-all ${
                      requestedRole === 'player'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                    }`}
                  >
                    Spelare
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestedRole('leader')}
                    className={`py-3 px-2 rounded-2xl text-xs font-black uppercase tracking-wider border transition-all ${
                      requestedRole === 'leader'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                    }`}
                  >
                    Ledare
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestedRole('parent')}
                    className={`py-3 px-2 rounded-2xl text-xs font-black uppercase tracking-wider border transition-all ${
                      requestedRole === 'parent'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                    }`}
                  >
                    Vårdnadshavare
                  </button>
                </div>
              </div>

              {/* Club & Team Selection */}
              <div className="space-y-3">
                <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Välj Förening & Lag
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Förening</label>
                    <div className="relative">
                      <Building2 size={18} className="absolute left-3.5 top-3.5 text-zinc-400" />
                      <select
                        value={selectedClubId}
                        onChange={e => setSelectedClubId(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        disabled={isLoadingClubs}
                      >
                        {clubs.length === 0 ? (
                          <option value="">Inga föreningar finns</option>
                        ) : (
                          clubs.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Lag</label>
                    <div className="relative">
                      <Users size={18} className="absolute left-3.5 top-3.5 text-zinc-400" />
                      <select
                        value={selectedTeamId}
                        onChange={e => setSelectedTeamId(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        disabled={isLoadingTeams || teams.length === 0}
                      >
                        {teams.length === 0 ? (
                          <option value="">Inga lag skapade i denna förening</option>
                        ) : (
                          teams.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !selectedClubId || !selectedTeamId}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 active:scale-98 transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Sparar profil...</span>
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    <span>Spara profil & Fortsätt</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
};
