// Übersetzt die gängigen Airflow-Zeitpläne in deutschen Klartext.
// Unbekannte Muster liefern null – die UI zeigt dann nur den Rohwert.

const WEEKDAYS = ['sonntags', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags'];
const WEEKDAY_ALIASES = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

const PRESETS = {
  '@once': 'einmalig',
  '@hourly': 'stündlich zur vollen Stunde',
  '@daily': 'täglich um 00:00 Uhr',
  '@midnight': 'täglich um 00:00 Uhr',
  '@weekly': 'wöchentlich sonntags um 00:00 Uhr',
  '@monthly': 'monatlich am 1. um 00:00 Uhr',
  '@quarterly': 'vierteljährlich am 1. um 00:00 Uhr',
  '@yearly': 'jährlich am 1. Januar um 00:00 Uhr',
  '@annually': 'jährlich am 1. Januar um 00:00 Uhr',
};

/** Liefert eine Klartext-Beschreibung oder null, wenn das Muster nicht sicher erkannt wird. */
export function describeCron(expression) {
  if (typeof expression !== 'string') return null;
  const trimmed = expression.trim();
  if (PRESETS[trimmed.toLowerCase()]) return PRESETS[trimmed.toLowerCase()];

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  try {
    return describeFields(minute, hour, dayOfMonth, month, dayOfWeek);
  } catch {
    return null;
  }
}

function describeFields(minute, hour, dayOfMonth, month, dayOfWeek) {
  // Alle n Minuten
  if (/^\*\/\d+$/.test(minute) && hour === '*' && isAll(dayOfMonth, month, dayOfWeek)) {
    return `alle ${minute.slice(2)} Minuten`;
  }
  if (!isNumber(minute)) return null;

  // Stündlich bzw. alle n Stunden
  if (hour === '*' && isAll(dayOfMonth, month, dayOfWeek)) {
    return `stündlich zur Minute ${Number(minute)}`;
  }
  const stepHours = hour.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
  if (stepHours && isAll(dayOfMonth, month, dayOfWeek)) {
    return `alle ${stepHours[2]} Stunden${stepHours[1] === '*' ? '' : ` (ab ${stepHours[1].split('-')[0]} Uhr)`}, jeweils zur Minute ${Number(minute)}`;
  }

  const times = describeTimes(minute, hour);
  if (!times) return null;

  if (isAll(dayOfMonth, month, dayOfWeek)) return `täglich um ${times}`;

  if (dayOfMonth === '*' && month === '*') {
    const days = describeWeekdays(dayOfWeek);
    return days ? `${days} um ${times}` : null;
  }

  if (dayOfWeek === '*' && isNumberList(dayOfMonth)) {
    const days = joinGerman(dayOfMonth.split(',').map((d) => `${Number(d)}.`));
    if (month === '*') return `monatlich am ${days} um ${times}`;
    if (isNumberList(month)) {
      const months = joinGerman(month.split(',').map((m) => MONTHS[Number(m) - 1]));
      if (months.includes('undefined')) return null;
      return `jährlich am ${days} ${months} um ${times}`;
    }
  }
  return null;
}

/** „04:00 Uhr“ bzw. „04:00 und 16:00 Uhr“ für Stundenlisten. */
function describeTimes(minute, hour) {
  if (!isNumberList(hour)) return null;
  const hours = hour.split(',').map(Number);
  if (hours.some((h) => h > 23) || Number(minute) > 59) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${joinGerman(hours.map((h) => `${pad(h)}:${pad(Number(minute))}`))} Uhr`;
}

/** „montags bis freitags“, „montags und donnerstags“ … */
function describeWeekdays(field) {
  const normalized = field.toUpperCase().replace(/[A-Z]{3}/g, (name) => {
    if (!(name in WEEKDAY_ALIASES)) throw new Error(`Unbekannter Wochentag ${name}`);
    return String(WEEKDAY_ALIASES[name]);
  });
  const parts = normalized.split(',');
  const described = parts.map((part) => {
    const range = part.match(/^(\d)-(\d)$/);
    if (range) return `${weekday(range[1])} bis ${weekday(range[2])}`;
    if (/^\d$/.test(part)) return weekday(part);
    throw new Error(`Unbekanntes Wochentagsmuster ${part}`);
  });
  return joinGerman(described);
}

function weekday(value) {
  const day = Number(value) % 7; // 7 ist ebenfalls Sonntag
  return WEEKDAYS[day];
}

function joinGerman(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

function isAll(...fields) {
  return fields.every((field) => field === '*' || field === '?');
}

function isNumber(value) {
  return /^\d+$/.test(value);
}

function isNumberList(value) {
  return /^\d+(,\d+)*$/.test(value);
}
