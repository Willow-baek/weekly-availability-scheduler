import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  MessageSquarePlus,
  Paintbrush,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Undo2,
  Users,
} from 'lucide-react';
import { AvailabilityRow, MeetingEventRow, isSupabaseConfigured, supabase } from './supabase';

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

type PendingTouchState = {
  pointerId: number;
  slot: Slot;
  startX: number;
  startY: number;
  timerId: number;
};

type EventEditorState = {
  slot: Slot;
  title: string;
  note: string;
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
const TOUCH_MOVE_CANCEL_DISTANCE = 12;
const TOUCH_EVENT_DELAY_MS = 780;

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

function formatShortDateLabel(month: number, day: number) {
  return `${month}/${day}`;
}

function formatWeekRange(slots: Slot[], timeZone: string) {
  if (slots.length === 0) return '';

  const first = new Date(slots[0].iso);
  const last = new Date(slots[slots.length - 1].iso);
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    month: 'numeric',
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
      label: `${DAY_LABELS[dayIndex]} ${formatShortDateLabel(date.month, date.day)}`,
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

function buildBufferedWeekSlots(timeZone: string, weekOffset: number) {
  const currentWeekStart = getViewerWeekStart(timeZone);
  const start = addLocalDays(currentWeekStart.year, currentWeekStart.month, currentWeekStart.day, weekOffset * 7);
  const slots: Slot[] = [];

  for (let dayOffset = -1; dayOffset <= 7; dayOffset += 1) {
    const date = addLocalDays(start.year, start.month, start.day, dayOffset);
    const dayOfWeek = ((dayOffset + 7) % 7) + 1;

    for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex += 1) {
      const totalMinutes = slotIndex * MINUTES_PER_SLOT;
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      const utc = zonedLocalTimeToUtc(date.year, date.month, date.day, hour, minute, timeZone);

      slots.push({
        key: `buffer-${dayOffset}-${slotIndex}`,
        iso: utc.toISOString(),
        dayIndex: dayOffset,
        dayOfWeek,
        slotIndex,
        localLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        hour,
        minute,
      });
    }
  }

  return slots;
}

function makeAvailabilityKey(userName: string, slotTime: string) {
  return `${userName}::${normalizeSlotTime(slotTime) ?? slotTime}`;
}

function normalizeSlotTime(slotTime: string) {
  const date = new Date(slotTime);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeAvailabilityRow(row: AvailabilityRow): AvailabilityRow | null {
  if (!row.slot_time) {
    return null;
  }

  const slotTime = normalizeSlotTime(row.slot_time);

  if (!slotTime) {
    return null;
  }

  return {
    ...row,
    slot_time: slotTime,
  };
}

function normalizeAvailabilityRows(rows: AvailabilityRow[]) {
  return rows.map(normalizeAvailabilityRow).filter((row): row is AvailabilityRow => Boolean(row));
}

function normalizeMeetingEventRow(row: MeetingEventRow): MeetingEventRow | null {
  if (!row.starts_at) {
    return null;
  }

  const startsAt = normalizeSlotTime(row.starts_at);

  if (!startsAt) {
    return null;
  }

  return {
    ...row,
    starts_at: startsAt,
  };
}

function normalizeMeetingEventRows(rows: MeetingEventRow[]) {
  return rows.map(normalizeMeetingEventRow).filter((row): row is MeetingEventRow => Boolean(row));
}

function sortRows(rows: AvailabilityRow[]) {
  return normalizeAvailabilityRows(rows).sort(
    (a, b) => a.slot_time.localeCompare(b.slot_time) || a.user_name.localeCompare(b.user_name),
  );
}

function sortEventRows(rows: MeetingEventRow[]) {
  return normalizeMeetingEventRows(rows).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
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

function getDirtySlotTimes(draftSlots: Set<string>, remoteSlots: Set<string>, slots: Slot[]) {
  const dirtySlots = new Set<string>();

  for (const slot of slots) {
    if (draftSlots.has(slot.iso) !== remoteSlots.has(slot.iso)) {
      dirtySlots.add(slot.iso);
    }
  }

  return dirtySlots;
}

function areSetsEqual<T>(first: Set<T>, second: Set<T>) {
  if (first.size !== second.size) return false;

  for (const item of first) {
    if (!second.has(item)) return false;
  }

  return true;
}

function trimHistory<T>(items: Set<T>[]) {
  return items.slice(-30);
}

function formatEventDateTime(slotTime: string, timeZone: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(slotTime));
}

function getCreatorShortLabel(createdBy: string) {
  if (createdBy === 'Jaiden') return 'Jd';
  if (createdBy === 'Hansol') return 'H';
  if (createdBy === 'Jieun') return 'Ji';
  return createdBy.slice(0, 2) || 'M';
}

function formatEventBadge(events: MeetingEventRow[]) {
  const creators = Array.from(new Set(events.map((eventRow) => eventRow.created_by).filter(Boolean)));
  const firstCreator = creators[0];

  if (!firstCreator) return String(events.length);
  if (creators.length > 1) return `${getCreatorShortLabel(firstCreator)}+${creators.length - 1}`;
  if (events.length > 1) return `${getCreatorShortLabel(firstCreator)}+${events.length - 1}`;

  return getCreatorShortLabel(firstCreator);
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
  const [extraClearSlots, setExtraClearSlots] = useState<Slot[]>([]);
  const [undoDraftStack, setUndoDraftStack] = useState<Set<string>[]>([]);
  const [redoDraftStack, setRedoDraftStack] = useState<Set<string>[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [eventRows, setEventRows] = useState<MeetingEventRow[]>([]);
  const [eventErrorMessage, setEventErrorMessage] = useState('');
  const [eventEditor, setEventEditor] = useState<EventEditorState | null>(null);
  const [eventSaveState, setEventSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [isTouchPaintMode, setIsTouchPaintMode] = useState(false);
  const dragState = useRef<DragState | null>(null);
  const draftScope = useRef('');
  const pendingTouch = useRef<PendingTouchState | null>(null);

  const selectedPerson = useMemo(
    () => PEOPLE.find((person) => person.name === selectedUser) ?? null,
    [selectedUser],
  );

  const { slots, dayDates } = useMemo(
    () => buildSlots(selectedPerson?.timezone ?? PEOPLE[0].timezone, weekOffset),
    [selectedPerson?.timezone, weekOffset],
  );

  const eventRange = useMemo(() => {
    const timeZone = selectedPerson?.timezone ?? PEOPLE[0].timezone;
    const firstWeekSlots = buildSlots(timeZone, 0).slots;
    const finalWeekSlots = buildSlots(timeZone, TOTAL_WEEKS - 1).slots;

    return {
      start: firstWeekSlots[0]?.iso ?? new Date().toISOString(),
      end: finalWeekSlots[finalWeekSlots.length - 1]?.iso ?? new Date().toISOString(),
    };
  }, [selectedPerson?.timezone]);

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

  const eventsBySlot = useMemo(() => {
    const map = new Map<string, MeetingEventRow[]>();

    for (const eventRow of eventRows) {
      const slotTime = normalizeSlotTime(eventRow.starts_at);
      if (!slotTime) continue;

      const eventSlotRows = map.get(slotTime) ?? [];
      eventSlotRows.push(eventRow);
      map.set(slotTime, eventSlotRows);
    }

    return map;
  }, [eventRows]);

  const nextEvent = useMemo(() => {
    const now = Date.now();

    return eventRows.find((eventRow) => new Date(eventRow.starts_at).getTime() >= now) ?? null;
  }, [eventRows]);

  const unsavedCount = dirtySlotTimes.size + (extraClearSlots.length > 0 ? 1 : 0);
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
      setExtraClearSlots([]);
      setUndoDraftStack([]);
      setRedoDraftStack([]);

      if (scopeChanged) {
        setSaveState('idle');
      }
    }
  }, [dirtySlotTimes.size, draftScopeKey, remoteSelectedAvailableSlots, saveState, selectedUser]);

  useEffect(() => {
    const stopDragging = () => {
      const pending = pendingTouch.current;
      if (pending) {
        window.clearTimeout(pending.timerId);
        pendingTouch.current = null;
      }
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

  const loadEvents = useCallback(async () => {
    if (!supabase) {
      return;
    }

    setEventErrorMessage('');

    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .gte('starts_at', eventRange.start)
      .lte('starts_at', eventRange.end)
      .order('starts_at', { ascending: true });

    if (error) {
      setEventRows([]);
      setEventErrorMessage(
        error.message.includes('schedule_events')
          ? 'Meeting notes need the updated Supabase schema.'
          : error.message,
      );
      return;
    }

    setEventRows(sortEventRows((data ?? []) as MeetingEventRow[]));
  }, [eventRange.end, eventRange.start]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

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
          const nextRow = payload.new ? normalizeAvailabilityRow(payload.new as AvailabilityRow) : null;
          const oldRow = payload.old ? normalizeAvailabilityRow(payload.old as AvailabilityRow) : null;
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

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    const client = supabase;
    const channel = supabase
      .channel('meeting-events')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedule_events',
        },
        (payload) => {
          const nextRow = payload.new ? normalizeMeetingEventRow(payload.new as MeetingEventRow) : null;
          const oldRow = payload.old ? normalizeMeetingEventRow(payload.old as MeetingEventRow) : null;
          const relevantTime = nextRow?.starts_at ?? oldRow?.starts_at;

          if (relevantTime && (relevantTime < eventRange.start || relevantTime > eventRange.end)) {
            return;
          }

          setEventRows((current) => {
            if (payload.eventType === 'DELETE' && oldRow?.id) {
              return current.filter((row) => row.id !== oldRow.id);
            }

            if (!nextRow) return current;

            const withoutRow = current.filter((row) => row.id !== nextRow.id);
            return sortEventRows([...withoutRow, nextRow]);
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [eventRange.end, eventRange.start]);

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

        if (areSetsEqual(current, next)) {
          return current;
        }

        setUndoDraftStack((history) => trimHistory([...history, new Set(current)]));
        setRedoDraftStack([]);
        setExtraClearSlots([]);
        setDirtySlotTimes(getDirtySlotTimes(next, remoteSelectedAvailableSlots, slots));
        setSaveState('idle');

        return next;
      });
    },
    [remoteSelectedAvailableSlots, selectedUser, slots],
  );

  const resetDraft = useCallback(() => {
    const clearedSlots = new Set<string>();
    const wasAlreadyEmpty = areSetsEqual(draftAvailableSlots, clearedSlots);

    if (!wasAlreadyEmpty) {
      setUndoDraftStack((history) => trimHistory([...history, new Set(draftAvailableSlots)]));
    }

    setRedoDraftStack([]);
    setDraftAvailableSlots(clearedSlots);
    setExtraClearSlots(buildBufferedWeekSlots(selectedPerson?.timezone ?? PEOPLE[0].timezone, weekOffset));
    setDirtySlotTimes(getDirtySlotTimes(clearedSlots, remoteSelectedAvailableSlots, slots));
    setSaveState('idle');
    dragState.current = null;
  }, [draftAvailableSlots, remoteSelectedAvailableSlots, selectedPerson?.timezone, slots, weekOffset]);

  const undoDraft = useCallback(() => {
    const previousDraft = undoDraftStack[undoDraftStack.length - 1];

    if (!previousDraft) return;

    const restoredSlots = new Set(previousDraft);
    setUndoDraftStack((history) => history.slice(0, -1));
    setRedoDraftStack((history) => trimHistory([...history, new Set(draftAvailableSlots)]));
    setDraftAvailableSlots(restoredSlots);
    setExtraClearSlots([]);
    setDirtySlotTimes(getDirtySlotTimes(restoredSlots, remoteSelectedAvailableSlots, slots));
    setSaveState('idle');
    dragState.current = null;
  }, [draftAvailableSlots, remoteSelectedAvailableSlots, slots, undoDraftStack]);

  const redoDraft = useCallback(() => {
    const nextDraft = redoDraftStack[redoDraftStack.length - 1];

    if (!nextDraft) return;

    const restoredSlots = new Set(nextDraft);
    setRedoDraftStack((history) => history.slice(0, -1));
    setUndoDraftStack((history) => trimHistory([...history, new Set(draftAvailableSlots)]));
    setDraftAvailableSlots(restoredSlots);
    setExtraClearSlots([]);
    setDirtySlotTimes(getDirtySlotTimes(restoredSlots, remoteSelectedAvailableSlots, slots));
    setSaveState('idle');
    dragState.current = null;
  }, [draftAvailableSlots, redoDraftStack, remoteSelectedAvailableSlots, slots]);

  const openEventEditor = useCallback((slot: Slot) => {
    setEventEditor({
      slot,
      title: 'Zoom meeting',
      note: '',
    });
    setEventSaveState('idle');
  }, []);

  const cancelPendingTouch = useCallback(() => {
    const pending = pendingTouch.current;
    if (!pending) return;

    window.clearTimeout(pending.timerId);
    pendingTouch.current = null;
  }, []);

  const closeEventEditor = useCallback(() => {
    setEventEditor(null);
    setEventSaveState('idle');
  }, []);

  const saveEvent = useCallback(async () => {
    if (!eventEditor || !selectedUser) return;

    const title = eventEditor.title.trim() || 'Zoom meeting';
    const note = eventEditor.note.trim();
    const rowToSave = {
      title,
      note: note || null,
      starts_at: eventEditor.slot.iso,
      created_by: selectedUser,
    };

    setEventSaveState('saving');
    setEventErrorMessage('');

    if (supabase) {
      const { data, error } = await supabase.from('schedule_events').insert(rowToSave).select('*').single();

      if (error) {
        setEventSaveState('error');
        setEventErrorMessage(
          error.message.includes('schedule_events')
            ? 'Meeting notes need the updated Supabase schema.'
            : error.message,
        );
        return;
      }

      const savedRow = normalizeMeetingEventRow(data as MeetingEventRow);
      if (savedRow) {
        setEventRows((current) => sortEventRows([...current, savedRow]));
      }
    } else {
      setEventRows((current) =>
        sortEventRows([
          ...current,
          {
            ...rowToSave,
            id: crypto.randomUUID(),
          },
        ]),
      );
    }

    setEventEditor(null);
    setEventSaveState('idle');
  }, [eventEditor, selectedUser]);

  const saveDraft = useCallback(async () => {
    if (!selectedUser || (dirtySlotTimes.size === 0 && extraClearSlots.length === 0)) return;

    const rowsBySlotTime = new Map<string, AvailabilityRow>();

    for (const slot of extraClearSlots) {
      rowsBySlotTime.set(slot.iso, {
        user_name: selectedUser,
        day_of_week: slot.dayOfWeek,
        slot_time: slot.iso,
        is_available: false,
      });
    }

    for (const row of [...dirtySlotTimes]
      .map((slotTime) => slotByIso.get(slotTime))
      .filter((slot): slot is Slot => Boolean(slot))
      .map((slot) => ({
        user_name: selectedUser,
        day_of_week: slot.dayOfWeek,
        slot_time: slot.iso,
        is_available: draftAvailableSlots.has(slot.iso),
      }))) {
      rowsBySlotTime.set(row.slot_time, row);
    }

    const rowsToSave = [...rowsBySlotTime.values()];

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

      for (const row of normalizeAvailabilityRows(rowsToSave)) {
        nextRows.set(makeAvailabilityKey(row.user_name, row.slot_time), row);
      }

      return sortRows([...nextRows.values()]);
    });
    setDirtySlotTimes(new Set());
    setExtraClearSlots([]);
    setUndoDraftStack([]);
    setRedoDraftStack([]);
    setSaveState('saved');
  }, [dirtySlotTimes, draftAvailableSlots, extraClearSlots, selectedUser, slotByIso]);

  const beginAvailabilityDrag = useCallback(
    (slot: Slot) => {
      if (!selectedUser) return;

      const current = draftAvailableSlots.has(slot.iso);
      const next = !current;
      dragState.current = {
        isAvailable: next,
        lastSlot: slot,
        touchedSlotTimes: new Set([slot.iso]),
      };

      updateDraftSlots([slot], next);
    },
    [draftAvailableSlots, selectedUser, updateDraftSlots],
  );

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
      const pending = pendingTouch.current;

      if (pending && pending.pointerId === event.pointerId) {
        const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > TOUCH_MOVE_CANCEL_DISTANCE;

        if (moved) {
          window.clearTimeout(pending.timerId);
          pendingTouch.current = null;
          dragState.current = null;
        }

        return;
      }

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
  }, [applyDragToSlot, beginAvailabilityDrag, slotByGridKey]);

  const handleSlotPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, slot: Slot) => {
    if (!selectedUser) return;

    if (event.pointerType === 'touch') {
      if (isTouchPaintMode) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        beginAvailabilityDrag(slot);
        return;
      }

      const timerId = window.setTimeout(() => {
        pendingTouch.current = null;
        dragState.current = null;
        openEventEditor(slot);
      }, TOUCH_EVENT_DELAY_MS);

      pendingTouch.current = {
        pointerId: event.pointerId,
        slot,
        startX: event.clientX,
        startY: event.clientY,
        timerId,
      };
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginAvailabilityDrag(slot);
  };

  const handleSlotPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, slot: Slot) => {
    const pending = pendingTouch.current;

    if (!pending || pending.pointerId !== event.pointerId) return;

    cancelPendingTouch();
    beginAvailabilityDrag(slot);
    dragState.current = null;
  };

  const handleSlotContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, slot: Slot) => {
    event.preventDefault();

    cancelPendingTouch();

    dragState.current = null;
    openEventEditor(slot);
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

  const selectUser = (userName: UserName) => {
    if (selectedUser && selectedUser !== userName && (unsavedCount > 0 || saveState === 'saving')) {
      return;
    }

    setSelectedUser(userName);
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
                  onClick={() => selectUser(person.name)}
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

          {eventErrorMessage && (
            <div className="notice event-warning">
              <MessageSquarePlus size={18} />
              {eventErrorMessage}
            </div>
          )}

          {nextEvent && (
            <section className="upcoming-event" aria-label="Upcoming meeting">
              <div>
                <span className="context-label">Next meeting</span>
                <strong>{nextEvent.title}</strong>
                <span>{formatEventDateTime(nextEvent.starts_at, selectedPerson.timezone)}</span>
                <span>by {nextEvent.created_by}</span>
              </div>
              {nextEvent.note && <p>{nextEvent.note}</p>}
            </section>
          )}

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
            </div>
          </section>

          <section className="controls-row" aria-label="Scheduler controls">
            <div className="control-side left">
              <button
                aria-label="Clear current user's week"
                className="secondary-action icon-action"
                disabled={saveState === 'saving'}
                onClick={resetDraft}
                title="Clear this user's week. Save to publish."
                type="button"
              >
                <RotateCcw size={15} />
              </button>
              <button
                aria-label="Undo"
                className="secondary-action icon-action"
                disabled={undoDraftStack.length === 0 || saveState === 'saving'}
                onClick={undoDraft}
                title="Undo"
                type="button"
              >
                <Undo2 size={15} />
              </button>
              <button
                aria-label="Redo"
                className="secondary-action icon-action"
                disabled={redoDraftStack.length === 0 || saveState === 'saving'}
                onClick={redoDraft}
                title="Redo"
                type="button"
              >
                <Redo2 size={15} />
              </button>
              <button
                aria-label={isTouchPaintMode ? 'Turn off touch paint mode' : 'Turn on touch paint mode'}
                aria-pressed={isTouchPaintMode}
                className="secondary-action icon-action touch-paint-action"
                disabled={saveState === 'saving'}
                onClick={() => setIsTouchPaintMode((current) => !current)}
                title={isTouchPaintMode ? 'Touch paint mode on' : 'Touch paint mode off'}
                type="button"
              >
                <Paintbrush size={15} />
              </button>
            </div>

            <div className="person-picker compact" aria-label="Current user">
              {PEOPLE.map((person) => (
                <button
                  aria-pressed={selectedUser === person.name}
                  className={`person-chip ${person.color}`}
                  disabled={selectedUser !== person.name && (unsavedCount > 0 || saveState === 'saving')}
                  key={person.name}
                  onClick={() => selectUser(person.name)}
                  title={selectedUser !== person.name && unsavedCount > 0 ? 'Save or undo changes before switching users' : person.name}
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
              <button
                aria-label="Save changes"
                className="primary-action icon-action"
                disabled={unsavedCount === 0 || saveState === 'saving'}
                onClick={saveDraft}
                title="Save changes"
                type="button"
              >
                {saveState === 'saving' ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
              </button>
            </div>
          </section>

          <section className={`scheduler ${isTouchPaintMode ? 'paint-mode' : ''}`} aria-label="Weekly availability grid">
            <div className="grid-head time-head">Time</div>
            {dayDates.map((day) => (
              <div className="grid-head day-head" key={day.label}>
                {day.label}
              </div>
            ))}

            {Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
              const timeLabel = `${String(hour).padStart(2, '0')}:00`;
              const periodLabel = hour === 0 ? '오전' : hour === 12 ? '오후' : '';
              const periodClass = hour === 12 ? 'period-start' : '';

              return (
                <div className="row-fragment" key={timeLabel}>
                  <div className={`time-cell ${periodClass}`}>
                    <span>{timeLabel}</span>
                    {periodLabel && <small>{periodLabel}</small>}
                  </div>
                  {DAY_LABELS.map((_, dayIndex) => {
                    const halfHourSlots = [hour * 2, hour * 2 + 1].map((slotIndex) => slots[dayIndex * SLOT_COUNT + slotIndex]);

                    return (
                      <div className={`hour-cell ${periodClass}`} key={`${dayIndex}-${hour}`}>
                        {halfHourSlots.map((slot) => {
                          const availableUsers = visibleSlotsByTime.get(slot.iso) ?? [];
                          const slotEvents = eventsBySlot.get(slot.iso) ?? [];
                          const isMine = selectedUser ? draftAvailableSlots.has(slot.iso) : false;
                          const mineClass = isMine ? 'mine' : '';
                          const emptyClass = availableUsers.length === 0 ? 'empty' : '';
                          const eventClass = slotEvents.length > 0 ? 'has-event' : '';

                          return (
                            <button
                              aria-label={`${DAY_LABELS[dayIndex]} ${slot.localLabel}, ${availableUsers.length} available, ${slotEvents.length} events`}
                              className={`half-slot slot-cell ${emptyClass} ${mineClass} ${eventClass}`}
                              data-slot-key={slot.key}
                              key={slot.key}
                              onContextMenu={(event) => handleSlotContextMenu(event, slot)}
                              onPointerDown={(event) => handleSlotPointerDown(event, slot)}
                              onPointerEnter={() => handleSlotPointerEnter(slot)}
                              onPointerUp={(event) => handleSlotPointerUp(event, slot)}
                              type="button"
                            >
                              {PEOPLE.map((person) => (
                                <span
                                  aria-hidden="true"
                                  className={`slot-segment ${person.color} ${availableUsers.includes(person.name) ? 'active' : ''}`}
                                  key={person.name}
                                />
                              ))}
                              {slotEvents.length > 0 && (
                                <>
                                  <span aria-hidden="true" className="event-badge">
                                    {formatEventBadge(slotEvents)}
                                  </span>
                                  <span className="event-tooltip" role="tooltip">
                                    {slotEvents.map((eventRow) => (
                                      <span className="event-tooltip-item" key={eventRow.id ?? `${eventRow.starts_at}-${eventRow.title}`}>
                                        <strong>{eventRow.title}</strong>
                                        <span>
                                          {formatEventDateTime(eventRow.starts_at, selectedPerson.timezone)} · by {eventRow.created_by}
                                        </span>
                                        {eventRow.note && <em>{eventRow.note}</em>}
                                      </span>
                                    ))}
                                  </span>
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>

          {eventEditor && (
            <div className="event-dialog-backdrop" role="presentation">
              <form
                className="event-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEvent();
                }}
              >
                <div>
                  <span className="context-label">Meeting note</span>
                  <strong>{formatEventDateTime(eventEditor.slot.iso, selectedPerson.timezone)}</strong>
                </div>
                <label>
                  Title
                  <input
                    autoFocus
                    onChange={(event) => setEventEditor((current) => (current ? { ...current, title: event.target.value } : current))}
                    value={eventEditor.title}
                  />
                </label>
                <label>
                  Memo
                  <textarea
                    onChange={(event) => setEventEditor((current) => (current ? { ...current, note: event.target.value } : current))}
                    placeholder="Zoom link, agenda, or short memo"
                    value={eventEditor.note}
                  />
                </label>
                <div className="event-dialog-actions">
                  <button className="secondary-action" onClick={closeEventEditor} type="button">
                    Cancel
                  </button>
                  <button className="primary-action" disabled={eventSaveState === 'saving'} type="submit">
                    {eventSaveState === 'saving' ? 'Saving...' : 'Add'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </main>
  );
}
