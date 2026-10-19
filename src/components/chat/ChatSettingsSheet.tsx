// Info om en chatt. I grupper: byt namn, lägg till och ta bort deltagare, gör till admin, lämna.
import React, { useEffect, useState } from 'react';
import { Crown, LogOut, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { Avatar, Badge, Button, MenuItem, Sheet, TextInput } from '../ui';
import { ChatPeoplePicker } from './ChatPeoplePicker';
import {
  addChatParticipants, CHAT_LIMITS, makeChatAdmin, removeChatParticipant, renameChat,
  type ChatDetail, type ChatParticipant,
} from '../../lib/chat';

export const ChatSettingsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  clubId: string;
  myUserId: string;
  detail: ChatDetail;
  onDetail: (d: ChatDetail) => void;
  onLeft: () => void;
}> = ({ open, onClose, clubId, myUserId, detail, onDetail, onLeft }) => {
  const [name, setName] = useState(detail.customName || '');
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [person, setPerson] = useState<ChatParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setName(detail.customName || ''); setAdding(false); setToAdd([]); setError(null); } }, [open, detail.id]);

  const isGroup = detail.kind === 'group';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message || 'Något gick fel.'); } finally { setBusy(false); }
  };

  const title = detail.kind === 'team' ? 'Lagchatt' : detail.kind === 'direct' ? 'Chatt' : 'Gruppen';

  return (
    <>
      <Sheet open={open && !adding} onClose={onClose} title={title}>
        <div className="px-2 pb-2">
          {detail.kind === 'team' && (
            <p className="px-1 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
              Alla i <strong>{detail.name}</strong> som har konto är med. Den som kommer med i laget kommer med i chatten,
              och den som lämnar laget försvinner ur den.
            </p>
          )}

          {isGroup && detail.isAdmin && (
            <div className="px-1 pb-4">
              <label htmlFor="chat-group-name" className="block text-sm font-semibold mb-1">Gruppens namn</label>
              <div className="flex gap-2">
                <TextInput
                  id="chat-group-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={CHAT_LIMITS.name}
                  placeholder="T.ex. Fikagruppen"
                  className="flex-1 min-w-0 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                />
                <Button
                  disabled={busy || name.trim() === (detail.customName || '')}
                  onClick={() => run(async () => onDetail((await renameChat(detail.id, name)).conversation))}
                >
                  Spara
                </Button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Utan namn visas deltagarnas förnamn.</p>
            </div>
          )}

          {error && <p className="px-1 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-semibold text-zinc-500">{detail.participants.length} deltagare</span>
            {isGroup && detail.isAdmin && (
              <Button size="sm" variant="secondary" icon={<UserPlus size={16} />} onClick={() => { setToAdd([]); setAdding(true); }}>Lägg till</Button>
            )}
          </div>
          {detail.participants.map((p) => (
            <button
              key={p.userId}
              type="button"
              onClick={() => isGroup && detail.isAdmin ? setPerson(p) : undefined}
              className={`w-full flex items-center gap-3 px-1 py-1.5 rounded-xl text-left ${isGroup && detail.isAdmin ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer' : 'cursor-default'}`}
            >
              <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
              <span className="flex-1 min-w-0 text-sm font-semibold truncate">{p.name}</span>
              {p.role === 'admin' && <Badge tone="brand" icon={<Crown size={12} />}>Gruppadmin</Badge>}
            </button>
          ))}

          {isGroup && (
            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-col gap-0.5">
              {detail.canTakeOver && (
                <MenuItem
                  icon={<ShieldCheck size={18} />}
                  label="Ta över som gruppadmin"
                  description="Du är föreningsadmin. Alla i gruppen ser att du tog över."
                  onClick={() => run(async () => onDetail((await makeChatAdmin(detail.id, myUserId)).conversation))}
                />
              )}
              <MenuItem
                icon={<LogOut size={18} />}
                label="Lämna gruppen"
                tone="danger"
                onClick={() => {
                  if (!window.confirm('Lämna gruppen? Du ser inte meddelandena längre.')) return;
                  run(async () => {
                    await removeChatParticipant(detail.id, myUserId);
                    onLeft();
                  });
                }}
              />
            </div>
          )}
        </div>
      </Sheet>

      {/* Lägg till personer */}
      <Sheet
        open={open && adding}
        onClose={() => setAdding(false)}
        title="Lägg till i gruppen"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setAdding(false)}>Avbryt</Button>
            <Button
              disabled={!toAdd.length || busy}
              onClick={() => run(async () => { onDetail((await addChatParticipants(detail.id, toAdd)).conversation); setAdding(false); })}
            >
              Lägg till {toAdd.length ? `(${toAdd.length})` : ''}
            </Button>
          </div>
        }
      >
        {error && <p className="px-3 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <ChatPeoplePicker clubId={clubId} selected={toAdd} onChange={setToAdd} exclude={detail.participants.map((p) => p.userId)} />
      </Sheet>

      {/* En deltagare (för gruppadmin) */}
      <Sheet open={!!person} onClose={() => setPerson(null)} title={person?.name}>
        {person && (
          <div className="flex flex-col gap-0.5">
            {person.role !== 'admin' && (
              <MenuItem
                icon={<Crown size={18} />}
                label="Gör till gruppadmin"
                description="Kan byta namn och lägga till och ta bort deltagare"
                onClick={() => run(async () => { onDetail((await makeChatAdmin(detail.id, person.userId)).conversation); setPerson(null); })}
              />
            )}
            <MenuItem
              icon={<UserMinus size={18} />}
              label="Ta bort ur gruppen"
              tone="danger"
              onClick={() => run(async () => {
                const r = await removeChatParticipant(detail.id, person.userId);
                setPerson(null);
                if (r.conversation) onDetail(r.conversation);
                else onLeft();
              })}
            />
          </div>
        )}
      </Sheet>
    </>
  );
};
