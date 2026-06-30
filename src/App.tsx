import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  CloudOff,
  MessageSquarePlus,
  MonitorSmartphone,
  MousePointerClick,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Smartphone,
  Undo2,
  Users,
  X,
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
  userName: UserName;
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
  id?: string;
  startsAtIso: string;
  date: string;
  time: string;
  timeZone: string;
  title: string;
  note: string;
  durationMinutes: number;
  attendees: UserName[];
  repeatWeekly: boolean;
  repeatCount: number;
  createdBy?: string;
};

type GuideTopic = 'overview' | 'create';
type QuickFillScope = 'week' | 'all-weeks';

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

const VIEW_TIME_ZONES = [
  { city: 'Seoul', label: 'KST', timezone: 'Asia/Seoul' },
  { city: 'Sydney', label: 'Sydney time', timezone: 'Australia/Sydney' },
  { city: 'Perth', label: 'AWST', timezone: 'Australia/Perth' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const QUICK_FILL_DAY_OPTIONS = [
  { label: 'Mon', shortLabel: 'Mo', value: 0 },
  { label: 'Tue', shortLabel: 'Tu', value: 1 },
  { label: 'Wed', shortLabel: 'We', value: 2 },
  { label: 'Thu', shortLabel: 'Th', value: 3 },
  { label: 'Fri', shortLabel: 'Fr', value: 4 },
  { label: 'Sat', shortLabel: 'Sa', value: 5 },
  { label: 'Sun', shortLabel: 'Su', value: 6 },
];
const SLOT_COUNT = 48;
const MINUTES_PER_SLOT = 30;
const TOTAL_WEEKS = 16;
const HOURS_PER_DAY = 24;
const SLEEP_HOURS_START = 1;
const SLEEP_HOURS_END = 7;
const TOUCH_MOVE_CANCEL_DISTANCE = 12;
const TOUCH_EVENT_DELAY_MS = 780;
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const DEFAULT_EVENT_TIME_ZONE = 'Asia/Seoul';
const DEFAULT_EVENT_TITLE = 'Meeting';
const EVENT_DURATION_OPTIONS = [
  { label: '20m', value: 20 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '1.5h', value: 90 },
  { label: '2h', value: 120 },
];
const EVENT_REPEAT_COUNT_OPTIONS = [2, 3, 4, 6, 8, 12];
const ALL_USER_NAMES = PEOPLE.map((person) => person.name);
const QUICK_FILL_TIME_OPTIONS = Array.from({ length: SLOT_COUNT + 1 }, (_, index) => {
  const totalMinutes = index * MINUTES_PER_SLOT;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});
function timeLabelToMinutes(timeLabel: string) {
  const [hour = '0', minute = '0'] = timeLabel.split(':');
  return Number(hour) * 60 + Number(minute);
}

function getFirstUrl(text?: string | null) {
  if (!text) return null;

  const match = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/i);
  const rawUrl = match?.[0]?.replace(/[),.;!?]+$/, '');

  if (!rawUrl) return null;
  return rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;
}

function getUserNameFromValue(value: string | null) {
  if (!value) return null;

  const normalizedValue = value.trim().toLowerCase();
  return PEOPLE.find((person) => person.name.toLowerCase() === normalizedValue)?.name ?? null;
}

function getUserNameFromUrl() {
  return getUserNameFromValue(new URL(window.location.href).searchParams.get('user'));
}

function updateUserUrl(userName: UserName) {
  const url = new URL(window.location.href);

  if (url.searchParams.get('user') === userName) return;

  url.searchParams.set('user', userName);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function canWriteForCurrentUrl(userName: UserName) {
  const urlUser = getUserNameFromUrl();
  return !urlUser || urlUser === userName;
}

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

function getLocalDateTimeFields(slotTime: string, timeZone: string) {
  const parts = getZonedParts(new Date(slotTime), timeZone);

  return {
    date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}

function localDateTimeFieldsToIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) {
    return new Date().toISOString();
  }

  return zonedLocalTimeToUtc(year, month, day, hour, minute, timeZone).toISOString();
}

function addDaysToDateInput(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = addLocalDays(year, month, day, days);

  return `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`;
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

function getTimeZoneOption(timeZone: string) {
  return VIEW_TIME_ZONES.find((option) => option.timezone === timeZone) ?? VIEW_TIME_ZONES[0];
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
    duration_minutes: Number.isFinite(row.duration_minutes) ? row.duration_minutes : DEFAULT_EVENT_DURATION_MINUTES,
    attendees: normalizeAttendees(row.attendees),
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

function normalizeAttendees(attendees?: string[] | null): UserName[] {
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return [...ALL_USER_NAMES];
  }

  const validAttendees = attendees.filter((name): name is UserName => PEOPLE.some((person) => person.name === name));
  return validAttendees.length > 0 ? validAttendees : [...ALL_USER_NAMES];
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

function getDirtySlotTimesWithExternalDrafts(
  draftSlots: Set<string>,
  remoteSlots: Set<string>,
  visibleSlots: Slot[],
  allSlots: Slot[],
) {
  const dirtySlots = getDirtySlotTimes(draftSlots, remoteSlots, visibleSlots);
  const visibleSlotTimes = new Set(visibleSlots.map((slot) => slot.iso));

  for (const slot of allSlots) {
    if (!visibleSlotTimes.has(slot.iso) && draftSlots.has(slot.iso)) {
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

function getEventDurationMinutes(eventRow: MeetingEventRow) {
  return Number.isFinite(eventRow.duration_minutes) ? eventRow.duration_minutes ?? DEFAULT_EVENT_DURATION_MINUTES : DEFAULT_EVENT_DURATION_MINUTES;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  const firstEvent = events[0];

  if (!firstCreator) return String(events.length);
  if (creators.length > 1) return `${getCreatorShortLabel(firstCreator)}+${creators.length - 1}`;
  if (events.length > 1) return `${getCreatorShortLabel(firstCreator)}+${events.length - 1}`;

  return `${getCreatorShortLabel(firstCreator)} ${formatDuration(getEventDurationMinutes(firstEvent))}`;
}

function formatAttendeeLabel(eventRow: MeetingEventRow) {
  const attendees = normalizeAttendees(eventRow.attendees);
  return attendees.length === PEOPLE.length ? 'All' : attendees.join(', ');
}

function isEventRelevantToUser(eventRow: MeetingEventRow, userName: UserName | null) {
  if (!userName) return true;
  return normalizeAttendees(eventRow.attendees).includes(userName);
}

function isMissingEventDetailColumnError(message: string) {
  return message.includes('duration_minutes') || message.includes('attendees');
}

export default function App() {
  const [selectedUser, setSelectedUser] = useState<UserName | null>(() => {
    return getUserNameFromUrl();
  });
  const [displayTimeZone, setDisplayTimeZone] = useState(() => {
    const initialUser = getUserNameFromUrl();
    return PEOPLE.find((person) => person.name === initialUser)?.timezone ?? PEOPLE[0].timezone;
  });
  const [isTimeZonePickerOpen, setIsTimeZonePickerOpen] = useState(false);
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
  const [quickFillStart, setQuickFillStart] = useState('07:00');
  const [quickFillEnd, setQuickFillEnd] = useState('10:00');
  const [quickFillDays, setQuickFillDays] = useState<Set<number>>(() => new Set(QUICK_FILL_DAY_OPTIONS.map((option) => option.value)));
  const [isQuickFillOpen, setIsQuickFillOpen] = useState(false);
  const [areSleepHoursCollapsed, setAreSleepHoursCollapsed] = useState(true);
  const [eventRows, setEventRows] = useState<MeetingEventRow[]>([]);
  const [eventErrorMessage, setEventErrorMessage] = useState('');
  const [eventEditor, setEventEditor] = useState<EventEditorState | null>(null);
  const [eventSaveState, setEventSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideTopic, setGuideTopic] = useState<GuideTopic>('overview');
  const [isCompactGuide, setIsCompactGuide] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const [isTouchPaintMode, setIsTouchPaintMode] = useState(false);
  const dragState = useRef<DragState | null>(null);
  const draftScope = useRef('');
  const pendingTouch = useRef<PendingTouchState | null>(null);

  const selectedPerson = useMemo(
    () => PEOPLE.find((person) => person.name === selectedUser) ?? null,
    [selectedUser],
  );
  const displayTimeZoneOption = useMemo(() => getTimeZoneOption(displayTimeZone), [displayTimeZone]);

  const { slots, dayDates } = useMemo(
    () => buildSlots(displayTimeZone, weekOffset),
    [displayTimeZone, weekOffset],
  );

  const eventRange = useMemo(() => {
    const timeZone = displayTimeZone;
    const firstWeekSlots = buildSlots(timeZone, 0).slots;
    const finalWeekSlots = buildSlots(timeZone, TOTAL_WEEKS - 1).slots;

    return {
      start: firstWeekSlots[0]?.iso ?? new Date().toISOString(),
      end: finalWeekSlots[finalWeekSlots.length - 1]?.iso ?? new Date().toISOString(),
    };
  }, [displayTimeZone]);

  const slotSet = useMemo(() => new Set(slots.map((slot) => slot.iso)), [slots]);
  const slotByGridKey = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);
  const slotByIso = useMemo(() => new Map(slots.map((slot) => [slot.iso, slot])), [slots]);
  const allWeekSlots = useMemo(
    () => Array.from({ length: TOTAL_WEEKS }, (_, targetWeekOffset) => buildSlots(displayTimeZone, targetWeekOffset).slots).flat(),
    [displayTimeZone],
  );
  const slotByIsoAllWeeks = useMemo(() => new Map(allWeekSlots.map((slot) => [slot.iso, slot])), [allWeekSlots]);
  const weekRange = useMemo(
    () => formatWeekRange(slots, displayTimeZone),
    [displayTimeZone, slots],
  );
  const weekLabel = `Week ${weekOffset + 1}`;
  const draftScopeKey = `${selectedUser ?? 'none'}-${displayTimeZone}-${weekOffset}`;
  const timezoneLabel = useMemo(() => {
    return `${displayTimeZoneOption.label} ${formatTimezoneLabel(displayTimeZone, new Date(slots[0]?.iso ?? Date.now()))}`;
  }, [displayTimeZone, displayTimeZoneOption.label, slots]);

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
      const eventStart = new Date(eventRow.starts_at).getTime();
      const eventEnd = eventStart + getEventDurationMinutes(eventRow) * 60 * 1000;

      for (const slot of slots) {
        const slotStart = new Date(slot.iso).getTime();
        const slotEnd = slotStart + MINUTES_PER_SLOT * 60 * 1000;

        if (slotStart < eventEnd && slotEnd > eventStart) {
          const eventSlotRows = map.get(slot.iso) ?? [];
          eventSlotRows.push(eventRow);
          map.set(slot.iso, eventSlotRows);
        }
      }
    }

    return map;
  }, [eventRows, slots]);

  const nextEvent = useMemo(() => {
    const now = Date.now();

    return eventRows.find((eventRow) => new Date(eventRow.starts_at).getTime() >= now) ?? null;
  }, [eventRows]);
  const nextEventUrl = useMemo(() => getFirstUrl(nextEvent?.note), [nextEvent]);

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
    const mediaQuery = window.matchMedia('(max-width: 860px)');
    const updateGuideMode = () => setIsCompactGuide(mediaQuery.matches);

    updateGuideMode();
    mediaQuery.addEventListener('change', updateGuideMode);

    return () => mediaQuery.removeEventListener('change', updateGuideMode);
  }, []);

  useEffect(() => {
    const urlUser = getUserNameFromUrl();

    if (urlUser && urlUser !== selectedUser) {
      const urlPerson = PEOPLE.find((person) => person.name === urlUser);

      setSelectedUser(urlUser);
      if (urlPerson) {
        setDisplayTimeZone(urlPerson.timezone);
      }
      return;
    }

    if (selectedUser) {
      window.localStorage.setItem('availability-user', selectedUser);
      if (!urlUser) {
        updateUserUrl(selectedUser);
      }
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
          ? 'Event details need the updated Supabase schema.'
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
      return;
    }

    void supabase
      .from('schedule_events')
      .select('duration_minutes,attendees')
      .limit(1)
      .then(({ error }) => {
        if (error && isMissingEventDetailColumnError(error.message)) {
          setEventErrorMessage('Event duration and attendees need the updated Supabase schema. Run supabase/schema.sql, then refresh.');
        }
      });
  }, []);

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
    (targetSlots: Slot[], isAvailable: boolean, userName = selectedUser) => {
      if (!selectedUser || userName !== selectedUser || !canWriteForCurrentUrl(userName)) return;
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

  const applyQuickFill = useCallback(
    (scope: QuickFillScope) => {
      if (!selectedUser || !canWriteForCurrentUrl(selectedUser)) return;

      const startMinutes = timeLabelToMinutes(quickFillStart);
      const endMinutes = timeLabelToMinutes(quickFillEnd);

      if (endMinutes <= startMinutes) return;

      const sourceSlots = scope === 'all-weeks' ? allWeekSlots : slots;
      const targetSlots = sourceSlots.filter((slot) => {
        const slotMinutes = slot.slotIndex * MINUTES_PER_SLOT;
        const isInTimeRange = slotMinutes >= startMinutes && slotMinutes < endMinutes;
        const isInDayRange = quickFillDays.has(slot.dayIndex);

        return isInTimeRange && isInDayRange;
      });

      if (targetSlots.length === 0) return;

      setDraftAvailableSlots((current) => {
        const next = new Set(current);

        for (const slot of targetSlots) {
          next.add(slot.iso);
        }

        if (areSetsEqual(current, next)) {
          return current;
        }

        setUndoDraftStack((history) => trimHistory([...history, new Set(current)]));
        setRedoDraftStack([]);
        setExtraClearSlots([]);
        setDirtySlotTimes((currentDirtySlots) => {
          const nextDirtySlots = new Set([
            ...getDirtySlotTimesWithExternalDrafts(next, remoteSelectedAvailableSlots, slots, allWeekSlots),
            ...currentDirtySlots,
          ]);

          for (const slot of targetSlots) {
            nextDirtySlots.add(slot.iso);
          }

          return nextDirtySlots;
        });
        setSaveState('idle');
        dragState.current = null;

        return next;
      });
    },
    [allWeekSlots, quickFillDays, quickFillEnd, quickFillStart, remoteSelectedAvailableSlots, selectedUser, slots],
  );

  const resetDraft = useCallback(() => {
    if (!selectedUser || !canWriteForCurrentUrl(selectedUser)) return;

    const clearedSlots = new Set<string>();
    const wasAlreadyEmpty = areSetsEqual(draftAvailableSlots, clearedSlots);

    if (!wasAlreadyEmpty) {
      setUndoDraftStack((history) => trimHistory([...history, new Set(draftAvailableSlots)]));
    }

    setRedoDraftStack([]);
    setDraftAvailableSlots(clearedSlots);
    setExtraClearSlots(buildBufferedWeekSlots(displayTimeZone, weekOffset));
    setDirtySlotTimes(getDirtySlotTimes(clearedSlots, remoteSelectedAvailableSlots, slots));
    setSaveState('idle');
    dragState.current = null;
  }, [displayTimeZone, draftAvailableSlots, remoteSelectedAvailableSlots, selectedUser, slots, weekOffset]);

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

  const openEventEditor = useCallback((slot: Slot, eventRow?: MeetingEventRow) => {
    const startsAtIso = eventRow?.starts_at ?? slot.iso;
    const defaultFields = getLocalDateTimeFields(startsAtIso, DEFAULT_EVENT_TIME_ZONE);

    setEventEditor({
      id: eventRow?.id,
      startsAtIso,
      date: defaultFields.date,
      time: defaultFields.time,
      timeZone: DEFAULT_EVENT_TIME_ZONE,
      title: eventRow?.title ?? DEFAULT_EVENT_TITLE,
      note: eventRow?.note ?? '',
      durationMinutes: getEventDurationMinutes(eventRow ?? { title: '', starts_at: slot.iso, created_by: selectedUser ?? '' }),
      attendees: normalizeAttendees(eventRow?.attendees),
      repeatWeekly: false,
      repeatCount: 4,
      createdBy: eventRow?.created_by,
    });
    setEventSaveState('idle');
  }, [selectedUser]);

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

    const title = eventEditor.title.trim() || DEFAULT_EVENT_TITLE;
    const note = eventEditor.note.trim();
    const startsAtIso = localDateTimeFieldsToIso(eventEditor.date, eventEditor.time, eventEditor.timeZone);
    const rowToSave = {
      title,
      note: note || null,
      starts_at: startsAtIso,
      duration_minutes: eventEditor.durationMinutes,
      attendees: eventEditor.attendees,
      created_by: eventEditor.createdBy ?? selectedUser,
    };
    const repeatCount = eventEditor.id || !eventEditor.repeatWeekly ? 1 : eventEditor.repeatCount;
    const rowsToCreate = Array.from({ length: repeatCount }, (_, index) => ({
      ...rowToSave,
      starts_at: localDateTimeFieldsToIso(addDaysToDateInput(eventEditor.date, index * 7), eventEditor.time, eventEditor.timeZone),
    }));

    setEventSaveState('saving');
    setEventErrorMessage('');

    if (supabase) {
      let { data, error } = eventEditor.id
        ? await supabase.from('schedule_events').update(rowToSave).eq('id', eventEditor.id).select('*').single()
        : await supabase.from('schedule_events').insert(rowsToCreate).select('*');

      if (error) {
        setEventSaveState('error');
        setEventErrorMessage(
          isMissingEventDetailColumnError(error.message)
              ? 'Event duration and attendees need the updated Supabase schema. Run supabase/schema.sql, then save again.'
            : error.message.includes('schedule_events')
              ? 'Event details need the updated Supabase schema.'
            : error.message,
        );
        return;
      }

      const savedRows = Array.isArray(data)
        ? normalizeMeetingEventRows(data as MeetingEventRow[])
        : normalizeMeetingEventRows([data as MeetingEventRow]);
      if (savedRows.length > 0) {
        setEventRows((current) => {
          const savedIds = new Set(savedRows.map((row) => row.id).filter(Boolean));
          const withoutSavedRows = current.filter((row) => !row.id || !savedIds.has(row.id));
          return sortEventRows([...withoutSavedRows, ...savedRows]);
        });
      }
    } else {
      setEventRows((current) =>
        sortEventRows([
          ...current.filter((row) => row.id !== eventEditor.id),
          ...rowsToCreate.map((row, index) => ({
            ...row,
            id: eventEditor.id ?? crypto.randomUUID(),
            created_at: new Date(Date.now() + index).toISOString(),
          })),
        ]),
      );
    }

    setEventEditor(null);
    setEventSaveState('idle');
  }, [eventEditor, selectedUser]);

  const deleteEvent = useCallback(async () => {
    if (!eventEditor?.id) return;

    setEventSaveState('saving');
    setEventErrorMessage('');

    if (supabase) {
      const { error } = await supabase.from('schedule_events').delete().eq('id', eventEditor.id);

      if (error) {
        setEventSaveState('error');
        setEventErrorMessage(error.message);
        return;
      }
    }

    setEventRows((current) => current.filter((row) => row.id !== eventEditor.id));
    setEventEditor(null);
    setEventSaveState('idle');
  }, [eventEditor]);

  const saveDraft = useCallback(async () => {
    if (!selectedUser || !canWriteForCurrentUrl(selectedUser) || (dirtySlotTimes.size === 0 && extraClearSlots.length === 0)) return;

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
      .map((slotTime) => slotByIsoAllWeeks.get(slotTime) ?? slotByIso.get(slotTime))
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
  }, [dirtySlotTimes, draftAvailableSlots, extraClearSlots, selectedUser, slotByIso, slotByIsoAllWeeks]);

  const beginAvailabilityDrag = useCallback(
    (slot: Slot) => {
      if (!selectedUser || !canWriteForCurrentUrl(selectedUser)) return;

      const dragUser = selectedUser;
      const current = draftAvailableSlots.has(slot.iso);
      const next = !current;
      dragState.current = {
        userName: dragUser,
        isAvailable: next,
        lastSlot: slot,
        touchedSlotTimes: new Set([slot.iso]),
      };

      updateDraftSlots([slot], next, dragUser);
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
      if (state.userName !== selectedUser) {
        dragState.current = null;
        return;
      }

      const rangeSlots = getSlotsBetween(state.lastSlot, slot).filter((rangeSlot) => !state.touchedSlotTimes.has(rangeSlot.iso));
      if (rangeSlots.length === 0) return;

      for (const rangeSlot of rangeSlots) {
        state.touchedSlotTimes.add(rangeSlot.iso);
      }

      state.lastSlot = slot;
      updateDraftSlots(rangeSlots, state.isAvailable, state.userName);
    },
    [getSlotsBetween, selectedUser, updateDraftSlots],
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

  const handleSlotPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, slot: Slot, slotEvents: MeetingEventRow[]) => {
    if (!selectedUser) return;

    if ((event.target as HTMLElement).closest('.event-block')) {
      event.preventDefault();
      event.stopPropagation();
      dragState.current = null;
      cancelPendingTouch();
      openEventEditor(slot, slotEvents[0]);
      return;
    }

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
        openEventEditor(slot, slotEvents[0]);
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

  const handleSlotContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, slot: Slot, slotEvents: MeetingEventRow[]) => {
    event.preventDefault();

    cancelPendingTouch();

    dragState.current = null;
    openEventEditor(slot, slotEvents[0]);
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

  const changeDisplayTimeZone = (timeZone: string) => {
    if (unsavedCount > 0 || saveState === 'saving') return;

    setDisplayTimeZone(timeZone);
    setIsTimeZonePickerOpen(false);
  };

  const selectUser = (userName: UserName) => {
    if (selectedUser && selectedUser !== userName && (unsavedCount > 0 || saveState === 'saving')) {
      return;
    }

    const person = PEOPLE.find((item) => item.name === userName);
    setSelectedUser(userName);
    updateUserUrl(userName);
    if (person) {
      setDisplayTimeZone(person.timezone);
    }
    setIsTimeZonePickerOpen(false);
  };

  const eventEditorStartsAtIso = eventEditor
    ? localDateTimeFieldsToIso(eventEditor.date, eventEditor.time, eventEditor.timeZone)
    : null;
  const appThemeClass = selectedPerson ? `theme-${selectedPerson.color}` : 'theme-neutral';

  return (
    <main className={`app-shell ${appThemeClass}`}>
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
            <div className="brand-row">
              <h1 className="app-title">🗓️ Team IGP</h1>
            </div>

            <div className="header-actions">
              <button
                aria-label="Open guide"
                className="header-icon-action"
                onClick={() => {
                  setGuideTopic('overview');
                  setIsGuideOpen(true);
                }}
                title="Guide"
                type="button"
              >
                <CircleHelp size={17} />
              </button>
              <div
                aria-label={syncLabel}
                className={`sync-state ${status}`}
                role="status"
                title={syncLabel}
              >
                {status === 'loading' ? <RefreshCw size={15} className="spin" /> : <Clock size={15} />}
                <span className="sr-only">{syncLabel}</span>
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
            <section className="upcoming-event" aria-label="Upcoming event">
              <div>
                <span className="context-label">Next event</span>
                <strong>{nextEvent.title}</strong>
                {nextEventUrl ? (
                  <a className="event-time-link" href={nextEventUrl} rel="noreferrer" target="_blank">
                    {formatEventDateTime(nextEvent.starts_at, displayTimeZone)}
                  </a>
                ) : (
                  <span>{formatEventDateTime(nextEvent.starts_at, displayTimeZone)}</span>
                )}
              </div>
              {nextEvent.note && <p>{nextEvent.note}</p>}
            </section>
          )}

          <section className="context-row" aria-label="Scheduler context">
            <div>
              <span className="context-label">Viewing as</span>
              <strong>{selectedPerson.name}</strong>
              <div className="timezone-switcher">
                <button
                  aria-expanded={isTimeZonePickerOpen}
                  className="timezone-trigger"
                  disabled={unsavedCount > 0 || saveState === 'saving'}
                  onClick={() => setIsTimeZonePickerOpen((current) => !current)}
                  title={unsavedCount > 0 ? 'Save or undo changes before changing time basis' : 'Change display time basis'}
                  type="button"
                >
                  {displayTimeZoneOption.city}, {timezoneLabel}
                </button>
                {isTimeZonePickerOpen && (
                  <div className="timezone-menu" role="menu">
                    {VIEW_TIME_ZONES.map((option) => (
                      <button
                        aria-pressed={displayTimeZone === option.timezone}
                        key={option.timezone}
                        onClick={() => changeDisplayTimeZone(option.timezone)}
                        role="menuitem"
                        type="button"
                      >
                        <span>{option.city}</span>
                        <small>
                          {option.label} {formatTimezoneLabel(option.timezone, new Date(slots[0]?.iso ?? Date.now()))}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                title="Reset"
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
                title={isTouchPaintMode ? 'Drag mode on' : 'Drag mode'}
                type="button"
              >
                <span className="touch-paint-label">Drag</span>
              </button>
            </div>

            <button
              aria-expanded={isQuickFillOpen}
              className="quick-fill-trigger"
              onClick={() => setIsQuickFillOpen((current) => !current)}
              title={isQuickFillOpen ? 'Hide quick fill' : 'Quick fill'}
              type="button"
            >
              <SlidersHorizontal size={15} />
              <span>Quick fill</span>
            </button>

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
                title="Save"
                type="button"
              >
                {saveState === 'saving' ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
              </button>
            </div>
          </section>

          {isQuickFillOpen && (
            <section className="quick-fill-panel" aria-label="Quick fill availability">
              <div className="quick-fill-meta">
                <span className="context-label">Quick fill</span>
                <small>Draft only. Save to publish.</small>
              </div>
              <label>
                <span>From</span>
                <select
                  onChange={(event) => setQuickFillStart(event.target.value)}
                  value={quickFillStart}
                >
                  {QUICK_FILL_TIME_OPTIONS.slice(0, -1).map((timeOption) => (
                    <option key={timeOption} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>To</span>
                <select
                  onChange={(event) => setQuickFillEnd(event.target.value)}
                  value={quickFillEnd}
                >
                  {QUICK_FILL_TIME_OPTIONS.slice(1).map((timeOption) => (
                    <option key={timeOption} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </label>
              <div className="quick-fill-days-field">
                <span>Days</span>
                <div className="quick-fill-days" role="group" aria-label="Quick fill days">
                  {QUICK_FILL_DAY_OPTIONS.map((option) => {
                    const isSelected = quickFillDays.has(option.value);

                    return (
                      <button
                        aria-pressed={isSelected}
                        className="quick-fill-day"
                        key={option.value}
                        onClick={() =>
                          setQuickFillDays((current) => {
                            const next = new Set(current);

                            if (next.has(option.value)) {
                              next.delete(option.value);
                            } else {
                              next.add(option.value);
                            }

                            return next;
                          })
                        }
                        title={option.label}
                        type="button"
                      >
                        {option.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="quick-fill-actions">
                <button
                  className="secondary-action"
                  disabled={saveState === 'saving' || quickFillDays.size === 0 || timeLabelToMinutes(quickFillEnd) <= timeLabelToMinutes(quickFillStart)}
                  onClick={() => applyQuickFill('week')}
                  type="button"
                >
                  This week
                </button>
                <button
                  className="primary-action"
                  disabled={saveState === 'saving' || quickFillDays.size === 0 || timeLabelToMinutes(quickFillEnd) <= timeLabelToMinutes(quickFillStart)}
                  onClick={() => applyQuickFill('all-weeks')}
                  type="button"
                >
                  All weeks
                </button>
              </div>
            </section>
          )}

          <section className="scheduler-nav" aria-label="Week navigation">
            <div className="week-pager">
              <button
                aria-label="Previous week"
                disabled={weekOffset === 0 || unsavedCount > 0 || saveState === 'saving'}
                onClick={goToPreviousWeek}
                title="Previous week"
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
                title="Next week"
                type="button"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <span>{weekRange}</span>
          </section>

          <section className={`scheduler ${isTouchPaintMode ? 'paint-mode' : ''}`} aria-label="Weekly availability grid">
            <div className="grid-head time-head">Time</div>
            {dayDates.map((day) => (
              <div className="grid-head day-head" key={day.label}>
                {day.label}
              </div>
            ))}

            {Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
              if (areSleepHoursCollapsed && hour === SLEEP_HOURS_START) {
                return (
                  <div className="row-fragment" key="sleep-hours-collapsed">
                    <div className="time-cell sleep-toggle-cell">
                      <button
                        aria-expanded="false"
                        className="sleep-toggle"
                        onClick={() => setAreSleepHoursCollapsed(false)}
                title="Show 01:00-07:00"
                        type="button"
                      >
                        <span>01-07</span>
                        <small>show</small>
                      </button>
                    </div>
                    {DAY_LABELS.map((dayLabel) => (
                      <div aria-hidden="true" className="hour-cell sleep-collapsed-cell" key={`sleep-${dayLabel}`} />
                    ))}
                  </div>
                );
              }

              if (areSleepHoursCollapsed && hour > SLEEP_HOURS_START && hour < SLEEP_HOURS_END) {
                return null;
              }

              const timeLabel = `${String(hour).padStart(2, '0')}:00`;
              const periodLabel = hour === 0 ? '오전' : hour === 12 ? '오후' : '';
              const periodClass = hour === 12 ? 'period-start' : '';
              const sleepToggleClass = !areSleepHoursCollapsed && hour === SLEEP_HOURS_START ? 'sleep-toggle-cell' : '';

              return (
                <div className="row-fragment" key={timeLabel}>
                  <div className={`time-cell ${periodClass} ${sleepToggleClass}`}>
                    {!areSleepHoursCollapsed && hour === SLEEP_HOURS_START ? (
                      <button
                        aria-expanded="true"
                        className="sleep-toggle"
                        onClick={() => setAreSleepHoursCollapsed(true)}
                        title="Hide 01:00-07:00"
                        type="button"
                      >
                        <span>01-07</span>
                        <small>hide</small>
                      </button>
                    ) : (
                      <>
                        <span>{timeLabel}</span>
                        {periodLabel && <small>{periodLabel}</small>}
                      </>
                    )}
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
                          const dirtyClass = dirtySlotTimes.has(slot.iso) ? 'dirty' : '';
                          const emptyClass = availableUsers.length === 0 ? 'empty' : '';
                          const eventClass = slotEvents.length > 0 ? 'has-event' : '';
                          const hasRelevantEvent = slotEvents.some((eventRow) => isEventRelevantToUser(eventRow, selectedUser));
                          const eventMutedClass = slotEvents.length > 0 && !hasRelevantEvent ? 'event-muted' : '';
                          const startingEvents = slotEvents.filter((eventRow) => normalizeSlotTime(eventRow.starts_at) === slot.iso);
                          const startsEvent = startingEvents.length > 0;
                          const eventStartClass = slotEvents.length === 0 ? '' : startsEvent ? 'event-start' : 'event-continuation';
                          const eventSlotSpan = Math.max(
                            1,
                            ...startingEvents.map((eventRow) => Math.ceil(getEventDurationMinutes(eventRow) / MINUTES_PER_SLOT)),
                          );
                          const eventBlockStyle = { '--event-slot-span': eventSlotSpan } as CSSProperties;

                          return (
                            <button
                              aria-label={`${DAY_LABELS[dayIndex]} ${slot.localLabel}, ${availableUsers.length} available, ${slotEvents.length} events`}
                              className={`half-slot slot-cell ${emptyClass} ${mineClass} ${dirtyClass} ${eventClass} ${eventMutedClass} ${eventStartClass}`}
                              data-slot-key={slot.key}
                              key={slot.key}
                              onContextMenu={(event) => handleSlotContextMenu(event, slot, slotEvents)}
                              onPointerDown={(event) => handleSlotPointerDown(event, slot, slotEvents)}
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
                                  {startsEvent && (
                                    <span aria-hidden="true" className="event-block" style={eventBlockStyle}>
                                      <span className="event-badge">{formatEventBadge(startingEvents)}</span>
                                    </span>
                                  )}
                                  <span className="event-tooltip" role="tooltip">
                                    {slotEvents.map((eventRow) => (
                                      <span className="event-tooltip-item" key={eventRow.id ?? `${eventRow.starts_at}-${eventRow.title}`}>
                                        <strong>{eventRow.title}</strong>
                                        <span>
                                          {formatEventDateTime(eventRow.starts_at, displayTimeZone)} · {formatDuration(getEventDurationMinutes(eventRow))}
                                        </span>
                                        <span>Attendees: {formatAttendeeLabel(eventRow)}</span>
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

          {isGuideOpen && (
            <div className="guide-dialog-backdrop" role="presentation">
              <section aria-modal="true" className="guide-dialog" role="dialog" aria-label="Scheduler guide">
                <button aria-label="Close guide" className="event-dialog-close" onClick={() => setIsGuideOpen(false)} type="button">
                  <X size={16} />
                </button>
                <div className="guide-dialog-heading">
                  <span className="context-label">Guide</span>
                  <strong>{isCompactGuide ? 'Mobile guide' : 'Web guide'}</strong>
                  <span>{isCompactGuide ? 'Touch-friendly steps for phone browsers.' : 'Mouse and keyboard steps for desktop browsers.'}</span>
                </div>
                <div className="guide-topic-tabs" aria-label="Guide topics">
                  <button
                    aria-pressed={guideTopic === 'overview'}
                    onClick={() => setGuideTopic('overview')}
                    type="button"
                  >
                    Overview
                  </button>
                  <button
                    aria-pressed={guideTopic === 'create'}
                    onClick={() => setGuideTopic('create')}
                    type="button"
                  >
                    Create event
                  </button>
                </div>

                {guideTopic === 'overview' ? (
                  <div className="guide-card-grid">
                    <article className="guide-card">
                      <div className="guide-visual slot-visual" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                      <div>
                        <strong>Mark availability</strong>
                        <p>{isCompactGuide ? 'Turn on Drag only when you want to paint many slots. Leave it off for normal scrolling.' : 'Click and drag across slots to mark your available time.'}</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual drag-visual" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <small>Drag</small>
                      </div>
                      <div>
                        <strong>Drag selection</strong>
                        <p>{isCompactGuide ? 'Tap Drag, swipe across the slots you want, then turn Drag off so scrolling stays normal.' : 'Press on a slot and drag across nearby slots. The whole dragged range follows the first slot action.'}</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual quick-visual" aria-hidden="true">
                        <span>07:00</span>
                        <span>10:00</span>
                        <strong>All weeks</strong>
                      </div>
                      <div>
                        <strong>Repeat a regular time</strong>
                        <p>Tap the center Quick fill button for regular availability like 07:00-10:00, then choose the exact weekdays you want. You can still remove a few slots by hand before pressing Save.</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual event-visual" aria-hidden="true">
                        <span />
                        <span />
                      </div>
                      <div>
                        <strong>Read events</strong>
                        <p>Colored availability stays in the background. Event borders and badges sit on top so they stay visible.</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual save-visual" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div>
                        <strong>Save availability</strong>
                        <p>Your availability changes publish after Save. Events publish immediately when added or edited.</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual timezone-visual" aria-hidden="true">
                        <span>Viewing as</span>
                        <strong>{selectedPerson.name}</strong>
                        <small>{displayTimeZoneOption.city}, {timezoneLabel}</small>
                      </div>
                      <div>
                        <strong>Change time basis</strong>
                        <p>Tap the timezone text next to Viewing as your name to switch the grid between Seoul, Sydney, and Perth time.</p>
                      </div>
                    </article>
                    <article className="guide-card">
                      <div className="guide-visual sleep-visual" aria-hidden="true">
                        <strong>01-07</strong>
                        <small>show / hide</small>
                      </div>
                      <div>
                        <strong>Fold sleep hours</strong>
                        <p>01:00-07:00 is folded by default. Tap 01-07 in the time column when you need to view or edit those slots.</p>
                      </div>
                    </article>
                  </div>
                ) : (
                  <div className="guide-create-layout">
                    <div className="guide-device-card" aria-hidden="true">
                      {isCompactGuide ? <Smartphone size={34} /> : <MonitorSmartphone size={34} />}
                      <div className="guide-device-grid">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                      <MousePointerClick size={26} />
                    </div>
                    <div className="guide-steps">
                      <strong>Create event</strong>
                      {isCompactGuide ? (
                        <>
                          <p>Long-press the target time slot until the event popup opens.</p>
                          <p>Set title, date, time basis, duration, repeat count, attendees, and memo.</p>
                          <p>Tap Add or Save. You do not need to press the availability Save button again.</p>
                        </>
                      ) : (
                        <>
                          <p>Right-click the target time slot to open the event popup.</p>
                          <p>Set title, date, time basis, duration, repeat count, attendees, and memo.</p>
                          <p>Click Add or Save. The event syncs immediately for everyone.</p>
                        </>
                      )}
                      <dl className="guide-field-list">
                        <div>
                          <dt>Title</dt>
                          <dd>Name the event. The default is Meeting.</dd>
                        </div>
                        <div>
                          <dt>Date / Time</dt>
                          <dd>Pick the exact start date and start time.</dd>
                        </div>
                        <div>
                          <dt>Time basis</dt>
                          <dd>Choose whether the typed time is Seoul, Sydney, or Perth time.</dd>
                        </div>
                        <div>
                          <dt>Duration</dt>
                          <dd>Set how long the event lasts, such as 20m, 1h, or 2h.</dd>
                        </div>
                        <div>
                          <dt>Attendees</dt>
                          <dd>Default is everyone. If someone is not selected, they still see it in gray.</dd>
                        </div>
                        <div>
                          <dt>Repeat weekly</dt>
                          <dd>Turn this on to create the same event for multiple weeks.</dd>
                        </div>
                        <div>
                          <dt>Memo</dt>
                          <dd>Add a meeting link, agenda, or short note. If there is a link, the Next event time opens it.</dd>
                        </div>
                        <div>
                          <dt>Add / Save</dt>
                          <dd>Publishes the event immediately. No extra availability Save is needed.</dd>
                        </div>
                        <div>
                          <dt>Delete / X</dt>
                          <dd>Delete removes an existing event. X closes the popup without saving.</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {eventEditor && (
            <div className="event-dialog-backdrop" role="presentation">
              <form
                className="event-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEvent();
                }}
              >
                <button aria-label="Close event editor" className="event-dialog-close" onClick={closeEventEditor} type="button">
                  <X size={16} />
                </button>
                <div className="event-dialog-heading">
                  <span className="context-label">{eventEditor.id ? 'Edit event' : 'New event'}</span>
                  <strong>{eventEditorStartsAtIso ? formatEventDateTime(eventEditorStartsAtIso, eventEditor.timeZone) : ''}</strong>
                </div>
                <label>
                  Title
                  <input
                    autoFocus
                    onChange={(event) => setEventEditor((current) => (current ? { ...current, title: event.target.value } : current))}
                    value={eventEditor.title}
                  />
                </label>
                <div className="event-time-fields">
                  <label>
                    Date
                    <input
                      onChange={(event) =>
                        setEventEditor((current) =>
                          current
                            ? {
                                ...current,
                                date: event.target.value,
                                startsAtIso: localDateTimeFieldsToIso(event.target.value, current.time, current.timeZone),
                              }
                            : current,
                        )
                      }
                      type="date"
                      value={eventEditor.date}
                    />
                  </label>
                  <label>
                    Time
                    <input
                      onChange={(event) =>
                        setEventEditor((current) =>
                          current
                            ? {
                                ...current,
                                time: event.target.value,
                                startsAtIso: localDateTimeFieldsToIso(current.date, event.target.value, current.timeZone),
                              }
                            : current,
                        )
                      }
                      step={600}
                      type="time"
                      value={eventEditor.time}
                    />
                  </label>
                  <label>
                    Time basis
                    <select
                      onChange={(event) =>
                        setEventEditor((current) => {
                          if (!current) return current;

                          const currentIso = localDateTimeFieldsToIso(current.date, current.time, current.timeZone);
                          const nextFields = getLocalDateTimeFields(currentIso, event.target.value);

                          return {
                            ...current,
                            ...nextFields,
                            startsAtIso: currentIso,
                            timeZone: event.target.value,
                          };
                        })
                      }
                      value={eventEditor.timeZone}
                    >
                      {VIEW_TIME_ZONES.map((option) => (
                        <option key={option.timezone} value={option.timezone}>
                          {option.city} · {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset className="duration-picker">
                  <legend>Duration</legend>
                  <div>
                    {EVENT_DURATION_OPTIONS.map((durationOption) => (
                      <button
                        aria-pressed={eventEditor.durationMinutes === durationOption.value}
                        className="duration-option"
                        key={durationOption.value}
                        onClick={() =>
                          setEventEditor((current) =>
                            current ? { ...current, durationMinutes: durationOption.value } : current,
                          )
                        }
                        type="button"
                      >
                        {durationOption.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="attendee-picker">
                  <legend>Attendees</legend>
                  <div>
                    {PEOPLE.map((person) => {
                      const isSelected = eventEditor.attendees.includes(person.name);

                      return (
                        <button
                          aria-pressed={isSelected}
                          className="attendee-option"
                          key={person.name}
                          onClick={() =>
                            setEventEditor((current) => {
                              if (!current) return current;

                              const nextAttendees = current.attendees.includes(person.name)
                                ? current.attendees.filter((name) => name !== person.name)
                                : [...current.attendees, person.name];

                              return nextAttendees.length > 0 ? { ...current, attendees: nextAttendees } : current;
                            })
                          }
                          type="button"
                        >
                          <span aria-hidden="true" className={`attendee-dot ${person.color}`} />
                          <span>{person.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                {!eventEditor.id && (
                  <fieldset className="repeat-picker">
                    <legend className="sr-only">Repeat</legend>
                    <label className="repeat-toggle">
                      <input
                        checked={eventEditor.repeatWeekly}
                        onChange={(event) =>
                          setEventEditor((current) => (current ? { ...current, repeatWeekly: event.target.checked } : current))
                        }
                        type="checkbox"
                      />
                      Repeat weekly
                    </label>
                    {eventEditor.repeatWeekly && (
                      <label>
                        Repeat count
                        <select
                          onChange={(event) =>
                            setEventEditor((current) =>
                              current ? { ...current, repeatCount: Number(event.target.value) } : current,
                            )
                          }
                          value={eventEditor.repeatCount}
                        >
                          {EVENT_REPEAT_COUNT_OPTIONS.map((count) => (
                            <option key={count} value={count}>
                              {count} times
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </fieldset>
                )}
                <label>
                  Memo
                  <textarea
                    onChange={(event) => setEventEditor((current) => (current ? { ...current, note: event.target.value } : current))}
                    placeholder="Meeting link, agenda, or short memo"
                    value={eventEditor.note}
                  />
                </label>
                <div className="event-dialog-actions">
                  {eventEditor.id && (
                    <button className="danger-action" disabled={eventSaveState === 'saving'} onClick={() => void deleteEvent()} type="button">
                      Delete
                    </button>
                  )}
                  <button className="primary-action" disabled={eventSaveState === 'saving'} type="submit">
                    {eventSaveState === 'saving' ? 'Saving...' : eventEditor.id ? 'Save' : 'Add'}
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
