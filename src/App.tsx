import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Clock, CloudOff, RefreshCw, Users } from 'lucide-react';
import { AvailabilityRow, isSupabaseConfigured, supabase } from './supabase';

type UserName = 'Jaiden' | 'Hansol' | 'Jieun';

type Person = {
  name: UserName;
  city: string;
  timezone: string;
  standardLabel: string;
  color: string;
};

type Slot = {
  key: string;
  iso: string;
  dayIndex: number;
  dayOfWeek: number;
  localLabel: string;
  hour: number;
  minute: number;
};

const PEOPLE: Person[] = [
  {
    name: 'Jaiden',
    city: 'Seoul',
    timezone: 'Asia/Seoul',
    standardLabel: 'KST',
    color: 'blue',
  },
  {
    name: 'Hansol',
    city: 'Sydney',
    timezone: 'Australia/Sydney',
    standardLabel: 'Sydney time',
    color: 'green',
  },
  {
    name: 'Jieun',
    city: 'Perth',
    timezone: 'Australia/Perth',
    standardLabel: 'AWST',
    color: 'orange',
  },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_COUNT = 48;
const MINUTES_PER_SLOT = 30;

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

function zonedLocalTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let utc = target;

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    utc -= rendered - target;
  }

  return new Date(utc);
}

function addLocalDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getViewerWeekStart(timeZone: string) {
  const nowParts = getZonedParts(new Date(), timeZone);
  const weekdayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(nowParts.weekday);
  const daysSinceMonday = weekdayIndex === -1 ? 0 : weekdayIndex;

  return addLocalDays(nowParts.year, nowParts.month, nowParts.day, -daysSinceMonday);
}

function formatDateLabel(year: number, month: number, day: number, timeZone: string) {
  const utc = zonedLocalTimeToUtc(year, month, day, 12, 0, timeZone);

  return new Intl.DateTimeFormat('en', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(utc);
}

function formatWeekRange(slots: Slot[], timeZone: string) {
  if (slots.length === 0) return '';

  const first = new Date(slots[0].iso);
  const last = new Date(slots[slots.length - 1].iso);
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    month: 'short',
    day: 'numeric',
  });

  return `${formatter.format(first)} - ${formatter.format(last)}`;
}

function formatTimezoneLabel(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;

  return timeZoneName.replace('GMT', 'UTC');
}

function buildSlots(timeZone: string) {
  const start = getViewerWeekStart(timeZone);
  const slots: Slot[] = [];
  const dayDates = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addLocalDays(start.year, start.month, start.day, dayIndex);
    return {
      ...date,
      label: `${DAY_LABELS[dayIndex]} ${formatDateLabel(date.year, date.month, date.day, timeZone)}`,
    };
  });

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const date = dayDates[dayIndex];

    for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex += 1) {
      const totalMinutes = slotIndex * MINUTES_PER_SLOT;
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      const utc = zonedLocalTimeToUtc(date.year, date.month, date.day, hour, minute, timeZone);

      slots.push({
        key: `${dayIndex}-${slotIndex}`,
        iso: utc.toISOString(),
        dayIndex,
        dayOfWeek: dayIndex + 1,
        localLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        hour,
        minute,
      });
    }
  }

  return { slots, dayDates };
}

function makeAvailabilityKey(userName: string, slotTime: string) {
  return `${userName}::${slotTime}`;
}

function sortRows(rows: AvailabilityRow[]) {
  return [...rows].sort((a, b) => a.slot_time.localeCompare(b.slot_time) || a.user_name.localeCompare(b.user_name));
}

export default function App() {
  const [selectedUser, setSelectedUser] = useState<UserName | null>(() => {
    const saved = window.localStorage.getItem('availability-user');
    return PEOPLE.some((person) => person.name === saved) ? (saved as UserName) : null;
  });
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'synced' | 'offline' | 'error'>(
    isSupabaseConfigured ? 'loading' : 'offline',
  );
  const [errorMessage, setErrorMessage] = useState('');
  const dragMode = useRef<boolean | null>(null);

  const selectedPerson = useMemo(
    () => PEOPLE.find((person) => person.name === selectedUser) ?? null,
    [selectedUser],
  );

  const { slots, dayDates } = useMemo(
    () => buildSlots(selectedPerson?.timezone ?? PEOPLE[0].timezone),
    [selectedPerson?.timezone],
  );

  const slotSet = useMemo(() => new Set(slots.map((slot) => slot.iso)), [slots]);
  const weekRange = useMemo(
    () => formatWeekRange(slots, selectedPerson?.timezone ?? PEOPLE[0].timezone),
    [selectedPerson?.timezone, slots],
  );
  const timezoneLabel = useMemo(() => {
    if (!selectedPerson) return '';
    return `${selectedPerson.standardLabel} ${formatTimezoneLabel(selectedPerson.timezone, new Date(slots[0]?.iso ?? Date.now()))}`;
  }, [selectedPerson, slots]);

  const availability = useMemo(() => {
    const map = new Map<string, AvailabilityRow>();

    for (const row of rows) {
      map.set(makeAvailabilityKey(row.user_name, row.slot_time), row);
    }

    return map;
  }, [rows]);

  const visibleSlotsByTime = useMemo(() => {
    const map = new Map<string, UserName[]>();

    for (const slot of slots) {
      const names = PEOPLE.filter((person) => {
        const row = availability.get(makeAvailabilityKey(person.name, slot.iso));
        return row?.is_available;
      }).map((person) => person.name);

      map.set(slot.iso, names);
    }

    return map;
  }, [availability, slots]);

  useEffect(() => {
    if (selectedUser) {
      window.localStorage.setItem('availability-user', selectedUser);
    }
  }, [selectedUser]);

  useEffect(() => {
    const stopDragging = () => {
      dragMode.current = null;
    };

    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, []);

  const loadAvailability = useCallback(async () => {
    if (!supabase || slots.length === 0) {
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    const orderedSlots = [...slots].sort((a, b) => a.iso.localeCompare(b.iso));
    const firstSlot = orderedSlots[0].iso;
    const lastSlot = orderedSlots[orderedSlots.length - 1].iso;
    const { data, error } = await supabase
      .from('availability')
      .select('*')
      .gte('slot_time', firstSlot)
      .lte('slot_time', lastSlot)
      .order('slot_time', { ascending: true });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
      return;
    }

    setRows(sortRows((data ?? []) as AvailabilityRow[]));
    setStatus('synced');
  }, [slots]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    const client = supabase;
    const channel = supabase
      .channel('availability-grid')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability',
        },
        (payload) => {
          const nextRow = payload.new as AvailabilityRow | null;
          const oldRow = payload.old as AvailabilityRow | null;
          const relevantSlot = nextRow?.slot_time ?? oldRow?.slot_time;

          if (relevantSlot && !slotSet.has(relevantSlot)) {
            return;
          }

          setRows((current) => {
            if (payload.eventType === 'DELETE' && oldRow) {
              return current.filter(
                (row) => makeAvailabilityKey(row.user_name, row.slot_time) !== makeAvailabilityKey(oldRow.user_name, oldRow.slot_time),
              );
            }

            if (!nextRow) return current;

            const rowKey = makeAvailabilityKey(nextRow.user_name, nextRow.slot_time);
            const withoutRow = current.filter((row) => makeAvailabilityKey(row.user_name, row.slot_time) !== rowKey);
            return sortRows([...withoutRow, nextRow]);
          });
        },
      )
      .subscribe((channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setStatus('synced');
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [slotSet]);

  const updateAvailability = useCallback(
    async (slot: Slot, isAvailable: boolean) => {
      if (!selectedUser) return;

      const optimisticRow: AvailabilityRow = {
        user_name: selectedUser,
        day_of_week: slot.dayOfWeek,
        slot_time: slot.iso,
        is_available: isAvailable,
      };

      setRows((current) => {
        const rowKey = makeAvailabilityKey(selectedUser, slot.iso);
        const withoutRow = current.filter((row) => makeAvailabilityKey(row.user_name, row.slot_time) !== rowKey);
        return sortRows([...withoutRow, optimisticRow]);
      });

      if (!supabase) {
        return;
      }

      const { error } = await supabase.from('availability').upsert(optimisticRow, {
        onConflict: 'user_name,slot_time',
      });

      if (error) {
        setStatus('error');
        setErrorMessage(error.message);
      }
    },
    [selectedUser],
  );

  const handleSlotPointerDown = (slot: Slot) => {
    if (!selectedUser) return;

    const current = availability.get(makeAvailabilityKey(selectedUser, slot.iso))?.is_available ?? false;
    const next = !current;
    dragMode.current = next;
    void updateAvailability(slot, next);
  };

  const handleSlotPointerEnter = (slot: Slot) => {
    if (dragMode.current === null) return;
    void updateAvailability(slot, dragMode.current);
  };

  return (
    <main className="app-shell">
      {!selectedUser && (
        <section className="entry-screen" aria-label="Select your name">
          <div className="entry-panel">
            <div className="entry-icon">
              <Users size={28} />
            </div>
            <h1>Weekly Availability</h1>
            <p>Select your name to open the scheduler in your local timezone.</p>
            <div className="person-picker large">
              {PEOPLE.map((person) => (
                <button
                  className={`person-button ${person.color}`}
                  key={person.name}
                  onClick={() => setSelectedUser(person.name)}
                  type="button"
                >
                  <span>{person.name}</span>
                  <small>
                    {person.city} · {person.standardLabel}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {selectedPerson && (
        <>
          <header className="topbar">
            <div>
              <div className="eyebrow">
                <CalendarDays size={16} />
                {weekRange}
              </div>
              <h1>Weekly Availability</h1>
            </div>

            <div className="header-actions">
              <div className={`sync-state ${status}`}>
                {status === 'loading' ? <RefreshCw size={15} className="spin" /> : <Clock size={15} />}
                <span>
                  {status === 'offline'
                    ? 'Local demo'
                    : status === 'error'
                      ? 'Sync error'
                      : status === 'loading'
                        ? 'Syncing'
                        : 'Realtime on'}
                </span>
              </div>

              <div className="person-picker compact" aria-label="Current user">
                {PEOPLE.map((person) => (
                  <button
                    aria-pressed={selectedUser === person.name}
                    className={`person-chip ${person.color}`}
                    key={person.name}
                    onClick={() => setSelectedUser(person.name)}
                    type="button"
                  >
                    {selectedUser === person.name && <Check size={14} />}
                    {person.name}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {!isSupabaseConfigured && (
            <div className="notice">
              <CloudOff size={18} />
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` to enable shared realtime sync.
            </div>
          )}

          {errorMessage && <div className="notice error">{errorMessage}</div>}

          <section className="context-row" aria-label="Scheduler context">
            <div>
              <span className="context-label">Viewing as</span>
              <strong>{selectedPerson.name}</strong>
              <span>
                {selectedPerson.city}, {timezoneLabel}
              </span>
            </div>
            <div className="legend" aria-label="Availability legend">
              {PEOPLE.map((person) => (
                <span className="legend-item" key={person.name}>
                  <span className={`dot ${person.color}`} />
                  {person.name}
                </span>
              ))}
              <span className="legend-item">
                <span className="dot overlap" />
                Overlap
              </span>
            </div>
          </section>

          <section className="scheduler" aria-label="Weekly availability grid">
            <div className="grid-head time-head">Time</div>
            {dayDates.map((day) => (
              <div className="grid-head day-head" key={day.label}>
                {day.label}
              </div>
            ))}

            {Array.from({ length: SLOT_COUNT }, (_, slotIndex) => {
              const hour = Math.floor((slotIndex * MINUTES_PER_SLOT) / 60);
              const minute = (slotIndex * MINUTES_PER_SLOT) % 60;
              const timeLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

              return (
                <div className="row-fragment" key={timeLabel}>
                  <div className="time-cell">{timeLabel}</div>
                  {DAY_LABELS.map((_, dayIndex) => {
                    const slot = slots[dayIndex * SLOT_COUNT + slotIndex];
                    const availableUsers = visibleSlotsByTime.get(slot.iso) ?? [];
                    const isMine = selectedUser
                      ? availability.get(makeAvailabilityKey(selectedUser, slot.iso))?.is_available ?? false
                      : false;
                    const overlapClass = availableUsers.length > 1 ? 'overlap' : '';
                    const mineClass = isMine ? 'mine' : '';

                    return (
                      <button
                        aria-label={`${DAY_LABELS[dayIndex]} ${slot.localLabel}, ${availableUsers.length} available`}
                        className={`slot-cell ${overlapClass} ${mineClass}`}
                        key={slot.key}
                        onPointerDown={() => handleSlotPointerDown(slot)}
                        onPointerEnter={() => handleSlotPointerEnter(slot)}
                        type="button"
                      >
                        <span className="availability-bars" aria-hidden="true">
                          {PEOPLE.map((person) => {
                            const isAvailable = availableUsers.includes(person.name);
                            return <span className={`bar ${person.color} ${isAvailable ? 'on' : ''}`} key={person.name} />;
                          })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
