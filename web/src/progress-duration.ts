export function formatProgressDuration(endMs: number, nowMs: number, locale: string): string {
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return '—';
  const minutes = Math.max(0, Math.floor((endMs - nowMs) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  const unit = (value: number, name: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
  return days ? `${unit(days, 'day')} ${unit(hours, 'hour')}`
    : hours ? `${unit(hours, 'hour')} ${unit(mins, 'minute')}` : unit(mins, 'minute');
}
