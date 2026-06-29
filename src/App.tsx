import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, CloudOff, RefreshCw, RotateCcw, Save, Users } from 'lucide-react';
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
  slotIndex: number;
  localLabel: string;
  hour: number;
  minute: number;
};

type DragState = {
  isAvailable: boolean;
  lastSlot: Slot;
  touchedSlotTimes: Set<string>;
};

const PEOPLE: Person[] = [
  {
    name: 'Jaiden',
    city: 'Sydney',
    timezone: 'Australia/Sydney',
    standardLabel: 'Sydney time',
    color: 'blue',
  },
  {
    name: 'Hansol',
    city: 'Seoul',
    timezone: 'Asia/Seoul',
    standardLabel: 'KST',
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
const TOTAL_WEEKS = 16;
const HOURS_PER_DAY = 24;

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

function buildSlots(timeZone: string, weekOffset: number) {
  const currentWeekStart = getViewerWeekStart(timeZone);
  const start = addLocalDays(currentWeekStart.year, currentWeekStart.month, currentWeekStart.day, weekOffset * 7);
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
        slotIndex,
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

function getAvailabilityClassNames(availableUsers: UserName[]) {
  if (availableUsers.length === 0) return 'empty';

  return availableUsers.map((userName) => `available-${userName.toLowerCase()}`).join(' ');
}

function makeUserSlotSet(userName: UserName | null, slots: Slot[], availability: Map<string, AvailabilityRow>) {
  const slotTimes = new Set<string>();

  if (!userName) return slotTimes;

  for (const slot of slots) {
    if (availability.get(makeAvailabilityKey(userName, slot.iso))?.is_available) {
      slotTimes.add(slot.iso);
    }
  }

  return slotTimes;
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
  const [weekOffset, setWeekOffset] = useState(0);
  const [draftAvailableSlots, setDraftAvailableSlots] = useState<Set<string>>(() => new Set());
  const [dirtySlotTimes, setDirtySlotTimes] = useState<Set<string>>(() => new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dragState = useRef<DragState | null>(null);
  const draftScope = useRef('');

  const selectedPerson = useMemo(
    () => PEOPLE.find((person) => person.name === selectedUser) ?? null,
    [selectedUser],
  );

  const { slots, dayDates } = useMemo(
    () => buildSlots(selectedPerson?.timezone ?? PEOPLE[0].timezone, weekOffset),
    [selectedPerson?.timezone, weekOffset],
  );

  const slotSet = useMemo(() => new Set(slots.map((slot) => slot.iso)), [slots]);
  const slotByGridKey = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);
  const slotByIso = useMemo(() => new Map(slots.map((slot) => [slot.iso, slot])), [slots]);
  const weekRange = useMemo(
    () => formatWeekRange(slots, selectedPerson?.timezone ?? PEOPLE[0].timezone),
    [selectedPerson?.timezone, slots],
  );
  const weekLabel = `Week ${weekOffset + 1}`;
  const draftScopeKey = `${selectedUser ?? 'none'}-${weekOffset}`;
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

  const remoteSelectedAvailableSlots = useMemo(
    () => makeUserSlotSet(selectedUser, slots, availability),
    [availability, selectedUser, slots],
  );

  const visibleSlotsByTime = useMemo(() => {
    const map = new Map<string, UserName[]>();

    for (const slot of slots) {
      const names = PEOPLE.filter((person) => {
        if (person.name === selectedUser) {
          return draftAvailableSlots.has(slot.iso);
        }

        const row = availability.get(makeAvailabilityKey(person.name, slot.iso));
        return row?.is_available;
      }).map((person) => person.name);

      map.set(slot.iso, names);
    }

    return map;
  }, [availability, draftAvailableSlots, selectedUser, slots]);

  const unsavedCount = dirtySlotTimes.size;
  const syncLabel =
    status === 'offline'
      ? 'Local demo'
      : status === 'error'
        ? 'Sync error'
        : status === 'loading'
          ? 'Syncing'
          : 'Realtime on';

  useEffect(() => {
    if (selectedUser) {
      window.localStorage.setItem('availability-user', selectedUser);
    }
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedUser) return;

    const scopeChanged = draftScope.current !== draftScopeKey;
    const shouldSyncRemote = dirtySlotTimes.size === 0 && saveState !== 'saved';

    if (scopeChanged || shouldSyncRemote) {
      draftScope.current = draftScopeKey;
      setDraftAvailableSlots(new Set(remoteSelectedAvailableSlots));
      setDirtySlotTimes(new Set());

      if (scopeChanged) {
        setSaveState('idle');
      }
    }
  }, [dirtySlotTimes.size, draftScopeKey, remoteSelectedAvailableSlots, saveState, selectedUser]);

  useEffect(() => {
    const stopDragging = () => {
      dragState.current = null;
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

  const updateDraftSlots = useCallback(
    (targetSlots: Slot[], isAvailable: boolean) => {
      if (!selectedUser) return;
      const uniqueSlots = Array.from(new Map(targetSlots.map((slot) => [slot.iso, slot])).values());
      if (uniqueSlots.length === 0) return;

      setDraftAvailableSlots((current) => {
        const next = new Set(current);

        for (const slot of uniqueSlots) {
          if (isAvailable) {
            next.add(slot.iso);
          } else {
            next.delete(slot.iso);
          }
        }

        return next;
      });

      setDirtySlotTimes((current) => {
        const next = new Set(current);

        for (const slot of uniqueSlots) {
          if (remoteSelectedAvailableSlots.has(slot.iso) === isAvailable) {
            next.delete(slot.iso);
          } else {
            next.add(slot.iso);
          }
        }

        return next;
      });

      setSaveState('idle');
    },
    [remoteSelectedAvailableSlots, selectedUser],
  );

  const resetDraft = useCallback(() => {
    setDraftAvailableSlots(new Set(remoteSelectedAvailableSlots));
    setDirtySlotTimes(new Set());
    setSaveState('idle');
    dragState.current = null;
  }, [remoteSelectedAvailableSlots]);

  const saveDraft = useCallback(async () => {
    if (!selectedUser || dirtySlotTimes.size === 0) return;

    const rowsToSave = [...dirtySlotTimes]
      .map((slotTime) => slotByIso.get(slotTime))
      .filter((slot): slot is Slot => Boolean(slot))
      .map((slot) => ({
        user_name: selectedUser,
        day_of_week: slot.dayOfWeek,
        slot_time: slot.iso,
        is_available: draftAvailableSlots.has(slot.iso),
      }));

    if (rowsToSave.length === 0) return;

    setSaveState('saving');
    setErrorMessage('');

    if (supabase) {
      const { error } = await supabase.from('availability').upsert(rowsToSave, {
        onConflict: 'user_name,slot_time',
      });

      if (error) {
        setSaveState('error');
        setStatus('error');
        setErrorMessage(error.message);
        return;
      }
    }

    setRows((current) => {
      const nextRows = new Map(current.map((row) => [makeAvailabilityKey(row.user_name, row.slot_time), row]));

      for (const row of rowsToSave) {
        nextRows.set(makeAvailabilityKey(row.user_name, row.slot_time), row);
      }

      return sortRows([...nextRows.values()]);
    });
    setDirtySlotTimes(new Set());
    setSaveState('saved');
  }, [dirtySlotTimes, draftAvailableSlots, selectedUser, slotByIso]);

  const getSlotsBetween = useCallback(
    (fromSlot: Slot, toSlot: Slot) => {
      if (fromSlot.dayIndex !== toSlot.dayIndex) {
        return [toSlot];
      }

      const start = Math.min(fromSlot.slotIndex, toSlot.slotIndex);
      const end = Math.max(fromSlot.slotIndex, toSlot.slotIndex);
      const range: Slot[] = [];

      for (let slotIndex = start; slotIndex <= end; slotIndex += 1) {
        const slot = slotByGridKey.get(`${toSlot.dayIndex}-${slotIndex}`);
        if (slot) {
          range.push(slot);
        }
      }

      return range;
    },
    [slotByGridKey],
  );

  const applyDragToSlot = useCallback(
    (slot: Slot) => {
      const state = dragState.current;
      if (!state) return;

      const rangeSlots = getSlotsBetween(state.lastSlot, slot).filter((rangeSlot) => !state.touchedSlotTimes.has(rangeSlot.iso));
      if (rangeSlots.length === 0) return;

      for (const rangeSlot of rangeSlots) {
        state.touchedSlotTimes.add(rangeSlot.iso);
      }

      state.lastSlot = slot;
      updateDraftSlots(rangeSlots, state.isAvailable);
    },
    [getSlotsBetween, updateDraftSlots],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState.current) return;

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const slotElement = element?.closest<HTMLElement>('[data-slot-key]');
      const slotKey = slotElement?.dataset.slotKey;
      const slot = slotKey ? slotByGridKey.get(slotKey) : null;

      if (slot) {
        applyDragToSlot(slot);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [applyDragToSlot, slotByGridKey]);

  const handleSlotPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, slot: Slot) => {
    if (!selectedUser) return;

    event.preventDefault();
    const current = draftAvailableSlots.has(slot.iso);
    const next = !current;
    dragState.current = {
      isAvailable: next,
      lastSlot: slot,
      touchedSlotTimes: new Set([slot.iso]),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    updateDraftSlots([slot], next);
  };

  const handleSlotPointerEnter = (slot: Slot) => {
    applyDragToSlot(slot);
  };

  const goToPreviousWeek = () => {
    if (unsavedCount > 0 || saveState === 'saving') return;
    setWeekOffset((current) => Math.max(0, current - 1));
  };

  const goToNextWeek = () => {
    if (unsavedCount > 0 || saveState === 'saving') return;
    setWeekOffset((current) => Math.min(TOTAL_WEEKS - 1, current + 1));
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
                {weekLabel} · {weekRange}
              </div>
              <h1>Weekly Availability</h1>
            </div>

            <div className="header-actions">
              <div
                aria-label={syncLabel}
                className={`sync-state ${status}`}
                role="status"
                title={syncLabel}
              >
                {status === 'loading' ? <RefreshCw size={15} className="spin" /> : <Clock size={15} />}
                <span className="sr-only">{syncLabel}</span>
              </div>

              <div className="week-pager" aria-label="Week navigation">
                <button
                  aria-label="Previous week"
                  disabled={weekOffset === 0 || unsavedCount > 0 || saveState === 'saving'}
                  onClick={goToPreviousWeek}
                  type="button"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {weekLabel} / {TOTAL_WEEKS}
                </span>
                <button
                  aria-label="Next week"
                  disabled={weekOffset === TOTAL_WEEKS - 1 || unsavedCount > 0 || saveState === 'saving'}
                  onClick={goToNextWeek}
                  type="button"
                >
                  <ChevronRight size={17} />
                </button>
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

          <section className="controls-row" aria-label="Scheduler controls">
            <div className="control-side left">
              <button className="secondary-action" disabled={unsavedCount === 0 || saveState === 'saving'} onClick={resetDraft} type="button">
                <RotateCcw size={15} />
                Reset
              </button>
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

            <div className="control-side right">
              <span className={unsavedCount > 0 ? 'save-note dirty' : 'save-note'}>
                {saveState === 'saving'
                  ? 'Saving...'
                  : saveState === 'saved'
                    ? 'Saved'
                    : unsavedCount > 0
                      ? `${unsavedCount} unsaved`
                      : 'No changes'}
              </span>
              <button className="primary-action" disabled={unsavedCount === 0 || saveState === 'saving'} onClick={saveDraft} type="button">
                {saveState === 'saving' ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
                Save
              </button>
            </div>
          </section>

          <section className="scheduler" aria-label="Weekly availability grid">
            <div className="grid-head time-head">Time</div>
            {dayDates.map((day) => (
              <div className="grid-head day-head" key={day.label}>
                {day.label}
              </div>
            ))}

            {Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
              const timeLabel = `${String(hour).padStart(2, '0')}:00`;

              return (
                <div className="row-fragment" key={timeLabel}>
                  <div className="time-cell">{timeLabel}</div>
                  {DAY_LABELS.map((_, dayIndex) => {
                    const halfHourSlots = [hour * 2, hour * 2 + 1].map((slotIndex) => slots[dayIndex * SLOT_COUNT + slotIndex]);

                    return (
                      <div className="hour-cell" key={`${dayIndex}-${hour}`}>
                        {halfHourSlots.map((slot) => {
                          const availableUsers = visibleSlotsByTime.get(slot.iso) ?? [];
                          const isMine = selectedUser ? draftAvailableSlots.has(slot.iso) : false;
                          const overlapClass = availableUsers.length > 1 ? 'overlap' : '';
                          const mineClass = isMine ? 'mine' : '';
                          const availabilityClass = getAvailabilityClassNames(availableUsers);

                          return (
                            <button
                              aria-label={`${DAY_LABELS[dayIndex]} ${slot.localLabel}, ${availableUsers.length} available`}
                              className={`half-slot slot-cell ${availabilityClass} ${overlapClass} ${mineClass}`}
                              data-slot-key={slot.key}
                              key={slot.key}
                              onPointerDown={(event) => handleSlotPointerDown(event, slot)}
                              onPointerEnter={() => handleSlotPointerEnter(slot)}
                              type="button"
                            />
                          );
                        })}
                      </div>
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
