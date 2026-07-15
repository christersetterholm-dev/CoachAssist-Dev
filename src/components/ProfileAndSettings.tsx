import React, { useState, useEffect } from 'react';
import { User, Phone, Fingerprint, Check, Save, Landmark, Info } from 'lucide-react';
import { UserProfile, Club, ClubMetadata, ClubMember } from '../types';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface ProfileAndSettingsProps {
  userId: string;
  userEmail: string;
  onProfileUpdated: (profile: UserProfile) => void;
  currentProfile: UserProfile;
}

export default function ProfileAndSettings({
  userId,
  userEmail,
  onProfileUpdated,
  currentProfile,
}: ProfileAndSettingsProps) {
  const [profile, setProfile] = useState<UserProfile>({
    fullName: currentProfile.fullName || '',
    phone: currentProfile.phone || '',
    personnummer: currentProfile.personnummer || '',
    activeClubId: currentProfile.activeClubId || null,
    activeTeamId: currentProfile.activeTeamId || null,
  });

  const [memberships, setMemberships] = useState<{ club: Club; roles: string[]; teams: string[]; availableTeams: { id: string; name: string }[] }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

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
              userMemberships.push({
                club,
                roles: myMemberRecord.roles || [],
                teams: myMemberRecord.teams || [],
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
  }, [userId, userEmail]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      // Save profile doc
      await setDoc(doc(db, 'users', userId, 'data', 'profile'), {
        ...profile,
        updatedAt: Date.now(),
      });

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
                fullName: profile.fullName,
                phone: profile.phone,
                personnummer: profile.personnummer
              };
              await setDoc(doc(db, 'clubs', profile.activeClubId, 'teams', 'club_global', 'data', 'members'), { members });
            }
          }
        } catch (e) {
          console.error("Failed to sync personal info into club membership registry:", e);
        }
      }

      onProfileUpdated(profile);
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto p-4 sm:p-6" id="profile-settings-page">
      {/* Profile Form (Left Column) */}
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
                    disabled
                    value={userEmail}
                    className="w-full pl-11 pr-4 py-3 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-500 rounded-2xl border border-zinc-200 dark:border-zinc-800 font-semibold text-sm cursor-not-allowed"
                  />
                </div>
              </div>

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
              <p className="text-[11px] text-zinc-400 mt-1.5 font-medium leading-relaxed">
                Personnummer är helt valfritt och används av klubbar för bidragsansökningar (t.ex. LOK-stöd) samt säker identifiering. Spara i formatet ÅÅÅÅMMDD-XXXX.
              </p>
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
                  <div className="border-t border-zinc-100 dark:border-zinc-800/80 pt-4 pb-1">
                    <h4 className="text-[11px] font-black uppercase text-zinc-400 tracking-wider">Mina Klubbar</h4>
                  </div>

                  {memberships.map(({ club, roles, teams, availableTeams }) => {
                    const isActive = profile.activeClubId === club.id;
                    const myClubTeams = availableTeams.filter(t => teams.includes(t.id));
                    
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
                              // Auto-select first team they are member of, or null if none
                              const firstTeamId = teams[0] || null;
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
    </div>
  );
}
